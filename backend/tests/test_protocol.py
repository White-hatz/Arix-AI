import pytest
from pydantic import ValidationError

from backend.app.core.protocol import (
    DEFAULT_LIVE_MODEL,
    THINKING_LIVE_MODEL,
    ModeSwitchInput,
    SessionStart,
    TextInput,
)


def test_session_start_accepts_frontend_aliases() -> None:
    value = SessionStart.model_validate({
        "type": "session.start",
        "apiKey": "test-key",
        "model": "gemini-live-test",
        "voice": "Kore",
        "systemInstruction": "Be useful.",
    })
    assert value.api_key == "test-key"
    assert value.system_instruction == "Be useful."


def test_session_start_defaults_to_gemini_3_8_live() -> None:
    value = SessionStart.model_validate({"type": "session.start", "apiKey": "test-key"})
    assert value.model == DEFAULT_LIVE_MODEL
    assert value.model == "gemini-3.8-live"


def test_mode_switch_input_validation() -> None:
    msg = ModeSwitchInput(type="switch_mode", mode="think", reason="hard math")
    assert msg.mode == "think"
    assert msg.reason == "hard math"

    with pytest.raises(ValidationError):
        ModeSwitchInput(type="switch_mode", mode="invalid_mode")  # type: ignore[arg-type]


def test_empty_text_is_rejected() -> None:
    with pytest.raises(ValidationError):
        TextInput(type="text", text="")

