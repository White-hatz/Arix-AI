from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from backend.app.core.protocol import DEFAULT_LIVE_MODEL, THINKING_LIVE_MODEL
from backend.app.main import app
from backend.app.tools.mode_tools import (
    register_mode_tools,
    set_active_switch_handler,
)
from backend.app.tools.registry import ToolRegistry
from scripts.switch import normalize_requested_mode


@pytest.mark.asyncio
async def test_switch_thinking_mode_tool() -> None:
    registry = ToolRegistry()
    switched_to: list[tuple[str, str]] = []

    async def mock_handler(mode: str, reason: str) -> dict[str, str]:
        switched_to.append((mode, reason))
        return {"handler_called": "yes"}

    register_mode_tools(registry, switch_handler=mock_handler)

    assert "switch_thinking_mode" in registry.names

    # Test switching to think mode
    res_think = await registry.execute("switch_thinking_mode", {"mode": "think", "reason": "math problem"})
    assert res_think["ok"] is True
    assert res_think["result"]["mode"] == "think"
    assert res_think["result"]["model"] == THINKING_LIVE_MODEL
    assert res_think["result"]["model"] == "gemini-3.8-live-extended-thinking"
    assert res_think["result"]["handler_called"] == "yes"
    assert switched_to[-1] == ("think", "math problem")

    # Test switching to normal mode
    res_normal = await registry.execute("switch_thinking_mode", {"mode": "normal"})
    assert res_normal["ok"] is True
    assert res_normal["result"]["mode"] == "normal"
    assert res_normal["result"]["model"] == DEFAULT_LIVE_MODEL
    assert res_normal["result"]["model"] == "gemini-3.8-live"


@pytest.mark.asyncio
async def test_global_active_switch_handler() -> None:
    registry = ToolRegistry()
    register_mode_tools(registry)

    handler_invocations: list[str] = []

    def sync_handler(mode: str, reason: str) -> dict[str, str]:
        handler_invocations.append(mode)
        return {"sync": "ok"}

    set_active_switch_handler(sync_handler)
    try:
        res = await registry.execute("switch_thinking_mode", {"mode": "think"})
        assert res["ok"] is True
        assert res["result"]["sync"] == "ok"
        assert handler_invocations == ["think"]
    finally:
        set_active_switch_handler(None)


def test_api_mode_endpoints() -> None:
    client = TestClient(app)

    # Test GET /api/mode
    get_res = client.get("/api/mode")
    assert get_res.status_code == 200
    data = get_res.json()
    assert "mode" in data
    assert "model" in data

    # Test POST /api/mode -> think
    post_think = client.post("/api/mode", json={"mode": "think"})
    assert post_think.status_code == 200
    assert post_think.json()["mode"] == "think"
    assert post_think.json()["model"] == THINKING_LIVE_MODEL

    # Test POST /api/mode -> normal
    post_norm = client.post("/api/mode", json={"mode": "normal"})
    assert post_norm.status_code == 200
    assert post_norm.json()["mode"] == "normal"
    assert post_norm.json()["model"] == DEFAULT_LIVE_MODEL

    # Test POST /api/mode -> toggle
    post_toggle = client.post("/api/mode", json={"mode": "toggle"})
    assert post_toggle.status_code == 200
    assert post_toggle.json()["mode"] == "think"

    # Test POST /api/mode with invalid mode
    post_invalid = client.post("/api/mode", json={"mode": "not-a-real-mode"})
    assert post_invalid.status_code == 400


def test_cli_normalize_requested_mode() -> None:
    assert normalize_requested_mode([]) == "toggle"
    assert normalize_requested_mode(["switch normal/think"]) == "toggle"
    assert normalize_requested_mode(["think"]) == "think"
    assert normalize_requested_mode(["deep", "think"]) == "think"
    assert normalize_requested_mode(["use", "extended", "thinking"]) == "think"
    assert normalize_requested_mode(["normal"]) == "normal"
    assert normalize_requested_mode(["standard"]) == "normal"


def test_api_logs_endpoint() -> None:
    client = TestClient(app)
    res = client.get("/api/logs?lines=50")
    assert res.status_code == 200
    data = res.json()
    assert "logs" in data
    assert "total_lines" in data
    assert isinstance(data["logs"], list)


@pytest.mark.asyncio
async def test_live_bridge_drain_queue() -> None:
    from backend.app.core.protocol import SessionStart
    from backend.app.services.gemini_live import GeminiLiveBridge

    events: list[dict] = []
    async def mock_emit(evt: dict) -> None:
        events.append(evt)

    start = SessionStart(type="session.start", api_key="fake-key", model="gemini-3.8-live")
    bridge = GeminiLiveBridge(start, "fake-key", mock_emit, ToolRegistry())
    await bridge.send_audio(b"sample-chunk-1")
    await bridge.send_audio(b"sample-chunk-2")
    await bridge.send_text("sample text")

    assert bridge._send_queue.qsize() == 3
    flushed = bridge._drain_send_queue()
    assert flushed == 3
    assert bridge._send_queue.empty()
