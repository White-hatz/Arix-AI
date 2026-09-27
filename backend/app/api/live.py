from __future__ import annotations

import asyncio
import contextlib
import json
import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from pydantic import ValidationError

from backend.app.core.config import settings
from backend.app.core.protocol import (
    DEFAULT_LIVE_MODEL,
    THINKING_LIVE_MODEL,
    ModeSwitchInput,
    SessionStart,
    TextInput,
)
from backend.app.services.gemini_live import GeminiLiveBridge
from backend.app.tools.in_app_control_tools import set_app_control_emitter
from backend.app.tools.mode_tools import set_active_mute_handler, set_active_switch_handler

logger = logging.getLogger(__name__)
router = APIRouter()


async def _send_events(websocket: WebSocket, queue: asyncio.Queue[dict]) -> None:
    while True:
        event = await queue.get()
        try:
            await websocket.send_json(event)
        finally:
            queue.task_done()


@router.websocket("/ws/live")
async def live_socket(websocket: WebSocket) -> None:
    origin = websocket.headers.get("origin")
    if origin and origin not in settings.allowed_origins and not origin.startswith("file://"):
        await websocket.close(code=1008, reason="Origin is not allowed")
        return

    await websocket.accept()
    events: asyncio.Queue[dict] = asyncio.Queue()
    sender = asyncio.create_task(_send_events(websocket, events))
    bridge: GeminiLiveBridge | None = None
    bridge_task: asyncio.Task | None = None

    async def emit(event: dict) -> None:
        await events.put(event)

    try:
        first = await websocket.receive_text()
        try:
            start = SessionStart.model_validate_json(first)
        except ValidationError:
            await emit({"type": "error", "code": "invalid_session", "message": "Invalid session configuration"})
            return

        api_key = start.api_key.strip()
        if not api_key:
            await emit({"type": "error", "code": "missing_api_key", "message": "A Gemini API key is required"})
            return

        # If a previous bridge is already active on the application, stop it cleanly
        existing_bridge = getattr(websocket.app.state, "active_bridge", None)
        if existing_bridge is not None:
            logger.warning("[LiveSocket] Closing previous active bridge before starting new live session")
            with contextlib.suppress(Exception):
                await existing_bridge.stop()
            websocket.app.state.active_bridge = None

        # If a preferred mode was configured globally (e.g. from CLI or API) and client used default model
        preferred_mode = getattr(websocket.app.state, "preferred_mode", "normal")
        if preferred_mode == "think" and (not start.model or start.model == DEFAULT_LIVE_MODEL):
            start.model = THINKING_LIVE_MODEL

        logger.info("[LiveSocket] Starting new GeminiLiveBridge (model=%s, preferred_mode=%s)", start.model, preferred_mode)
        memory_runtime = websocket.app.state.memory_runtime
        manager = await memory_runtime.configure_manager(api_key)
        start.system_instruction += await memory_runtime.service.session_context()

        # D7b: Session Continuity — Retrieve prior Home/Live session context
        from backend.app.services.session_reports import get_latest_live_session_report, save_live_session_report
        latest_live_report = get_latest_live_session_report()
        if latest_live_report and latest_live_report.get("summary"):
            summary_text = latest_live_report.get("summary")
            saved_time = latest_live_report.get("formatted_time", "a prior session")
            start.system_instruction += (
                f"\n\n[PRIOR SESSION CONTINUITY]:\n"
                f"In your previous conversation ({saved_time}), the following context and key takeaways were discussed:\n"
                f"{summary_text}\n"
                f"Use this retrieved context naturally to continue the conversation seamlessly where you left off if relevant. Do NOT recite this verbatim or use a canned robotic intro."
            )
        bridge = GeminiLiveBridge(
            start, api_key, emit, memory_runtime.tools, ingest_turn=manager.ingest
        )
        websocket.app.state.active_bridge = bridge
        set_app_control_emitter(emit)

        async def _mute_handler(muted: bool) -> dict[str, Any]:
            if bridge:
                await bridge.set_mute(muted)
            return {"ok": True, "muted": muted}

        set_active_mute_handler(_mute_handler)
        bridge_task = asyncio.create_task(bridge.run())

        while True:
            receive_task = asyncio.create_task(websocket.receive())
            done, _ = await asyncio.wait(
                {receive_task, bridge_task}, return_when=asyncio.FIRST_COMPLETED
            )
            if bridge_task in done:
                receive_task.cancel()
                error = bridge_task.exception()
                if error:
                    logger.error("Gemini Live session ended with error: %s", error, exc_info=error)
                    err_str = str(error)
                    if "api_key" in err_str.lower() or "unauthenticated" in err_str.lower():
                        clean_msg = "Invalid or unauthenticated Gemini API key. Please verify your API key in Configure."
                    elif "permission" in err_str.lower() or "denied" in err_str.lower():
                        clean_msg = "Gemini API permission denied. Please verify your account/key has access to Gemini Live."
                    else:
                        clean_msg = f"Gemini Live error: {err_str[:250]}"
                    await emit({
                        "type": "error",
                        "code": "gemini_connection",
                        "message": clean_msg,
                    })
                break

            message = receive_task.result()
            if message["type"] == "websocket.disconnect":
                logger.info("[LiveSocket] Client disconnected cleanly")
                break
            if message.get("bytes") is not None:
                await bridge.send_audio(message["bytes"])
            elif message.get("text"):
                try:
                    payload = json.loads(message["text"])
                    p_type = payload.get("type")
                    if p_type == "switch_mode":
                        mode_input = ModeSwitchInput.model_validate(payload)
                        logger.info("[LiveSocket] Client sent switch_mode: %s", mode_input.mode)
                        websocket.app.state.preferred_mode = mode_input.mode
                        await bridge.switch_mode(mode_input.mode)
                    elif p_type == "set_mute":
                        muted = bool(payload.get("muted", True))
                        logger.info("[LiveSocket] Client sent set_mute: %s", muted)
                        await bridge.set_mute(muted)
                    elif p_type in ("abort_desktop_control", "desktop_control_override"):
                        from backend.app.tools.computer_tools import abort_desktop_control
                        logger.info("[LiveSocket] Client requested desktop control override")
                        abort_desktop_control()
                        await emit({"type": "desktop_control_active", "active": False, "action": "aborted"})
                    elif p_type == "text":
                        text_input = TextInput.model_validate(payload)
                        text = text_input.text.strip()
                        lower = text.lower()

                        # Direct mute commands
                        if lower in ("mute", "/mute", "mute ai", "be quiet", "shut up", "silence"):
                            logger.info("[LiveSocket] Direct mute command: %s", text)
                            await bridge.set_mute(True)
                            await emit({
                                "type": "transcript",
                                "role": "system",
                                "text": "AI voice output is now MUTED (listening silently)",
                                "final": True,
                            })
                            continue
                        if lower in ("unmute", "/unmute", "unmute ai", "speak", "speak up", "talk again"):
                            logger.info("[LiveSocket] Direct unmute command: %s", text)
                            await bridge.set_mute(False)
                            await emit({
                                "type": "transcript",
                                "role": "system",
                                "text": "AI voice output is now UNMUTED",
                                "final": True,
                            })
                            continue

                        # Direct command matching
                        if lower in ("switch think", "/switch think", "switch deep think"):
                            logger.info("[LiveSocket] Direct command switch to think: %s", text)
                            websocket.app.state.preferred_mode = "think"
                            await bridge.switch_mode("think")
                            await emit({
                                "type": "transcript",
                                "role": "system",
                                "text": f"Switched mode to think ({THINKING_LIVE_MODEL})",
                                "final": True,
                            })
                            continue
                        if lower in ("switch normal", "/switch normal", "switch standard"):
                            logger.info("[LiveSocket] Direct command switch to normal: %s", text)
                            websocket.app.state.preferred_mode = "normal"
                            await bridge.switch_mode("normal")
                            await emit({
                                "type": "transcript",
                                "role": "system",
                                "text": f"Switched mode to normal ({DEFAULT_LIVE_MODEL})",
                                "final": True,
                            })
                            continue
                        if lower in ("switch normal/think", "switch think/normal", "/switch"):
                            new_mode = "normal" if bridge.mode == "think" else "think"
                            logger.info("[LiveSocket] Direct toggle command: %s -> %s", text, new_mode)
                            websocket.app.state.preferred_mode = new_mode
                            await bridge.switch_mode(new_mode)
                            await emit({
                                "type": "transcript",
                                "role": "system",
                                "text": f"Switched mode to {new_mode} ({bridge.current_model})",
                                "final": True,
                            })
                            continue

                        # Natural language triggers like "use deep think/extended thinking/use thinking for ..."
                        if any(phrase in lower for phrase in ("use deep think", "use extended thinking", "use thinking", "deep think:", "think deeply:")):
                            logger.info("[LiveSocket] Natural language switch to think triggered by prompt: %r", text)
                            websocket.app.state.preferred_mode = "think"
                            await bridge.switch_mode("think", context=text)
                            continue

                        await bridge.send_text(text)
                except (json.JSONDecodeError, ValidationError):
                    await emit({"type": "error", "code": "invalid_message", "message": "The message was not valid"})
    except WebSocketDisconnect:
        logger.info("[LiveSocket] WebSocketDisconnect caught")
    except Exception as error:  # The key and message payload are deliberately never logged.
        logger.warning("Live socket failed (%s)", type(error).__name__)
        with contextlib.suppress(Exception):
            await emit({"type": "error", "code": "local_bridge", "message": "The local live bridge encountered an error"})
    finally:
        set_active_mute_handler(None)
        set_active_switch_handler(None)
        set_app_control_emitter(None)
        if getattr(websocket.app.state, "active_bridge", None) is bridge:
            websocket.app.state.active_bridge = None
        if bridge:
            # D7b: Save session takeaways to continuity report & memory
            if hasattr(bridge, "conversation_history") and len(bridge.conversation_history) >= 2:
                try:
                    turns = bridge.conversation_history[-10:]
                    summary_lines = [f"{t.get('role', 'speaker')}: {t.get('text', '')}" for t in turns if t.get('text')]
                    if summary_lines:
                        combined_summary = "\n".join(summary_lines)
                        from backend.app.services.session_reports import save_live_session_report
                        save_live_session_report({
                            "summary": combined_summary,
                            "turn_count": len(bridge.conversation_history),
                        })
                        if memory_runtime and hasattr(memory_runtime, "service"):
                            summary_excerpt = combined_summary[:400]
                            await memory_runtime.service.save_direct(
                                f"Home conversation session takeaways ({time.strftime('%Y-%m-%d %H:%M')}): {summary_excerpt}",
                                source="live_direct"
                            )
                        logger.info("[LiveSocket] Auto-saved session continuity takeaways")
                except Exception as save_err:
                    logger.warning("[LiveSocket] Failed to auto-save session continuity: %s", save_err)

            logger.info("[LiveSocket] Stopping active bridge in socket teardown")
            await bridge.stop()
        if bridge_task and not bridge_task.done():
            bridge_task.cancel()
        with contextlib.suppress(TimeoutError):
            await asyncio.wait_for(events.join(), timeout=0.25)
        sender.cancel()
        logger.info("[LiveSocket] Live socket session teardown complete")

