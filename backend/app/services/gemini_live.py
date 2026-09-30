from __future__ import annotations

import asyncio
import base64
import contextlib
import io
import logging
from pathlib import Path
import time
from collections.abc import Awaitable, Callable
from typing import Any

from google import genai
from google.genai import types

from backend.app.core.protocol import DEFAULT_LIVE_MODEL, THINKING_LIVE_MODEL, SessionStart
from backend.app.tools.registry import ToolRegistry

EventSink = Callable[[dict[str, Any]], Awaitable[None]]
TurnIngestor = Callable[[str, str], Awaitable[None]]

logger = logging.getLogger(__name__)


def _sanitize_tool_response(raw_result: Any, max_string_len: int = 1500, depth: int = 0) -> dict[str, Any]:
    """Sanitize and truncate tool response payload for Gemini Live FunctionResponse.

    Gemini Live transmits tool responses via google.protobuf.Struct over WebSocket.
    Payloads exceeding ~32KB, containing non-primitive objects, or with huge base64 strings
    trigger WebSocket 1007 (invalid frame payload data / Request contains an invalid argument).
    This function guarantees clean, truncated, JSON-serializable dictionaries.
    """
    def _clean_node(node: Any, curr_depth: int) -> Any:
        if curr_depth > 5:
            return "[truncated depth]"

        if node is None or isinstance(node, (bool, int, float)):
            return node

        if isinstance(node, bytes):
            return f"[binary data omitted, length={len(node)} bytes]"

        if isinstance(node, str):
            if node.startswith("data:image/") or (len(node) > 500 and node.startswith(("/9j/", "iVBOR"))):
                return f"[base64 image omitted, length={len(node)}]"
            if len(node) > max_string_len:
                head = node[:800]
                tail = node[-400:]
                omitted = len(node) - 1200
                return f"{head}\n... [omitted {omitted} characters] ...\n{tail}"
            return node

        if isinstance(node, dict):
            clean_dict: dict[str, Any] = {}
            for k, v in node.items():
                key_str = str(k)
                if key_str.lower() in {"screenshot", "data_url", "image_base64", "base64", "frame"} and isinstance(v, str) and len(v) > 200:
                    clean_dict[key_str] = f"[image omitted, length={len(v)}]"
                else:
                    clean_dict[key_str] = _clean_node(v, curr_depth + 1)
            return clean_dict

        if isinstance(node, (list, tuple, set)):
            items = list(node)
            if len(items) > 50:
                return [_clean_node(item, curr_depth + 1) for item in items[:50]] + [f"[omitted {len(items)-50} items]"]
            return [_clean_node(item, curr_depth + 1) for item in items]

        str_repr = str(node)
        if len(str_repr) > max_string_len:
            return str_repr[:max_string_len] + "... [truncated]"
        return str_repr

    cleaned = _clean_node(raw_result, depth)
    if isinstance(cleaned, dict):
        return cleaned
    return {"result": cleaned}


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

SCREEN_VISION_DIRECTIVE = (
    "\n\n[System Directive - Screen Awareness & Multimodal Visual Inspection]: "
    "You have real-time visual perception via `screen_process` and `computer_control`. "
    "When the user asks you to look at their screen, read something on screen, find an icon/button, or check what is currently displayed: "
    "1. Invoke `screen_process(action='capture')` or `computer_control(action='screenshot')`. "
    "2. The bridge immediately streams the captured screen image frame directly into your live multimodal visual input! "
    "3. Once captured, you can directly see the screen and describe or locate elements visually. "
    "4. If you need pixel coordinates to click an element, you can use `screen_process(action='locate', query='...')`."
)

ENVIRONMENT_DIRECTIVE = (
    "\n\n[System Directive - Environmental Self-Awareness]: "
    "You have access to `get_environment_info(scope='all')`. "
    "You possess full awareness of your operating environment. Whenever a task or user question requires knowing "
    "where files, user-registered projects, memories, logs, or Arix AI's own codebase/installation are located, "
    "DO NOT guess, assume, or hallucinate paths. Proactively invoke `get_environment_info()` to retrieve live, verified system data."
)

DYNAMIC_PERMISSION_DIRECTIVE = (
    "\n\n[System Directive - Dynamic Permissions & Real-Time Human Authorization]: "
    "Arix AI uses a dynamic permission model where everything is grantable by the human. "
    "Whenever a tool returns `requires_permission=True` or `status='permission_required'`, the action is paused at the boundary. "
    "1. You MUST clearly explain to the user in that moment (voice or chat) exactly what you need to do and ask for their approval "
    "(e.g. 'I need your permission to access E:\\Coding World — would you like to allow this?'). "
    "2. Once the user approves ('yes', 'sure', 'allow it'), immediately re-invoke the tool with `confirmed=True`. "
    "3. If the user denies permission, gracefully stop and suggest alternatives without repeatedly asking."
)

TOOL_DISCLOSURE_DIRECTIVE = (
    "\n\n[System Directive - Live Tool Self-Disclosure]: "
    "You have access to `list_available_tools`. "
    "If the user asks 'what tools do you have?', 'what can you do?', 'list your tool callings', or asks about available capabilities, "
    "you MUST invoke `list_available_tools()` to retrieve your live registered tool list rather than reciting a static or assumed list."
)

WORKSPACE_AUTONOMY_DIRECTIVE = (
    "\n\n[System Directive - Workspace & Coding Space Full Autonomy, Self-Reliance & Direct Control]: "
    "When interacting within the workspace or regarding any coding project: "
    "1. FULL AUTONOMOUS CONTROL & SELF-RELIANCE: You have direct control over project files, folders, and the terminal. "
    "NEVER ask the user to search for files, inspect line numbers, tell you what dependencies or libraries are installed, "
    "or check code for you. You MUST proactively do all searching and investigation on your own using your available tools: "
    "use `file_controller(action='find'|'list'|'read')` to explore directories and inspect code, use `search_in_files(query=...)` "
    "to grep codebase contents, inspect `package.json`, `requirements.txt`, `pyproject.toml`, imports, and configurations to discover libraries independently. "
    "2. PROACTIVE PLANNING & TASKS: Autonomously formulate the implementation plan (`PLAN.md`) and task checklist (`TASKS.md`). "
    "3. AUTOMATIC HANDOFF TO CODER AGENT: When the plan and task list are ready, or when the user says 'proceed with the plan', "
    "'proceed', 'start', 'execute', or approves the plan, confirm the handoff. The workspace will automatically package the complete plan, "
    "task list, and execution prompt, switch to the Coder Agent tab, and begin execution autonomously without requiring the user to do anything."
)

def _get_system_paths_directive() -> str:
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
        nims_note = ""
        if "nims assignment" in paths:
            nims_note = f"\n- User Project/Assignment Folder: {paths['nims assignment']}"
        return (
            "\n\n[System Directive - Exact Host System Paths & Storage Drives]: "
            "You run on the host system with the following verified directories: "
            f"- User Home Profile: {home}\n"
            f"- Primary Downloads Folder: {d_dl}\n"
            f"- User Profile Downloads: {c_dl}\n"
            f"- Desktop Folder: {desktop}\n"
            f"- Documents Folder: {documents}"
            f"{nims_note}\n"
            f"- Available System Drives: {drives_str}\n"
            "CRITICAL RULE: When searching, reading, listing, or modifying files in Downloads, Desktop, or Documents, "
            "always use these verified host paths. Never assume 'Downloads' or 'Desktop' is inside the workspace root."
        )
    except Exception:
        return (
            "\n\n[System Directive - Exact Host System Paths]: "
            f"- User Home Profile: {Path.home()}\n"
            f"- Downloads: {Path.home() / 'Downloads'}\n"
            f"- Desktop: {Path.home() / 'Desktop'}\n"
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
        self._resumption_handle: str | None = None
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
        full_instruction = (
            f"{base_instruction}"
            f"{THINKING_DIRECTIVE}"
            f"{MUTE_DIRECTIVE}"
            f"{PLANNING_DIRECTIVE}"
            f"{DESKTOP_CONTROL_DIRECTIVE}"
            f"{MEMORY_DIRECTIVE}"
            f"{SCREEN_VISION_DIRECTIVE}"
            f"{ENVIRONMENT_DIRECTIVE}"
            f"{DYNAMIC_PERMISSION_DIRECTIVE}"
            f"{TOOL_DISCLOSURE_DIRECTIVE}"
            f"{WORKSPACE_AUTONOMY_DIRECTIVE}"
            f"{_get_system_paths_directive()}"
        )
        thinking_level = "high" if self.mode == "think" else "minimal"
        selected_voice = (self.config.voice or "Kore").strip().title()
        cfg_kwargs: dict[str, Any] = {
            "response_modalities": [types.Modality.AUDIO],
            "input_audio_transcription": types.AudioTranscriptionConfig(),
            "output_audio_transcription": types.AudioTranscriptionConfig(),
            "speech_config": types.SpeechConfig(
                voice_config=types.VoiceConfig(
                    prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name=selected_voice)
                )
            ),
            "system_instruction": full_instruction,
            "tools": self.tools.declarations(),
        }
        if use_thinking_config:
            cfg_kwargs["thinking_config"] = types.ThinkingConfig(thinking_level=thinking_level)

        # Keepalive & session durability: context window compression
        if hasattr(types, "ContextWindowCompressionConfig") and hasattr(types, "SlidingWindow"):
            with contextlib.suppress(Exception):
                cfg_kwargs["context_window_compression"] = types.ContextWindowCompressionConfig(
                    sliding_window=types.SlidingWindow()
                )

        # Keepalive & session durability: session resumption
        if hasattr(types, "SessionResumptionConfig"):
            with contextlib.suppress(Exception):
                cfg_kwargs["session_resumption"] = types.SessionResumptionConfig(
                    handle=self._resumption_handle
                )

        return types.LiveConnectConfig(**cfg_kwargs)

    async def set_voice(self, new_voice: str) -> dict[str, Any]:
        """Sets the active voice persona and cleanly updates the live connection so the voice persists."""
        clean_voice = new_voice.strip().title()
        if clean_voice == self.config.voice:
            logger.info("[GeminiLiveBridge] Voice is already %s, ignoring change", clean_voice)
            return {"ok": True, "voice": clean_voice}

        logger.info("[GeminiLiveBridge] Switching voice persona: %s -> %s", self.config.voice, clean_voice)
        self.config.voice = clean_voice
        await self.switch_model(self.current_model)
        await self.emit({
            "type": "voice.changed",
            "voice": clean_voice,
        })
        return {"ok": True, "voice": clean_voice}

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
        auto_reconnect_attempts = 0
        while not self._stopping.is_set():
            candidates = self._model_candidates(self.current_model)
            connected_session = None
            active_model = self.current_model
            last_error: Exception | None = None
            cm = None

            for attempt in range(1, 4):
                if self._stopping.is_set():
                    break
                for candidate in candidates:
                    if self._stopping.is_set():
                        break
                    for use_thinking in (True, False):
                        if self._stopping.is_set():
                            break
                        try:
                            logger.info(
                                "[GeminiLiveBridge] Connecting to candidate '%s' (attempt %d/3, thinking_config=%s, resumption_handle=%s)…",
                                candidate,
                                attempt,
                                use_thinking,
                                bool(self._resumption_handle),
                            )
                            await self.emit({
                                "type": "status",
                                "status": "connecting",
                                "message": f"Connecting to {candidate} (attempt {attempt}/3)…",
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
                            auto_reconnect_attempts = 0
                            break
                        except Exception as err:
                            last_error = err
                            logger.warning(
                                "[GeminiLiveBridge] Connection to candidate '%s' failed (attempt %d/3, thinking=%s): %s",
                                candidate,
                                attempt,
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

                if connected_session is not None:
                    break

                # If connection failed due to transient network / DNS, back off before retry
                if attempt < 3 and not self._stopping.is_set():
                    err_str = str(last_error).lower()
                    if any(t in err_str for t in ("11001", "getaddrinfo", "dns", "connection", "connect", "timeout", "timed out", "unreachable")):
                        logger.info("[GeminiLiveBridge] Transient DNS/network error, retrying in 1.5s (attempt %d/3)...", attempt)
                        await asyncio.sleep(1.5)

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

                # Acknowledge all exceptions across all tasks so asyncio never logs "Task exception was never retrieved"
                for task in done | pending:
                    if task is not stop_task and task is not switch_task:
                        with contextlib.suppress(asyncio.CancelledError, Exception):
                            task.exception()

                if stop_task in done or self._stopping.is_set():
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

                # Inspect errors on terminated tasks
                idle_drop = False
                for task in done:
                    if task not in (stop_task, switch_task):
                        exc = task.exception()
                        if exc and not self._stopping.is_set():
                            err_str = str(exc).lower()
                            # Fatal auth/permission errors should fail immediately
                            is_auth_error = any(k in err_str for k in ("api_key", "unauthenticated", "permission", "invalid argument", "forbidden"))
                            if is_auth_error:
                                logger.error("[GeminiLiveBridge] Fatal authentication/permission error: %s", exc)
                                raise exc

                            # Provider dropped session on idle/silence timeout, 1011 internal error, or network drop
                            auto_reconnect_attempts += 1
                            if auto_reconnect_attempts <= 5:
                                logger.warning(
                                    "[GeminiLiveBridge] Provider dropped live session (%s). Auto-reconnecting attempt %d/5 (resumption_handle=%s)...",
                                    exc,
                                    auto_reconnect_attempts,
                                    bool(self._resumption_handle),
                                )
                                await self.emit({
                                    "type": "status",
                                    "status": "connecting",
                                    "message": f"Reconnecting live session (attempt {auto_reconnect_attempts}/5)…",
                                })
                                backoff = min(1.0 * (1.5 ** (auto_reconnect_attempts - 1)), 6.0)
                                await asyncio.sleep(backoff)
                                idle_drop = True
                                break
                            else:
                                logger.error("[GeminiLiveBridge] Exhausted auto-reconnect attempts (%d). Last error: %s", auto_reconnect_attempts, exc)
                                raise exc

                if idle_drop:
                    self._drain_send_queue()
                    if cm is not None:
                        with contextlib.suppress(Exception):
                            await cm.__aexit__(None, None, None)
                        cm = None
                    self._session = None
                    continue

                break
            finally:
                if cm is not None:
                    logger.info("[GeminiLiveBridge] Closing live link to '%s' in cleanup", active_model)
                    with contextlib.suppress(Exception):
                        await cm.__aexit__(None, None, None)
                    cm = None
                self._session = None



    async def _send_loop(self) -> None:
        # Keepalive silent frame: 100ms of PCM digital silence (16kHz 16-bit mono)
        SILENT_KEEPALIVE_FRAME = b"\x00" * 3200
        try:
            while not self._stopping.is_set():
                try:
                    kind, payload = await asyncio.wait_for(self._send_queue.get(), timeout=20.0)
                except asyncio.TimeoutError:
                    # Silence keep-alive: send silent audio packet every 20s so server does not timeout
                    if self._session is not None and not self._stopping.is_set():
                        with contextlib.suppress(Exception):
                            await self._session.send_realtime_input(
                                audio=types.Blob(data=SILENT_KEEPALIVE_FRAME, mime_type="audio/pcm;rate=16000")
                            )
                    continue

                if self._session is None or self._stopping.is_set():
                    continue
                if kind == "audio":
                    await self._session.send_realtime_input(
                        audio=types.Blob(data=payload, mime_type="audio/pcm;rate=16000")
                    )
                elif kind == "text":
                    await self._session.send_realtime_input(text=payload)
        except asyncio.CancelledError:
            pass
        except Exception as error:
            if not self._stopping.is_set():
                logger.warning("[GeminiLiveBridge] Send loop closed: %s", error)
                raise

    async def _receive_loop(self) -> None:
        try:
            while not self._stopping.is_set() and self._session is not None:
                async for response in self._session.receive():
                    if self._stopping.is_set():
                        break
                    await self._handle_response(response)
        except asyncio.CancelledError:
            pass
        except Exception as error:
            err_str = str(error)
            if self._stopping.is_set() or "1000" in err_str or "ConnectionClosedOK" in type(error).__name__:
                logger.debug("[GeminiLiveBridge] Receive loop ended normally: %s", error)
                return
            logger.warning("[GeminiLiveBridge] Receive loop closed: %s", error)
            raise

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
        # Capture session resumption updates for seamless reconnects
        resumption = getattr(response, "session_resumption_update", None)
        if resumption and getattr(resumption, "resumable", False) and getattr(resumption, "new_handle", None):
            self._resumption_handle = resumption.new_handle
            logger.info("[GeminiLiveBridge] Stored session resumption handle for auto-reconnect: %s", self._resumption_handle)

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
                logger.info("[GeminiLiveBridge] Tool %s executed with result: %s", call.name, str(result)[:300])

                # 1. If this was a screenshot or screen inspection action, stream the image frame directly as realtime multimodal media
                inner_result = result.get("result") if isinstance(result, dict) and isinstance(result.get("result"), dict) else result
                ss_path = None
                if isinstance(inner_result, dict):
                    if call.name == "computer_control" and call_args.get("action") == "screenshot":
                        ss_path = inner_result.get("path")
                    elif call.name == "screen_process" and inner_result.get("path"):
                        ss_path = inner_result.get("path")
                elif isinstance(result, dict) and result.get("path"):
                    ss_path = result.get("path")

                if ss_path:
                    try:
                        from PIL import Image
                        img_file = Path(ss_path)
                        if img_file.exists():
                            with Image.open(img_file) as im:
                                im_rgb = im.convert("RGB")
                                im_rgb.thumbnail((1280, 1280))
                                buf = io.BytesIO()
                                im_rgb.save(buf, format="JPEG", quality=75)
                                jpeg_data = buf.getvalue()
                            logger.info("[GeminiLiveBridge] Streaming captured screenshot (%d bytes) to Gemini Live session", len(jpeg_data))
                            await self._session.send_realtime_input(media=types.Blob(data=jpeg_data, mime_type="image/jpeg"))
                            if isinstance(inner_result, dict):
                                inner_result["visual_frame_streamed"] = True
                                inner_result["message"] = (str(inner_result.get("message") or "") + " [Visual screenshot frame delivered directly into your Gemini Live visual context.]").strip()
                    except Exception as ss_media_err:
                        logger.warning("[GeminiLiveBridge] Failed to stream screenshot media frame: %s", ss_media_err)

                # 2. Check for dynamic permission required
                is_perm_required = bool(
                    (isinstance(result, dict) and (result.get("requires_permission") or result.get("status") == "permission_required"))
                    or (isinstance(inner_result, dict) and (inner_result.get("requires_permission") or inner_result.get("status") == "permission_required"))
                )

                # 3. Check for genuine failure
                is_failed = not is_perm_required and (
                    not result.get("ok", True)
                    or not result.get("success", True)
                    or bool(result.get("error"))
                    or result.get("status") in {"system_error", "permission_denied", "error"}
                    or (isinstance(inner_result, dict) and (
                        inner_result.get("ok") is False
                        or inner_result.get("success") is False
                        or bool(inner_result.get("error"))
                        or inner_result.get("status") in {"system_error", "permission_denied", "error"}
                    ))
                )

                if is_perm_required:
                    perm_target = (inner_result and inner_result.get("target")) or (result and result.get("target")) or "resource"
                    perm_msg = (
                        (inner_result and inner_result.get("message"))
                        or (result and result.get("message"))
                        or f"Permission required to perform '{call.name}' on {perm_target}."
                    )
                    enhanced_response = {
                        "ok": False,
                        "requires_permission": True,
                        "status": "permission_required",
                        "target": perm_target,
                        "message": (
                            f"{perm_msg} Ask the user explicitly for permission now. "
                            f"Once granted, re-invoke '{call.name}' with confirmed=True."
                        ),
                    }
                    function_responses.append(types.FunctionResponse(
                        name=call.name, id=call.id, response=_sanitize_tool_response(enhanced_response)
                    ))
                elif is_failed:
                    err_text = str(
                        (inner_result and (inner_result.get("error") or inner_result.get("message")))
                        or result.get("error")
                        or result.get("message")
                        or "Tool execution failed"
                    )
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
                        name=call.name, id=call.id, response=_sanitize_tool_response(enhanced_response)
                    ))
                else:
                    function_responses.append(types.FunctionResponse(
                        name=call.name, id=call.id, response=_sanitize_tool_response(result)
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

