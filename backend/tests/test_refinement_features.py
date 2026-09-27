import os
import tempfile
from pathlib import Path
import pytest
from fastapi.testclient import TestClient

from backend.app.main import app
from backend.app.tools import in_app_control_tools
from backend.app.api.projects import scan_project_stats_sync, STATS_CACHE_FILE

client = TestClient(app)


def test_project_stats_caching():
    with tempfile.TemporaryDirectory() as temp_dir:
        temp_path = Path(temp_dir)
        (temp_path / "sub").mkdir()
        (temp_path / "sub" / "a.txt").write_text("hello world")
        (temp_path / "b.txt").write_text("arix")

        # 1. Compute stats directly
        stats1 = scan_project_stats_sync(temp_path)
        assert stats1["fileCount"] == 2
        assert stats1["folderCount"] == 1
        assert stats1["sizeBytes"] > 0

        # 2. Test via endpoint
        res = client.post("/api/projects/stats", json={"path": temp_dir, "refresh": False})
        assert res.status_code == 200
        assert res.json()["stats"]["fileCount"] == 2

        # 3. Add a file and test refresh
        (temp_path / "sub" / "c.txt").write_text("another file")
        res_refresh = client.post("/api/projects/stats", json={"path": temp_dir, "refresh": True})
        assert res_refresh.status_code == 200
        assert res_refresh.json()["stats"]["fileCount"] == 3

        # 4. Refresh all endpoint
        res_all = client.post("/api/projects/stats/refresh-all")
        assert res_all.status_code == 200
        assert res_all.json()["ok"] is True


def test_terminal_api_endpoints():
    with tempfile.TemporaryDirectory() as temp_dir:
        # Create terminal
        res = client.post("/api/workspace/terminal/create", json={"workspace_root": temp_dir, "name": "PowerShell Test"})
        assert res.status_code == 200
        term_data = res.json()["terminal"]
        term_id = term_data["id"]
        assert term_data["name"] == "PowerShell Test"
        assert term_data["is_user"] is True

        # List terminals
        res_list = client.get(f"/api/workspace/terminal/list?workspace_root={temp_dir}")
        assert res_list.status_code == 200
        terminals = res_list.json()["terminals"]
        assert any(t["id"] == term_id for t in terminals)

        # Exec command in terminal
        res_exec = client.post("/api/workspace/terminal/exec", json={"terminal_id": term_id, "workspace_root": temp_dir, "command": "Write-Output 'Hello Arix'"})
        assert res_exec.status_code == 200
        history = res_exec.json()["history"]
        assert any("Hello Arix" in line for line in history)

        # Delete terminal
        res_del = client.delete(f"/api/workspace/terminal/{term_id}")
        assert res_del.status_code == 200
        assert res_del.json()["ok"] is True


@pytest.mark.asyncio
async def test_in_app_control_tools():
    # Test tool declarations
    declarations = in_app_control_tools.IN_APP_CONTROL_TOOL_DECLARATIONS
    tool_names = [d["name"] for d in declarations]
    assert "navigate_app" in tool_names
    assert "scroll_app" in tool_names
    assert "click_app" in tool_names
    assert "type_app" in tool_names
    assert "drag_drop_app" in tool_names
    assert "highlight_app" in tool_names
    assert "move_cursor_app" in tool_names
    assert "view_app_screen" in tool_names

    # Test tool execution with mock emitter
    events_received = []

    async def mock_emitter(ev: dict):
        events_received.append(ev)

    in_app_control_tools.set_app_control_emitter(mock_emitter)

    # 1. navigate_app
    nav_res = await in_app_control_tools.execute_in_app_control_action("navigate_app", {"route": "settings"})
    assert nav_res["ok"] is True
    assert events_received[-1]["action"] == "navigate_app"
    assert events_received[-1]["args"]["route"] == "settings"

    # 2. highlight_app
    hl_res = await in_app_control_tools.execute_in_app_control_action("highlight_app", {"selector": "#save-button", "note": "Click here to save"})
    assert hl_res["ok"] is True
    assert events_received[-1]["action"] == "highlight_app"

    # 3. move_cursor_app
    mv_res = await in_app_control_tools.execute_in_app_control_action("move_cursor_app", {"x": 200, "y": 350})
    assert mv_res["ok"] is True
    assert events_received[-1]["action"] == "move_cursor_app"

    # 4. view_app_screen
    view_res = await in_app_control_tools.execute_in_app_control_action("view_app_screen", {})
    assert view_res["ok"] is True
    assert "active_view" in view_res

    # Reset emitter
    in_app_control_tools.set_app_control_emitter(None)


def test_settings_allow_in_app_self_control():
    # Verify settings persistence for allowInAppSelfControl
    res = client.post("/api/settings", json={"allowInAppSelfControl": True})
    assert res.status_code == 200
    assert res.json()["settings"]["allowInAppSelfControl"] is True

    # Check GET reflects it
    res_get = client.get("/api/settings")
    assert res_get.status_code == 200
    assert res_get.json()["allowInAppSelfControl"] is True


def test_active_project_and_file_content_graceful_missing(tmp_path: Path):
    proj_dir = tmp_path / "my_project"
    proj_dir.mkdir()

    # 1. Sync active project
    res_proj = client.post("/api/workspace/active-project", json={"project_path": str(proj_dir)})
    assert res_proj.status_code == 200
    assert res_proj.json()["ok"] is True
    assert res_proj.json()["active_project"] == str(proj_dir)

    # 2. Query missing file content - should return 200 with exists=False rather than 400 Bad Request
    res_file = client.get(f"/api/workspace/file-content?workspace_root={proj_dir}&path=PLAN.md")
    assert res_file.status_code == 200
    data = res_file.json()
    assert data["exists"] is False
    assert data["success"] is False
    assert "not exist" in data["error"].lower() or "not found" in data["error"].lower()

    # 3. Path resolution for relative paths anchors to active project
    from backend.app.tools.safety import resolve_user_path
    resolved = resolve_user_path(".")
    assert resolved == proj_dir.resolve()

