from __future__ import annotations

import importlib
import platform
import subprocess
from collections.abc import Sequence
from pathlib import Path
from types import ModuleType
from typing import Any

MAX_COMMAND_TIMEOUT_SECONDS = 120.0
MAX_TEXT_BYTES = 1_000_000


class ConfirmationRequired(ValueError):
    """Raised when a consequential action has not been explicitly confirmed."""


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


def _default_roots() -> tuple[Path, ...]:
    home = Path.home().resolve()
    candidates = [home]
    for name in ("Desktop", "Documents", "Downloads", "Pictures", "Music", "Videos"):
        child = home / name
        if child.exists():
            candidates.append(child.resolve())

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

    # Add configured workspace directories if any
    try:
        from backend.app.core.config import settings
        cfg_file = settings.data_directory / "config.json"
        if cfg_file.exists():
            import json
            cfg = json.loads(cfg_file.read_text(encoding="utf-8"))
            for d in cfg.get("allowedWorkspaceDirectories", []):
                p = Path(d).expanduser().resolve()
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
) -> Path:
    value = raw.strip()
    if not value or "\x00" in value:
        raise ValueError("A valid path is required")

    home = Path.home().resolve()
    candidate = Path(value).expanduser()

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
        candidate = base_dir / candidate

    resolved = candidate.resolve(strict=False)
    roots = tuple(Path(root).expanduser().resolve() for root in (allowed_roots or _default_roots()))
    if not any(resolved == root or resolved.is_relative_to(root) for root in roots):
        raise PermissionError("Path is outside the approved user-profile roots")

    if must_exist and not resolved.exists():
        raise FileNotFoundError(f"Path does not exist: {resolved}")
    if resolved.exists():
        real = resolved.resolve(strict=True)
        if not any(real == root or real.is_relative_to(root) for root in roots):
            raise PermissionError("Resolved path escapes the approved user-profile roots")
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
