"""Programmatic installer for SWE-Kit and Composio packages into backend virtualenv."""

from __future__ import annotations

import asyncio
import logging
import os
import subprocess
import sys
from typing import Any

from backend.app.services.swe_kit.detector import check_swekit_packages

logger = logging.getLogger("backend.services.swe_kit.installer")

_INSTALL_STATE: dict[str, Any] = {
    "status": "idle",  # "idle" | "installing" | "completed" | "failed"
    "progress": 0,
    "current_step": "",
    "logs": [],
    "error": None,
}

_INSTALL_LOCK = asyncio.Lock()


def get_installation_status() -> dict[str, Any]:
    """Returns the current state of package installation and availability."""
    current = dict(_INSTALL_STATE)
    pkg_status = check_swekit_packages()
    current["packages_ready"] = pkg_status["installed"]
    return current


async def start_background_installation(force: bool = False) -> dict[str, Any]:
    """Starts async pip installation of swekit and composio if not already present."""
    async with _INSTALL_LOCK:
        if _INSTALL_STATE["status"] == "installing":
            return get_installation_status()

        pkg_status = check_swekit_packages()
        if pkg_status["installed"] and not force:
            _INSTALL_STATE["status"] = "completed"
            _INSTALL_STATE["progress"] = 100
            _INSTALL_STATE["current_step"] = "Engineering tools already installed."
            return get_installation_status()

        _INSTALL_STATE["status"] = "installing"
        _INSTALL_STATE["progress"] = 5
        _INSTALL_STATE["current_step"] = "Starting installation of SWE-Kit & Composio..."
        _INSTALL_STATE["logs"] = ["Initializing package installation in local environment..."]
        _INSTALL_STATE["error"] = None

        # Launch background task
        asyncio.create_task(_run_pip_install())
        return get_installation_status()


async def _run_pip_install() -> None:
    """Executes pip install in background process and captures progress logs."""
    python_exe = sys.executable
    cmd = [python_exe, "-m", "pip", "install", "swekit", "composio-core", "--no-input"]

    logger.info("[Installer] Starting command: %s", " ".join(cmd))
    _INSTALL_STATE["logs"].append(f"Running: {' '.join(cmd)}")
    _INSTALL_STATE["progress"] = 15
    _INSTALL_STATE["current_step"] = "Downloading SWE-Kit and Composio packages..."

    # Ensure telemetry is disabled during any install or post-install hooks
    env = os.environ.copy()
    env["COMPOSIO_DISABLE_TELEMETRY"] = "true"

    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env=env,
        )

        async def read_stream(stream: asyncio.StreamReader, is_err: bool = False):
            while True:
                line_bytes = await stream.readline()
                if not line_bytes:
                    break
                line = line_bytes.decode("utf-8", "replace").strip()
                if line:
                    _INSTALL_STATE["logs"].append(line)
                    # Limit log buffer to last 200 lines
                    if len(_INSTALL_STATE["logs"]) > 200:
                        _INSTALL_STATE["logs"].pop(0)

                    if "Downloading" in line or "Collecting" in line:
                        _INSTALL_STATE["progress"] = min(70, _INSTALL_STATE["progress"] + 3)
                        _INSTALL_STATE["current_step"] = line[:80]
                    elif "Installing collected packages" in line:
                        _INSTALL_STATE["progress"] = 85
                        _INSTALL_STATE["current_step"] = "Finalizing package installation..."

        await asyncio.gather(
            read_stream(proc.stdout),  # type: ignore
            read_stream(proc.stderr, is_err=True),  # type: ignore
        )

        return_code = await proc.wait()

        if return_code == 0:
            _INSTALL_STATE["status"] = "completed"
            _INSTALL_STATE["progress"] = 100
            _INSTALL_STATE["current_step"] = "SWE-Kit and Composio engineering tools successfully installed."
            _INSTALL_STATE["logs"].append("Installation successful.")
            logger.info("[Installer] Installation completed successfully.")
        else:
            _INSTALL_STATE["status"] = "failed"
            _INSTALL_STATE["error"] = f"Pip exited with error code {return_code}"
            _INSTALL_STATE["current_step"] = f"Installation failed (exit code {return_code})."
            _INSTALL_STATE["logs"].append(f"Installation failed with code {return_code}")
            logger.error("[Installer] Installation failed with code %d", return_code)

    except Exception as err:
        logger.exception("[Installer] Installation exception: %s", err)
        _INSTALL_STATE["status"] = "failed"
        _INSTALL_STATE["error"] = str(err)
        _INSTALL_STATE["current_step"] = f"Error during installation: {err}"
        _INSTALL_STATE["logs"].append(f"Exception: {err}")
