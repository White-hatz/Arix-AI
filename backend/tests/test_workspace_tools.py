from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from backend.app.tools.registry import ToolRegistry
from backend.app.tools.safety import ConfirmationRequired
from backend.app.tools.workspace_tools import (
    _BrowserRuntime,
    _file_controller_sync,
    _safe_browser_url,
    register_workspace_tools,
)


def test_workspace_tools_register() -> None:
    registry = ToolRegistry()
    register_workspace_tools(registry)
    assert registry.names == ("file_controller", "browser_control", "desktop_control")


def test_file_read_and_write_confirmation(tmp_path: Path) -> None:
    source = tmp_path / "notes.txt"
    source.write_text("old", encoding="utf-8")

    def safe_path(raw: str, must_exist: bool = False):
        path = Path(raw)
        if must_exist and not path.exists():
            raise FileNotFoundError(raw)
        return path

    with patch("backend.app.tools.workspace_tools.resolve_user_path", side_effect=safe_path):
        result = _file_controller_sync("read", str(source), "", "", "", False, False)
        assert result["content"] == "old"
        with pytest.raises(ConfirmationRequired):
            _file_controller_sync("write", str(source), "", "new", "", False, False)
        changed = _file_controller_sync("write", str(source), "", "new", "", True, False)
    assert changed["bytes_written"] == 3
    assert source.read_text(encoding="utf-8") == "new"


def test_file_delete_uses_recycle_bin(tmp_path: Path) -> None:
    source = tmp_path / "discard.txt"
    source.write_text("x", encoding="utf-8")
    trash = MagicMock()
    trash.send2trash = MagicMock()
    with (
        patch("backend.app.tools.workspace_tools.resolve_user_path", return_value=source),
        patch("backend.app.tools.workspace_tools.require_optional_dependency", return_value=trash),
    ):
        with pytest.raises(ConfirmationRequired):
            _file_controller_sync("delete", str(source), "", "", "", False, False)
        result = _file_controller_sync("delete", str(source), "", "", "", True, False)
    assert result["recycled"] is True
    trash.send2trash.assert_called_once_with(str(source))


def test_browser_url_blocks_internal_and_file_schemes() -> None:
    assert _safe_browser_url("example.com") == "https://example.com"
    with pytest.raises(ValueError, match="HTTP and HTTPS"):
        _safe_browser_url("file:///etc/passwd")
    with pytest.raises(ValueError, match="blocked"):
        _safe_browser_url("http://localhost:3000")


def test_browser_url_allows_localhost_when_enabled() -> None:
    assert _safe_browser_url("http://localhost:5173", allow_local=True) == "http://localhost:5173"
    assert _safe_browser_url("localhost:5173", allow_local=True) == "http://localhost:5173"
    assert _safe_browser_url("http://127.0.0.1:3000", allow_local=True) == "http://127.0.0.1:3000"
    assert _safe_browser_url("", allow_local=True) == "http://localhost:5173"


def test_browser_consequential_click_requires_confirmation() -> None:
    runtime = _BrowserRuntime()
    page = MagicMock()
    page.url = "https://example.com/cart"
    page.title.return_value = "Cart"
    with patch.object(runtime, "_ensure", return_value=page):
        with pytest.raises(ConfirmationRequired):
            runtime.execute("click", "", "", "button.buy", "", "", 0, 0, False, True)
        result = runtime.execute("click", "", "", "button.buy", "", "", 0, 0, True, True)
    assert result["completed"] is True
    page.locator.return_value.first.click.assert_called_once()
    runtime.executor.shutdown(wait=False, cancel_futures=True)
