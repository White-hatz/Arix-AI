from __future__ import annotations

import asyncio
import base64
import io
import json
import logging
import re
import subprocess
import time
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any

from backend.app.core.config import settings as app_cfg
from backend.app.tools.registry import ToolDefinition, ToolRegistry

logger = logging.getLogger("backend.tools.computer")

_SESSION_DESKTOP_CONTROL_GRANTED = False


def set_session_desktop_control_granted(granted: bool) -> None:
    global _SESSION_DESKTOP_CONTROL_GRANTED
    _SESSION_DESKTOP_CONTROL_GRANTED = granted
    logger.info("[ComputerControl] Session desktop control granted set to %s", granted)


def abort_desktop_control() -> dict[str, Any]:
    global _SESSION_DESKTOP_CONTROL_GRANTED
    _SESSION_DESKTOP_CONTROL_GRANTED = False
    logger.info("[ComputerControl] User override triggered: Desktop control halted immediately.")
    from backend.app.tools.in_app_control_tools import _EMIT_HANDLER
    if _EMIT_HANDLER:
        try:
            import asyncio
            loop = asyncio.get_event_loop()
            if loop.is_running():
                asyncio.create_task(_EMIT_HANDLER({
                    "type": "desktop_control_active",
                    "action": "aborted",
                    "active": False,
                    "timestamp": time.time(),
                }))
        except Exception:
            pass
    return {"ok": True, "status": "aborted", "message": "Desktop control halted"}
from backend.app.tools.safety import (
    bounded_number,
    bounded_text,
    require_confirmation,
    require_optional_dependency,
    require_platform,
    resolve_user_path,
    run_command,
)

_REMINDER_TASK_PREFIX = "Arix_Reminder_"
_SAFE_KEYS = {
    "backspace", "delete", "down", "end", "enter", "esc", "home", "left", "pagedown",
    "pageup", "right", "space", "tab", "up", "volumeup", "volumedown", "volumemute",
    "alt", "ctrl", "shift", "win",
    *{f"f{number}" for number in range(1, 13)},
    *set("abcdefghijklmnopqrstuvwxyz0123456789"),
}
_SAFE_BUTTONS = {"left", "middle", "right"}


def _pyautogui() -> Any:
    module = require_optional_dependency("pyautogui", "pip install pyautogui")
    module.FAILSAFE = True
    module.PAUSE = 0.08
    return module


def _parse_reminder_time(date: str, time: str) -> datetime:
    raw_date = bounded_text(date, limit=10, field="date")
    raw_time = bounded_text(time, limit=8, field="time")
    try:
        scheduled = datetime.fromisoformat(f"{raw_date}T{raw_time}")
    except ValueError as error:
        raise ValueError("Use ISO date YYYY-MM-DD and 24-hour time HH:MM") from error
    if scheduled <= datetime.now():
        raise ValueError("Reminder time must be in the future")
    return scheduled


def _reminder_directory() -> Path:
    target = Path.home() / "AppData" / "Local" / "Arix" / "reminders"
    target.mkdir(parents=True, exist_ok=True)
    return target


def _powershell_literal(value: str) -> str:
    return value.replace("'", "''").replace("\r", " ").replace("\n", " ")


def _create_reminder(date: str, time: str, message: str) -> dict[str, Any]:
    require_platform("Windows")
    scheduled = _parse_reminder_time(date, time)
    text = bounded_text(message, limit=500, field="message")
    identifier = uuid.uuid4().hex[:12]
    task_name = f"{_REMINDER_TASK_PREFIX}{identifier}"
    script_path = _reminder_directory() / f"{identifier}.ps1"
    literal = _powershell_literal(text)
    script_path.write_text(
        "Add-Type -AssemblyName PresentationFramework\n"
        f"[System.Windows.MessageBox]::Show('{literal}', 'Arix Reminder') | Out-Null\n"
        f"schtasks.exe /Delete /TN '{task_name}' /F | Out-Null\n"
        "Remove-Item -LiteralPath $MyInvocation.MyCommand.Path -Force\n",
        encoding="utf-8",
    )
    task_command = f'powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "{script_path}"'
    try:
        run_command([
            "schtasks.exe", "/Create", "/F", "/SC", "ONCE", "/TN", task_name,
            "/SD", scheduled.strftime("%m/%d/%Y"), "/ST", scheduled.strftime("%H:%M"),
            "/TR", task_command,
        ], timeout=15)
    except Exception:
        script_path.unlink(missing_ok=True)
        raise
    return {
        "created": True,
        "task_name": task_name,
        "scheduled_for": scheduled.isoformat(timespec="minutes"),
        "message": text,
    }


def _cancel_reminder(task_name: str, confirmed: bool) -> dict[str, Any]:
    require_platform("Windows")
    require_confirmation("cancel this reminder", confirmed)
    name = bounded_text(task_name, limit=80, field="task_name")
    if not re.fullmatch(r"Arix_Reminder_[a-f0-9]{12}", name):
        raise ValueError("Only Arix reminder task names can be cancelled")
    run_command(["schtasks.exe", "/Delete", "/TN", name, "/F"], timeout=15)
    script = _reminder_directory() / f"{name.removeprefix(_REMINDER_TASK_PREFIX)}.ps1"
    script.unlink(missing_ok=True)
    return {"cancelled": True, "task_name": name}


def _list_reminders() -> dict[str, Any]:
    require_platform("Windows")
    result = run_command(["schtasks.exe", "/Query", "/FO", "CSV", "/V"], timeout=20)
    names = sorted(set(re.findall(r"Arix_Reminder_[a-f0-9]{12}", result.stdout)))[:100]
    return {"reminders": names, "count": len(names)}


async def reminder(
    action: str,
    date: str = "",
    time: str = "",
    message: str = "",
    task_name: str = "",
    confirmed: bool = False,
) -> dict[str, Any]:
    if action == "create":
        return await asyncio.to_thread(_create_reminder, date, time, message)
    if action == "cancel":
        return await asyncio.to_thread(_cancel_reminder, task_name, confirmed)
    if action == "list":
        return await asyncio.to_thread(_list_reminders)
    raise ValueError("action must be create, cancel, or list")


def _computer_settings_sync(action: str, value: int | None, confirmed: bool) -> dict[str, Any]:
    require_platform("Windows")
    gui = None
    if action in {
        "volume_up", "volume_down", "volume_mute", "minimize", "maximize", "snap_left",
        "snap_right", "switch_window", "new_tab", "close_tab", "reopen_tab", "next_tab",
        "previous_tab", "copy", "cut", "paste", "select_all", "scroll_up", "scroll_down",
    }:
        gui = _pyautogui()

    hotkeys: dict[str, tuple[str, ...]] = {
        "minimize": ("win", "down"), "maximize": ("win", "up"), "snap_left": ("win", "left"),
        "snap_right": ("win", "right"), "switch_window": ("alt", "tab"),
        "new_tab": ("ctrl", "t"), "close_tab": ("ctrl", "w"), "reopen_tab": ("ctrl", "shift", "t"),
        "next_tab": ("ctrl", "tab"), "previous_tab": ("ctrl", "shift", "tab"),
        "copy": ("ctrl", "c"), "cut": ("ctrl", "x"), "paste": ("ctrl", "v"),
        "select_all": ("ctrl", "a"),
    }
    if action in hotkeys:
        gui.hotkey(*hotkeys[action])
    elif action in {"volume_up", "volume_down"}:
        presses = int(bounded_number(value if value is not None else 2, minimum=1, maximum=20, field="value"))
        gui.press("volumeup" if action == "volume_up" else "volumedown", presses=presses)
    elif action == "volume_mute":
        gui.press("volumemute")
    elif action == "volume_set":
        level = int(bounded_number(value, minimum=0, maximum=100, field="value"))
        gui = _pyautogui()
        gui.press("volumedown", presses=50)
        gui.press("volumeup", presses=round(level / 2))
    elif action in {"brightness_up", "brightness_down", "brightness_set"}:
        brightness = require_optional_dependency("screen_brightness_control", "pip install screen-brightness-control")
        if action == "brightness_set":
            level = int(bounded_number(value, minimum=0, maximum=100, field="value"))
        else:
            current = brightness.get_brightness(display=0)
            current_value = int(current[0] if isinstance(current, list) else current)
            delta = int(bounded_number(value if value is not None else 10, minimum=1, maximum=50, field="value"))
            level = max(0, min(100, current_value + (delta if action.endswith("up") else -delta)))
        brightness.set_brightness(level, display=0)
        return {"action": action, "completed": True, "value": level}
    elif action in {"scroll_up", "scroll_down"}:
        amount = int(bounded_number(value if value is not None else 5, minimum=1, maximum=50, field="value"))
        gui.scroll(amount if action == "scroll_up" else -amount)
    elif action == "lock":
        run_command(["rundll32.exe", "user32.dll,LockWorkStation"])
    elif action == "open_settings":
        subprocess.Popen(["explorer.exe", "ms-settings:"], shell=False)
    elif action == "open_explorer":
        subprocess.Popen(["explorer.exe"], shell=False)
    elif action == "open_task_manager":
        subprocess.Popen(["taskmgr.exe"], shell=False)
    elif action in {"restart", "shutdown"}:
        require_confirmation(action + " the computer", confirmed)
        run_command(["shutdown.exe", "/r" if action == "restart" else "/s", "/t", "0"])
    else:
        raise ValueError("Unsupported computer settings action")
    return {"action": action, "completed": True, **({"value": value} if value is not None else {})}


async def computer_settings(action: str, value: int | None = None, confirmed: bool = False) -> dict[str, Any]:
    return await asyncio.to_thread(_computer_settings_sync, action, value, confirmed)


def _validate_key(key: str) -> str:
    normalized = key.strip().lower()
    if normalized not in _SAFE_KEYS:
        raise ValueError(f"Unsupported keyboard key: {key}")
    return normalized


def _computer_control_sync(
    action: str,
    text: str,
    x: int | None,
    y: int | None,
    button: str,
    key: str,
    keys: list[str] | None,
    amount: int,
    duration: float,
    path: str,
) -> dict[str, Any]:
    gui = _pyautogui()
    duration = bounded_number(duration, minimum=0, maximum=10, field="duration")
    width, height = gui.size()

    def point() -> tuple[int, int]:
        if x is None or y is None:
            raise ValueError("x and y coordinates are required")
        px = int(bounded_number(x, minimum=0, maximum=max(0, width - 1), field="x"))
        py = int(bounded_number(y, minimum=0, maximum=max(0, height - 1), field="y"))
        return px, py

    if button not in _SAFE_BUTTONS:
        raise ValueError("button must be left, middle, or right")
    if action == "type":
        content = bounded_text(text, limit=10_000, field="text")
        gui.write(content, interval=min(duration, 0.2))
        return {"action": action, "completed": True, "characters_typed": len(content)}
    if action in {"click", "double_click", "right_click"}:
        px, py = point()
        clicks = 2 if action == "double_click" else 1
        selected_button = "right" if action == "right_click" else button
        gui.click(px, py, clicks=clicks, interval=min(duration, 1), button=selected_button)
        return {"action": action, "completed": True, "x": px, "y": py, "button": selected_button}
    if action in {"move", "drag"}:
        px, py = point()
        if action == "move":
            gui.moveTo(px, py, duration=duration)
        else:
            gui.dragTo(px, py, duration=duration, button=button)
        return {"action": action, "completed": True, "x": px, "y": py}
    if action == "press":
        selected = _validate_key(key)
        gui.press(selected)
        return {"action": action, "completed": True, "key": selected}
    if action == "hotkey":
        selected = [_validate_key(item) for item in (keys or [])]
        if not 2 <= len(selected) <= 4:
            raise ValueError("hotkey requires between two and four safe keys")
        gui.hotkey(*selected)
        return {"action": action, "completed": True, "keys": selected}
    if action == "scroll":
        delta = int(bounded_number(amount, minimum=-100, maximum=100, field="amount"))
        if delta == 0:
            raise ValueError("amount cannot be zero")
        gui.scroll(delta)
        return {"action": action, "completed": True, "amount": delta}
    if action == "wait":
        import time
        time.sleep(duration)
        return {"action": action, "completed": True, "seconds": duration}
    if action == "clear_field":
        gui.hotkey("ctrl", "a")
        gui.press("backspace")
        return {"action": action, "completed": True}
    if action == "screenshot":
        target = resolve_user_path(path or str(Path.home() / "Desktop" / "arix_screenshot.png"))
        if target.suffix.lower() not in {".png", ".jpg", ".jpeg"}:
            raise ValueError("Screenshot path must end in .png, .jpg, or .jpeg")
        target.parent.mkdir(parents=True, exist_ok=True)
        img = None
        try:
            img = gui.screenshot()
        except Exception as ss_err:
            logger.warning("[ComputerControl] Primary screen grab unavailable (%s), creating fallback canvas frame", ss_err)
            from PIL import Image, ImageDraw
            w, h = gui.size() if hasattr(gui, "size") else (1920, 1080)
            img = Image.new("RGB", (w, h), color=(20, 24, 33))
            draw = ImageDraw.Draw(img)
            draw.text((w // 4, h // 2), f"Arix Desktop Stream — Display session protected or headless ({ss_err})", fill=(120, 180, 240))
        img.save(str(target))
        w, h = img.size
        return {
            "action": action,
            "completed": True,
            "path": str(target),
            "width": w,
            "height": h,
            "message": f"Captured desktop screenshot saved to {target} ({w}x{h})",
        }
    raise ValueError("Unsupported computer control action")


async def computer_control(
    action: str,
    text: str = "",
    x: int | None = None,
    y: int | None = None,
    button: str = "left",
    key: str = "",
    keys: list[str] | None = None,
    amount: int = 0,
    duration: float = 0.2,
    path: str = "",
    confirmed: bool = False,
) -> dict[str, Any]:
    # 1. Master toggle check in config.json
    config_file = app_cfg.data_directory / "config.json"
    if config_file.exists():
        try:
            cfg = json.loads(config_file.read_text(encoding="utf-8"))
            if not cfg.get("allowDesktopControl", True) and not cfg.get("allowMouseKeyboardControl", True):
                return {
                    "ok": False,
                    "status": "permission_denied",
                    "error": (
                        "Desktop-level automation is currently disabled in Settings -> Automation & Safety. "
                        "Please ask the user to enable 'Allow AI to request desktop control when needed' in Settings."
                    ),
                }
            if cfg.get("desktopControlAlwaysAllowedSession"):
                confirmed = True
        except Exception:
            pass

    # 2. Permission check: require explicit confirmation for active inputs
    if action not in {"screenshot", "wait"} and not confirmed and not _SESSION_DESKTOP_CONTROL_GRANTED:
        return {
            "ok": False,
            "requires_permission": True,
            "status": "permission_required",
            "action": action,
            "message": (
                f"Desktop control permission is required before taking control of the computer. "
                f"You must ask the user orally/in-chat explicitly: "
                f"'I need your permission to take desktop screen/input control to {action}. Should I proceed?' "
                "Once the user approves, re-invoke computer_control with confirmed=True."
            ),
        }

    # 3. Visual feedback dispatch to frontend
    from backend.app.tools.in_app_control_tools import _EMIT_HANDLER
    if _EMIT_HANDLER:
        try:
            await _EMIT_HANDLER({
                "type": "desktop_control_active",
                "active": True,
                "action": action,
                "x": x,
                "y": y,
                "text": text,
                "duration": duration,
                "timestamp": time.time(),
            })
        except Exception as emit_err:
            logger.debug("Failed to dispatch desktop_control_active event: %s", emit_err)

    try:
        return await asyncio.to_thread(
            _computer_control_sync, action, text, x, y, button, key, keys, amount, duration, path
        )
    finally:
        if _EMIT_HANDLER:
            try:
                await _EMIT_HANDLER({
                    "type": "desktop_control_active",
                    "active": False,
                    "action": action,
                    "timestamp": time.time(),
                })
            except Exception:
                pass


def register_computer_tools(registry: ToolRegistry) -> None:
    registry.register(ToolDefinition(
        name="reminder",
        description="Create, list, or cancel a persistent Windows reminder. Cancellation requires confirmation.",
        parameters={
            "type": "object",
            "properties": {
                "action": {"type": "string", "enum": ["create", "list", "cancel"]},
                "date": {"type": "string", "description": "ISO date YYYY-MM-DD for create."},
                "time": {"type": "string", "description": "24-hour HH:MM for create."},
                "message": {"type": "string", "maxLength": 500},
                "task_name": {"type": "string"},
                "confirmed": {"type": "boolean", "default": False},
            },
            "required": ["action"], "additionalProperties": False,
        },
        handler=reminder,
    ))
    registry.register(ToolDefinition(
        name="computer_settings",
        description="Control allowlisted Windows settings and shortcuts. Restart and shutdown require explicit confirmation.",
        parameters={
            "type": "object",
            "properties": {
                "action": {"type": "string", "enum": [
                    "volume_up", "volume_down", "volume_mute", "volume_set", "brightness_up",
                    "brightness_down", "brightness_set", "minimize", "maximize", "snap_left",
                    "snap_right", "switch_window", "new_tab", "close_tab", "reopen_tab", "next_tab",
                    "previous_tab", "copy", "cut", "paste", "select_all", "scroll_up", "scroll_down",
                    "lock", "open_settings", "open_explorer", "open_task_manager", "restart", "shutdown",
                ]},
                "value": {"type": "integer"},
                "confirmed": {"type": "boolean", "default": False},
            },
            "required": ["action"], "additionalProperties": False,
        },
        handler=computer_settings,
    ))
    registry.register(ToolDefinition(
        name="computer_control",
        description="Perform a bounded mouse, keyboard, wait, or screenshot action requested by the user. Active mouse/keyboard actions require confirmed=true or explicit permission.",
        parameters={
            "type": "object",
            "properties": {
                "action": {"type": "string", "enum": [
                    "type", "click", "double_click", "right_click", "move", "drag", "press", "hotkey",
                    "scroll", "wait", "clear_field", "screenshot",
                ]},
                "text": {"type": "string", "maxLength": 10000},
                "x": {"type": "integer", "minimum": 0}, "y": {"type": "integer", "minimum": 0},
                "button": {"type": "string", "enum": ["left", "middle", "right"], "default": "left"},
                "key": {"type": "string"},
                "keys": {"type": "array", "items": {"type": "string"}, "minItems": 2, "maxItems": 4},
                "amount": {"type": "integer", "minimum": -100, "maximum": 100},
                "duration": {"type": "number", "minimum": 0, "maximum": 10, "default": 0.2},
                "path": {"type": "string"},
                "confirmed": {"type": "boolean", "default": False, "description": "Set to true once the user has explicitly granted permission for this action."},
            },
            "required": ["action"], "additionalProperties": False,
        },
        handler=computer_control,
    ))
