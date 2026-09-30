from pathlib import Path
import pytest
from backend.app.tools.environment_tools import (
    get_environment_info,
    list_available_tools,
    get_core_project_path,
)
from backend.app.memory.runtime import create_memory_runtime


def test_get_environment_info_all() -> None:
    info = get_environment_info(scope="all")
    assert info["ok"] is True
    assert "core_system" in info
    assert "registered_projects" in info
    assert "storage_locations" in info
    assert "active_workspace" in info
    assert info["core_system"]["installation_path"] != ""


def test_get_environment_info_scopes() -> None:
    core_info = get_environment_info(scope="core")
    assert core_info["ok"] is True
    assert "core_system" in core_info
    assert "registered_projects" not in core_info

    proj_info = get_environment_info(scope="projects")
    assert proj_info["ok"] is True
    assert "registered_projects" in proj_info

    storage_info = get_environment_info(scope="storage")
    assert storage_info["ok"] is True
    assert "storage_locations" in storage_info
    assert "memory_graph_file" in storage_info["storage_locations"]
    assert "logs_file" in storage_info["storage_locations"]


@pytest.mark.asyncio
async def test_list_available_tools(tmp_path: Path) -> None:
    runtime = await create_memory_runtime(tmp_path)
    # Test all context
    res = list_available_tools(context="all")
    assert res["ok"] is True
    assert res["total_tools"] > 0
    tool_names = [t["name"] for t in res["tools"]]
    assert "get_environment_info" in tool_names
    assert "list_available_tools" in tool_names
    assert "open_application" in tool_names
    assert "file_controller" in tool_names

    # Test home context (should filter out workspace/coder only tools)
    home_res = list_available_tools(context="home")
    assert home_res["ok"] is True
    assert home_res["total_tools"] > 0
    home_names = [t["name"] for t in home_res["tools"]]
    assert "run_command" not in home_names
    assert "get_environment_info" in home_names
