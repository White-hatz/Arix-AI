from __future__ import annotations

import difflib
import logging
import os
import re
import shlex
import subprocess
import threading
import time
from pathlib import Path
from typing import Any

logger = logging.getLogger("backend.tools.coder")

IGNORED_PATTERNS = {
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

# In-memory registry for background running processes (e.g. dev servers)
ACTIVE_PROCESSES: dict[str, dict[str, Any]] = {}
PORT_REGEX = re.compile(r"(?:https?://(?:localhost|127\.0\.0\.1|0\.0\.0\.0):(\d+))")


def resolve_safe_path(workspace_root: str | Path, target_path: str | Path) -> Path:
    root = Path(workspace_root).resolve()
    target = Path(target_path)
    if not target.is_absolute():
        target = (root / target).resolve()
    else:
        target = target.resolve()
    return target


def read_file(
    workspace_root: str,
    path: str,
    start_line: int | None = None,
    end_line: int | None = None,
) -> dict[str, Any]:
    try:
        resolved = resolve_safe_path(workspace_root, path)
        if not resolved.exists():
            return {"success": False, "error": f"File does not exist: {path}"}
        if not resolved.is_file():
            return {"success": False, "error": f"Path is not a regular file: {path}"}

        # Try utf-8 first, fallback to latin-1
        try:
            content = resolved.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            content = resolved.read_text(encoding="latin-1")

        lines = content.splitlines(keepends=True)
        total_lines = len(lines)

        s = 1 if start_line is None else max(1, start_line)
        e = total_lines if end_line is None else min(total_lines, max(s, end_line))

        # 1-indexed slice
        selected_lines = lines[s - 1 : e]
        annotated = [f"{idx}: {line}" for idx, line in enumerate(selected_lines, start=s)]

        return {
            "success": True,
            "path": str(resolved),
            "relative_path": os.path.relpath(resolved, workspace_root),
            "total_lines": total_lines,
            "start_line": s,
            "end_line": e,
            "content": "".join(selected_lines),
            "annotated_content": "".join(annotated),
        }
    except Exception as err:
        logger.exception("read_file failed: %s", err)
        return {"success": False, "error": str(err)}


def write_file(workspace_root: str, path: str, content: str) -> dict[str, Any]:
    try:
        resolved = resolve_safe_path(workspace_root, path)
        resolved.parent.mkdir(parents=True, exist_ok=True)
        resolved.write_text(content, encoding="utf-8")
        return {
            "success": True,
            "path": str(resolved),
            "relative_path": os.path.relpath(resolved, workspace_root),
            "bytes_written": len(content.encode("utf-8")),
            "lines_written": len(content.splitlines()),
        }
    except Exception as err:
        logger.exception("write_file failed: %s", err)
        return {"success": False, "error": str(err)}


def edit_file(
    workspace_root: str,
    path: str,
    edits: list[dict[str, Any]] | None = None,
    target_content: str | None = None,
    replacement_content: str | None = None,
    start_line: int | None = None,
    end_line: int | None = None,
) -> dict[str, Any]:
    """
    Applies batch line or string replacements with diff calculation.
    Accepts either an 'edits' list or top-level target_content/replacement_content.
    Each edit should have:
    - start_line (optional, 1-indexed)
    - end_line (optional, 1-indexed)
    - target_content (text to find)
    - replacement_content (text to replace with)
    """
    try:
        resolved = resolve_safe_path(workspace_root, path)
        if not resolved.exists():
            return {"success": False, "error": f"File does not exist: {path}"}

        edit_list = list(edits) if edits else []
        if not edit_list and target_content is not None:
            edit_list.append({
                "target_content": target_content,
                "replacement_content": replacement_content or "",
                "start_line": start_line,
                "end_line": end_line,
            })

        if not edit_list:
            return {"success": False, "error": "No edits or target_content provided for edit_file."}

        original_text = resolved.read_text(encoding="utf-8")
        current_text = original_text

        for edit in edit_list:
            target = edit.get("target_content", "")
            replacement = edit.get("replacement_content", "")
            if not target:
                continue

            if target in current_text:
                current_text = current_text.replace(target, replacement, 1)
            else:
                # Attempt normalized whitespace match
                lines = current_text.splitlines(keepends=True)
                s = edit.get("start_line")
                e = edit.get("end_line")
                if s is not None and e is not None and 1 <= s <= len(lines):
                    chunk = "".join(lines[s - 1 : e])
                    if chunk.strip() == target.strip():
                        new_lines = lines[: s - 1] + [replacement] + lines[e:]
                        current_text = "".join(new_lines)
                    else:
                        return {
                            "success": False,
                            "error": f"Target content not found in file: {target[:100]}...",
                        }
                else:
                    return {
                        "success": False,
                        "error": f"Target content not found in file: {target[:100]}...",
                    }

        resolved.write_text(current_text, encoding="utf-8")

        # Generate unified diff
        diff_lines = list(
            difflib.unified_diff(
                original_text.splitlines(),
                current_text.splitlines(),
                fromfile=f"a/{path}",
                tofile=f"b/{path}",
                lineterm="",
            )
        )
        diff_str = "\n".join(diff_lines)

        return {
            "success": True,
            "path": str(resolved),
            "relative_path": os.path.relpath(resolved, workspace_root),
            "diff": diff_str,
            "applied_edits_count": len(edit_list),
        }
    except Exception as err:
        logger.exception("edit_file failed: %s", err)
        return {"success": False, "error": str(err)}


def list_directory(workspace_root: str, path: str = ".", depth: int = 1) -> dict[str, Any]:
    try:
        resolved = resolve_safe_path(workspace_root, path)
        if not resolved.exists() or not resolved.is_dir():
            return {"success": False, "error": f"Directory does not exist: {path}"}

        items: list[dict[str, Any]] = []
        for entry in os.scandir(resolved):
            name = entry.name
            if name in IGNORED_PATTERNS or name.startswith("."):
                continue
            is_dir = entry.is_dir()
            size = 0
            if not is_dir:
                try:
                    size = entry.stat().st_size
                except OSError:
                    pass
            rel = os.path.relpath(entry.path, workspace_root)
            items.append({
                "name": name,
                "path": rel.replace("\\", "/"),
                "is_dir": is_dir,
                "size": size,
            })

        items.sort(key=lambda x: (not x["is_dir"], x["name"].lower()))
        return {
            "success": True,
            "directory": str(resolved),
            "relative_directory": os.path.relpath(resolved, workspace_root).replace("\\", "/"),
            "items": items,
        }
    except Exception as err:
        logger.exception("list_directory failed: %s", err)
        return {"success": False, "error": str(err)}


def search_in_files(
    workspace_root: str,
    query: str,
    path: str = ".",
    case_insensitive: bool = True,
    max_results: int = 50,
) -> dict[str, Any]:
    try:
        resolved = resolve_safe_path(workspace_root, path)
        if not resolved.exists():
            return {"success": False, "error": f"Path does not exist: {path}"}

        matches: list[dict[str, Any]] = []
        flags = re.IGNORECASE if case_insensitive else 0
        pattern = re.compile(re.escape(query), flags)

        for root, dirs, files in os.walk(resolved):
            dirs[:] = [d for d in dirs if d not in IGNORED_PATTERNS and not d.startswith(".")]
            for f in files:
                if f.startswith("."):
                    continue
                file_path = Path(root) / f
                # Skip known binary extensions
                if file_path.suffix.lower() in {
                    ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".exe", ".bin",
                    ".zip", ".tar", ".gz", ".pyc", ".pyd", ".woff", ".woff2", ".ttf",
                }:
                    continue

                try:
                    content = file_path.read_text(encoding="utf-8", errors="ignore")
                except Exception:
                    continue

                for line_idx, line in enumerate(content.splitlines(), start=1):
                    if pattern.search(line):
                        matches.append({
                            "path": os.path.relpath(file_path, workspace_root).replace("\\", "/"),
                            "line": line_idx,
                            "content": line.strip()[:200],
                        })
                        if len(matches) >= max_results:
                            break
                if len(matches) >= max_results:
                    break
            if len(matches) >= max_results:
                break

        return {"success": True, "query": query, "matches": matches, "count": len(matches)}
    except Exception as err:
        logger.exception("search_in_files failed: %s", err)
        return {"success": False, "error": str(err)}


def run_command(
    workspace_root: str,
    command: str,
    is_background: bool = False,
    mode: str = "foreground",
    timeout: int = 60,
) -> dict[str, Any]:
    resolved_cwd = Path(workspace_root).resolve()
    effective_background = is_background or str(mode).lower() in ("background", "watch")
    logger.info("[run_command] executing '%s' (background=%s, mode=%s) in %s", command, effective_background, mode, resolved_cwd)

    if not effective_background:
        try:
            # Run in powershell or cmd
            proc = subprocess.run(
                command,
                cwd=str(resolved_cwd),
                shell=True,
                capture_output=True,
                text=True,
                timeout=timeout,
                encoding="utf-8",
                errors="replace",
            )
            return {
                "success": proc.returncode == 0,
                "exit_code": proc.returncode,
                "stdout": proc.stdout,
                "stderr": proc.stderr,
                "command": command,
            }
        except subprocess.TimeoutExpired:
            return {
                "success": False,
                "error": f"Command timed out after {timeout} seconds.",
                "command": command,
            }
        except Exception as err:
            logger.exception("run_command error: %s", err)
            return {"success": False, "error": str(err), "command": command}

    # Background execution (e.g. dev server)
    try:
        proc_id = f"proc-{int(time.time() * 1000)}"
        proc = subprocess.Popen(
            command,
            cwd=str(resolved_cwd),
            shell=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1,
            encoding="utf-8",
            errors="replace",
        )

        proc_record: dict[str, Any] = {
            "id": proc_id,
            "pid": proc.pid,
            "command": command,
            "cwd": str(resolved_cwd),
            "start_time": int(time.time() * 1000),
            "status": "running",
            "detected_port": None,
            "logs": [],
            "_proc": proc,
        }
        ACTIVE_PROCESSES[proc_id] = proc_record

        # Background log reader thread
        def stream_logs(pipe, is_stderr: bool):
            try:
                for line in iter(pipe.readline, ""):
                    if not line:
                        break
                    line_clean = line.rstrip()
                    proc_record["logs"].append(line_clean)
                    if len(proc_record["logs"]) > 500:
                        proc_record["logs"].pop(0)

                    # Port detection
                    match = PORT_REGEX.search(line_clean)
                    if match and not proc_record["detected_port"]:
                        port = int(match.group(1))
                        proc_record["detected_port"] = port
                        logger.info("[Process %s] Detected listening port: %d", proc_id, port)
                pipe.close()
            except Exception as e:
                logger.debug("Pipe reader exception for %s: %s", proc_id, e)

        if proc.stdout:
            t_out = threading.Thread(target=stream_logs, args=(proc.stdout, False), daemon=True)
            t_out.start()
        if proc.stderr:
            t_err = threading.Thread(target=stream_logs, args=(proc.stderr, True), daemon=True)
            t_err.start()

        # Give 500ms to check if immediate failure or port detection
        time.sleep(0.5)
        poll = proc.poll()
        if poll is not None:
            proc_record["status"] = "exited"
            proc_record["exit_code"] = poll

        return {
            "success": True,
            "is_background": True,
            "process_id": proc_id,
            "pid": proc.pid,
            "command": command,
            "detected_port": proc_record["detected_port"],
            "status": proc_record["status"],
        }
    except Exception as err:
        logger.exception("Failed to launch background process: %s", err)
        return {"success": False, "error": str(err), "command": command}


def kill_process(proc_id_or_pid: str | int) -> dict[str, Any]:
    target_record: dict[str, Any] | None = None
    target_id = ""

    for pid_key, record in list(ACTIVE_PROCESSES.items()):
        if pid_key == str(proc_id_or_pid) or str(record.get("pid")) == str(proc_id_or_pid):
            target_record = record
            target_id = pid_key
            break

    if not target_record:
        # Try direct OS kill if numeric PID
        if str(proc_id_or_pid).isdigit():
            try:
                subprocess.run(f"taskkill /PID {proc_id_or_pid} /F /T", shell=True, capture_output=True)
                return {"success": True, "message": f"Killed OS PID {proc_id_or_pid}"}
            except Exception as e:
                return {"success": False, "error": str(e)}
        return {"success": False, "error": f"Process not found: {proc_id_or_pid}"}

    proc = target_record.get("_proc")
    pid = target_record.get("pid")
    try:
        if os.name == "nt" and pid:
            subprocess.run(f"taskkill /PID {pid} /F /T", shell=True, capture_output=True)
        elif proc:
            proc.terminate()
            proc.kill()
        target_record["status"] = "killed"
        ACTIVE_PROCESSES.pop(target_id, None)
        return {"success": True, "message": f"Terminated process {pid}"}
    except Exception as err:
        logger.exception("Failed to kill process %s: %s", target_id, err)
        return {"success": False, "error": str(err)}


def list_active_processes(workspace_root: str | None = None) -> list[dict[str, Any]]:
    results: list[dict[str, Any]] = []
    for pid_key, record in list(ACTIVE_PROCESSES.items()):
        proc = record.get("_proc")
        if proc and proc.poll() is not None:
            record["status"] = "exited"
            record["exit_code"] = proc.poll()

        if workspace_root:
            rec_cwd = record.get("cwd", "")
            if os.path.normpath(rec_cwd) != os.path.normpath(workspace_root):
                continue

        results.append({
            "id": record["id"],
            "pid": record["pid"],
            "command": record["command"],
            "cwd": record["cwd"],
            "startTime": record["start_time"],
            "status": record["status"],
            "detectedPort": record.get("detected_port"),
            "recentLogs": record.get("logs", [])[-20:],
        })
    return results
