from __future__ import annotations

import asyncio
import json
import logging
import os
from typing import Any, Callable, Coroutine

from google import genai
from google.genai import types

from backend.app.api.settings import load_backend_config
from backend.app.core.protocol import THINKING_LIVE_MODEL
from backend.app.services.mcp import mcp_manager
from backend.app.services.session_reports import save_session_report
from backend.app.tools import coder_tools

logger = logging.getLogger("backend.services.coder_agent")

BASE_TOOL_DEFINITIONS = [
    {
        "name": "read_file",
        "description": "Read content from a file in the workspace, with optional 1-indexed start_line and end_line bounds.",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "path": {"type": "STRING", "description": "Relative or absolute path to the file."},
                "start_line": {"type": "INTEGER", "description": "Optional start line number (1-indexed)."},
                "end_line": {"type": "INTEGER", "description": "Optional end line number (1-indexed)."},
            },
            "required": ["path"],
        },
    },
    {
        "name": "write_file",
        "description": "Write entire content to a file, creating any parent folders if needed.",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "path": {"type": "STRING", "description": "Relative or absolute path to the file."},
                "content": {"type": "STRING", "description": "Full file content to write."},
            },
            "required": ["path", "content"],
        },
    },
    {
        "name": "edit_file",
        "description": "Replace specific snippets or batch of lines in an existing file. Returns a unified diff. Provide either 'edits' list or 'target_content' and 'replacement_content'.",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "path": {"type": "STRING", "description": "Relative or absolute path to the file."},
                "edits": {
                    "type": "ARRAY",
                    "description": "Optional list of edits for multi-edit batches: [{target_content, replacement_content, start_line, end_line}].",
                    "items": {
                        "type": "OBJECT",
                        "properties": {
                            "target_content": {"type": "STRING", "description": "Exact text snippet to replace."},
                            "replacement_content": {"type": "STRING", "description": "New replacement text."},
                            "start_line": {"type": "INTEGER", "description": "Optional start line number."},
                            "end_line": {"type": "INTEGER", "description": "Optional end line number."},
                        },
                    },
                },
                "target_content": {"type": "STRING", "description": "Exact text snippet to replace (for single edit)."},
                "replacement_content": {"type": "STRING", "description": "New replacement text (for single edit)."},
                "start_line": {"type": "INTEGER", "description": "Optional approximate start line number."},
                "end_line": {"type": "INTEGER", "description": "Optional approximate end line number."},
            },
            "required": ["path"],
        },
    },
    {
        "name": "list_directory",
        "description": "List files and subdirectories in a directory path (skips node_modules, .venv, .git).",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "path": {"type": "STRING", "description": "Directory path, default '.'."},
                "depth": {"type": "INTEGER", "description": "Depth of listing (default 1)."},
            },
        },
    },
    {
        "name": "search_in_files",
        "description": "Search for a text query across all workspace files.",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "query": {"type": "STRING", "description": "Search term or pattern."},
                "path": {"type": "STRING", "description": "Directory to search in (default '.')."},
                "case_insensitive": {"type": "BOOLEAN", "description": "Whether to ignore case (default true)."},
            },
            "required": ["query"],
        },
    },
    {
        "name": "run_command",
        "description": "Execute a terminal command. Use is_background=true or mode='background'|'watch' for long-running servers or watch tasks.",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "command": {"type": "STRING", "description": "Shell command to run."},
                "is_background": {
                    "type": "BOOLEAN",
                    "description": "Set to true for dev servers and background processes.",
                },
                "mode": {
                    "type": "STRING",
                    "description": "Execution mode: 'foreground' (synchronous wait), 'background' (long running daemon/server), or 'watch' (monitoring).",
                },
                "timeout": {
                    "type": "INTEGER",
                    "description": "Timeout in seconds for foreground commands (default 60).",
                },
            },
            "required": ["command"],
        },
    },
    {
        "name": "kill_process",
        "description": "Terminate a background server or process by its process ID.",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "process_id": {"type": "STRING", "description": "Process ID or PID to kill."},
            },
            "required": ["process_id"],
        },
    },
    {
        "name": "delegate_to_swe_agent",
        "description": "Delegate a complex engineering, debugging, or refactoring task to the SWE-Kit engineering agent. In isolated_trial mode (default), changes are generated in a safe sandbox generating unified diffs for review before applying.",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "task_description": {"type": "STRING", "description": "Detailed description of the engineering task."},
                "mode": {"type": "STRING", "description": "Execution mode: 'isolated_trial' (safe scratch sandbox with diff review) or 'live' (direct edits). Default 'isolated_trial'."},
                "test_command": {"type": "STRING", "description": "Optional test or verification command to run (e.g. 'pytest', 'npm test')."},
            },
            "required": ["task_description"],
        },
    },
    {
        "name": "git_operation",
        "description": "Perform a Git version control action (status, diff, branch, commit, push, create_pr) in the workspace.",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "action": {"type": "STRING", "description": "Git action: 'status', 'diff', 'branch', 'commit', 'push', or 'create_pr'."},
                "branch_name": {"type": "STRING", "description": "Branch name for 'branch' or 'push'."},
                "commit_message": {"type": "STRING", "description": "Commit message for 'commit'."},
                "pr_title": {"type": "STRING", "description": "Pull request title for 'create_pr'."},
                "pr_body": {"type": "STRING", "description": "Pull request description body for 'create_pr'."},
            },
            "required": ["action"],
        },
    },
    {
        "name": "sandbox_run",
        "description": "Execute a shell command inside an isolated trial sandbox or live container without modifying live workspace files unless confirmed.",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "command": {"type": "STRING", "description": "Shell command to execute in sandbox."},
                "mode": {"type": "STRING", "description": "Mode: 'isolated_trial' (default) or 'live'."},
                "timeout": {"type": "INTEGER", "description": "Timeout in seconds (default 120)."},
            },
            "required": ["command"],
        },
    },
]

LEGACY_BROWSER_TOOL_DEFINITIONS = [
    {
        "name": "browser_navigate",
        "description": "Open or navigate an automated browser to a URL (e.g. http://localhost:5173).",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "url": {"type": "STRING", "description": "Web URL to open."},
                "headless": {"type": "BOOLEAN", "description": "Run headless (default false for visibility)."},
            },
            "required": ["url"],
        },
    },
    {
        "name": "browser_view",
        "description": "Capture current screenshot and metadata from the automated browser for self-verification.",
        "parameters": {"type": "OBJECT", "properties": {}},
    },
    {
        "name": "browser_highlight",
        "description": "Highlight an element with a glowing pulse and tooltip note during self-verification tour.",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "selector": {"type": "STRING", "description": "CSS selector to highlight."},
                "note": {"type": "STRING", "description": "Guided tour note to display."},
            },
            "required": ["selector"],
        },
    },
]

# Backward compatible tool definitions
TOOL_DEFINITIONS = BASE_TOOL_DEFINITIONS + LEGACY_BROWSER_TOOL_DEFINITIONS


class CoderAgentSession:
    def __init__(
        self,
        workspace_root: str,
        api_key: str = "",
        model_name: str = "gemini-3.8-flash",
        custom_instructions: str = "",
    ):
        self.workspace_root = workspace_root
        self.api_key = api_key or os.getenv("GEMINI_API_KEY", "")
        # Non-live text/code generation models only for Coder Agent
        if not model_name or "live" in model_name:
            model_name = "gemini-3.8-flash"
        self.model_name = model_name
        self.custom_instructions = custom_instructions
        self.modified_files: set[str] = set()
        self.completed_tasks: list[str] = []
        self.active_tasks: list[str] = []
        self._stopped = False

    def stop(self):
        self._stopped = True

    def _sanitize_error(self, err: Exception | None) -> str:
        if not err:
            return "An unknown error occurred during code generation."
        err_str = str(err)
        if "RESOURCE_EXHAUSTED" in err_str or "429" in err_str or "quota" in err_str.lower():
            import re
            delay_match = re.search(r"Please retry in\s*([\d.]+s?)", err_str)
            retry_note = f" (retry suggested in {delay_match.group(1)})" if delay_match else ""
            return f"Gemini API Quota Exceeded (Free Tier Rate Limit){retry_note}. Please wait a moment or consider configuring a paid API key in Settings."
        if "details:" in err_str:
            err_str = err_str.split("details:")[0].strip().rstrip(":").rstrip(",").strip()
        return err_str[:350]

    async def execute_tool_call(self, name: str, args: dict[str, Any]) -> dict[str, Any]:
        logger.info("[CoderTool] Invoking %s with args: %s", name, args)

        if name == "read_file":
            return coder_tools.read_file(
                self.workspace_root,
                args.get("path", ""),
                args.get("start_line"),
                args.get("end_line"),
            )
        elif name == "write_file":
            res = coder_tools.write_file(self.workspace_root, args.get("path", ""), args.get("content", ""))
            if res.get("success"):
                self.modified_files.add(args.get("path", ""))
            return res
        elif name == "edit_file":
            edits = args.get("edits")
            res = coder_tools.edit_file(
                self.workspace_root,
                args.get("path", ""),
                edits=edits,
                target_content=args.get("target_content"),
                replacement_content=args.get("replacement_content"),
                start_line=args.get("start_line"),
                end_line=args.get("end_line"),
            )
            if res.get("success"):
                self.modified_files.add(args.get("path", ""))
            return res
        elif name == "list_directory":
            return coder_tools.list_directory(self.workspace_root, args.get("path", "."), args.get("depth", 1))
        elif name == "search_in_files":
            return coder_tools.search_in_files(
                self.workspace_root,
                args.get("query", ""),
                args.get("path", "."),
                args.get("case_insensitive", True),
            )
        elif name == "run_command":
            return coder_tools.run_command(
                self.workspace_root,
                args.get("command", ""),
                is_background=args.get("is_background", False),
                mode=args.get("mode", "foreground"),
                timeout=args.get("timeout", 60),
            )
        elif name == "kill_process":
            return coder_tools.kill_process(args.get("process_id", ""))
        elif name in ("sequentialthinking", "sequential_thinking") or name.startswith("browser_"):
            return await mcp_manager.call_tool(name, args, workspace_root=self.workspace_root)
        elif name == "delegate_to_swe_agent":
            from backend.app.services.swe_kit.scaffold import create_swe_agent
            swe = create_swe_agent(self.workspace_root, api_key=self.api_key, model_name=self.model_name)
            res = await swe.run(
                task_description=args.get("task_description", ""),
                mode=args.get("mode", "isolated_trial"),
                test_command=args.get("test_command", ""),
            )
            if res.get("modified_files") and res.get("mode") == "live":
                for mf in res["modified_files"]:
                    self.modified_files.add(mf)
            return res
        elif name == "git_operation":
            from backend.app.services.swe_kit.github_service import run_git_operation
            return run_git_operation(
                workspace_root=self.workspace_root,
                action=args.get("action", "status"),
                branch_name=args.get("branch_name", ""),
                commit_message=args.get("commit_message", ""),
                pr_title=args.get("pr_title", ""),
                pr_body=args.get("pr_body", ""),
            )
        elif name == "sandbox_run":
            from backend.app.services.swe_kit.agent_runner import run_swe_command
            res = run_swe_command(
                workspace_root=self.workspace_root,
                command=args.get("command", ""),
                mode=args.get("mode", "isolated_trial"),
                timeout=args.get("timeout", 120),
            )
            if res.get("modified_files") and res.get("mode") == "live":
                for mf in res["modified_files"]:
                    self.modified_files.add(mf)
            return res
        else:
            return {"success": False, "error": f"Unknown tool: {name}"}

    async def run_task(
        self,
        prompt: str,
        emit_event: Callable[[dict[str, Any]], Coroutine[Any, Any, None]],
    ) -> dict[str, Any]:
        self._stopped = False
        config = load_backend_config()
        effective_key = self.api_key or config.get("apiKey") or os.getenv("GEMINI_API_KEY", "")

        if not effective_key:
            err_msg = "Gemini API key is missing. Please set it in Settings."
            await emit_event({"type": "error", "message": err_msg})
            return {"success": False, "error": err_msg}

        client = genai.Client(api_key=effective_key)

        system_paths_info = ""
        try:
            from backend.app.tools.safety import get_well_known_system_paths, get_system_drives
            paths = get_well_known_system_paths()
            drives = get_system_drives()
            home = paths.get("home", Path.home())
            d_dl = paths.get("d_downloads", paths.get("downloads", home / "Downloads"))
            c_dl = paths.get("c_downloads", home / "Downloads")
            desktop = paths.get("desktop", home / "Desktop")
            documents = paths.get("documents", home / "Documents")
            drives_str = ", ".join(f"{d['letter']}:\\ ({d.get('free_gb', '')}GB free)" for d in drives) if drives else "C:\\"
            system_paths_info = (
                f"HOST SYSTEM & FILE LOCATIONS:\n"
                f"- Host User Profile: {home}\n"
                f"- Primary Downloads: {d_dl}\n"
                f"- User Profile Downloads: {c_dl}\n"
                f"- Desktop: {desktop}\n"
                f"- Documents: {documents}\n"
                f"- Available Drives: {drives_str}\n"
                f"- When searching or reading files in Downloads or Desktop, use these verified host paths.\n\n"
            )
        except Exception:
            pass

        system_instruction = (
            f"You are Arix Coder, an elite autonomous software engineering partner working directly inside: {self.workspace_root}.\n"
            f"You have access to powerful tools to read file slices, write and edit files, search, run terminal commands, decompose reasoning, and control a browser via MCP.\n\n"
            f"CORE WORKFLOW & CAPABILITIES:\n"
            f"1. Step-by-Step Problem Decomposition (Sequential Thinking MCP):\n"
            f"   - When handling complex engineering tasks, multi-file refactoring, debugging subtle errors, or when asked to 'think through this step by step' / 'plan carefully', call `sequentialthinking`.\n"
            f"   - Break problems down systematically, validate assumptions, explore hypotheses, and plan implementation before touching code.\n"
            f"2. Precision Editing:\n"
            f"   - Read only the necessary file chunks rather than huge files.\n"
            f"   - Make precision edits with diffs using `edit_file` or `write_file`.\n"
            f"3. Live Browser Verification & Testing (Playwright MCP):\n"
            f"   - When building or changing web UI, frontends, or fullstack apps, verify your changes in the browser using Playwright tools (`browser_navigate`, `browser_click`, `browser_type`, `browser_snapshot`, `browser_take_screenshot`, `browser_evaluate`, etc.).\n"
            f"   - Also invoke browser tools when the user explicitly requests: 'test this in the browser', 'check UI', 'verify localhost'.\n"
            f"   - Capture snapshots or screenshots to ensure no visual breakages or console errors occur.\n"
            f"4. Clear Reporting:\n"
            f"   - Report what you accomplished, what files were modified, and the test status clearly.\n\n"
            f"{system_paths_info}"
            f"{self.custom_instructions or config.get('coderAgentInstructions', '')}"
        )

        await emit_event({"type": "status", "status": "thinking", "message": "Analyzing task and workspace..."})

        # Dynamically discover and incorporate live MCP tools
        mcp_tools = []
        try:
            mcp_tools = await mcp_manager.get_tools_for_agent("coder")
        except Exception as err:
            logger.warning("[CoderAgent] Failed to fetch MCP tools: %s", err)

        active_tool_declarations = list(BASE_TOOL_DEFINITIONS)
        if mcp_tools:
            active_tool_declarations.extend(mcp_tools)
        else:
            active_tool_declarations.extend(LEGACY_BROWSER_TOOL_DEFINITIONS)

        # Model cascade fallback: preferred model -> gemini-3.8-flash -> gemini-2.0-flash -> gemini-flash-latest
        models_to_try = [
            self.model_name,
            "gemini-3.8-flash",
            "gemini-2.0-flash",
            "gemini-flash-latest",
        ]
        # Deduplicate while preserving order
        models_to_try = list(dict.fromkeys(models_to_try))

        # We maintain conversation contents
        chat_contents: list[types.Content] = [
            types.Content(
                role="user",
                parts=[types.Part.from_text(text=f"Workspace Directory: {self.workspace_root}\n\nTask: {prompt}")],
            )
        ]

        active_model = models_to_try[0]
        max_turns = 16
        turn = 0
        has_emitted_report = False

        while turn < max_turns and not self._stopped:
            turn += 1
            response = None
            last_err = None

            # Retry loop for rate limit (429 / RESOURCE_EXHAUSTED)
            retry_count = 0
            max_retries = 2
            while retry_count <= max_retries and not response and not self._stopped:
                for m in models_to_try:
                    try:
                        logger.info("[CoderAgent] Calling model %s (turn %d, attempt %d)...", m, turn, retry_count)
                        response = client.models.generate_content(
                            model=m,
                            contents=chat_contents,
                            config=types.GenerateContentConfig(
                                system_instruction=system_instruction,
                                tools=[{"function_declarations": active_tool_declarations}],
                                temperature=0.3,
                            ),
                        )
                        active_model = m
                        break
                    except Exception as err:
                        err_str = str(err)
                        logger.warning("[CoderAgent] Model %s failed: %s", m, err)
                        last_err = err
                        # If rate limited, don't immediately give up on all models; try next model or backoff
                        if "RESOURCE_EXHAUSTED" in err_str or "429" in err_str or "quota" in err_str.lower():
                            continue

                if not response and not self._stopped:
                    err_str = str(last_err)
                    if ("RESOURCE_EXHAUSTED" in err_str or "429" in err_str or "quota" in err_str.lower()) and retry_count < max_retries:
                        retry_count += 1
                        import re
                        delay_match = re.search(r"Please retry in\s*([\d.]+)", err_str)
                        wait_sec = int(float(delay_match.group(1))) + 2 if delay_match else (12 * retry_count)
                        wait_sec = min(max(wait_sec, 5), 45)
                        await emit_event({
                            "type": "status",
                            "status": "rate_limited",
                            "message": f"Gemini API rate limit reached. Pausing for {wait_sec}s before auto-resuming...",
                        })
                        await asyncio.sleep(wait_sec)
                    else:
                        break

            if not response:
                clean_err = self._sanitize_error(last_err)
                await emit_event({"type": "error", "message": clean_err})
                return {"success": False, "error": clean_err}

            # Check candidates
            candidate = response.candidates[0] if response.candidates else None
            if not candidate or not candidate.content:
                break

            model_parts = candidate.content.parts or []
            tool_calls = [p.function_call for p in model_parts if p.function_call]
            text_parts = [p.text for p in model_parts if p.text]

            full_text = "\n".join(text_parts).strip()
            if full_text:
                await emit_event({
                    "type": "thought" if tool_calls else "message",
                    "role": "assistant",
                    "content": full_text,
                    "model": active_model,
                })

            # Append model turn to conversation
            chat_contents.append(candidate.content)

            if not tool_calls:
                # Finished execution - final text response is the report
                has_emitted_report = bool(full_text)
                break

            # Execute tool calls in order
            response_parts = []
            for tc in tool_calls:
                if self._stopped:
                    break
                fn_name = tc.name
                fn_args = dict(tc.args) if tc.args else {}

                await emit_event({
                    "type": "tool_call",
                    "tool": fn_name,
                    "args": fn_args,
                })

                result = await self.execute_tool_call(fn_name, fn_args)

                await emit_event({
                    "type": "tool_result",
                    "tool": fn_name,
                    "result": result,
                    "diff": result.get("diff"),
                })

                is_failed = not result.get("success", True) or not result.get("ok", True) or bool(result.get("error"))
                if is_failed:
                    err_msg = str(result.get("error") or result.get("message") or "Tool execution error")
                    await emit_event({
                        "type": "system_error",
                        "tool": fn_name,
                        "error": err_msg,
                        "message": f"System Error in tool '{fn_name}': {err_msg}",
                    })
                    response_payload = {
                        "result": result,
                        "system_error": err_msg,
                        "instruction": (
                            f"Tool '{fn_name}' failed with error: {err_msg}. "
                            f"Explain to the user clearly what went wrong technically, quote the exact error, "
                            f"and formulate troubleshooting steps or a fix."
                        ),
                    }
                else:
                    response_payload = {"result": result}

                response_parts.append(
                    types.Part.from_function_response(
                        name=fn_name,
                        response=response_payload,
                    )
                )

            if response_parts:
                chat_contents.append(types.Content(role="user", parts=response_parts))
                # Add polite pacing between turns to avoid free-tier burst limit
                await asyncio.sleep(1.2)

        # If model did not emit a final text message before stopping, emit structured report
        if not has_emitted_report and not self._stopped:
            mod_files_str = "\n".join(f"- `{f}`" for f in sorted(self.modified_files)) if self.modified_files else "None (inspection/analysis only)"
            fallback_report = (
                f"### Coder Agent Execution Summary\n\n"
                f"**Task**: {prompt}\n\n"
                f"**Status**: Completed successfully across {turn} reasoning turn(s).\n\n"
                f"**Modified Files**:\n{mod_files_str}\n\n"
                f"**Verification**: All requested workspace checks and tool actions were executed."
            )
            await emit_event({
                "type": "message",
                "role": "assistant",
                "content": fallback_report,
                "model": active_model,
            })

        # Save session report on task completion
        report_data = {
            "summary": f"Completed coding task: {prompt}",
            "tasks_completed": [prompt],
            "tasks_pending": [],
            "files_modified": list(self.modified_files),
            "active_servers": [p["command"] for p in coder_tools.list_active_processes(self.workspace_root)],
        }
        save_session_report(self.workspace_root, report_data)

        await emit_event({
            "type": "status",
            "status": "idle",
            "message": "Task completed.",
            "modified_files": list(self.modified_files),
        })

        return {
            "success": True,
            "modified_files": list(self.modified_files),
            "completed_turn": turn,
        }
