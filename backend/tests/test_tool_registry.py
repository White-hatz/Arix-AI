from pathlib import Path

import pytest

from backend.app.memory.runtime import create_memory_runtime


@pytest.mark.asyncio
async def test_memory_tools_are_declared_and_executable(tmp_path: Path) -> None:
    runtime = await create_memory_runtime(tmp_path)
    expected = {
        "save_memory", "request_memory", "open_app", "web_search", "weather_report",
        "reminder", "computer_settings", "computer_control", "file_controller",
        "browser_control", "desktop_control", "send_message", "youtube_video",
        "screen_process", "smart_home_control", "game_updater", "flight_finder",
        "file_processor", "presentation_builder", "spreadsheet_builder", "word_document",
        "pdf_document", "agent_task", "shutdown_arix", "switch_thinking_mode",
        "set_mute_state", "mute_ai",
        "navigate_app", "scroll_app", "click_app", "type_app",
        "drag_drop_app", "highlight_app", "move_cursor_app", "view_app_screen",
        "sequentialthinking", "sequential_thinking", "query_memory",
    }
    assert expected == set(runtime.tools.names)

    declarations = runtime.tools.declarations()
    assert len(declarations) == 1
    result = await runtime.tools.execute("save_memory", {"text": "User likes quiet mornings."})
    assert result["ok"] is True
    assert "quiet mornings" in await runtime.service.scratchpad.read()
