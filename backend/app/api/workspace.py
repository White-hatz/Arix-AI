from __future__ import annotations

import asyncio
import json
import logging
import mimetypes
import os
from pathlib import Path
import subprocess
import time
from typing import Any

from fastapi import APIRouter, File, Form, HTTPException, Query, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from backend.app.services.coder_agent import CoderAgentSession
from backend.app.services.session_reports import (
    get_latest_session_report,
    save_session_report,
)
from backend.app.tools import coder_tools
from backend.app.tools.in_app_control_tools import update_reported_app_state

logger = logging.getLogger("backend.api.workspace")
router = APIRouter(prefix="/api/workspace", tags=["workspace"])

# Active sessions map: project_path -> CoderAgentSession
ACTIVE_SESSIONS: dict[str, CoderAgentSession] = {}
USER_TERMINAL_SESSIONS: dict[str, dict[str, Any]] = {}


def _touch_workspace_root(workspace_root: str) -> None:
    if workspace_root and workspace_root.strip():
        update_reported_app_state({
            "current_view": "workspace",
            "active_project": workspace_root.strip(),
        })


@router.post("/active-project")
async def set_active_project(payload: dict[str, Any]) -> dict[str, Any]:
    project_path = payload.get("project_path") or payload.get("workspace_root") or ""
    _touch_workspace_root(project_path)
    return {"ok": True, "active_project": project_path}


class SaveFileInput(BaseModel):
    workspace_root: str = Field(min_length=1)
    path: str = Field(min_length=1)
    content: str = Field(default="")


class SaveSessionInput(BaseModel):
    workspace_root: str = Field(min_length=1)
    data: dict[str, Any] = Field(default_factory=dict)


class KillProcessInput(BaseModel):
    process_id: str = Field(min_length=1)


@router.get("/files")
async def get_workspace_files(
    workspace_root: str = Query(..., min_length=1),
    subpath: str = Query(".", min_length=1),
) -> dict[str, Any]:
    _touch_workspace_root(workspace_root)
    res = coder_tools.list_directory(workspace_root, subpath, depth=1)
    if not res.get("success"):
        raise HTTPException(status_code=400, detail=res.get("error", "Failed to list directory"))
    return res


@router.get("/file-content")
async def get_file_content(
    workspace_root: str = Query(..., min_length=1),
    path: str = Query(..., min_length=1),
    start_line: int | None = Query(None),
    end_line: int | None = Query(None),
) -> dict[str, Any]:
    _touch_workspace_root(workspace_root)
    res = coder_tools.read_file(workspace_root, path, start_line, end_line)
    if not res.get("success"):
        err_msg = str(res.get("error", ""))
        if "not found" in err_msg.lower() or "does not exist" in err_msg.lower():
            return {
                "success": False,
                "exists": False,
                "error": f"File '{path}' does not exist yet.",
                "content": "",
                "path": path,
            }
        raise HTTPException(status_code=400, detail=err_msg or "Failed to read file")
    res["exists"] = True
    return res


@router.get("/raw-file")
async def get_raw_file(
    workspace_root: str = Query(..., min_length=1),
    path: str = Query(..., min_length=1),
):
    resolved = coder_tools.resolve_safe_path(workspace_root, path)
    if not resolved.exists() or not resolved.is_file():
        raise HTTPException(status_code=404, detail="File not found")
    media_type, _ = mimetypes.guess_type(str(resolved))
    return FileResponse(path=str(resolved), media_type=media_type or "application/octet-stream")


class TerminalExecInput(BaseModel):
    workspace_root: str = Field(min_length=1)
    terminal_id: str = Field(min_length=1)
    command: str = Field(min_length=1)


@router.post("/terminal/create")
async def create_user_terminal(payload: dict[str, Any]) -> dict[str, Any]:
    workspace_root = payload.get("workspace_root", "")
    term_id = f"term-{int(time.time() * 1000)}"
    name = payload.get("name", f"Terminal {len(USER_TERMINAL_SESSIONS) + 1}")
    record = {
        "id": term_id,
        "name": name,
        "workspace_root": workspace_root,
        "history": [f"PowerShell session started at {workspace_root}"],
        "created_at": time.time(),
        "is_user": True,
    }
    USER_TERMINAL_SESSIONS[term_id] = record
    return {"ok": True, "terminal": record}


@router.post("/terminal/exec")
async def exec_user_terminal(payload: TerminalExecInput) -> dict[str, Any]:
    term_id = payload.terminal_id
    if term_id not in USER_TERMINAL_SESSIONS:
        USER_TERMINAL_SESSIONS[term_id] = {
            "id": term_id,
            "name": "Terminal",
            "workspace_root": payload.workspace_root,
            "history": [],
            "created_at": time.time(),
            "is_user": True,
        }
    session = USER_TERMINAL_SESSIONS[term_id]
    cmd = payload.command.strip()
    session["history"].append(f"PS {payload.workspace_root}> {cmd}")

    shell_cmd = (
        ["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", cmd]
        if os.name == "nt"
        else ["bash", "-c", cmd]
    )
    try:
        proc = subprocess.run(
            shell_cmd,
            cwd=payload.workspace_root,
            capture_output=True,
            text=True,
            timeout=30,
            encoding="utf-8",
            errors="replace",
        )
        if proc.stdout:
            for line in proc.stdout.splitlines():
                session["history"].append(line)
        if proc.stderr:
            for line in proc.stderr.splitlines():
                session["history"].append(line)
        if not proc.stdout and not proc.stderr:
            session["history"].append("(completed with exit code 0)")
    except subprocess.TimeoutExpired:
        session["history"].append("Command timed out after 30 seconds.")
    except Exception as e:
        session["history"].append(f"Execution error: {e}")

    return {"ok": True, "history": session["history"]}


@router.get("/terminal/list")
async def list_user_terminals(workspace_root: str = Query(...)) -> dict[str, Any]:
    _touch_workspace_root(workspace_root)
    terms = [
        t for t in USER_TERMINAL_SESSIONS.values()
        if os.path.normpath(t.get("workspace_root", "")) == os.path.normpath(workspace_root)
    ]
    return {"ok": True, "terminals": terms}


@router.delete("/terminal/{term_id}")
async def close_user_terminal(term_id: str) -> dict[str, Any]:
    USER_TERMINAL_SESSIONS.pop(term_id, None)
    return {"ok": True}


@router.post("/save-file")
async def save_file(payload: SaveFileInput) -> dict[str, Any]:
    _touch_workspace_root(payload.workspace_root)
    res = coder_tools.write_file(payload.workspace_root, payload.path, payload.content)
    if not res.get("success"):
        raise HTTPException(status_code=400, detail=res.get("error", "Failed to write file"))
    return res


@router.get("/session-report")
async def get_session_report_endpoint(workspace_root: str = Query(..., min_length=1)) -> dict[str, Any]:
    _touch_workspace_root(workspace_root)
    report = get_latest_session_report(workspace_root)
    return {"ok": True, "report": report}


@router.post("/save-session")
async def save_session_endpoint(payload: SaveSessionInput) -> dict[str, Any]:
    _touch_workspace_root(payload.workspace_root)
    res = save_session_report(payload.workspace_root, payload.data)
    return {"ok": res.get("success", False), "result": res}


@router.get("/processes")
async def list_processes_endpoint(workspace_root: str = Query(None)) -> dict[str, Any]:
    if workspace_root:
        _touch_workspace_root(workspace_root)
    procs = coder_tools.list_active_processes(workspace_root)
    return {"ok": True, "processes": procs}


@router.post("/processes/kill")
async def kill_process_endpoint(payload: KillProcessInput) -> dict[str, Any]:
    res = coder_tools.kill_process(payload.process_id)
    return {"ok": res.get("success", False), "result": res}


class AttachPathInput(BaseModel):
    source_path: str = Field(min_length=1)
    workspace_root: str = Field(default="")
    copy_to_workspace: bool = Field(default=False)
    destination_subpath: str = Field(default="uploads")


@router.post("/upload")
async def upload_file_endpoint(
    file: UploadFile = File(...),
    workspace_root: str = Form(""),
    destination_subpath: str = Form("uploads"),
) -> dict[str, Any]:
    if workspace_root and workspace_root.strip():
        _touch_workspace_root(workspace_root)
        base_dir = Path(workspace_root).resolve()
    else:
        from backend.app.tools.in_app_control_tools import _APP_STATE
        active_proj = _APP_STATE.get("active_project")
        if active_proj and Path(active_proj).exists():
            base_dir = Path(active_proj).resolve()
        else:
            base_dir = Path.cwd().resolve()

    dest_folder = (base_dir / destination_subpath).resolve()
    dest_folder.mkdir(parents=True, exist_ok=True)

    filename = os.path.basename(file.filename or "uploaded_file")
    dest_file = dest_folder / filename

    if dest_file.exists():
        stem = dest_file.stem
        suffix = dest_file.suffix
        counter = 1
        while (dest_folder / f"{stem}_{counter}{suffix}").exists():
            counter += 1
        dest_file = dest_folder / f"{stem}_{counter}{suffix}"

    content_bytes = await file.read()
    dest_file.write_bytes(content_bytes)

    mime_type = file.content_type or mimetypes.guess_type(dest_file.name)[0] or "application/octet-stream"
    is_text = False
    preview = None
    if dest_file.suffix.lower() == ".pdf" or mime_type == "application/pdf":
        try:
            import pypdf
            reader = pypdf.PdfReader(str(dest_file))
            extracted = []
            for p in reader.pages[:10]:
                txt = p.extract_text()
                if txt:
                    extracted.append(txt.strip())
            if extracted:
                is_text = True
                preview = f"[PDF: {len(reader.pages)} pages]\n" + "\n\n".join(extracted)[:4000]
        except Exception:
            pass

    if not preview:
        try:
            text_str = content_bytes.decode("utf-8")
            is_text = True
            preview = text_str[:4000]
        except UnicodeDecodeError:
            try:
                text_str = content_bytes.decode("latin-1")
                is_text = True
                preview = text_str[:4000]
            except Exception:
                is_text = False

    return {
        "ok": True,
        "file": {
            "name": dest_file.name,
            "path": str(dest_file),
            "relative_path": os.path.relpath(dest_file, base_dir).replace("\\", "/"),
            "size": len(content_bytes),
            "mime_type": mime_type,
            "is_text": is_text,
            "preview": preview,
        },
    }


@router.get("/system-paths")
async def get_system_paths_endpoint() -> dict[str, Any]:
    from backend.app.tools.safety import get_well_known_system_paths, get_system_drives
    paths = get_well_known_system_paths()
    drives = get_system_drives()
    locations: dict[str, str] = {}
    if "d_downloads" in paths and paths["d_downloads"].exists():
        locations["Downloads (D:)"] = str(paths["d_downloads"])
    if "nims assignment" in paths and paths["nims assignment"].exists():
        locations["NIMS Assignment"] = str(paths["nims assignment"])
    c_dl = paths.get("c_downloads") or (Path.home() / "Downloads")
    if c_dl.exists():
        locations["Downloads"] = str(c_dl)
    if "desktop" in paths:
        locations["Desktop"] = str(paths["desktop"])
    if "documents" in paths:
        locations["Documents"] = str(paths["documents"])
    for d in drives:
        locations[f"{d['letter']}: Drive"] = d["path"]
    try:
        from backend.app.tools.in_app_control_tools import _APP_STATE
        active_proj = _APP_STATE.get("active_project")
        if active_proj:
            locations["Active Project"] = str(active_proj)
    except Exception:
        pass
    return {"ok": True, "system_locations": locations, "drives": drives}


@router.post("/attach-path")
async def attach_path_endpoint(payload: AttachPathInput) -> dict[str, Any]:
    from backend.app.tools.safety import resolve_user_path
    from backend.app.tools.coder_tools import resolve_safe_path

    raw_path = payload.source_path.strip()
    workspace_root = payload.workspace_root.strip()

    if workspace_root:
        _touch_workspace_root(workspace_root)
        resolved = resolve_safe_path(workspace_root, raw_path)
    else:
        resolved = resolve_user_path(raw_path, must_exist=False)

    if not resolved.exists():
        resolved_alt = resolve_user_path(raw_path, must_exist=False)
        if resolved_alt.exists():
            resolved = resolved_alt
        else:
            raise HTTPException(status_code=404, detail=f"Path not found: {raw_path}")

    stat = resolved.stat()
    is_dir = resolved.is_dir()
    mime_type = "inode/directory" if is_dir else (mimetypes.guess_type(resolved.name)[0] or "application/octet-stream")
    is_text = False
    preview = None

    if not is_dir:
        if resolved.suffix.lower() == ".pdf" or mime_type == "application/pdf":
            try:
                import pypdf
                reader = pypdf.PdfReader(str(resolved))
                extracted = []
                for p in reader.pages[:10]:
                    txt = p.extract_text()
                    if txt:
                        extracted.append(txt.strip())
                if extracted:
                    is_text = True
                    preview = f"[PDF: {len(reader.pages)} pages]\n" + "\n\n".join(extracted)[:4000]
            except Exception:
                pass

        if not preview:
            try:
                sample_bytes = resolved.read_bytes()[:8192]
                preview = sample_bytes.decode("utf-8")[:4000]
                is_text = True
            except Exception:
                is_text = False
    else:
        try:
            sub_items = [p.name for p in list(resolved.iterdir())[:15]]
            preview = f"Directory with {len(sub_items)} items: " + ", ".join(sub_items)
        except Exception:
            preview = "Directory"

    final_path = resolved
    if payload.copy_to_workspace and workspace_root and not is_dir:
        base_dir = Path(workspace_root).resolve()
        dest_dir = (base_dir / payload.destination_subpath).resolve()
        dest_dir.mkdir(parents=True, exist_ok=True)
        dest_file = dest_dir / resolved.name
        if dest_file.resolve() != resolved.resolve():
            import shutil
            shutil.copy2(resolved, dest_file)
            final_path = dest_file

    base_ref = Path(workspace_root).resolve() if workspace_root else Path.home().resolve()
    try:
        rel_path = os.path.relpath(final_path, base_ref).replace("\\", "/")
    except Exception:
        rel_path = str(final_path)

    return {
        "ok": True,
        "file": {
            "name": final_path.name,
            "path": str(final_path),
            "relative_path": rel_path,
            "size": stat.st_size if not is_dir else 0,
            "is_dir": is_dir,
            "mime_type": mime_type,
            "is_text": is_text,
            "preview": preview,
        },
    }


@router.websocket("/coder")
async def coder_websocket(websocket: WebSocket):
    await websocket.accept()
    session: CoderAgentSession | None = None
    logger.info("[CoderWS] Client connected")

    try:
        while True:
            text = await websocket.receive_text()
            try:
                data = json.loads(text)
            except json.JSONDecodeError:
                await websocket.send_json({"type": "error", "message": "Invalid JSON"})
                continue

            action = data.get("action")

            if action == "init":
                workspace_root = data.get("workspace_root")
                if workspace_root:
                    _touch_workspace_root(workspace_root)
                model_name = data.get("model", "gemini-3.8-flash")
                instructions = data.get("instructions", "")
                session = CoderAgentSession(
                    workspace_root=workspace_root,
                    model_name=model_name,
                    custom_instructions=instructions,
                )
                ACTIVE_SESSIONS[workspace_root] = session
                await websocket.send_json({
                    "type": "init_ok",
                    "workspace_root": workspace_root,
                    "model": model_name,
                })

            elif action == "prompt":
                prompt_text = data.get("prompt", "")
                workspace_root = data.get("workspace_root")
                if not session and workspace_root:
                    session = CoderAgentSession(workspace_root=workspace_root)
                    ACTIVE_SESSIONS[workspace_root] = session

                if not session:
                    await websocket.send_json({"type": "error", "message": "No active session initialized."})
                    continue

                async def emit(ev: dict[str, Any]):
                    try:
                        await websocket.send_json(ev)
                    except Exception as e:
                        logger.warning("Failed to emit coder event: %s", e)

                # Run task asynchronously
                asyncio.create_task(session.run_task(prompt_text, emit))

            elif action == "stop":
                if session:
                    session.stop()
                    await websocket.send_json({"type": "status", "status": "stopped", "message": "Execution stopped by user."})

    except WebSocketDisconnect:
        logger.info("[CoderWS] Client disconnected")
    except Exception as err:
        logger.exception("[CoderWS] Exception: %s", err)
