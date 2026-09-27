"""Tests for SWE-Kit integration: detector, runner, isolated trials, github service, and REST endpoints."""

from __future__ import annotations

import os
from pathlib import Path
import tempfile
import pytest
from fastapi.testclient import TestClient

from backend.app.main import app
from backend.app.services.swe_kit.detector import (
    check_docker,
    check_git,
    check_swekit_packages,
    get_full_system_status,
)
from backend.app.services.swe_kit.installer import get_installation_status
from backend.app.services.swe_kit.github_service import (
    verify_github_token,
    disconnect_github,
    run_git_operation,
)
from backend.app.services.swe_kit.agent_runner import (
    run_swe_command,
    apply_isolated_trial,
)


@pytest.fixture
def client():
    return TestClient(app)


def test_detector_functions():
    """Verify detector reports system status without throwing exceptions."""
    docker = check_docker()
    assert isinstance(docker, dict)
    assert "installed" in docker
    assert "running" in docker

    git_info = check_git()
    assert isinstance(git_info, dict)
    assert "installed" in git_info

    pkgs = check_swekit_packages()
    assert isinstance(pkgs, dict)
    assert "swekit" in pkgs
    assert "composio_core" in pkgs

    full = get_full_system_status()
    assert "docker" in full
    assert "git" in full
    assert "packages" in full
    assert "github" in full
    assert "composio" in full


def test_installer_initial_status():
    """Installer status should report valid dictionary."""
    st = get_installation_status()
    assert "status" in st
    assert "progress" in st
    assert "logs" in st


def test_github_service_validation():
    """Empty GitHub token returns invalid."""
    res = verify_github_token("")
    assert res["valid"] is False
    assert "empty" in res["error"].lower()

    # Disconnect should succeed
    disc = disconnect_github()
    assert disc["ok"] is True


def test_isolated_trial_execution_and_apply():
    """Verify isolated trial creates sandbox, computes unified diffs, and applies back cleanly."""
    import sys
    with tempfile.TemporaryDirectory() as temp_dir:
        root = Path(temp_dir)
        test_file = root / "sample.py"
        test_file.write_text("print('hello world')\n", encoding="utf-8")

        # Run command in isolated_trial mode modifying sample.py in sandbox
        py_exe = sys.executable
        cmd = f'"{py_exe}" -c "open(\'sample.py\', \'w\').write(\'hello from trial\\n\')"'
        result = run_swe_command(
            workspace_root=str(root),
            command=cmd,
            mode="isolated_trial",
            timeout=30,
        )

        assert result["mode"] == "isolated_trial"
        trial_id = result["trial_id"]
        assert trial_id != ""
        assert "sample.py" in result["modified_files"]
        assert result["status"] == "pending_review"
        assert result["additions"] > 0
        assert "hello from trial" in result["diff"]

        # Verify live file is UNCHANGED before applying
        assert test_file.read_text(encoding="utf-8") == "print('hello world')\n"

        # Apply trial
        apply_res = apply_isolated_trial(str(root), trial_id)
        assert apply_res["success"] is True
        assert "sample.py" in apply_res["applied_files"]

        # Verify live file is now UPDATED
        assert test_file.read_text(encoding="utf-8") == "hello from trial\n"


def test_swe_kit_rest_endpoints(client):
    """Test FastAPI REST routes for SWE-Kit."""
    res = client.get("/api/swe-kit/status")
    assert res.status_code == 200
    data = res.json()
    assert "docker" in data
    assert "ready" in data

    res_install = client.get("/api/swe-kit/install-status")
    assert res_install.status_code == 200
    data_install = res_install.json()
    assert "status" in data_install
