from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Request, Response
from fastapi.responses import FileResponse
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
    orb_model: str = Field(default="classic", alias="orbModel")
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
    permission_policies: dict[str, str] = Field(
        default_factory=lambda: {
            "fileOperations": "always_ask",
            "terminalCommands": "always_ask",
            "appLaunching": "always_ask",
            "desktopControl": "always_ask",
        },
        alias="permissionPolicies",
    )
    granted_permissions: list[dict[str, Any]] = Field(default_factory=list, alias="grantedPermissions")

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
async def update_settings(payload: dict[str, Any], request: Request) -> dict[str, Any]:
    current = load_backend_config()
    current.update(payload)

    # Normalize and persist selected voice persona
    if "voice" in payload and payload["voice"]:
        clean_voice = str(payload["voice"]).strip().title()
        current["voice"] = clean_voice
        # If live bridge is currently running, update its voice immediately without dropping session
        active_bridge = getattr(request.app.state, "active_bridge", None)
        if active_bridge:
            try:
                logger.info("[Settings] Propagating voice change '%s' to active live bridge", clean_voice)
                await active_bridge.set_voice(clean_voice)
            except Exception as err:
                logger.warning("[Settings] Error propagating voice to active bridge: %s", err)

    save_backend_config(current)

    # If API key updated, update runtime memory if applicable
    raw_key = current.get("apiKey") or current.get("api_key") or ""
    if raw_key:
        # Update settings object in-memory
        object.__setattr__(settings, "fallback_api_key", raw_key)
        logger.info("[Settings] Active Gemini API key updated in backend memory")

    logger.info("[Settings] Configuration updated successfully (voice=%s)", current.get("voice"))
    return {"ok": True, "settings": current}


@router.get("/voice-preview")
async def get_voice_preview(voice: str = "Kore") -> Response:
    """Returns a real, high-fidelity audio preview WAV for the requested Gemini voice persona."""
    clean_voice = voice.strip().lower()
    file_path = settings.data_directory / "voice_previews" / f"{clean_voice}.wav"
    if file_path.exists() and file_path.stat().st_size > 1000:
        return FileResponse(file_path, media_type="audio/wav", headers={"Cache-Control": "public, max-age=86400"})

    # Fallback to kore.wav if specific voice not found
    fallback_path = settings.data_directory / "voice_previews" / "kore.wav"
    if fallback_path.exists() and fallback_path.stat().st_size > 1000:
        return FileResponse(fallback_path, media_type="audio/wav", headers={"Cache-Control": "public, max-age=86400"})

    raise HTTPException(status_code=404, detail=f"Voice preview audio for '{voice}' not found")


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


@router.get("/permissions")
async def get_permissions_route() -> dict[str, Any]:
    """Retrieve active permission category policies, persistent granted permissions, and session grants."""
    from backend.app.tools.safety import get_session_granted_paths
    from backend.app.tools.system_tools import _SESSION_GRANTED_APPS
    from backend.app.tools.computer_tools import _SESSION_DESKTOP_CONTROL_GRANTED

    cfg = load_backend_config()
    policies = cfg.get("permissionPolicies") or {
        "fileOperations": "always_ask",
        "terminalCommands": "always_ask",
        "appLaunching": "always_ask",
        "desktopControl": "always_ask",
    }
    granted = cfg.get("grantedPermissions") or []

    return {
        "ok": True,
        "policies": policies,
        "grantedPermissions": granted,
        "session": {
            "grantedPaths": get_session_granted_paths(),
            "grantedApps": sorted(_SESSION_GRANTED_APPS),
            "desktopControlGranted": _SESSION_DESKTOP_CONTROL_GRANTED,
        },
    }


@router.post("/permissions/policy")
async def update_permission_policy_route(payload: dict[str, Any]) -> dict[str, Any]:
    """Update policy for a category (always_ask, ask_once_per_session, always_allow)."""
    category = payload.get("category")
    policy = payload.get("policy")
    if not category or policy not in ("always_ask", "ask_once_per_session", "always_allow"):
        raise HTTPException(status_code=400, detail="Valid category and policy ('always_ask', 'ask_once_per_session', 'always_allow') are required")

    cfg = load_backend_config()
    if "permissionPolicies" not in cfg or not isinstance(cfg["permissionPolicies"], dict):
        cfg["permissionPolicies"] = {
            "fileOperations": "always_ask",
            "terminalCommands": "always_ask",
            "appLaunching": "always_ask",
            "desktopControl": "always_ask",
        }
    cfg["permissionPolicies"][category] = policy
    save_backend_config(cfg)
    return {"ok": True, "policies": cfg["permissionPolicies"]}


@router.post("/permissions/grant")
async def grant_permission_route(payload: dict[str, Any]) -> dict[str, Any]:
    """Grant permission for a path, drive, app, or command."""
    from backend.app.tools.safety import grant_session_path
    from backend.app.tools.system_tools import _SESSION_GRANTED_APPS

    category = payload.get("category", "file_operations")
    target = str(payload.get("target", "")).strip()
    scope = payload.get("scope", "persistent")  # "session" or "persistent"

    if not target:
        raise HTTPException(status_code=400, detail="Target is required")

    # Session grant
    if category in ("file_operations", "path", "drive"):
        grant_session_path(target)
    elif category in ("app_launching", "app"):
        _SESSION_GRANTED_APPS.add(target.casefold())

    # Persistent grant if requested
    if scope == "persistent":
        cfg = load_backend_config()
        granted = cfg.get("grantedPermissions", [])
        import time
        import uuid
        existing = [g for g in granted if g.get("target") == target and g.get("category") == category]
        if not existing:
            granted.append({
                "id": f"grant-{uuid.uuid4().hex[:8]}",
                "category": category,
                "target": target,
                "scope": "persistent",
                "grantedAt": int(time.time() * 1000),
            })
            cfg["grantedPermissions"] = granted
            save_backend_config(cfg)

    return {"ok": True, "granted": True, "category": category, "target": target, "scope": scope}


@router.post("/permissions/revoke")
async def revoke_permission_route(payload: dict[str, Any]) -> dict[str, Any]:
    """Revoke a previously granted permission."""
    from backend.app.tools.safety import revoke_session_path
    from backend.app.tools.system_tools import _SESSION_GRANTED_APPS

    grant_id = payload.get("id")
    target = payload.get("target")

    cfg = load_backend_config()
    granted = cfg.get("grantedPermissions", [])

    if grant_id:
        to_remove = [g for g in granted if g.get("id") == grant_id]
        granted = [g for g in granted if g.get("id") != grant_id]
        cfg["grantedPermissions"] = granted
        save_backend_config(cfg)
        for r in to_remove:
            t = r.get("target")
            if t:
                revoke_session_path(t)
                _SESSION_GRANTED_APPS.discard(t.casefold())
    elif target:
        granted = [g for g in granted if g.get("target") != target]
        cfg["grantedPermissions"] = granted
        save_backend_config(cfg)
        revoke_session_path(target)
        _SESSION_GRANTED_APPS.discard(target.casefold())

    return {"ok": True, "revoked": True, "grantedPermissions": granted}

