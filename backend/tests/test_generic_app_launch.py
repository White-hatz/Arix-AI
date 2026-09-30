import platform
from pathlib import Path
import pytest
from backend.app.tools.system_tools import (
    resolve_installed_app,
    open_application,
)


@pytest.mark.skipif(platform.system() != "Windows", reason="Windows application resolution tests")
def test_resolve_installed_app_windows() -> None:
    # 1. Notepad should resolve directly via PATH or Windows
    exe, source = resolve_installed_app("notepad")
    assert exe is not None
    assert "notepad" in exe.lower()

    # 2. Antigravity IDE should resolve via Local Programs or Start Menu
    exe_anti, source_anti = resolve_installed_app("antigravity")
    if (Path.home() / r"AppData\Local\Programs\Antigravity\Antigravity.exe").exists():
        assert exe_anti is not None
        assert "antigravity" in exe_anti.lower()


@pytest.mark.asyncio
async def test_open_application_requires_confirmation_for_unknown(monkeypatch) -> None:
    # An unknown app should return needs_clarification if not confirmed or not found
    res = await open_application("non_existent_fake_app_12345", confirmed=False)
    assert res["ok"] is False
    assert res["status"] in {"needs_clarification", "not_found", "app_not_found"}
