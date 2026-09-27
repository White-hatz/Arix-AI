"""MCP Client Manager: subprocess lifecycle, tool discovery, and execution routing for Arix AI."""

from __future__ import annotations

import asyncio
from contextlib import AsyncExitStack
import json
import logging
import os
from pathlib import Path
import shutil
import sys
import time
from typing import Any

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client
from mcp.types import Tool

from backend.app.services.mcp.bridge import mcp_result_to_dict, mcp_tool_to_gemini_declaration
from backend.app.services.mcp.playwright_wrapper import build_highlight_script, detect_captcha
from backend.app.services.session_reports import save_session_report

logger = logging.getLogger("backend.services.mcp.manager")

CONFIG_FILE_PATH = Path(__file__).parent / "mcp_servers.json"


def check_node_available() -> dict[str, Any]:
    """Detects if Node.js and npx are installed on host system."""
    node_bin = shutil.which("node")
    npx_bin = shutil.which("npx") or shutil.which("npx.cmd")
    available = bool(node_bin and npx_bin)
    return {
        "available": available,
        "node_path": node_bin or "",
        "npx_path": npx_bin or "",
        "message": (
            "Node.js runtime detected."
            if available
            else "Node.js or npx not found on PATH. Please install Node.js (https://nodejs.org) to run MCP servers."
        ),
    }


class MCPServerInstance:
    """Manages a single stdio-connected MCP server process."""

    def __init__(self, server_id: str, config: dict[str, Any]) -> None:
        self.server_id = server_id
        self.config = config
        self.session: ClientSession | None = None
        self._exit_stack: AsyncExitStack | None = None
        self.tools: list[Tool] = []
        self.gemini_declarations: list[dict[str, Any]] = []
        self.status: str = "disconnected"  # "connected" | "connecting" | "disconnected" | "error"
        self.last_error: str | None = None
        self.lock = asyncio.Lock()
        self.started_at: float = 0
        self.logs: list[str] = []

    def log(self, msg: str) -> None:
        entry = f"[{time.strftime('%X')}] {msg}"
        self.logs.append(entry)
        if len(self.logs) > 100:
            self.logs = self.logs[-100:]
        logger.info("[MCP:%s] %s", self.server_id, msg)

    async def connect(self) -> bool:
        """Establishes stdio connection, performs protocol handshake, and discovers tools."""
        async with self.lock:
            if self.status == "connected" and self.session:
                return True

            node_check = check_node_available()
            if not node_check["available"]:
                self.status = "error"
                self.last_error = node_check["message"]
                self.log(self.last_error)
                return False

            self.status = "connecting"
            self.last_error = None
            self.log(f"Spawning {self.server_id} with command: {self.config.get('command')} {self.config.get('args')}")

            # Resolve command path (e.g. npx -> npx.cmd on Windows)
            raw_cmd = self.config.get("command", "npx")
            resolved_cmd = shutil.which(raw_cmd) or shutil.which(f"{raw_cmd}.cmd") or raw_cmd
            args = self.config.get("args", [])
            env = self.config.get("env")

            # Enforce local privacy across all spawned servers
            merged_env = os.environ.copy()
            merged_env["COMPOSIO_DISABLE_TELEMETRY"] = "true"
            if env and isinstance(env, dict):
                merged_env.update(env)

            server_params = StdioServerParameters(
                command=resolved_cmd,
                args=args,
                env=merged_env,
            )

            try:
                self._exit_stack = AsyncExitStack()
                read_stream, write_stream = await self._exit_stack.enter_async_context(
                    stdio_client(server_params)
                )
                session = await self._exit_stack.enter_async_context(
                    ClientSession(read_stream, write_stream)
                )

                init_res = await session.initialize()
                self.session = session
                self.started_at = time.time()
                self.log(f"Connected successfully (server={init_res.server_info.name} v{init_res.server_info.version})")

                # Discover available tools
                tools_res = await session.list_tools()
                self.tools = tools_res.tools
                self.gemini_declarations = [
                    mcp_tool_to_gemini_declaration(t, server_id=self.server_id)
                    for t in self.tools
                ]

                # If playwright server, inject custom high-level helper tool declarations
                if self.server_id == "playwright":
                    self._inject_playwright_helpers()

                self.status = "connected"
                self.log(f"Discovered {len(self.tools)} tools dynamically.")
                return True

            except Exception as err:
                self.status = "error"
                self.last_error = str(err)
                self.log(f"Connection failed: {err}")
                await self._cleanup()
                return False

    def _inject_playwright_helpers(self) -> None:
        """Exposes browser_highlight tour guide tool on top of Playwright MCP."""
        # Ensure browser_highlight is listed for the agent
        has_highlight = any(d["name"] == "browser_highlight" for d in self.gemini_declarations)
        if not has_highlight:
            self.gemini_declarations.append({
                "name": "browser_highlight",
                "description": (
                    "Tour-guide annotation: draws a glowing pulse border and floating badge around the target element "
                    "on the web page, smoothly scrolling it into view for user guidance."
                ),
                "parameters": {
                    "type": "OBJECT",
                    "properties": {
                        "selector": {"type": "STRING", "description": "CSS selector of element to highlight."},
                        "note": {"type": "STRING", "description": "Tour guide explanation note to display in badge."},
                    },
                    "required": ["selector"],
                },
            })

    async def _cleanup(self) -> None:
        if self._exit_stack:
            try:
                await self._exit_stack.aclose()
            except Exception as e:
                logger.debug("Error during exit stack aclose: %s", e)
            self._exit_stack = None
        self.session = None

    async def disconnect(self) -> None:
        """Terminates subprocess cleanly without leaving orphaned Node processes."""
        async with self.lock:
            self.log("Stopping MCP server process...")
            await self._cleanup()
            self.status = "disconnected"
            self.log("Server disconnected cleanly.")

    async def call_tool(self, tool_name: str, arguments: dict[str, Any]) -> dict[str, Any]:
        """Calls a tool on this MCP server with automatic reconnection and error handling."""
        start_time = time.time()

        if self.status != "connected" or not self.session:
            connected = await self.connect()
            if not connected:
                return {
                    "success": False,
                    "source": f"mcp:{self.server_id}",
                    "tool": tool_name,
                    "error": f"Failed to connect to MCP server '{self.server_id}': {self.last_error}",
                }

        assert self.session is not None

        # Handle Playwright tour-guide highlight helper wrapper
        if self.server_id == "playwright" and tool_name == "browser_highlight":
            selector = arguments.get("selector", "")
            note = arguments.get("note", "")
            js_fn = build_highlight_script(selector, note)
            try:
                eval_res = await self.session.call_tool("browser_evaluate", arguments={"function": js_fn})
                duration = time.time() - start_time
                res_dict = mcp_result_to_dict(eval_res, self.server_id, "browser_highlight")
                res_dict["highlighted_selector"] = selector
                res_dict["note"] = note
                res_dict["duration_ms"] = int(duration * 1000)

                # Capture an updated screenshot so the UI highlights visually
                try:
                    shot_res = await self.session.call_tool("browser_take_screenshot", arguments={"scale": "css"})
                    shot_dict = mcp_result_to_dict(shot_res, self.server_id, "browser_take_screenshot")
                    if shot_dict.get("screenshot"):
                        res_dict["screenshot"] = shot_dict["screenshot"]
                except Exception:
                    pass

                self.log(f"Called browser_highlight({selector}) in {res_dict['duration_ms']}ms")
                return res_dict
            except Exception as err:
                self.log(f"Error calling browser_highlight: {err}")
                return {"success": False, "source": "mcp:playwright", "tool": "browser_highlight", "error": str(err)}

        # Normal MCP tool invocation
        try:
            # Map sequential_thinking to sequentialthinking if needed
            effective_tool_name = tool_name
            if self.server_id == "sequential-thinking" and tool_name == "sequential_thinking":
                effective_tool_name = "sequentialthinking"

            mcp_res = await self.session.call_tool(effective_tool_name, arguments=arguments)
            duration = time.time() - start_time
            res_dict = mcp_result_to_dict(mcp_res, self.server_id, tool_name)
            res_dict["duration_ms"] = int(duration * 1000)

            # Auto-check for CAPTCHA if snapshot tool called
            if self.server_id == "playwright" and tool_name in ("browser_snapshot", "browser_find"):
                captcha_info = detect_captcha(res_dict.get("content", ""))
                if captcha_info["captcha_detected"]:
                    res_dict["captcha"] = captcha_info

            self.log(f"Called {tool_name} -> success={res_dict['success']} ({res_dict['duration_ms']}ms)")
            return res_dict

        except Exception as err:
            self.log(f"Tool call {tool_name} failed: {err}")
            # Detect process crash
            self.status = "error"
            self.last_error = str(err)
            return {
                "success": False,
                "source": f"mcp:{self.server_id}",
                "tool": tool_name,
                "error": f"MCP tool execution failed: {err}",
            }


class MCPClientManager:
    """Central registry and routing manager for all MCP servers."""

    def __init__(self) -> None:
        self.servers: dict[str, MCPServerInstance] = {}
        self._load_configs()

    def _load_configs(self) -> None:
        """Loads server definitions from mcp_servers.json."""
        if CONFIG_FILE_PATH.exists():
            try:
                data = json.loads(CONFIG_FILE_PATH.read_text(encoding="utf-8"))
                for s_id, s_cfg in data.get("servers", {}).items():
                    self.servers[s_id] = MCPServerInstance(s_id, s_cfg)
                return
            except Exception as err:
                logger.error("Failed to parse %s: %s", CONFIG_FILE_PATH, err)

        # Fallback defaults
        default_configs = {
            "sequential-thinking": {
                "id": "sequential-thinking",
                "name": "Anthropic Sequential Thinking",
                "command": "npx",
                "args": ["-y", "@modelcontextprotocol/server-sequential-thinking"],
                "enabled": True,
                "agents": ["coder", "assistant"],
                "description": "Structured step-by-step problem decomposition and reflective reasoning.",
            },
            "playwright": {
                "id": "playwright",
                "name": "Microsoft Playwright Browser",
                "command": "npx",
                "args": ["-y", "@playwright/mcp@latest"],
                "enabled": True,
                "agents": ["coder"],
                "description": "Official Microsoft Playwright browser automation and verification.",
            },
        }
        for s_id, s_cfg in default_configs.items():
            self.servers[s_id] = MCPServerInstance(s_id, s_cfg)

    def save_configs(self) -> None:
        """Persists server configuration changes back to disk."""
        data = {
            "servers": {
                s_id: inst.config for s_id, inst in self.servers.items()
            }
        }
        try:
            CONFIG_FILE_PATH.write_text(json.dumps(data, indent=2), encoding="utf-8")
        except Exception as err:
            logger.error("Failed to write %s: %s", CONFIG_FILE_PATH, err)

    async def get_tools_for_agent(self, agent_name: str) -> list[dict[str, Any]]:
        """Returns Gemini function declarations for all enabled MCP servers accessible to this agent."""
        declarations: list[dict[str, Any]] = []

        for server_id, instance in self.servers.items():
            if not instance.config.get("enabled", True):
                continue
            allowed_agents = instance.config.get("agents", ["coder", "assistant"])
            if agent_name not in allowed_agents:
                continue

            # Auto-connect if not yet connected to discover live tools
            if instance.status != "connected":
                await instance.connect()

            declarations.extend(instance.gemini_declarations)

        return declarations

    async def call_tool(self, tool_name: str, arguments: dict[str, Any], workspace_root: str = "") -> dict[str, Any]:
        """Routes a tool call to the appropriate MCP server hosting that tool."""
        # Find which server owns this tool
        target_server: MCPServerInstance | None = None

        if tool_name in ("sequentialthinking", "sequential_thinking"):
            target_server = self.servers.get("sequential-thinking")
        elif tool_name.startswith("browser_"):
            target_server = self.servers.get("playwright")
        else:
            for s in self.servers.values():
                if any(t.name == tool_name for t in s.tools):
                    target_server = s
                    break

        if not target_server:
            return {"success": False, "error": f"No active MCP server found for tool: {tool_name}"}

        res = await target_server.call_tool(tool_name, arguments)

        # Log to project session report if workspace_root provided
        if workspace_root:
            save_session_report(workspace_root, {
                "type": "mcp_tool_call",
                "server": target_server.server_id,
                "tool": tool_name,
                "arguments": arguments,
                "success": res.get("success", False),
                "duration_ms": res.get("duration_ms", 0),
            })

        return res

    def get_full_status(self) -> dict[str, Any]:
        """Returns aggregated status of all MCP servers and Node.js environment."""
        node_info = check_node_available()
        servers_status = {}

        for s_id, s in self.servers.items():
            servers_status[s_id] = {
                "id": s_id,
                "name": s.config.get("name", s_id),
                "enabled": s.config.get("enabled", True),
                "agents": s.config.get("agents", []),
                "description": s.config.get("description", ""),
                "status": s.status,
                "last_error": s.last_error,
                "tool_count": len(s.tools),
                "tools": [
                    {
                        "name": t.name,
                        "description": t.description or "",
                        "required": (t.input_schema or {}).get("required", []),
                    }
                    for t in s.tools
                ],
                "logs": s.logs[-20:],
            }

        return {
            "node": node_info,
            "servers": servers_status,
        }

    async def toggle_server(self, server_id: str, enabled: bool) -> dict[str, Any]:
        """Enables or disables an MCP server."""
        if server_id not in self.servers:
            return {"ok": False, "error": f"Server {server_id} not found"}

        server = self.servers[server_id]
        server.config["enabled"] = enabled
        self.save_configs()

        if not enabled and server.status == "connected":
            await server.disconnect()
        elif enabled and server.status != "connected":
            await server.connect()

        return {"ok": True, "server_id": server_id, "enabled": enabled, "status": server.status}

    async def restart_server(self, server_id: str) -> dict[str, Any]:
        """Restarts an MCP server process."""
        if server_id not in self.servers:
            return {"ok": False, "error": f"Server {server_id} not found"}

        server = self.servers[server_id]
        await server.disconnect()
        success = await server.connect()
        return {
            "ok": success,
            "server_id": server_id,
            "status": server.status,
            "tool_count": len(server.tools),
            "error": server.last_error,
        }

    async def shutdown_all(self) -> None:
        """Clean shutdown of all running server child processes."""
        for s in self.servers.values():
            if s.status == "connected":
                await s.disconnect()


# Global singleton manager
mcp_manager = MCPClientManager()
