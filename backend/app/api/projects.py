from __future__ import annotations

import json
import logging
import os
import time
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from backend.app.core.config import settings

logger = logging.getLogger("backend.api.projects")
router = APIRouter(prefix="/api/projects", tags=["projects"])

PROJECTS_FILE = settings.data_directory / "projects.json"
STATS_CACHE_FILE = settings.data_directory / "project-stats-cache.json"
STATS_CACHE: dict[str, dict[str, Any]] = {}

IGNORED_DIRS = {
    "node_modules",
    ".venv",
    "venv",
    "env",
    ".git",
    "__pycache__",
    ".pytest_cache",
    "dist",
    "build",
    ".next",
    ".nuxt",
    ".idea",
    ".vscode",
}


def load_stats_cache() -> dict[str, dict[str, Any]]:
    if not STATS_CACHE_FILE.exists():
        return {}
    try:
        data = json.loads(STATS_CACHE_FILE.read_text(encoding="utf-8"))
        if isinstance(data, dict):
            return data
    except Exception as err:
        logger.warning("Failed to read %s: %s", STATS_CACHE_FILE, err)
    return {}


def save_stats_cache(cache: dict[str, dict[str, Any]]) -> None:
    try:
        STATS_CACHE_FILE.parent.mkdir(parents=True, exist_ok=True)
        STATS_CACHE_FILE.write_text(json.dumps(cache, indent=2), encoding="utf-8")
    except Exception as err:
        logger.warning("Failed to write %s: %s", STATS_CACHE_FILE, err)


def get_core_project_path() -> Path:
    # Resolve repository root: from backend/app/api -> up 3 levels to repo root
    return Path(__file__).resolve().parent.parent.parent.parent


def format_bytes(size: int) -> str:
    if size < 1024:
        return f"{size} B"
    if size < 1024 * 1024:
        return f"{size / 1024:.1f} KB"
    if size < 1024 * 1024 * 1024:
        return f"{size / (1024 * 1024):.1f} MB"
    return f"{size / (1024 * 1024 * 1024):.2f} GB"


def scan_project_stats_sync(target_path: Path) -> dict[str, Any]:
    if not target_path.exists() or not target_path.is_dir():
        return {
            "sizeBytes": 0,
            "humanSize": "0 B",
            "folderCount": 0,
            "fileCount": 0,
            "mtime": 0,
            "cachedAt": int(time.time() * 1000),
            "error": "Directory does not exist",
        }

    total_bytes = 0
    file_count = 0
    folder_count = 0
    root_mtime = target_path.stat().st_mtime

    try:
        for root, dirs, files in os.walk(target_path, followlinks=False):
            # Exclude ignored directories in-place
            dirs[:] = [d for d in dirs if d not in IGNORED_DIRS and not d.startswith(".")]
            folder_count += len(dirs)
            for f in files:
                file_count += 1
                try:
                    file_path = Path(root) / f
                    if not file_path.is_symlink():
                        total_bytes += file_path.stat().st_size
                except (OSError, PermissionError):
                    continue
    except Exception as err:
        logger.warning("Error scanning project stats for %s: %s", target_path, err)

    return {
        "sizeBytes": total_bytes,
        "humanSize": format_bytes(total_bytes),
        "folderCount": folder_count,
        "fileCount": file_count,
        "mtime": root_mtime,
        "cachedAt": int(time.time() * 1000),
    }


def load_user_projects() -> list[dict[str, Any]]:
    if not PROJECTS_FILE.exists():
        return []
    try:
        data = json.loads(PROJECTS_FILE.read_text(encoding="utf-8"))
        if isinstance(data, list):
            return data
    except Exception as err:
        logger.error("Failed to read %s: %s", PROJECTS_FILE, err)
    return []


def save_user_projects(projects: list[dict[str, Any]]) -> None:
    try:
        PROJECTS_FILE.parent.mkdir(parents=True, exist_ok=True)
        PROJECTS_FILE.write_text(json.dumps(projects, indent=2), encoding="utf-8")
    except Exception as err:
        logger.error("Failed to write %s: %s", PROJECTS_FILE, err)


class AddProjectInput(BaseModel):
    path: str = Field(min_length=1)
    name: str = Field(default="")


class ProjectStatsInput(BaseModel):
    path: str = Field(min_length=1)
    refresh: bool = Field(default=False)


@router.get("")
async def list_projects() -> dict[str, Any]:
    global STATS_CACHE
    if not STATS_CACHE:
        STATS_CACHE = load_stats_cache()

    core_path = get_core_project_path()
    user_projects = load_user_projects()
    norm_core = os.path.normpath(str(core_path))

    # Instant cached check for core project
    core_stats = STATS_CACHE.get(norm_core)
    core_mtime = core_path.stat().st_mtime if core_path.exists() else 0
    if not core_stats or core_stats.get("mtime", 0) != core_mtime:
        core_stats = scan_project_stats_sync(core_path)
        STATS_CACHE[norm_core] = core_stats
        save_stats_cache(STATS_CACHE)

    core_project = {
        "id": "core-arix-ai",
        "name": "Arix AI (Core System)",
        "path": str(core_path),
        "isCore": True,
        "lastOpened": int(core_mtime * 1000) if core_path.exists() else 0,
        "stats": core_stats,
    }

    results = [core_project]
    cache_dirty = False

    for p in user_projects:
        p_path = p.get("path", "")
        norm_p = os.path.normpath(p_path)
        if norm_p == norm_core:
            continue
        p_copy = dict(p)
        p_copy["isCore"] = False

        # Instant check from cache
        p_path_obj = Path(norm_p)
        p_mtime = p_path_obj.stat().st_mtime if p_path_obj.exists() else 0
        cached_p_stats = STATS_CACHE.get(norm_p)

        if not cached_p_stats:
            cached_p_stats = scan_project_stats_sync(p_path_obj)
            STATS_CACHE[norm_p] = cached_p_stats
            cache_dirty = True
        elif cached_p_stats.get("mtime", 0) != p_mtime:
            cached_p_stats = scan_project_stats_sync(p_path_obj)
            STATS_CACHE[norm_p] = cached_p_stats
            cache_dirty = True

        p_copy["stats"] = cached_p_stats
        results.append(p_copy)

    if cache_dirty:
        save_stats_cache(STATS_CACHE)

    return {"projects": results}


@router.post("")
async def add_project(payload: AddProjectInput) -> dict[str, Any]:
    global STATS_CACHE
    norm_path = os.path.normpath(payload.path.strip())
    p = Path(norm_path)
    if not p.exists() or not p.is_dir():
        raise HTTPException(status_code=400, detail="The selected path is not a valid directory.")

    core_path = get_core_project_path()
    if os.path.normpath(str(core_path)) == norm_path:
        return {"ok": True, "message": "Arix AI Core is already registered."}

    user_projects = load_user_projects()
    for existing in user_projects:
        if os.path.normpath(existing.get("path", "")) == norm_path:
            return {"ok": True, "project": existing, "message": "Project already exists in registry."}

    name = payload.name.strip() or p.name or "Untitled Project"
    new_project = {
        "id": f"proj-{len(user_projects) + 1}-{int(os.path.getmtime(p) if p.exists() else 0)}",
        "name": name,
        "path": norm_path,
        "lastOpened": int(os.path.getmtime(p) * 1000) if p.exists() else 0,
    }
    user_projects.append(new_project)
    save_user_projects(user_projects)

    # Trigger stats scan
    stats = scan_project_stats_sync(p)
    STATS_CACHE[norm_path] = stats
    save_stats_cache(STATS_CACHE)
    new_project["stats"] = stats

    logger.info("[Projects] Added project '%s' at %s", name, norm_path)
    return {"ok": True, "project": new_project}


@router.delete("")
async def remove_project(path: str) -> dict[str, Any]:
    global STATS_CACHE
    norm_path = os.path.normpath(path.strip())
    core_path = get_core_project_path()
    if os.path.normpath(str(core_path)) == norm_path:
        raise HTTPException(status_code=400, detail="Cannot remove permanent Arix AI core project.")

    user_projects = load_user_projects()
    filtered = [p for p in user_projects if os.path.normpath(p.get("path", "")) != norm_path]
    save_user_projects(filtered)
    STATS_CACHE.pop(norm_path, None)
    save_stats_cache(STATS_CACHE)

    logger.info("[Projects] Removed project from registry: %s", norm_path)
    return {"ok": True, "removed": norm_path}


@router.post("/stats")
async def get_project_stats(payload: ProjectStatsInput) -> dict[str, Any]:
    global STATS_CACHE
    norm_path = os.path.normpath(payload.path.strip())
    p = Path(norm_path)
    p_mtime = p.stat().st_mtime if p.exists() else 0

    if not payload.refresh and norm_path in STATS_CACHE:
        cached = STATS_CACHE[norm_path]
        if cached.get("mtime") == p_mtime:
            return {"ok": True, "stats": cached}

    stats = scan_project_stats_sync(p)
    STATS_CACHE[norm_path] = stats
    save_stats_cache(STATS_CACHE)
    return {"ok": True, "stats": stats}


@router.post("/stats/refresh-all")
async def refresh_all_project_stats() -> dict[str, Any]:
    global STATS_CACHE
    core_path = get_core_project_path()
    user_projects = load_user_projects()

    core_stats = scan_project_stats_sync(core_path)
    STATS_CACHE[os.path.normpath(str(core_path))] = core_stats

    for p in user_projects:
        p_path = Path(p.get("path", ""))
        if p_path.exists():
            STATS_CACHE[os.path.normpath(str(p_path))] = scan_project_stats_sync(p_path)

    save_stats_cache(STATS_CACHE)
    return {"ok": True, "stats": STATS_CACHE}
