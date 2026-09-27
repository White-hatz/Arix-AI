from __future__ import annotations

import asyncio
import base64
import contextlib
import logging
from collections.abc import Awaitable, Callable
from typing import Any

from google import genai
from google.genai import types

from backend.app.core.protocol import DEFAULT_LIVE_MODEL, THINKING_LIVE_MODEL, SessionStart
from backend.app.tools.registry import ToolRegistry

EventSink = Callable[[dict[str, Any]], Awaitable[None]]
TurnIngestor = Callable[[str, str], Awaitable[None]]

logger = logging.getLogger(__name__)

THINKING_DIRECTIVE = (
    "\n\n[System Directive - Thinking Modes]: You operate by default with standard Gemini 3.8 Live for rapid, "
    "fluid voice conversation. You have access to `switch_thinking_mode`. "
    "Only switch to Extended Thinking mode in two cases: "
    "(1) Explicit user request: the user asks for deeper reasoning (e.g. 'think harder about this', 'use extended thinking', 'reason through this carefully'). "
    "(2) Complex escalation: when a task presents high-stakes complexity or deep debugging logic that clearly benefits from extended reasoning. "
    "When escalating, briefly tell the user: 'This needs deeper thought, switching to extended reasoning for a moment' "
    "and call `switch_thinking_mode(mode='think')`. Switch back to normal (`switch_thinking_mode(mode='normal')`) when concluded."
)

MUTE_DIRECTIVE = (
    "\n\n[System Directive - Voice Mute Control]: You have access to the `set_mute_state` and `mute_ai` tools. "
    "If the user says 'mute', 'mute yourself', 'be quiet', 'shut up', 'silence', 'don't speak', or asks you "
    "not to speak out loud, immediately call `set_mute_state(muted=True)`. "
    "If the user says 'unmute', 'you can speak now', 'speak up', 'talk again', call `set_mute_state(muted=False)`. "
    "When muted, you still listen to their voice, process all requests, run tools, and provide written replies, "
    "but your voice audio output is silenced."
)

PLANNING_DIRECTIVE = (
    "\n\n[System Directive - Mandatory Planning, Step-by-Step Reasoning & Self-Triggered Questions]: "
    "Before executing code changes or taking actions for any software request, you MUST FIRST guide the user in creating: "
    "(1) A concrete Plan (`PLAN.md`): Architecture, affected files, design rationale, and open questions. "
    "(2) An actionable Task List (`TASKS.md`): Ordered checklist of tasks with clear completion markers. "
    "(3) Recommended Commands (`cmd`): Explicit terminal commands to build, test, and run. "
    "STEP-BY-STEP REASONING: Invoke the `sequentialthinking` tool to systematically break down problem spaces, "
    "evaluate architectural tradeoffs, and structure steps before writing files. "
    "PROACTIVE CLARIFYING QUESTIONS: Always self-trigger 1-3 targeted clarifying questions to address ambiguity, "
    "design tradeoffs, or edge cases before beginning implementation. "
    "Always reference files using their workspace relative paths. "
    "When creating or updating `PLAN.md` or `TASKS.md`, invoke `file_controller` with "
    "`action='create_file'`, `path='PLAN.md'`, `content=...`, `confirmed=True`, `overwrite=True`."
)

DESKTOP_CONTROL_DIRECTIVE = (
    "\n\n[System Directive - Desktop-Level OS Automation]: "
    "When the user asks you to interact with the computer/desktop outside Arix AI's own window "
    "(e.g. clicking another app, moving windows, typing into an OS window, or interacting with the desktop) "
    "and no direct tool like `run_command` or `open_app` applies: "
    "1. You MUST ask for permission orally/in-chat FIRST naming specifically what you plan to do "
    "(e.g. 'I can do that on your desktop. May I have permission to take mouse and keyboard control to click the window and type?'). "
    "NEVER take screen/mouse control silently. "
    "2. Once granted, invoke `computer_control` with `confirmed=True`. "
    "3. Use `computer_control(action='screenshot')` whenever you need to visually inspect the desktop state before or after clicking."
)

MEMORY_DIRECTIVE = (
    "\n\n[System Directive - Long-Term Memory & Recall]: "
    "You have access to `save_memory` and `query_memory`. "
    "1. Autonomous & explicit memory persistence: When the user says 'remember this', 'keep this in mind', 'remember that...', "
    "or shares persistent personal preferences, project context, or decisions, immediately call `save_memory(text=...)`. "
    "It instantly persists and reflects in the real-time memory graph. "
    "2. Proactive and explicit recall: When the user asks 'what did we talk about before?', 'do you remember...', or when "
    "prior context/preferences are relevant to the current conversation, call `query_memory(query=...)` to retrieve stored memories."
)


class GeminiLiveBridge:
    """Owns one Gemini Live session and translates it to Arix protocol events."""

    def __init__(
        self,
        config: SessionStart,
        api_key: str,
        emit: EventSink,
        tools: ToolRegistry,
        ingest_turn: TurnIngestor | None = None,
    ) -> None:
        self.config = config
        self.api_key = api_key
        self.emit = emit
        self.tools = tools
        self.ingest_turn = ingest_turn
        self.current_model = config.model or DEFAULT_LIVE_MODEL
        self.mode = "think" if "thinking" in self.current_model else "normal"
        self.is_muted: bool = False
        self._switch_model_event = asyncio.Event()
        self._target_model: str | None = None
        self._target_context: str | None = None
        self._user_transcript: list[str] = []
        self._assistant_transcript: list[str] = []
        self.conversation_history: list[dict[str, str]] = []
        self._client = genai.Client(api_key=api_key)
        self._session: Any | None = None
        self._send_queue: asyncio.Queue[tuple[str, Any]] = asyncio.Queue(maxsize=128)
        self._memory_tasks: set[asyncio.Task[None]] = set()
        self._stopping = asyncio.Event()

    def _model_candidates(self, primary_model: str) -> list[str]:
        candidates = [primary_model]
        for fb in ("gemini-3.1-flash-live-preview", "gemini-2.0-flash-exp"):
            if fb not in candidates:
                candidates.append(fb)
        return candidates

    def _live_config(self, use_thinking_config: bool = True) -> types.LiveConnectConfig:
        base_instruction = self.config.system_instruction or "You are Arix, a helpful voice-first desktop assistant."
        full_instruction = f"{base_instruction}{THINKING_DIRECTIVE}{MUTE_DIRECTIVE}{PLANNING_DIRECTIVE}{DESKTOP_CONTROL_DIRECTIVE}{MEMORY_DIRECTIVE}"
        thinking_level = "high" if self.mode == "think" else "minimal"
        cfg_kwargs: dict[str, Any] = {
            "response_modalities": [types.Modality.AUDIO],
            "input_audio_transcription": types.AudioTranscriptionConfig(),
            "output_audio_transcription": types.AudioTranscriptionConfig(),
            "speech_config": types.SpeechConfig(
                voice_config=types.VoiceConfig(
                    prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name=self.config.voice)
                )
            ),
            "system_instruction": full_instruction,
            "tools": self.tools.declarations(),
        }
        if use_thinking_config:
            cfg_kwargs["thinking_config"] = types.ThinkingConfig(thinking_level=thinking_level)
        return types.LiveConnectConfig(**cfg_kwargs)

    async def set_mute(self, muted: bool) -> None:
        """Mutes or unmutes the bridge's voice audio output dispatch."""
        self.is_muted = muted
        logger.info("[GeminiLiveBridge] Voice mute state updated: is_muted=%s", self.is_muted)
        await self.emit({
            "type": "mute_state",
            "muted": self.is_muted,
        })

    def _drain_send_queue(self) -> int:
        flushed = 0
        while not self._send_queue.empty():
            try:
                self._send_queue.get_nowait()
                flushed += 1
            except (asyncio.QueueEmpty, ValueError):
                break
        if flushed:
            logger.info("[GeminiLiveBridge] Flushed %d pending items from send queue", flushed)
        return flushed

    async def switch_model(self, new_model: str, context: str | None = None) -> dict[str, Any]:
        """Switches the active live session to a new model cleanly."""
        new_mode = "think" if "thinking" in new_model else "normal"
        if new_model == self.current_model and not self._switch_model_event.is_set():
            logger.info("[GeminiLiveBridge] Already running %s, switch ignored", self.current_model)
            return {
                "ok": True,
                "model": self.current_model,
                "mode": self.mode,
                "message": f"Already running {self.current_model}",
            }
        logger.info(
            "[GeminiLiveBridge] Switch requested: %s (%s) -> %s (%s)",
            self.current_model,
            self.mode,
            new_model,
            new_mode,
        )
        self._target_model = new_model
        self._target_context = context
        self._drain_send_queue()
        self._switch_model_event.set()
        await self.emit({
            "type": "thinking.changed",
            "enabled": (new_mode == "think"),
            "mode": new_mode,
            "model": new_model,
        })
        return {
            "ok": True,
            "model": new_model,
            "mode": new_mode,
            "message": f"Switching live session to {new_model} ({new_mode} mode)",
        }

    async def switch_mode(self, mode: str, context: str | None = None) -> dict[str, Any]:
        """Switches mode between 'normal' and 'think'."""
        target_model = (
            THINKING_LIVE_MODEL
            if mode.lower() in ("think", "thinking", "deep_think", "extended")
            else DEFAULT_LIVE_MODEL
        )
        return await self.switch_model(target_model, context=context)

    async def run(self) -> None:
        logger.info("[GeminiLiveBridge] Run loop started (model=%s, mode=%s)", self.current_model, self.mode)
        while not self._stopping.is_set():
            candidates = self._model_candidates(self.current_model)
            connected_session = None
            active_model = self.current_model
            last_error: Exception | None = None
            cm = None

            for candidate in candidates:
                if self._stopping.is_set():
                    break
                for use_thinking in (True, False):
                    try:
                        logger.info(
                            "[GeminiLiveBridge] Connecting to candidate '%s' (thinking_config=%s)…",
                            candidate,
                            use_thinking,
                        )
                        await self.emit({
                            "type": "status",
                            "status": "connecting",
                            "message": f"Connecting to {candidate}…",
                        })
                        config = self._live_config(use_thinking_config=use_thinking)
                        cm = self._client.aio.live.connect(model=candidate, config=config)
                        connected_session = await cm.__aenter__()
                        active_model = candidate
                        logger.info(
                            "[GeminiLiveBridge] Established single active link to '%s' (session_id=%s)",
                            active_model,
                            getattr(connected_session, "session_id", "n/a"),
                        )
                        break
                    except Exception as err:
                        last_error = err
                        logger.warning(
                            "[GeminiLiveBridge] Connection to candidate '%s' failed (thinking=%s): %s",
                            candidate,
                            use_thinking,
                            err,
                        )
                        err_str = str(err).lower()
                        if "api_key" in err_str or "unauthenticated" in err_str or "permission" in err_str:
                            raise
                        if not use_thinking:
                            break
                if connected_session is not None:
                    break

            if connected_session is None:
                logger.error("[GeminiLiveBridge] Could not connect to any candidate. Last error: %s", last_error)
                if last_error:
                    raise last_error
                break

            self._session = connected_session
            self.current_model = active_model
            self._switch_model_event.clear()

            try:
                await self.emit({"type": "session.ready", "model": active_model})
                await self.emit({
                    "type": "thinking.changed",
                    "enabled": ("thinking" in active_model or self.mode == "think"),
                    "mode": self.mode,
                    "model": active_model,
                })

                if self._target_context:
                    logger.info("[GeminiLiveBridge] Providing carried-over context to new session (%d chars)", len(self._target_context))
                    with contextlib.suppress(Exception):
                        await self._session.send_realtime_input(text=self._target_context)
                    self._target_context = None

                send_task = asyncio.create_task(self._send_loop())
                receive_task = asyncio.create_task(self._receive_loop())
                stop_task = asyncio.create_task(self._stopping.wait())
                switch_task = asyncio.create_task(self._switch_model_event.wait())

                done, pending = await asyncio.wait(
                    {send_task, receive_task, stop_task, switch_task},
                    return_when=asyncio.FIRST_COMPLETED,
                )
                for task in pending:
                    task.cancel()
                await asyncio.gather(*pending, return_exceptions=True)

                if stop_task in done:
                    logger.info("[GeminiLiveBridge] Stop event triggered; breaking run loop")
                    break

                if switch_task in done:
                    logger.info(
                        "[GeminiLiveBridge] Model switch event triggered: cleanly closing old link '%s' before connecting to '%s'",
                        active_model,
                        self._target_model,
                    )
                    self._drain_send_queue()
                    if cm is not None:
                        with contextlib.suppress(Exception):
                            await cm.__aexit__(None, None, None)
                        cm = None
                    self._session = None
                    logger.info("[GeminiLiveBridge] Closed previous link to '%s'", active_model)

                    if self._target_model:
                        self.current_model = self._target_model
                        self.mode = "think" if "thinking" in self.current_model else "normal"
                        self._target_model = None
                    continue

                for task in done:
                    if task not in (stop_task, switch_task):
                        task.result()
                break
            finally:
                if cm is not None:
                    logger.info("[GeminiLiveBridge] Closing live link to '%s' in cleanup", active_model)
                    with contextlib.suppress(Exception):
                        await cm.__aexit__(None, None, None)
                    cm = None
                self._session = None



    async def _send_loop(self) -> None:
        while not self._stopping.is_set():
            kind, payload = await self._send_queue.get()
            if self._session is None:
                continue
            if kind == "audio":
                await self._session.send_realtime_input(
                    audio=types.Blob(data=payload, mime_type="audio/pcm;rate=16000")
                )
            elif kind == "text":
                await self._session.send_realtime_input(text=payload)

    async def _receive_loop(self) -> None:
        while not self._stopping.is_set() and self._session is not None:
            async for response in self._session.receive():
                await self._handle_response(response)

    async def _ingest_completed_turn(self, material: str) -> None:
        if not self.ingest_turn:
            return
        try:
            await self.ingest_turn(material, "manager")
        except asyncio.CancelledError:
            raise
        except Exception as error:
            # Memory extraction is best-effort and must never interrupt a live conversation.
            err_msg = str(error)
            if "429" in err_msg or "RESOURCE_EXHAUSTED" in err_msg:
                logger.info("Memory turn ingestion deferred due to quota limits (429).")
            elif "503" in err_msg or "UNAVAILABLE" in err_msg:
                logger.info("Memory turn ingestion deferred due to model load (503).")
            else:
                logger.warning("Memory turn ingestion failed (%s): %s", type(error).__name__, error)

    async def _handle_response(self, response: Any) -> None:
        tool_call = getattr(response, "tool_call", None)
        if tool_call and self._session is not None:
            function_responses: list[types.FunctionResponse] = []
            switch_target_model: str | None = None
            for call in getattr(tool_call, "function_calls", None) or []:
                call_args = dict(call.args or {})
                call_id = getattr(call, "id", None) or f"{call.name}-{int(time.time() * 1000)}"
                logger.info("[GeminiLiveBridge] Model requested tool execution: %s (args=%s, call_id=%s)", call.name, call_args, call_id)

                # Emit tool initiation event for real-time Home conversation stream (D5)
                await self.emit({
                    "type": "tool.call",
                    "call_id": call_id,
                    "name": call.name,
                    "args": call_args,
                })

                result = await self.tools.execute(call.name, call_args)
                logger.info("[GeminiLiveBridge] Tool %s executed with result: %s", call.name, result)
                is_failed = not result.get("ok", True) or not result.get("success", True) or bool(result.get("error"))
                if is_failed:
                    err_text = str(result.get("error") or result.get("message") or "Tool execution failed")
                    logger.warning("[GeminiLiveBridge] System error in tool %s: %s", call.name, err_text)
                    await self.emit({
                        "type": "system_error",
                        "tool": call.name,
                        "error": err_text,
                        "message": f"System Error in tool '{call.name}': {err_text}",
                    })
                    enhanced_response = {
                        "ok": False,
                        "error": err_text,
                        "system_error": err_text,
                        "message": (
                            f"System Error in tool '{call.name}': {err_text}. "
                            f"CRITICAL: Inform the user explicitly that a system error occurred in tool '{call.name}'. "
                            f"Quote the exact error: '{err_text}', explain why it occurred, and suggest how to resolve it."
                        ),
                    }
                    function_responses.append(types.FunctionResponse(
                        name=call.name, id=call.id, response=enhanced_response
                    ))
                else:
                    function_responses.append(types.FunctionResponse(
                        name=call.name, id=call.id, response=result
                    ))
                await self.emit({
                    "type": "tool.result",
                    "call_id": call_id,
                    "name": call.name,
                    "result": result,
                })
                if call.name in ("set_mute_state", "mute_ai") and isinstance(result, dict):
                    inner = result.get("result") if "result" in result else result
                    if isinstance(inner, dict) and "muted" in inner:
                        await self.set_mute(bool(inner["muted"]))
                if call.name == "switch_thinking_mode" and isinstance(result, dict):
                    inner = result.get("result") if "result" in result else result
                    if isinstance(inner, dict) and inner.get("ok"):
                        switch_target_model = inner.get("model")

            if function_responses and self._session is not None:
                logger.info("[GeminiLiveBridge] Sending %d tool response(s) back to Gemini", len(function_responses))
                try:
                    await self._session.send_tool_response(function_responses=function_responses)
                except Exception as err:
                    logger.warning("[GeminiLiveBridge] send_tool_response warning: %s", err)

            if switch_target_model and switch_target_model != self.current_model:
                logger.info("[GeminiLiveBridge] Tool requested switch to %s; initiating switch", switch_target_model)
                recent_context = "".join(self._user_transcript).strip() or None
                await self.switch_model(switch_target_model, context=recent_context)


        content = getattr(response, "server_content", None)
        if content is None:
            return

        input_transcription = getattr(content, "input_transcription", None)
        if input_transcription and getattr(input_transcription, "text", None):
            self._user_transcript.append(input_transcription.text)
            await self.emit({
                "type": "transcript",
                "role": "user",
                "text": input_transcription.text,
                "final": False,
            })

        output_transcription = getattr(content, "output_transcription", None)
        if output_transcription and getattr(output_transcription, "text", None):
            self._assistant_transcript.append(output_transcription.text)
            await self.emit({
                "type": "transcript",
                "role": "assistant",
                "text": output_transcription.text,
                "final": False,
            })

        model_turn = getattr(content, "model_turn", None)
        for part in getattr(model_turn, "parts", None) or []:
            inline_data = getattr(part, "inline_data", None)
            if inline_data and getattr(inline_data, "data", None):
                if self.is_muted:
                    continue
                data = inline_data.data
                if isinstance(data, str):
                    encoded = data
                else:
                    encoded = base64.b64encode(data).decode("ascii")
                await self.emit({
                    "type": "audio",
                    "data": encoded,
                    "mime_type": getattr(inline_data, "mime_type", None) or "audio/pcm;rate=24000",
                })

        if getattr(content, "interrupted", False):
            await self.emit({"type": "interrupted"})
        if getattr(content, "turn_complete", False):
            if self.ingest_turn and (self._user_transcript or self._assistant_transcript):
                material = (
                    f"User: {''.join(self._user_transcript).strip()}\n"
                    f"Arix: {''.join(self._assistant_transcript).strip()}"
                )
                task = asyncio.create_task(self._ingest_completed_turn(material))
                self._memory_tasks.add(task)
                task.add_done_callback(self._memory_tasks.discard)
            self._user_transcript.clear()
            self._assistant_transcript.clear()
            await self.emit({"type": "turn.complete"})

    async def send_audio(self, data: bytes) -> None:
        if not data or self._stopping.is_set():
            return
        try:
            self._send_queue.put_nowait(("audio", data))
        except asyncio.QueueFull:
            # Favor fresh real-time audio over delayed audio when the connection is congested.
            with contextlib.suppress(asyncio.QueueEmpty):
                self._send_queue.get_nowait()
            self._send_queue.put_nowait(("audio", data))

    async def send_text(self, text: str) -> None:
        await self._send_queue.put(("text", text))

    async def stop(self) -> None:
        logger.info("[GeminiLiveBridge] Stopping live bridge for model=%s", self.current_model)
        self._stopping.set()
        self._drain_send_queue()
        for task in self._memory_tasks:
            task.cancel()
        if self._memory_tasks:
            await asyncio.gather(*self._memory_tasks, return_exceptions=True)
        self._memory_tasks.clear()
        logger.info("[GeminiLiveBridge] Live bridge stopped")

