"""SWE-Kit Agent Runner: handles live volume-mounted execution and isolated trial sandboxes."""

from __future__ import annotations

import difflib
import json
import logging
import os
from pathlib import Path
import shutil
import subprocess
import time
from typing import Any, Callable, Coroutine

from backend.app.services.session_reports import save_session_report
from backend.app.services.swe_kit.detector import check_docker

logger = logging.getLogger("backend.services.swe_kit.runner")

TRIALS_DIR_NAME = ".arix/trials"


def _get_trial_dir(workspace_root: str, trial_id: str) -> Path:
    return Path(workspace_root) / TRIALS_DIR_NAME / trial_id


def _compute_workspace_diff(original_root: Path, sandbox_root: Path) -> tuple[str, list[str]]:
    """Computes unified diff and list of modified files between original and sandbox."""
    diff_lines: list[str] = []
    modified_files: list[str] = []

    # Walk through sandbox files
    for root, dirs, files in os.walk(sandbox_root):
        dirs[:] = [d for d in dirs if d not in (".git", "node_modules", ".venv", ".arix", "__pycache__")]
        for f in files:
            sandbox_file = Path(root) / f
            rel_path = sandbox_file.relative_to(sandbox_root)
            original_file = original_root / rel_path

            orig_content = original_file.read_text(encoding="utf-8", errors="replace") if original_file.exists() else ""
            sand_content = sandbox_file.read_text(encoding="utf-8", errors="replace")

            if orig_content != sand_content:
                modified_files.append(str(rel_path).replace("\\", "/"))
                diff = difflib.unified_diff(
                    orig_content.splitlines(keepends=True),
                    sand_content.splitlines(keepends=True),
                    fromfile=f"a/{rel_path}",
                    tofile=f"b/{rel_path}",
                )
                diff_lines.extend(diff)

    return "".join(diff_lines), modified_files


def run_swe_command(
    workspace_root: str,
    command: str,
    mode: str = "live",
    timeout: int = 120,
    terminal_label: str = "",
) -> dict[str, Any]:
    """Executes a command either in live mode (direct project) or isolated trial sandbox."""
    docker_status = check_docker()
    is_docker_available = docker_status["running"]

    # Sanitize label for Terminals tab
    term_label = terminal_label or ("Sandbox: live" if mode == "live" else "Sandbox: isolated_trial")

    # Record into USER_TERMINAL_SESSIONS so it surfaces in Right Panel Terminals tab
    from backend.app.api.workspace import USER_TERMINAL_SESSIONS
    term_id = f"sandbox-{int(time.time() * 1000)}"
    terminal_record = {
        "id": term_id,
        "name": term_label,
        "workspace_root": workspace_root,
        "history": [f"[{term_label}] Initializing run (mode={mode}, docker={is_docker_available})..."],
        "created_at": time.time(),
        "is_user": False,
        "is_sandbox": True,
    }
    USER_TERMINAL_SESSIONS[term_id] = terminal_record

    target_dir = Path(workspace_root)
    trial_id = ""

    if mode == "isolated_trial":
        trial_id = f"trial-{int(time.time())}"
        sandbox_path = _get_trial_dir(workspace_root, trial_id)
        sandbox_path.mkdir(parents=True, exist_ok=True)
        terminal_record["history"].append(f"Creating isolated sandbox snapshot at: {sandbox_path}")

        # Copy workspace files excluding heavy/internal directories
        ignore_patterns = shutil.ignore_patterns(".git", "node_modules", ".venv", ".arix", "__pycache__", "dist", "build")
        for item in target_dir.iterdir():
            if item.name in (".git", "node_modules", ".venv", ".arix"):
                continue
            dest = sandbox_path / item.name
            if item.is_dir():
                shutil.copytree(item, dest, ignore=ignore_patterns, dirs_exist_ok=True)
            else:
                shutil.copy2(item, dest)

        target_dir = sandbox_path

    # Build and execute command (Docker volume mounted if Docker is running, else host execution)
    docker_used = False

    try:
        if is_docker_available:
            docker_used = True
            mount_flag = f"{target_dir.resolve()}:/workspace"
            shell_cmd = [
                "docker", "run", "--rm",
                "-v", mount_flag,
                "-w", "/workspace",
                "python:3.11-slim",
                "sh", "-c", command,
            ]
            terminal_record["history"].append(f"Docker sandbox started: {' '.join(shell_cmd[:6])} ...")
            proc = subprocess.run(
                shell_cmd,
                cwd=str(target_dir),
                capture_output=True,
                text=True,
                timeout=timeout,
                encoding="utf-8",
                errors="replace",
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
            )
        else:
            terminal_record["history"].append(f"Host sandbox command: {command}")
            proc = subprocess.run(
                command,
                cwd=str(target_dir),
                shell=True,
                capture_output=True,
                text=True,
                timeout=timeout,
                encoding="utf-8",
                errors="replace",
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
            )
        stdout = proc.stdout or ""
        stderr = proc.stderr or ""
        exit_code = proc.returncode

        for line in stdout.splitlines():
            terminal_record["history"].append(line)
        if stderr:
            for line in stderr.splitlines():
                terminal_record["history"].append(f"[stderr] {line}")

    except subprocess.TimeoutExpired:
        terminal_record["history"].append(f"Command timed out after {timeout} seconds.")
        return {
            "success": False,
            "mode": mode,
            "error": f"Execution timed out after {timeout}s",
            "terminal_id": term_id,
        }
    except Exception as err:
        terminal_record["history"].append(f"Execution error: {err}")
        return {
            "success": False,
            "mode": mode,
            "error": str(err),
            "terminal_id": term_id,
        }

    # If in isolated_trial mode, compute diffs and store metadata
    if mode == "isolated_trial":
        diff_text, modified_files = _compute_workspace_diff(Path(workspace_root), target_dir)

        # Count diff additions and deletions
        adds = sum(1 for line in diff_text.splitlines() if line.startswith("+") and not line.startswith("+++"))
        dels = sum(1 for line in diff_text.splitlines() if line.startswith("-") and not line.startswith("---"))

        trial_meta = {
            "trial_id": trial_id,
            "command": command,
            "exit_code": exit_code,
            "status": "pending_review",
            "created_at": time.time(),
            "modified_files": modified_files,
            "additions": adds,
            "deletions": dels,
            "diff": diff_text,
            "logs": terminal_record["history"][-50:],
        }
        (target_dir / "trial_meta.json").write_text(json.dumps(trial_meta, indent=2), encoding="utf-8")

        # Save event to session report
        save_session_report(workspace_root, {
            "type": "swe_kit_trial",
            "trial_id": trial_id,
            "command": command,
            "modified_files": modified_files,
            "additions": adds,
            "deletions": dels,
        })

        return {
            "success": exit_code == 0,
            "mode": "isolated_trial",
            "trial_id": trial_id,
            "status": "pending_review",
            "docker_used": docker_used,
            "exit_code": exit_code,
            "modified_files": modified_files,
            "additions": adds,
            "deletions": dels,
            "diff": diff_text,
            "terminal_id": term_id,
            "message": (
                f"Isolated trial run completed ({'+' if adds else ''}{adds}/-{dels} across {len(modified_files)} files). "
                "Changes have NOT been applied to real project files. Click 'Apply to project' to merge."
            ),
        }

    # Live mode: changes are directly on project files
    save_session_report(workspace_root, {
        "type": "swe_kit_live_run",
        "command": command,
        "exit_code": exit_code,
    })

    return {
        "success": exit_code == 0,
        "mode": "live",
        "docker_used": docker_used,
        "exit_code": exit_code,
        "stdout": stdout[:4000],
        "stderr": stderr[:4000],
        "terminal_id": term_id,
        "message": "Executed directly on workspace files in live mode.",
    }


def apply_isolated_trial(workspace_root: str, trial_id: str) -> dict[str, Any]:
    """Applies the changes from an isolated trial back into the live project workspace."""
    trial_dir = _get_trial_dir(workspace_root, trial_id)
    meta_file = trial_dir / "trial_meta.json"

    if not meta_file.exists():
        return {"success": False, "error": f"Trial record {trial_id} not found at {meta_file}"}

    try:
        meta = json.loads(meta_file.read_text(encoding="utf-8"))
    except Exception as err:
        return {"success": False, "error": f"Failed to read trial metadata: {err}"}

    applied_files: list[str] = []
    dest_root = Path(workspace_root)

    for rel_path in meta.get("modified_files", []):
        src_file = trial_dir / rel_path
        target_file = dest_root / rel_path
        if src_file.exists():
            target_file.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src_file, target_file)
            applied_files.append(rel_path)

    meta["status"] = "applied"
    meta["applied_at"] = time.time()
    meta_file.write_text(json.dumps(meta, indent=2), encoding="utf-8")

    save_session_report(workspace_root, {
        "type": "swe_kit_trial_applied",
        "trial_id": trial_id,
        "applied_files": applied_files,
    })

    return {
        "success": True,
        "trial_id": trial_id,
        "status": "applied",
        "applied_files": applied_files,
        "message": f"Successfully applied changes from {trial_id} ({len(applied_files)} files merged into project).",
    }
