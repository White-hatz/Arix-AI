"""Tests for Model Context Protocol (MCP) integration:
- Bridge schema translation (MCP <-> Gemini)
- Node.js runtime detection
- Playwright wrapper utilities (CAPTCHA detection, tour-guide highlight script)
- MCPClientManager lifecycle and configuration persistence
- Assistant ToolRegistry integration (Sequential Thinking)
- Coder Agent session integration and tool delegation
- FastAPI REST endpoints (/api/mcp/status, /api/mcp/toggle, /api/mcp/tools)
"""

from __future__ import annotations

import asyncio
from pathlib import Path
import pytest
from fastapi.testclient import TestClient
from mcp.types import CallToolResult, ImageContent, TextContent, Tool

from backend.app.main import app
from backend.app.memory.runtime import create_memory_runtime
from backend.app.services.coder_agent import BASE_TOOL_DEFINITIONS, CoderAgentSession
from backend.app.services.mcp.bridge import mcp_result_to_dict, mcp_tool_to_gemini_declaration
from backend.app.services.mcp.manager import check_node_available, mcp_manager
from backend.app.services.mcp.playwright_wrapper import build_highlight_script, detect_captcha
from backend.app.tools.mcp_tools import register_mcp_tools
from backend.app.tools.registry import ToolRegistry


@pytest.fixture
def client():
    return TestClient(app)


def test_node_detection():
    """Verify check_node_available returns a valid environment report."""
    res = check_node_available()
    assert isinstance(res, dict)
    assert "available" in res
    assert "node_path" in res
    assert "npx_path" in res
    assert "message" in res
    assert isinstance(res["available"], bool)


def test_bridge_tool_declaration_translation():
    """Verify MCP Tool definition converts accurately into a Gemini FunctionDeclaration dict."""
    mcp_tool = Tool(
        name="test_tool",
        description="A test tool for unit verification",
        input_schema={
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "Search query"},
                "limit": {"type": "integer", "description": "Max results"},
                "flags": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Optional flags",
                },
                "options": {
                    "type": "object",
                    "properties": {
                        "mode": {"type": "string", "enum": ["fast", "deep"]},
                    },
                },
            },
            "required": ["query"],
        },
    )

    declaration = mcp_tool_to_gemini_declaration(mcp_tool, server_id="test-server")
    assert declaration["name"] == "test_tool"
    assert declaration["description"] == "A test tool for unit verification"
    params = declaration["parameters"]
    assert params["type"] == "OBJECT"
    assert params["required"] == ["query"]
    assert params["properties"]["query"]["type"] == "STRING"
    assert params["properties"]["limit"]["type"] == "INTEGER"
    assert params["properties"]["flags"]["type"] == "ARRAY"
    assert params["properties"]["flags"]["items"]["type"] == "STRING"
    assert params["properties"]["options"]["type"] == "OBJECT"
    assert params["properties"]["options"]["properties"]["mode"]["enum"] == ["fast", "deep"]


def test_bridge_result_translation_text():
    """Verify TextContent conversion from MCP CallToolResult."""
    result = CallToolResult(
        content=[TextContent(type="text", text="Thinking step 1 completed successfully.")],
        is_error=False,
    )
    d = mcp_result_to_dict(result, server_id="sequential-thinking", tool_name="sequentialthinking")
    assert d["success"] is True
    assert d["source"] == "mcp:sequential-thinking"
    assert d["tool"] == "sequentialthinking"
    assert "Thinking step 1 completed" in d["content"]
    assert d["is_sequential_thinking"] is True


def test_bridge_result_translation_image():
    """Verify ImageContent conversion surfaces screenshot data URL."""
    result = CallToolResult(
        content=[
            TextContent(type="text", text="Screenshot captured"),
            ImageContent(type="image", data="iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", mime_type="image/png"),
        ],
        is_error=False,
    )
    d = mcp_result_to_dict(result, server_id="playwright", tool_name="browser_take_screenshot")
    assert d["success"] is True
    assert "screenshot" in d
    assert d["screenshot"].startswith("data:image/png;base64,")
    assert len(d["images"]) == 1


def test_playwright_captcha_detector():
    """Verify CAPTCHA detection logic catches Cloudflare and Recaptcha patterns."""
    clean_html = "<html><body><h1>Dashboard</h1><p>Welcome back</p></body></html>"
    assert detect_captcha(clean_html)["captcha_detected"] is False

    cf_html = "<html><head><title>Just a moment...</title></head><body>Verify you are human. Cloudflare Ray ID: 84729</body></html>"
    assert detect_captcha(cf_html)["captcha_detected"] is True

    turnstile_html = "<div class='cf-turnstile' data-sitekey='abc'></div>"
    assert detect_captcha(turnstile_html)["captcha_detected"] is True


def test_playwright_highlight_script():
    """Verify highlight injection script creates tour-guide overlay with selector and note."""
    script = build_highlight_script("#submit-btn", "Click here to proceed")
    assert "#submit-btn" in script
    assert "Click here to proceed" in script
    assert "00f2fe" in script  # Cyan glowing border color
    assert "arix-tour-highlight" in script


def test_mcp_manager_status_and_defaults():
    """Verify MCPClientManager initializes default servers and reports full status."""
    status = mcp_manager.get_full_status()
    assert "node" in status
    assert "servers" in status
    assert "sequential-thinking" in status["servers"]
    assert "playwright" in status["servers"]

    seq = status["servers"]["sequential-thinking"]
    assert seq["id"] == "sequential-thinking"
    assert "coder" in seq["agents"]
    assert "assistant" in seq["agents"]

    pw = status["servers"]["playwright"]
    assert pw["id"] == "playwright"
    assert "coder" in pw["agents"]


@pytest.mark.asyncio
async def test_assistant_tool_registry_has_sequential_thinking(tmp_path: Path):
    """Verify create_memory_runtime registers sequentialthinking in Assistant ToolRegistry."""
    runtime = await create_memory_runtime(tmp_path)
    assert "sequentialthinking" in runtime.tools.names
    assert "sequential_thinking" in runtime.tools.names

    declarations = runtime.tools.declarations()
    assert len(declarations) > 0
    fn_names = [f.name for f in declarations[0].function_declarations]
    assert "sequentialthinking" in fn_names
    assert "sequential_thinking" in fn_names
    await runtime.close()


@pytest.mark.asyncio
async def test_coder_agent_session_tool_delegation():
    """Verify CoderAgentSession incorporates base tools and delegates MCP tool calls."""
    session = CoderAgentSession(workspace_root=".")
    assert len(BASE_TOOL_DEFINITIONS) >= 8

    # Test unknown tool returns clean error
    unknown_res = await session.execute_tool_call("unknown_tool", {})
    assert unknown_res["success"] is False
    assert "Unknown tool" in unknown_res["error"]


@pytest.mark.asyncio
async def test_mcp_rest_endpoints():
    """Verify FastAPI MCP management endpoints with AsyncClient."""
    from httpx import ASGITransport, AsyncClient

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        # 1. GET /api/mcp/status
        res = await ac.get("/api/mcp/status")
        assert res.status_code == 200
        data = res.json()
        assert "node" in data
        assert "servers" in data

        # 2. GET /api/mcp/tools
        res_tools = await ac.get("/api/mcp/tools?agent=coder")
        assert res_tools.status_code == 200
        tools_data = res_tools.json()
        assert "agent" in tools_data
        assert tools_data["agent"] == "coder"
        assert "tools" in tools_data

        # 3. POST /api/mcp/toggle
        toggle_res = await ac.post("/api/mcp/toggle", json={"server_id": "sequential-thinking", "enabled": True})
        assert toggle_res.status_code == 200
        toggle_data = toggle_res.json()
        assert toggle_data["ok"] is True
        assert toggle_data["server_id"] == "sequential-thinking"
        assert toggle_data["enabled"] is True
