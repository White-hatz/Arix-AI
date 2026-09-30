from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from backend.app.tools.integration_tools import (
    _private_host,
    _youtube_video_id,
    register_integration_tools,
    send_message,
    smart_home_control,
)
from backend.app.tools.registry import ToolRegistry
from backend.app.tools.safety import ConfirmationRequired


def test_integration_tools_register() -> None:
    registry = ToolRegistry()
    register_integration_tools(registry)
    assert registry.names == ("send_message", "youtube_video", "screen_process", "smart_home_control")


@pytest.mark.asyncio
async def test_message_opens_composer_but_does_not_claim_sent() -> None:
    with patch("backend.app.tools.integration_tools._open_external") as opened:
        with pytest.raises(ConfirmationRequired):
            await send_message("whatsapp", "+1 555 010 1234", "Hello", False)
        result = await send_message("whatsapp", "+1 555 010 1234", "Hello", True)
    assert result["composer_opened"] is True
    assert result["sent"] is False
    assert opened.call_args.args[0].startswith("https://wa.me/15550101234?")


def test_youtube_ids_are_strict() -> None:
    assert _youtube_video_id("https://youtu.be/dQw4w9WgXcQ") == "dQw4w9WgXcQ"
    assert _youtube_video_id("https://www.youtube.com/watch?v=dQw4w9WgXcQ") == "dQw4w9WgXcQ"
    assert _youtube_video_id("https://example.com/watch?v=dQw4w9WgXcQ") is None


def test_smart_home_hosts_must_be_private_literal_ips() -> None:
    assert _private_host("192.168.1.25") == "192.168.1.25"
    with pytest.raises(ValueError):
        _private_host("example.com")
    with pytest.raises(ValueError):
        _private_host("8.8.8.8")
    with pytest.raises(ValueError):
        _private_host("127.0.0.1")


@pytest.mark.asyncio
async def test_smart_home_state_change_requires_confirmation() -> None:
    device = MagicMock()
    device.alias = "Desk light"
    device.model = "Test"
    device.is_on = False
    device.update = AsyncMock()
    device.turn_on = AsyncMock()
    kasa = MagicMock()
    kasa.Discover.discover_single = AsyncMock(return_value=device)
    with patch("backend.app.tools.integration_tools.require_optional_dependency", return_value=kasa):
        with pytest.raises(ConfirmationRequired):
            await smart_home_control("turn_on", "192.168.1.25", False)
        result = await smart_home_control("turn_on", "192.168.1.25", True)
    assert result["action"] == "turn_on"
    device.turn_on.assert_awaited_once()


@pytest.mark.asyncio
async def test_screen_process_bypasses_tesseract_and_uses_gemini_vision(tmp_path) -> None:
    from backend.app.tools.integration_tools import screen_process
    from PIL import Image

    test_img = tmp_path / "test_screenshot.png"
    img = Image.new("RGB", (800, 600), color=(10, 20, 30))
    img.save(test_img)

    mock_response = MagicMock()
    mock_response.text = (
        "FOUND: true\n"
        "COORDINATES: x=400, y=300\n"
        "BOUNDING_BOX_1000: [450, 450, 550, 550]\n"
        "DESCRIPTION: Center button on screen\n"
        "RAW_TEXT: Start Live Session"
    )

    with patch("google.genai.Client") as mock_client_cls, \
         patch("backend.app.api.settings.load_backend_config", return_value={"apiKey": "fake_test_key"}):
        mock_client = MagicMock()
        mock_client.models.generate_content.return_value = mock_response
        mock_client_cls.return_value = mock_client

        # Test locate action
        result = await screen_process(action="locate", path=str(test_img), query="Start button")
        assert result["ok"] is True
        assert result["ocr_bypassed"] is True
        assert result["click_coordinates"] == {"x": 400, "y": 300}
        assert "Gemini Multimodal Vision" in result["vision_engine"]

        # Test OCR action
        ocr_result = await screen_process(action="ocr", path=str(test_img))
        assert ocr_result["ok"] is True
        assert ocr_result["ocr_bypassed"] is True
        assert "Start Live Session" in ocr_result["text"]

