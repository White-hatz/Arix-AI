"""System detection for SWE-Kit, Docker, Git, and Composio packages."""

from __future__ import annotations

import importlib.metadata
import importlib.util
import json
import logging
import os
import shutil
import subprocess
from typing import Any

from backend.app.api.settings import load_backend_config

logger = logging.getLogger("backend.services.swe_kit.detector")


def check_docker() -> dict[str, Any]:
    """Inspects Docker availability and daemon status on the host machine."""
    docker_bin = shutil.which("docker")
    if not docker_bin:
        return {
            "installed": False,
            "running": False,
            "version": "",
            "message": (
                "Docker is not installed on this machine. Sandboxed engineering trials will use "
                "local trial isolation until Docker Desktop is installed."
            ),
            "install_url": "https://www.docker.com/products/docker-desktop/",
        }

    # Docker binary found; test if Docker daemon is running
    try:
        proc = subprocess.run(
            ["docker", "version", "--format", "{{.Server.Version}}"],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            timeout=3.5,
            shell=False,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        if proc.returncode == 0 and proc.stdout.strip():
            server_ver = proc.stdout.strip()
            return {
                "installed": True,
                "running": True,
                "version": server_ver,
                "message": f"Docker daemon is running (version {server_ver}).",
                "install_url": "https://www.docker.com/products/docker-desktop/",
            }
        else:
            return {
                "installed": True,
                "running": False,
                "version": "CLI Detected",
                "message": "Docker CLI is installed, but Docker Desktop daemon is not running.",
                "install_url": "https://www.docker.com/products/docker-desktop/",
            }
    except subprocess.TimeoutExpired:
        return {
            "installed": True,
            "running": False,
            "version": "Timeout",
            "message": "Docker daemon check timed out. Ensure Docker Desktop is started.",
            "install_url": "https://www.docker.com/products/docker-desktop/",
        }
    except Exception as err:
        return {
            "installed": True,
            "running": False,
            "version": "",
            "message": f"Docker status check error: {err}",
            "install_url": "https://www.docker.com/products/docker-desktop/",
        }


def check_git() -> dict[str, Any]:
    """Inspects Git CLI availability on host."""
    git_bin = shutil.which("git")
    if not git_bin:
        return {"installed": False, "version": "", "message": "Git CLI not found on PATH"}
    try:
        proc = subprocess.run(
            ["git", "--version"],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            timeout=3.0,
            shell=False,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        ver = proc.stdout.strip() if proc.returncode == 0 else ""
        return {"installed": True, "version": ver, "message": ver}
    except Exception as err:
        return {"installed": False, "version": "", "message": str(err)}


def check_swekit_packages() -> dict[str, Any]:
    """Checks if swekit and composio packages are installed in current Python environment."""
    swekit_spec = importlib.util.find_spec("swekit")
    composio_spec = importlib.util.find_spec("composio") or importlib.util.find_spec("composio_core")

    swekit_ver = ""
    composio_ver = ""

    if swekit_spec:
        try:
            swekit_ver = importlib.metadata.version("swekit")
        except Exception:
            swekit_ver = "installed"

    if composio_spec:
        try:
            composio_ver = importlib.metadata.version("composio")
        except Exception:
            try:
                composio_ver = importlib.metadata.version("composio-core")
            except Exception:
                composio_ver = "installed"

    installed = bool(swekit_spec and composio_spec)

    return {
        "installed": installed,
        "swekit": bool(swekit_spec),
        "composio": bool(composio_spec),
        "composio_core": bool(composio_spec),
        "swekit_version": swekit_ver,
        "composio_version": composio_ver,
        "composio_core_version": composio_ver,
        "status": "ready" if installed else "missing",
    }


def get_full_system_status() -> dict[str, Any]:
    """Aggregates all SWE-Kit and host dependencies status for the frontend."""
    config = load_backend_config()
    composio_key = config.get("composioApiKey") or os.getenv("COMPOSIO_API_KEY", "")
    github_token = config.get("githubToken") or os.getenv("GITHUB_TOKEN", "")
    github_username = config.get("githubUsername", "")
    pkg_status = check_swekit_packages()

    return {
        "docker": check_docker(),
        "git": check_git(),
        "packages": pkg_status,
        "composio": {
            "configured": bool(composio_key.strip()),
            "masked_key": f"{composio_key[:4]}...{composio_key[-4:]}" if len(composio_key) > 8 else ("Configured" if composio_key else ""),
        },
        "github": {
            "connected": bool(github_token.strip()),
            "username": github_username or ("Connected" if github_token else "Not connected"),
        },
        "ready": bool(pkg_status["installed"] and composio_key.strip()),
    }
