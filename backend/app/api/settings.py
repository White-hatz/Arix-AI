from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from backend.app.core.config import settings
from backend.app.core.protocol import DEFAULT_LIVE_MODEL, THINKING_LIVE_MODEL

logger = logging.getLogger("backend.api.settings")
router = APIRouter(prefix="/api/settings", tags=["settings"])

CONFIG_FILE = settings.data_directory / "config.json"


class AppSettingsModel(BaseModel):
    api_key: str = Field(default="", alias="apiKey")
    direct_assistant_model: str = Field(default=DEFAULT_LIVE_MODEL, alias="directAssistantModel")
    coder_agent_model: str = Field(default=THINKING_LIVE_MODEL, alias="coderAgentModel")
    extended_thinking_enabled: bool = Field(default=True, alias="extendedThinkingEnabled")
    thinking_budget: str = Field(default="high", alias="thinkingBudget")
    voice: str = Field(default="Kore")
    input_device_id: str = Field(default="default", alias="inputDeviceId")
    output_device_id: str = Field(default="default", alias="outputDeviceId")
    vad_sensitivity: str = Field(default="medium", alias="vadSensitivity")
    push_to_talk: bool = Field(default=False, alias="pushToTalk")
    direct_assistant_instructions: str = Field(
        default=(
            "You are Arix, an articulate, voice-first desktop engineering partner. "
            "Listen to the user, proactively ask self-triggered clarifying questions, synthesize clear structured "
            "plans (PLAN.md), actionable task lists (TASKS.md), and recommended shell commands (cmd) before implementation."
        ),
        alias="directAssistantInstructions",
    )
    coder_agent_instructions: str = Field(
        default=(
            "You are Arix Coder, an autonomous coding agent. Execute plans thoroughly, "
            "read minimal necessary file slices, make batched edits, verify code with tests "
            "and browser automation, and report clearly."
        ),
        alias="coderAgentInstructions",
    )
    long_term_memory_enabled: bool = Field(default=True, alias="longTermMemoryEnabled")
    memory_location: str = Field(default="local", alias="memoryLocation")
    allow_mouse_keyboard_control: bool = Field(default=True, alias="allowMouseKeyboardControl")
    allow_desktop_control: bool = Field(default=True, alias="allowDesktopControl")
    desktop_control_always_allowed_session: bool = Field(default=False, alias="desktopControlAlwaysAllowedSession")
    allow_auto_terminal_commands: bool = Field(default=False, alias="allowAutoTerminalCommands")
    allow_autonomous_browser: bool = Field(default=True, alias="allowAutonomousBrowser")
    allowed_workspace_directories: list[str] = Field(default_factory=list, alias="allowedWorkspaceDirectories")
    theme: str = Field(default="glass-black")
    editor_font_size: int = Field(default=13, alias="editorFontSize")
    editor_theme: str = Field(default="vs-dark", alias="editorTheme")
    editor_font_family: str = Field(
        default="'JetBrains Mono', 'Fira Code', 'Consolas', monospace",
        alias="editorFontFamily",
    )
    editor_tab_size: int = Field(default=2, alias="editorTabSize")
    editor_minimap: bool = Field(default=False, alias="editorMinimap")
    allow_in_app_self_control: bool = Field(default=False, alias="allowInAppSelfControl")
    composio_api_key: str = Field(default="", alias="composioApiKey")
    github_token: str = Field(default="", alias="githubToken")
    github_username: str = Field(default="", alias="githubUsername")
    github_avatar_url: str = Field(default="", alias="githubAvatarUrl")

    model_config = {"populate_by_name": True, "extra": "allow"}


def load_backend_config() -> dict[str, Any]:
    if CONFIG_FILE.exists():
        try:
            return json.loads(CONFIG_FILE.read_text(encoding="utf-8"))
        except Exception as err:
            logger.warning("Failed to parse %s: %s", CONFIG_FILE, err)
    return AppSettingsModel().model_dump(by_alias=True)


def save_backend_config(data: dict[str, Any]) -> None:
    try:
        CONFIG_FILE.parent.mkdir(parents=True, exist_ok=True)
        CONFIG_FILE.write_text(json.dumps(data, indent=2), encoding="utf-8")
    except Exception as err:
        logger.error("Failed to write %s: %s", CONFIG_FILE, err)


@router.get("")
async def get_settings() -> dict[str, Any]:
    config_dict = load_backend_config()
    # Mask API key if requested or return clean structure
    return config_dict


@router.post("")
async def update_settings(payload: dict[str, Any]) -> dict[str, Any]:
    current = load_backend_config()
    current.update(payload)
    save_backend_config(current)

    # If API key updated, update runtime memory if applicable
    raw_key = current.get("apiKey") or current.get("api_key") or ""
    if raw_key:
        # Update settings object in-memory
        object.__setattr__(settings, "fallback_api_key", raw_key)
        logger.info("[Settings] Active Gemini API key updated in backend memory")

    logger.info("[Settings] Configuration updated successfully")
    return {"ok": True, "settings": current}


@router.post("/test-key")
async def test_api_key(payload: dict[str, Any]) -> dict[str, Any]:
    key = str(payload.get("apiKey") or payload.get("api_key") or "").strip()
    if not key:
        raise HTTPException(status_code=400, detail="API key is required")

    try:
        from google import genai
        client = genai.Client(api_key=key)
        # Attempt to list models or do a test call
        models_pager = client.models.list(config={"page_size": 5})
        models = [m.name for m in models_pager]
        return {"ok": True, "message": f"Successfully connected to Gemini API ({len(models)} models available)."}
    except Exception as err:
        err_msg = str(err)
        logger.warning("[Settings] API key test failed: %s", err_msg)
        return {"ok": False, "message": f"Connection failed: {err_msg[:200]}"}


@router.post("/desktop-control/abort")
async def abort_desktop_control_route() -> dict[str, Any]:
    from backend.app.tools.computer_tools import abort_desktop_control
    return abort_desktop_control()


@router.post("/desktop-control/grant-session")
async def grant_session_desktop_control_route(payload: dict[str, Any]) -> dict[str, Any]:
    from backend.app.tools.computer_tools import set_session_desktop_control_granted
    granted = bool(payload.get("granted", True))
    set_session_desktop_control_granted(granted)
    return {"ok": True, "granted": granted}

