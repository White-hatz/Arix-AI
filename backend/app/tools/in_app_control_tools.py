from __future__ import annotations

import asyncio
import json
import logging
from typing import Any, Callable, Coroutine

logger = logging.getLogger("backend.tools.in_app_control")

# Global event emitter set by the active live bridge or workspace session
_EMIT_HANDLER: Callable[[dict[str, Any]], Coroutine[Any, Any, None]] | None = None
_APP_STATE: dict[str, Any] = {
    "current_view": "voice",
    "active_project": None,
    "open_files": [],
    "last_action": None,
}


def set_app_control_emitter(emitter: Callable[[dict[str, Any]], Coroutine[Any, Any, None]] | None) -> None:
    global _EMIT_HANDLER
    _EMIT_HANDLER = emitter


def update_reported_app_state(state: dict[str, Any]) -> None:
    global _APP_STATE
    _APP_STATE.update(state)


IN_APP_CONTROL_TOOL_DECLARATIONS = [
    {
        "name": "navigate_app",
        "description": "Switch the Arix AI desktop app to a specific internal page/route ('voice', 'memory', 'code', 'settings', 'workspace').",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "route": {
                    "type": "STRING",
                    "description": "Target route: 'voice' (command center), 'code' (projects hub), 'settings', 'memory', or 'workspace'.",
                },
                "project_path": {
                    "type": "STRING",
                    "description": "Optional project directory path if navigating to a specific workspace.",
                },
            },
            "required": ["route"],
        },
    },
    {
        "name": "scroll_app",
        "description": "Scroll a specific panel, container, or the entire app window up or down.",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "target": {
                    "type": "STRING",
                    "description": "Optional CSS selector of the scroll container (e.g. '.projects-grid-area', '.file-tree-scroll-area').",
                },
                "direction": {
                    "type": "STRING",
                    "description": "'up' or 'down' (default 'down').",
                },
                "amount": {
                    "type": "INTEGER",
                    "description": "Amount to scroll in pixels (default 350).",
                },
            },
        },
    },
    {
        "name": "click_app",
        "description": "Click an interactive button, tab, card, or element within the Arix AI desktop app.",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "selector": {
                    "type": "STRING",
                    "description": "CSS selector of the element to click (e.g. '.hub-add-btn', '.rail-button', '#deep-think-toggle').",
                },
                "x": {"type": "INTEGER", "description": "Optional X coordinate in app viewport."},
                "y": {"type": "INTEGER", "description": "Optional Y coordinate in app viewport."},
            },
        },
    },
    {
        "name": "type_app",
        "description": "Type text into a focused or targeted input field within the Arix AI app.",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "selector": {
                    "type": "STRING",
                    "description": "CSS selector of the input or textarea to type into.",
                },
                "text": {
                    "type": "STRING",
                    "description": "Text to enter into the input.",
                },
            },
            "required": ["text"],
        },
    },
    {
        "name": "drag_drop_app",
        "description": "Demonstrate or execute a drag-and-drop between two elements/regions inside the app (e.g. dragging a file from Explorer to chat input or right panel).",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "source": {
                    "type": "STRING",
                    "description": "CSS selector or path of the element being dragged.",
                },
                "target": {
                    "type": "STRING",
                    "description": "CSS selector of the drop target container.",
                },
            },
            "required": ["source", "target"],
        },
    },
    {
        "name": "highlight_app",
        "description": "Spotlight a specific UI element with a high-contrast glowing pulse outline and floating explanation note while narrating.",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "selector": {
                    "type": "STRING",
                    "description": "CSS selector of the element to highlight.",
                },
                "note": {
                    "type": "STRING",
                    "description": "Short explanation badge text shown next to the highlighted element.",
                },
            },
            "required": ["selector"],
        },
    },
    {
        "name": "move_cursor_app",
        "description": "Smoothly animate a visible synthetic cursor overlay to a target element or coordinate in the app window.",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "selector": {
                    "type": "STRING",
                    "description": "CSS selector of the destination element.",
                },
                "x": {"type": "INTEGER", "description": "Optional X destination coordinate."},
                "y": {"type": "INTEGER", "description": "Optional Y destination coordinate."},
            },
        },
    },
    {
        "name": "view_app_screen",
        "description": "Inspect current app state, active route, open tabs, and visible UI structure for closed-loop self-verification.",
        "parameters": {"type": "OBJECT", "properties": {}},
    },
]


async def execute_in_app_control_action(tool_name: str, args: dict[str, Any]) -> dict[str, Any]:
    logger.info("[InAppControl] Executing %s with args: %s", tool_name, args)

    if tool_name == "view_app_screen":
        from pathlib import Path
        active_proj = _APP_STATE.get("active_project")
        if not active_proj:
            try:
                cwd = Path.cwd().resolve()
                if cwd.exists():
                    active_proj = str(cwd)
                    _APP_STATE["active_project"] = active_proj
            except Exception:
                pass
        return {
            "ok": True,
            "active_view": _APP_STATE.get("current_view", "voice"),
            "active_project": active_proj,
            "working_directory": str(Path.cwd().resolve()),
            "open_files": _APP_STATE.get("open_files", []),
            "last_action": _APP_STATE.get("last_action"),
            "message": f"App is currently showing {_APP_STATE.get('current_view', 'voice')} view. Active project: {active_proj or 'None'}.",
        }

    # Check permission in config
    from backend.app.core.config import settings as app_cfg
    config_file = app_cfg.data_directory / "config.json"
    if config_file.exists():
        try:
            cfg = json.loads(config_file.read_text(encoding="utf-8"))
            if not cfg.get("allowInAppSelfControl", True):
                return {
                    "ok": True,
                    "status": "disabled_by_user",
                    "action": tool_name,
                    "message": (
                        "In-app UI self-control is currently toggled off in Settings -> Automation & Permissions. "
                        "Do not run UI control actions (clicks/navigation/scrolling). "
                        "Instead, explain what you recommend to the user verbally or in chat, and interact via project files."
                    ),
                }
        except Exception:
            pass

    # Update app state proactively on navigation
    if tool_name == "navigate_app":
        route = args.get("route")
        if route:
            _APP_STATE["current_view"] = route
        if args.get("project_path"):
            _APP_STATE["active_project"] = args.get("project_path")
    elif tool_name == "click_app":
        selector = str(args.get("selector", "")).lower()
        if "settings" in selector:
            _APP_STATE["current_view"] = "settings"
        elif "code" in selector:
            _APP_STATE["current_view"] = "code"

    # Dispatch to frontend through the event sink
    if _EMIT_HANDLER:
        try:
            await _EMIT_HANDLER({
                "type": "in_app_control",
                "action": tool_name,
                "args": args,
            })
            _APP_STATE["last_action"] = {"tool": tool_name, "args": args}
            return {
                "ok": True,
                "action": tool_name,
                "status": "dispatched",
                "message": f"Successfully performed {tool_name} inside Arix AI app.",
            }
        except Exception as err:
            logger.exception("Failed to dispatch in-app action %s: %s", tool_name, err)
            return {"ok": False, "error": str(err)}

    return {
        "ok": True,
        "action": tool_name,
        "status": "queued",
        "message": f"Action {tool_name} noted (no active frontend socket).",
    }


def register_in_app_control_tools(registry: Any) -> None:
    from backend.app.tools.registry import ToolDefinition

    for decl in IN_APP_CONTROL_TOOL_DECLARATIONS:
        tool_name = decl["name"]

        def make_handler(name: str):
            async def handler(**kwargs):
                return await execute_in_app_control_action(name, kwargs)

            return handler

        registry.register(
            ToolDefinition(
                name=tool_name,
                description=decl["description"],
                parameters=decl.get("parameters", {}),
                handler=make_handler(tool_name),
            )
        )
    logger.info("[InAppControl] Registered %d in-app UI control tools", len(IN_APP_CONTROL_TOOL_DECLARATIONS))
