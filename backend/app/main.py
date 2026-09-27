from __future__ import annotations

import json
import logging
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from backend.app.api.live import router as live_router
from backend.app.api.mcp import router as mcp_router
from backend.app.api.memory import router as memory_router
from backend.app.api.projects import router as projects_router
from backend.app.api.settings import load_backend_config, router as settings_router
from backend.app.api.swe_kit import router as swe_kit_router
from backend.app.api.workspace import router as workspace_router
from backend.app.core.config import settings
from backend.app.core.logging_config import setup_logging
from backend.app.core.protocol import DEFAULT_LIVE_MODEL, THINKING_LIVE_MODEL
from backend.app.memory.runtime import create_memory_runtime
from backend.app.services.mcp import mcp_manager

logger = logging.getLogger("backend.main")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Initialize file and console logging
    log_path = setup_logging(settings.data_directory / "logs")
    logger.info("Starting Arix Local Bridge (version=%s) with logging at %s", app.version, log_path)

    # Initialize preferred mode, restoring from config.json or mode.json if available
    app.state.preferred_mode = "normal"
    app.state.active_bridge = None
    cfg = load_backend_config()
    if cfg.get("apiKey"):
        object.__setattr__(settings, "fallback_api_key", cfg["apiKey"])
    # Home/Live defaults strictly to standard Gemini 3.8 Live (fast, voice-capable).
    # Extended thinking is invoked only on-demand per D6.
    mode_file = settings.data_directory / "mode.json"
    if mode_file.exists():
        try:
            data = json.loads(mode_file.read_text(encoding="utf-8"))
            if data.get("mode") in ("think", "normal"):
                app.state.preferred_mode = data["mode"]
        except Exception:
            pass

    app.state.memory_runtime = await create_memory_runtime(
        settings.data_directory,
        firebase_database_url=settings.firebase_database_url,
        firebase_service_account=settings.firebase_service_account,
        firebase_service_account_json=settings.firebase_service_account_json,
    )
    yield
    logger.info("Shutting down Arix Local Bridge...")
    await app.state.memory_runtime.close()
    try:
        await mcp_manager.shutdown_all()
    except Exception as err:
        logger.warning("Error shutting down MCP servers: %s", err)


app = FastAPI(
    title="Arix Local Bridge",
    version="0.3.0",
    description="Local-only bridge between the Arix Electron client and Gemini Live.",
    lifespan=lifespan,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=list(settings.allowed_origins),
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(live_router)
app.include_router(memory_router)
app.include_router(settings_router)
app.include_router(projects_router)
app.include_router(workspace_router)
app.include_router(swe_kit_router)
app.include_router(mcp_router)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "service": "arix-local-bridge", "version": app.version}


@app.get("/api/mode")
async def get_mode() -> dict[str, Any]:
    active_bridge = getattr(app.state, "active_bridge", None)
    preferred = getattr(app.state, "preferred_mode", "normal")
    current_mode = active_bridge.mode if active_bridge else preferred
    current_model = (
        active_bridge.current_model
        if active_bridge
        else (THINKING_LIVE_MODEL if current_mode == "think" else DEFAULT_LIVE_MODEL)
    )
    return {
        "mode": current_mode,
        "model": current_model,
        "active_session": active_bridge is not None,
        "preferred_mode": preferred,
    }


@app.post("/api/mode")
async def set_mode(payload: dict[str, Any]) -> dict[str, Any]:
    req_mode = str(payload.get("mode", "")).strip().lower()
    active_bridge = getattr(app.state, "active_bridge", None)
    current_mode = (
        active_bridge.mode if active_bridge else getattr(app.state, "preferred_mode", "normal")
    )

    if req_mode in ("toggle", "switch normal/think", "switch think/normal"):
        target_mode = "normal" if current_mode == "think" else "think"
    elif req_mode in ("think", "thinking", "deep_think", "extended"):
        target_mode = "think"
    elif req_mode in ("normal", "standard", "default"):
        target_mode = "normal"
    else:
        raise HTTPException(
            status_code=400, detail="Invalid mode. Expected 'normal', 'think', or 'toggle'."
        )

    app.state.preferred_mode = target_mode
    try:
        mode_file = settings.data_directory / "mode.json"
        mode_file.parent.mkdir(parents=True, exist_ok=True)
        mode_file.write_text(json.dumps({"mode": target_mode}), encoding="utf-8")
    except Exception:
        pass

    target_model = THINKING_LIVE_MODEL if target_mode == "think" else DEFAULT_LIVE_MODEL
    session_updated = False
    if active_bridge:
        await active_bridge.switch_mode(target_mode)
        session_updated = True

    logger.info(
        "[APIMode] Mode updated to '%s' (model=%s, active_session_updated=%s)",
        target_mode,
        target_model,
        session_updated,
    )

    return {
        "ok": True,
        "mode": target_mode,
        "model": target_model,
        "active_session_updated": session_updated,
        "message": f"Mode switched to {target_mode} ({target_model})",
    }


@app.post("/api/mode/state")
async def update_app_state(payload: dict[str, Any]) -> dict[str, Any]:
    from backend.app.tools.in_app_control_tools import update_reported_app_state
    update_reported_app_state(payload)
    return {"ok": True}


@app.get("/api/logs")
async def get_logs(lines: int = 150) -> dict[str, Any]:
    """Returns the tail of the backend log file for diagnostic inspection."""
    log_file = settings.data_directory / "logs" / "arix.log"
    if not log_file.exists():
        return {"logs": [], "total_lines": 0}
    try:
        content = log_file.read_text(encoding="utf-8", errors="replace").splitlines()
        tail = content[-lines:] if lines > 0 else content
        return {"logs": tail, "total_lines": len(content)}
    except Exception as err:
        return {"logs": [f"Error reading logs: {err}"], "total_lines": 0}

