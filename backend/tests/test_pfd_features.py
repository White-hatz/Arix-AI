import json
import os
import shutil
import tempfile
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from backend.app.main import app
from backend.app.services.session_reports import (
    get_latest_session_report,
    save_session_report,
)
from backend.app.tools import coder_tools

client = TestClient(app)


def test_settings_endpoints():
    # Test GET settings
    res = client.get("/api/settings")
    assert res.status_code == 200
    data = res.json()
    assert "directAssistantModel" in data
    assert "coderAgentModel" in data

    # Test POST settings
    patch = {"voice": "Fenrir", "extendedThinkingEnabled": True}
    res = client.post("/api/settings", json=patch)
    assert res.status_code == 200
    assert res.json()["settings"]["voice"] == "Fenrir"


def test_projects_endpoints():
    res = client.get("/api/projects")
    assert res.status_code == 200
    data = res.json()
    assert "projects" in data
    assert len(data["projects"]) >= 1

    # First project must be core system
    core = data["projects"][0]
    assert core["isCore"] is True
    assert "Arix AI" in core["name"]
    assert Path(core["path"]).exists()


def test_coder_tools_file_operations():
    with tempfile.TemporaryDirectory() as temp_dir:
        temp_path = Path(temp_dir)

        # 1. Write file
        write_res = coder_tools.write_file(temp_dir, "test.py", "line 1\nline 2\nline 3\n")
        assert write_res["success"] is True
        assert (temp_path / "test.py").exists()

        # 2. Read file (partial range)
        read_res = coder_tools.read_file(temp_dir, "test.py", start_line=2, end_line=3)
        assert read_res["success"] is True
        assert "line 2" in read_res["content"]
        assert "line 1" not in read_res["content"]

        # 3. Edit file with diff
        edit_res = coder_tools.edit_file(
            temp_dir,
            "test.py",
            [{"target_content": "line 2", "replacement_content": "line 2 modified"}],
        )
        assert edit_res["success"] is True
        assert "+line 2 modified" in edit_res["diff"]
        assert "-line 2" in edit_res["diff"]

        # 4. List directory
        list_res = coder_tools.list_directory(temp_dir, ".")
        assert list_res["success"] is True
        assert any(item["name"] == "test.py" for item in list_res["items"])

        # 5. Search in files
        search_res = coder_tools.search_in_files(temp_dir, "modified")
        assert search_res["success"] is True
        assert len(search_res["matches"]) == 1
        assert search_res["matches"][0]["line"] == 2


def test_session_continuity_reports():
    with tempfile.TemporaryDirectory() as temp_dir:
        report_data = {
            "summary": "Implemented phase 1 projects hub and settings rebuild.",
            "tasks_completed": ["Rebuilt settings", "Created projects hub"],
            "tasks_pending": ["Test browser integration"],
            "files_modified": ["src/App.tsx", "src/styles.css"],
            "active_servers": [],
        }

        save_res = save_session_report(temp_dir, report_data)
        assert save_res["success"] is True
        assert Path(save_res["json_path"]).exists()
        assert Path(save_res["md_path"]).exists()

        latest = get_latest_session_report(temp_dir)
        assert latest is not None
        assert latest["summary"] == report_data["summary"]
        assert len(latest["tasks_completed"]) == 2
