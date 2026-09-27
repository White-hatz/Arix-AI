from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Any

from backend.app.core.protocol import DEFAULT_LIVE_MODEL, THINKING_LIVE_MODEL
from backend.app.tools.registry import ToolDefinition, ToolRegistry

ModeSwitchHandler = Callable[[str, str], Awaitable[dict[str, Any]]] | Callable[[str, str], dict[str, Any]]
MuteHandler = Callable[[bool], Awaitable[dict[str, Any]]] | Callable[[bool], dict[str, Any]]

_ACTIVE_SWITCH_HANDLER: ModeSwitchHandler | None = None
_ACTIVE_MUTE_HANDLER: MuteHandler | None = None


def set_active_switch_handler(handler: ModeSwitchHandler | None) -> None:
    global _ACTIVE_SWITCH_HANDLER
    _ACTIVE_SWITCH_HANDLER = handler


def set_active_mute_handler(handler: MuteHandler | None) -> None:
    global _ACTIVE_MUTE_HANDLER
    _ACTIVE_MUTE_HANDLER = handler


def register_mode_tools(
    registry: ToolRegistry,
    switch_handler: ModeSwitchHandler | None = None,
) -> None:
    """Registers switch_thinking_mode, set_mute_state, and mute_ai tools for Gemini Live conversations."""

    async def _switch_thinking_mode(mode: str, reason: str = "") -> dict[str, Any]:
        normalized_mode = "think" if mode.lower() in ("think", "thinking", "deep_think", "extended") else "normal"
        target_model = THINKING_LIVE_MODEL if normalized_mode == "think" else DEFAULT_LIVE_MODEL

        result: dict[str, Any] = {
            "ok": True,
            "mode": normalized_mode,
            "model": target_model,
            "reason": reason,
            "message": f"Thinking mode switched to {normalized_mode} using {target_model}.",
        }

        handler = switch_handler or _ACTIVE_SWITCH_HANDLER
        if handler:
            custom_res = handler(normalized_mode, reason)
            if hasattr(custom_res, "__await__"):
                custom_res = await custom_res
            if isinstance(custom_res, dict):
                result.update(custom_res)

        return result

    async def _set_mute_state(muted: bool, reason: str = "") -> dict[str, Any]:
        result: dict[str, Any] = {
            "ok": True,
            "muted": muted,
            "reason": reason,
            "message": (
                "AI voice output is now MUTED. You will continue to listen silently and process user requests/tools, but your spoken audio will not play out loud until the user says unmute."
                if muted else
                "AI voice output is now UNMUTED. Your spoken replies will play out loud."
            ),
        }
        handler = _ACTIVE_MUTE_HANDLER
        if handler:
            custom_res = handler(muted)
            if hasattr(custom_res, "__await__"):
                custom_res = await custom_res
            if isinstance(custom_res, dict):
                result.update(custom_res)
        return result

    registry.register(
        ToolDefinition(
            name="switch_thinking_mode",
            description=(
                "Switches the model between standard fast voice mode ('normal', using gemini-3.8-live) "
                "and deep reasoning / extended thinking mode ('think', using gemini-3.8-live-extended-thinking). "
                "Call this tool whenever the user asks to 'use deep think', 'extended thinking', 'use thinking', "
                "'think deeply', or asks to solve complex reasoning/coding/math problems with deep thinking, "
                "or when they ask to switch back to normal/standard mode."
            ),
            parameters={
                "type": "object",
                "properties": {
                    "mode": {
                        "type": "string",
                        "enum": ["think", "normal"],
                        "description": (
                            "The target operational mode: 'think' for deep extended thinking (gemini-3.8-live-extended-thinking), "
                            "or 'normal' for standard fast conversation (gemini-3.8-live)."
                        ),
                    },
                    "reason": {
                        "type": "string",
                        "description": "Optional brief reason or context describing why the mode is being switched.",
                    },
                },
                "required": ["mode"],
            },
            handler=_switch_thinking_mode,
        )
    )

    registry.register(
        ToolDefinition(
            name="set_mute_state",
            description=(
                "Mute or unmute the AI's spoken voice replies. "
                "Call this tool with muted=true when the user says 'mute', 'mute yourself', 'be quiet', "
                "'shut up', 'silence', 'stop speaking', 'don't speak', or asks you not to talk out loud. "
                "Call this tool with muted=false when the user says 'unmute', 'you can speak now', 'talk again'. "
                "While muted, you remain connected, continue listening to the user, execute all actions and tools, "
                "and reply in text, but your spoken audio is suppressed from playing out loud."
            ),
            parameters={
                "type": "object",
                "properties": {
                    "muted": {
                        "type": "boolean",
                        "description": "True to mute spoken voice output; False to unmute.",
                    },
                    "reason": {
                        "type": "string",
                        "description": "Optional reason for muting or unmuting.",
                    },
                },
                "required": ["muted"],
            },
            handler=_set_mute_state,
        )
    )

    registry.register(
        ToolDefinition(
            name="mute_ai",
            description="Quick alias for set_mute_state to mute or unmute the AI's spoken voice output.",
            parameters={
                "type": "object",
                "properties": {
                    "muted": {
                        "type": "boolean",
                        "description": "True to mute spoken voice output; False to unmute.",
                    },
                },
                "required": ["muted"],
            },
            handler=_set_mute_state,
        )
    )
