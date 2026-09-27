"""FastAPI endpoints for SWE-Kit integration, dependencies, GitHub status, and sandboxed trials."""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from backend.app.services.swe_kit import agent_runner, detector, github_service, installer

logger = logging.getLogger("backend.api.swe_kit")
router = APIRouter(prefix="/api/swe-kit", tags=["swe-kit"])


class GitHubConnectInput(BaseModel):
    token: str = Field(min_length=1)


class TrialApplyInput(BaseModel):
    workspace_root: str = Field(min_length=1)
    trial_id: str = Field(min_length=1)


@router.get("/status")
async def get_swe_kit_status() -> dict[str, Any]:
    """Returns status of Docker, Git, Composio, SWE-Kit, and GitHub connections."""
    return detector.get_full_system_status()


@router.post("/install")
async def trigger_install(force: bool = False) -> dict[str, Any]:
    """Triggers background installation of SWE-Kit & Composio packages into backend venv."""
    return await installer.start_background_installation(force=force)


@router.get("/install-status")
async def get_install_status() -> dict[str, Any]:
    """Checks the progress and logs of package installation."""
    return installer.get_installation_status()


@router.post("/github/connect")
async def connect_github(payload: GitHubConnectInput) -> dict[str, Any]:
    """Validates and persists GitHub token in backend settings."""
    res = github_service.connect_github_token(payload.token)
    if not res.get("ok"):
        raise HTTPException(status_code=400, detail=res.get("error", "Failed to connect GitHub"))
    return res


@router.post("/github/disconnect")
async def disconnect_github() -> dict[str, Any]:
    """Disconnects GitHub account."""
    return github_service.disconnect_github()


@router.post("/trial/apply")
async def apply_trial(payload: TrialApplyInput) -> dict[str, Any]:
    """Merges files from an isolated trial back into the live workspace."""
    res = agent_runner.apply_isolated_trial(payload.workspace_root, payload.trial_id)
    if not res.get("success"):
        raise HTTPException(status_code=400, detail=res.get("error", "Failed to apply trial"))
    return res


@router.get("/trial/{trial_id}")
async def get_trial_details(trial_id: str, workspace_root: str = Query(..., min_length=1)) -> dict[str, Any]:
    """Retrieves diff and output logs for an isolated trial sandbox run."""
    meta_path = Path(workspace_root) / ".arix/trials" / trial_id / "trial_meta.json"
    if not meta_path.exists():
        raise HTTPException(status_code=404, detail="Trial record not found")
    try:
        data = json.loads(meta_path.read_text(encoding="utf-8"))
        return {"ok": True, "trial": data}
    except Exception as err:
        raise HTTPException(status_code=500, detail=f"Failed to read trial: {err}")
