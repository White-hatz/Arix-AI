from __future__ import annotations

import json
import logging
import time
from pathlib import Path
from typing import Any

logger = logging.getLogger("backend.services.session_reports")


def get_sessions_dir(project_path: str) -> Path:
    p = Path(project_path) / ".arix" / "sessions"
    p.mkdir(parents=True, exist_ok=True)
    return p


def save_session_report(project_path: str, data: dict[str, Any]) -> dict[str, Any]:
    try:
        sessions_dir = get_sessions_dir(project_path)
        timestamp = int(time.time() * 1000)
        iso_time = time.strftime("%Y-%m-%d %H:%M:%S")

        report_id = f"session-{timestamp}"
        data["session_id"] = report_id
        data["saved_at"] = timestamp
        data["formatted_time"] = iso_time

        json_file = sessions_dir / f"{report_id}.json"
        md_file = sessions_dir / f"{report_id}.md"

        json_file.write_text(json.dumps(data, indent=2), encoding="utf-8")

        # Generate markdown summary
        md_content = f"""# Arix AI Session Report — {iso_time}

**Project:** {data.get("project_name", Path(project_path).name)}  
**Directory:** `{project_path}`  
**Session ID:** `{report_id}`  

## Executive Summary
{data.get("summary", "No summary recorded.")}

## Tasks Completed
{chr(10).join(f"- [x] {task}" for task in data.get("tasks_completed", [])) or "None recorded."}

## Next Steps / Pending
{chr(10).join(f"- [ ] {task}" for task in data.get("tasks_pending", [])) or "All planned tasks completed."}

## Modified Files
{chr(10).join(f"- `{f}`" for f in data.get("files_modified", [])) or "None."}

## Active Processes & Terminals
{chr(10).join(f"- `{cmd}`" for cmd in data.get("active_servers", [])) or "No active background servers."}

---
*Generated automatically by Arix AI Workspace Continuity Engine.*
"""
        md_file.write_text(md_content, encoding="utf-8")

        logger.info("[SessionReport] Saved report %s in %s", report_id, sessions_dir)
        return {"success": True, "session_id": report_id, "json_path": str(json_file), "md_path": str(md_file)}
    except Exception as err:
        logger.exception("Failed to save session report: %s", err)
        return {"success": False, "error": str(err)}


def get_latest_session_report(project_path: str) -> dict[str, Any] | None:
    try:
        sessions_dir = Path(project_path) / ".arix" / "sessions"
        if not sessions_dir.exists():
            return None

        json_files = sorted(sessions_dir.glob("session-*.json"), key=lambda p: p.stat().st_mtime, reverse=True)
        if not json_files:
            return None

        latest_file = json_files[0]
        content = json.loads(latest_file.read_text(encoding="utf-8"))
        return content
    except Exception as err:
        logger.warning("Failed to read latest session report for %s: %s", project_path, err)
        return None


def save_live_session_report(data: dict[str, Any]) -> dict[str, Any]:
    """Persists a summary of takeaways and key decisions from a Home/Live session."""
    from backend.app.core.config import settings as app_cfg
    try:
        sessions_dir = app_cfg.data_directory / "sessions"
        sessions_dir.mkdir(parents=True, exist_ok=True)
        timestamp = int(time.time() * 1000)
        iso_time = time.strftime("%Y-%m-%d %H:%M:%S")

        report_id = f"live-session-{timestamp}"
        data["session_id"] = report_id
        data["saved_at"] = timestamp
        data["formatted_time"] = iso_time

        json_file = sessions_dir / f"{report_id}.json"
        json_file.write_text(json.dumps(data, indent=2), encoding="utf-8")
        logger.info("[SessionReport] Saved live conversation report %s", report_id)
        return {"success": True, "session_id": report_id, "json_path": str(json_file)}
    except Exception as err:
        logger.exception("Failed to save live session report: %s", err)
        return {"success": False, "error": str(err)}


def get_latest_live_session_report() -> dict[str, Any] | None:
    """Retrieves the most recent Home/Live session takeaways for seamless conversation resumption."""
    from backend.app.core.config import settings as app_cfg
    try:
        sessions_dir = app_cfg.data_directory / "sessions"
        if not sessions_dir.exists():
            return None

        json_files = sorted(sessions_dir.glob("live-session-*.json"), key=lambda p: p.stat().st_mtime, reverse=True)
        if not json_files:
            return None

        latest_file = json_files[0]
        content = json.loads(latest_file.read_text(encoding="utf-8"))
        return content
    except Exception as err:
        logger.warning("Failed to read latest live session report: %s", err)
        return None
