from __future__ import annotations

import importlib
import platform
import subprocess
from collections.abc import Sequence
from pathlib import Path
from types import ModuleType
from typing import Any

import os
import json

MAX_COMMAND_TIMEOUT_SECONDS = 120.0
MAX_TEXT_BYTES = 1_000_000

# Session-level dynamically granted paths and drives (e.g. "e:\", "e:\coding world\...")
_SESSION_GRANTED_PATHS: set[str] = set()


def grant_session_path(path_str: str) -> None:
    norm = os.path.normpath(str(path_str)).casefold()
    _SESSION_GRANTED_PATHS.add(norm)
    try:
        drive = Path(path_str).drive
        if drive:
            _SESSION_GRANTED_PATHS.add(os.path.normpath(drive + "\\").casefold())
            _SESSION_GRANTED_PATHS.add(os.path.normpath(drive).casefold())
    except Exception:
        pass


def revoke_session_path(path_str: str) -> None:
    norm = os.path.normpath(str(path_str)).casefold()
    _SESSION_GRANTED_PATHS.discard(norm)
    try:
        drive = Path(path_str).drive
        if drive:
            _SESSION_GRANTED_PATHS.discard(os.path.normpath(drive + "\\").casefold())
            _SESSION_GRANTED_PATHS.discard(os.path.normpath(drive).casefold())
    except Exception:
        pass


def get_session_granted_paths() -> list[str]:
    return sorted(_SESSION_GRANTED_PATHS)


class ConfirmationRequired(ValueError):
    """Raised when a consequential action has not been explicitly confirmed."""
    def __init__(self, message: str, boundary_type: str = "consequential_action", target: str = ""):
        self.boundary_type = boundary_type
        self.target = target
        self.status = "permission_required"
        self.requires_permission = True
        super().__init__(message)


class PermissionRequiredError(PermissionError):
    """Raised when an operation touches a drive/path/resource outside standard roots requiring user approval."""
    def __init__(self, target: str, boundary_type: str = "path", message: str = ""):
        self.target = target
        self.path = target
        self.boundary_type = boundary_type
        self.status = "permission_required"
        self.requires_permission = True
        default_msg = (
            f"Permission required: Access to '{target}' is outside your standard project roots. "
            f"Please ask the user: 'I need your permission to access {target} — do you want to allow this?' "
            "Once the user approves orally or in chat, re-invoke the tool with confirmed=True."
        )
        super().__init__(message or default_msg)


def require_confirmation(action: str, confirmed: bool) -> None:
    if not confirmed:
        label = " ".join(action.split())[:160] or "perform this action"
        raise ConfirmationRequired(
            f"Confirmation required to {label}. Ask the user, then call again with confirmed=true."
        )


def require_platform(*allowed: str) -> str:
    current = platform.system()
    if current not in allowed:
        supported = ", ".join(allowed)
        raise RuntimeError(f"This action requires one of these platforms: {supported}; current platform: {current}")
    return current


import shutil
import string

def get_well_known_system_paths() -> dict[str, Path]:
    """Return dictionary of important verified system and user directory paths."""
    home = Path.home().resolve()
    paths: dict[str, Path] = {
        "home": home,
        "user": home,
        "userprofile": home,
    }

    # 1. Read Windows User Shell Folders registry if on Windows
    if platform.system() == "Windows":
        try:
            import winreg
            with winreg.OpenKey(
                winreg.HKEY_CURRENT_USER,
                r"Software\Microsoft\Windows\CurrentVersion\Explorer\User Shell Folders",
            ) as key:
                val_count = winreg.QueryInfoKey(key)[1]
                for i in range(val_count):
                    k_name, k_val, _ = winreg.EnumValue(key, i)
                    expanded_val = os.path.expandvars(str(k_val))
                    p = Path(expanded_val).resolve()
                    if p.exists():
                        if k_name in (
                            "{374DE290-123F-4565-9164-39C4925E467B}",
                            "{7D83EE9B-2244-4E70-B1F5-5393042AF1E4}",
                        ):
                            paths["downloads"] = p
                            paths["download"] = p
                        elif k_name == "Desktop":
                            paths["desktop"] = p
                            paths["desk"] = p
                        elif k_name in ("Personal", "{F42EE2D3-909F-4907-8871-4C22FC0BF756}"):
                            paths["documents"] = p
                            paths["doc"] = p
                            paths["docs"] = p
                            paths["my documents"] = p
                        elif k_name in ("My Pictures", "{0DDD015D-B06C-45D5-8C4C-F59713854639}"):
                            paths["pictures"] = p
                        elif k_name == "My Music":
                            paths["music"] = p
                        elif k_name == "My Video":
                            paths["videos"] = p
        except Exception:
            pass

    # 2. Check standard user profile subfolders if not already set or as fallbacks
    for name in ("Desktop", "Downloads", "Documents", "Pictures", "Music", "Videos", "AppData"):
        folder = home / name
        if folder.exists():
            key = name.lower()
            if key not in paths:
                paths[key] = folder.resolve()
            if name == "Downloads":
                paths["c_downloads"] = folder.resolve()
                if "downloads" not in paths:
                    paths["downloads"] = folder.resolve()
                    paths["download"] = folder.resolve()
            elif name == "Documents" and "documents" not in paths:
                paths["documents"] = folder.resolve()
            elif name == "Desktop" and "desktop" not in paths:
                paths["desktop"] = folder.resolve()

    # 3. Check for dedicated download/media folders on all system drives (e.g. D:\Downloads, D:\PDFs)
    for letter in ("D", "E", "F", "G"):
        d_dl = Path(f"{letter}:/Downloads")
        if d_dl.exists():
            paths[f"{letter.lower()}_downloads"] = d_dl.resolve()
            if letter == "D":
                paths["d_downloads"] = d_dl.resolve()
                paths["downloads"] = d_dl.resolve()
                paths["download"] = d_dl.resolve()

    # 4. Check for known subfolders like NIMS Assignment
    for dl_root in (paths.get("d_downloads"), paths.get("downloads"), paths.get("c_downloads")):
        if dl_root and (dl_root / "NIMS Assignment").exists():
            paths["nims assignment"] = (dl_root / "NIMS Assignment").resolve()
            paths["nims"] = (dl_root / "NIMS Assignment").resolve()
            break

    return paths


def get_system_drives() -> list[dict[str, Any]]:
    """Return list of all active local storage drives with capacity details."""
    drives: list[dict[str, Any]] = []
    if platform.system() == "Windows":
        for letter in string.ascii_uppercase:
            drive_root = Path(f"{letter}:\\")
            if drive_root.exists():
                stat_info: dict[str, Any] = {"letter": letter, "path": str(drive_root), "exists": True}
                try:
                    usage = shutil.disk_usage(str(drive_root))
                    stat_info["total_gb"] = round(usage.total / (1024**3), 2)
                    stat_info["used_gb"] = round(usage.used / (1024**3), 2)
                    stat_info["free_gb"] = round(usage.free / (1024**3), 2)
                except Exception:
                    pass
                drives.append(stat_info)
    else:
        drives.append({"letter": "/", "path": "/", "exists": True})
    return drives


def _default_roots() -> tuple[Path, ...]:
    home = Path.home().resolve()
    candidates = [home]
    for name in ("Desktop", "Documents", "Downloads", "Pictures", "Music", "Videos", "AppData"):
        child = home / name
        if child.exists():
            candidates.append(child.resolve())

    # Add all available drive roots on Windows
    if platform.system() == "Windows":
        for d in get_system_drives():
            d_path = Path(d["path"]).resolve()
            if d_path.exists():
                candidates.append(d_path)

    # Add active workspace directory from reported app state if set
    try:
        from backend.app.tools.in_app_control_tools import _APP_STATE
        active_proj = _APP_STATE.get("active_project")
        if active_proj:
            p = Path(active_proj).expanduser().resolve()
            if p.exists():
                candidates.append(p)
    except Exception:
        pass

    # Add current working directory
    try:
        cwd = Path.cwd().resolve()
        if cwd.exists():
            candidates.append(cwd)
    except Exception:
        pass

    # Add Arix AI core project root
    try:
        from backend.app.tools.environment_tools import get_core_project_path
        core_p = get_core_project_path().resolve()
        if core_p.exists():
            candidates.append(core_p)
    except Exception:
        pass

    # Add registered projects from Projects Hub
    try:
        from backend.app.api.projects import load_user_projects
        for proj in load_user_projects():
            p_str = proj.get("path")
            if p_str:
                p = Path(p_str).expanduser().resolve()
                if p.exists():
                    candidates.append(p)
    except Exception:
        pass

    # Add configured workspace directories and persistent granted permissions from config.json
    try:
        from backend.app.core.config import settings
        cfg_file = settings.data_directory / "config.json"
        if cfg_file.exists():
            cfg = json.loads(cfg_file.read_text(encoding="utf-8"))
            for d in cfg.get("allowedWorkspaceDirectories", []):
                p = Path(d).expanduser().resolve()
                if p.exists():
                    candidates.append(p)
            for g in cfg.get("grantedPermissions", []):
                if g.get("category") == "file_operations" or g.get("type") in ("path", "drive"):
                    t = g.get("target")
                    if t:
                        p = Path(t).expanduser().resolve()
                        if p.exists():
                            candidates.append(p)
    except Exception:
        pass

    # Add session-granted paths
    for s_path in _SESSION_GRANTED_PATHS:
        try:
            p = Path(s_path).resolve()
            if p.exists():
                candidates.append(p)
        except Exception:
            pass

    return tuple(dict.fromkeys(candidates))


def resolve_user_path(
    raw: str,
    *,
    must_exist: bool = False,
    allowed_roots: Sequence[Path] | None = None,
    confirmed: bool = False,
) -> Path:
    value = raw.strip()
    if not value or "\x00" in value:
        raise ValueError("A valid path is required")

    # Expand environment variables (e.g. %USERPROFILE%, %APPDATA%) and user home (~)
    value = os.path.expandvars(value)
    home = Path.home().resolve()
    candidate = Path(value).expanduser()

    # Intelligent fallback for well-known aliases like "Downloads", "Desktop", "Documents"
    well_known = get_well_known_system_paths()
    norm_slash = value.replace("\\", "/").strip().strip("/")
    first_part = norm_slash.split("/")[0].lower() if norm_slash else ""
    rest_part = "/".join(norm_slash.split("/")[1:]) if "/" in norm_slash else ""

    if not candidate.is_absolute():
        if allowed_roots:
            base_dir = Path(allowed_roots[0]).expanduser().resolve()
        else:
            base_dir = home
            try:
                from backend.app.tools.in_app_control_tools import _APP_STATE
                active_proj = _APP_STATE.get("active_project")
                if active_proj and Path(active_proj).expanduser().resolve().exists():
                    base_dir = Path(active_proj).expanduser().resolve()
                elif Path.cwd().resolve().exists():
                    base_dir = Path.cwd().resolve()
            except Exception:
                pass

        # Check if first_part is a known alias and if base_dir / candidate does not exist
        if first_part in well_known and not (base_dir / candidate).exists():
            alias_root = well_known[first_part]
            if first_part in ("downloads", "download") and rest_part:
                d_dl = well_known.get("d_downloads")
                c_dl = well_known.get("c_downloads")
                if d_dl and (d_dl / rest_part).exists():
                    alias_root = d_dl
                elif c_dl and (c_dl / rest_part).exists():
                    alias_root = c_dl
            candidate = (alias_root / rest_part).resolve(strict=False) if rest_part else alias_root
        elif first_part.startswith("nims") and "nims assignment" in well_known:
            candidate = well_known["nims assignment"]
        else:
            candidate = base_dir / candidate
    elif first_part in well_known:
        # Check if it was something like /downloads or \downloads
        alias_root = well_known[first_part]
        if first_part in ("downloads", "download") and rest_part:
            d_dl = well_known.get("d_downloads")
            c_dl = well_known.get("c_downloads")
            if d_dl and (d_dl / rest_part).exists():
                alias_root = d_dl
            elif c_dl and (c_dl / rest_part).exists():
                alias_root = c_dl
        if not candidate.exists() and alias_root.exists():
            candidate = (alias_root / rest_part).resolve(strict=False) if rest_part else alias_root
    elif first_part.startswith("nims") and "nims assignment" in well_known:
        candidate = well_known["nims assignment"]

    resolved = candidate.resolve(strict=False)

    # Check if category policy is always_allow in config.json (only when allowed_roots is not explicitly constrained)
    if allowed_roots is None:
        try:
            from backend.app.core.config import settings
            cfg_file = settings.data_directory / "config.json"
            if cfg_file.exists():
                cfg = json.loads(cfg_file.read_text(encoding="utf-8"))
                pol = cfg.get("permissionPolicies", {}).get("fileOperations") or cfg.get("fileOperationsPolicy")
                if pol == "always_allow":
                    if must_exist and not resolved.exists():
                        raise FileNotFoundError(f"Path does not exist: {resolved}")
                    return resolved
        except Exception:
            pass

    roots = tuple(Path(root).expanduser().resolve() for root in (allowed_roots or _default_roots()))
    norm_resolved = os.path.normpath(str(resolved)).casefold()

    is_allowed = any(resolved == root or resolved.is_relative_to(root) for root in roots)
    if not is_allowed:
        for granted in _SESSION_GRANTED_PATHS:
            if norm_resolved == granted or norm_resolved.startswith(granted.rstrip("\\/") + "\\") or norm_resolved.startswith(granted.rstrip("\\/") + "/"):
                is_allowed = True
                break

    if not is_allowed:
        # If user explicitly confirmed (oral or in-chat approval)
        if confirmed:
            grant_session_path(str(resolved))
            is_allowed = True
        else:
            # Raise dynamic permission request error instead of static rejection
            raise PermissionRequiredError(
                target=str(resolved),
                boundary_type="path",
                message=(
                    f"Permission required: Access to '{resolved}' is outside your approved workspace and user folders. "
                    f"Please ask the user: 'I need your permission to access {resolved} — do you want to allow this?' "
                    "Once approved, re-invoke with confirmed=True."
                ),
            )

    if must_exist and not resolved.exists():
        raise FileNotFoundError(f"Path does not exist: {resolved}")
    return resolved


def run_command(
    command: Sequence[str],
    *,
    timeout: float = 10.0,
    check: bool = True,
) -> subprocess.CompletedProcess[str]:
    args = [str(part) for part in command]
    if not args or not args[0].strip():
        raise ValueError("A non-empty command is required")
    bounded_timeout = max(0.1, min(float(timeout), MAX_COMMAND_TIMEOUT_SECONDS))
    try:
        return subprocess.run(
            args,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=bounded_timeout,
            check=check,
            shell=False,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
    except subprocess.TimeoutExpired as error:
        raise RuntimeError(f"Command timed out after {bounded_timeout:g} seconds") from error
    except subprocess.CalledProcessError as error:
        detail = (error.stderr or error.stdout or "Command failed").strip()[:500]
        raise RuntimeError(detail) from error


def require_optional_dependency(module_name: str, install_hint: str = "") -> ModuleType:
    try:
        return importlib.import_module(module_name)
    except ImportError as error:
        hint = f" Install it with: {install_hint}" if install_hint else ""
        raise RuntimeError(f"Optional dependency '{module_name}' is required.{hint}") from error


def bounded_text(value: Any, *, limit: int, field: str) -> str:
    text = str(value or "").strip()
    if not text:
        raise ValueError(f"{field} is required")
    if len(text) > limit:
        raise ValueError(f"{field} must be at most {limit} characters")
    return text


def bounded_number(value: Any, *, minimum: float, maximum: float, field: str) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError) as error:
        raise ValueError(f"{field} must be a number") from error
    if number < minimum or number > maximum:
        raise ValueError(f"{field} must be between {minimum:g} and {maximum:g}")
    return number
