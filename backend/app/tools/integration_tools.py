from __future__ import annotations

import asyncio
import ipaddress
import json
import urllib.parse
import urllib.request
import webbrowser
from pathlib import Path
from typing import Any

from backend.app.tools.registry import ToolDefinition, ToolRegistry
from backend.app.tools.safety import (
    bounded_number,
    bounded_text,
    require_confirmation,
    require_optional_dependency,
    resolve_user_path,
)

_NETWORK_TIMEOUT = 10
_USER_AGENT = "Arix-AI/0.2 (+local desktop assistant)"


def _open_external(url: str) -> None:
    if not webbrowser.open(url, new=2):
        raise RuntimeError("The default browser did not accept the request")


async def send_message(
    platform: str,
    receiver: str,
    message: str,
    confirmed: bool = False,
) -> dict[str, Any]:
    require_confirmation(f"open a {platform} message addressed to {receiver}", confirmed)
    recipient = bounded_text(receiver, limit=200, field="receiver")
    text = bounded_text(message, limit=4_000, field="message")
    if platform == "whatsapp":
        phone = "".join(character for character in recipient if character.isdigit())
        if not 7 <= len(phone) <= 15:
            raise ValueError("WhatsApp receiver must contain a 7-15 digit international phone number")
        url = f"https://wa.me/{phone}?" + urllib.parse.urlencode({"text": text})
    elif platform == "telegram":
        username = recipient.removeprefix("@").strip()
        if not username.replace("_", "").isalnum():
            raise ValueError("Telegram receiver must be a valid username")
        url = f"https://t.me/{urllib.parse.quote(username)}?" + urllib.parse.urlencode({"text": text})
    elif platform == "email":
        if "@" not in recipient or any(character in recipient for character in "\r\n"):
            raise ValueError("A valid email receiver is required")
        url = "mailto:" + urllib.parse.quote(recipient, safe="@+._-") + "?" + urllib.parse.urlencode({"body": text})
    elif platform == "sms":
        phone = "".join(character for character in recipient if character.isdigit() or character == "+")
        if not 7 <= len(phone.replace("+", "")) <= 15:
            raise ValueError("SMS receiver must contain a valid phone number")
        url = "sms:" + urllib.parse.quote(phone, safe="+") + "?" + urllib.parse.urlencode({"body": text})
    else:
        raise ValueError("platform must be whatsapp, telegram, email, or sms")
    await asyncio.to_thread(_open_external, url)
    return {
        "platform": platform,
        "receiver": recipient,
        "composer_opened": True,
        "sent": False,
        "note": "The message is prepared but the user must review and press Send.",
    }


def _youtube_video_id(value: str) -> str | None:
    parsed = urllib.parse.urlparse(value)
    host = (parsed.hostname or "").casefold().removeprefix("www.")
    if host == "youtu.be":
        candidate = parsed.path.strip("/").split("/")[0]
    elif host in {"youtube.com", "m.youtube.com"}:
        candidate = urllib.parse.parse_qs(parsed.query).get("v", [""])[0]
        if not candidate and parsed.path.startswith("/shorts/"):
            candidate = parsed.path.split("/")[2]
    else:
        return None
    return candidate if len(candidate) == 11 and all(character.isalnum() or character in "-_" for character in candidate) else None


def _request_json(url: str) -> Any:
    request = urllib.request.Request(url, headers={"User-Agent": _USER_AGENT})
    with urllib.request.urlopen(request, timeout=_NETWORK_TIMEOUT) as response:
        return json.loads(response.read(1_000_000))


async def youtube_video(
    action: str,
    query: str = "",
    url: str = "",
    languages: list[str] | None = None,
) -> dict[str, Any]:
    if action in {"play", "search"}:
        if url:
            video_id = _youtube_video_id(url)
            if not video_id:
                raise ValueError("A valid YouTube video URL is required")
            target = f"https://www.youtube.com/watch?v={video_id}"
        else:
            search = bounded_text(query, limit=500, field="query")
            target = "https://www.youtube.com/results?" + urllib.parse.urlencode({"search_query": search})
        await asyncio.to_thread(_open_external, target)
        return {"action": action, "opened": True, "url": target}
    video_id = _youtube_video_id(bounded_text(url, limit=2_000, field="url"))
    if not video_id:
        raise ValueError("A valid YouTube video URL is required")
    canonical = f"https://www.youtube.com/watch?v={video_id}"
    if action == "info":
        data = await asyncio.to_thread(
            _request_json,
            "https://www.youtube.com/oembed?" + urllib.parse.urlencode({"url": canonical, "format": "json"}),
        )
        return {"action": action, "video_id": video_id, "url": canonical, "title": data.get("title", ""), "author": data.get("author_name", ""), "thumbnail_url": data.get("thumbnail_url", "")}
    if action == "transcript":
        transcript_api = require_optional_dependency("youtube_transcript_api", "pip install youtube-transcript-api")
        preferred = [str(item)[:12] for item in (languages or ["en"])][:5]

        def fetch() -> list[dict[str, Any]]:
            api = transcript_api.YouTubeTranscriptApi()
            transcript = api.fetch(video_id, languages=preferred)
            return [{"text": item.text, "start": item.start, "duration": item.duration} for item in transcript][:2_000]

        segments = await asyncio.to_thread(fetch)
        joined = " ".join(segment["text"] for segment in segments)[:100_000]
        return {"action": action, "video_id": video_id, "url": canonical, "text": joined, "segments": segments, "truncated": len(joined) >= 100_000}
    raise ValueError("action must be play, search, info, or transcript")


def _capture_screen(path: str) -> dict[str, Any]:
    target = resolve_user_path(path or str(Path.home() / "Pictures" / "Arix" / "screen_capture.png"))
    if target.suffix.casefold() not in {".png", ".jpg", ".jpeg"}:
        raise ValueError("Screen capture path must end in .png, .jpg, or .jpeg")
    target.parent.mkdir(parents=True, exist_ok=True)
    image_grab = require_optional_dependency("PIL.ImageGrab", "pip install Pillow")
    image = image_grab.grab(all_screens=True)
    image.save(target)
    return {"captured": True, "path": str(target), "width": image.width, "height": image.height}


# [TEMPORARY/INTERIM OCR BYPASS]:
# Tesseract local binary dependency is bypassed in favor of native Gemini Multimodal Vision grounding.
# This removes external binary prerequisites while allowing direct pixel grounding and element location.
_USE_LOCAL_TESSERACT_OCR = False  # Feature-flagged off per PO directive; zero-setup Gemini Vision is default.


async def _gemini_vision_grounding(
    target_path: Path,
    action: str = "ocr",
    query: str = "",
) -> dict[str, Any]:
    from backend.app.core.config import settings as app_cfg
    from backend.app.api.settings import load_backend_config
    import os
    import re
    from google.genai import types
    import google.genai as genai

    image_module = require_optional_dependency("PIL.Image", "pip install Pillow")
    with image_module.open(target_path) as img:
        width, height = img.size

    # Read image bytes
    image_bytes = target_path.read_bytes()
    mime_type = "image/png"
    if target_path.suffix.lower() in {".jpg", ".jpeg"}:
        mime_type = "image/jpeg"

    # Resolve API Key
    backend_cfg = load_backend_config()
    api_key = (
        backend_cfg.get("apiKey")
        or os.getenv("GEMINI_API_KEY")
        or app_cfg.fallback_api_key
    )
    if not api_key or not api_key.strip():
        return {
            "ok": False,
            "status": "system_error",
            "error": "Gemini API key is missing. Please configure it in Settings.",
            "message": "System Error in tool 'screen_process': Gemini API key is missing for vision grounding.",
        }

    client = genai.Client(api_key=api_key.strip())

    if query or action in {"locate", "ground"}:
        target_desc = query or "the requested UI element, button, icon, or text"
        prompt = (
            f"You are an expert desktop UI vision and grounding system.\n"
            f"Image dimensions: {width}x{height} pixels.\n"
            f"Target to locate: \"{target_desc}\".\n\n"
            f"Task:\n"
            f"1. Determine if the target is visible on screen.\n"
            f"2. Identify its bounding box normalized to 0-1000 [ymin, xmin, ymax, xmax].\n"
            f"3. Calculate the center pixel coordinates (x, y) where a mouse click should land (0 <= x < {width}, 0 <= y < {height}).\n"
            f"4. Describe what is visible at that location (surrounding icons, taskbar, active window title).\n\n"
            f"Return your answer with this structured format:\n"
            f"FOUND: true or false\n"
            f"COORDINATES: x=<int>, y=<int>\n"
            f"BOUNDING_BOX_1000: [ymin, xmin, ymax, xmax]\n"
            f"DESCRIPTION: <clear visual summary>\n"
            f"RAW_TEXT: <any text visible on or near the target>"
        )
    else:
        prompt = (
            f"You are an expert desktop UI screen reader and OCR system.\n"
            f"Image dimensions: {width}x{height} pixels.\n"
            f"Task:\n"
            f"1. Transcribe all prominent text visible on the screen (active window titles, menus, buttons, taskbar items, notifications).\n"
            f"2. List key interactive UI elements with their estimated pixel click coordinates (x, y).\n"
            f"3. Summarize the user's active desktop state.\n"
            f"Provide a clear, accurate, complete transcription."
        )

    part = types.Part.from_bytes(data=image_bytes, mime_type=mime_type)

    models_to_try = [
        "gemini-2.5-flash-image",
        "gemini-3.8-flash",
        "gemini-3.7-flash",
        "gemini-3.5-flash",
        "gemini-flash-latest",
    ]
    last_error = None
    response_text = ""
    used_model = ""

    for m in models_to_try:
        try:
            response = await asyncio.to_thread(
                client.models.generate_content,
                model=m,
                contents=[part, prompt],
            )
            response_text = response.text or ""
            used_model = m
            break
        except Exception as e:
            last_error = e
            err_str = str(e).lower()
            if any(ind in err_str for ind in ("404", "not_found", "model", "503", "unavailable", "resource_exhausted", "quota")):
                continue
            break

    if not response_text and last_error:
        return {
            "ok": False,
            "status": "system_error",
            "error": f"Gemini Vision call failed: {last_error}",
            "message": f"System Error in tool 'screen_process': Gemini Vision grounding failed ({last_error}). Quote this error and check API key or network connectivity.",
            "path": str(target_path),
            "width": width,
            "height": height,
        }

    coords = None
    coord_match = re.search(r"COORDINATES:\s*x=(\d+),\s*y=(\d+)", response_text, re.IGNORECASE)
    if not coord_match:
        coord_match = re.search(r"[\"']?click_coordinates[\"']?:\s*\{\s*[\"']?x[\"']?:\s*(\d+),\s*[\"']?y[\"']?:\s*(\d+)\s*\}", response_text, re.IGNORECASE)
    if coord_match:
        coords = {"x": int(coord_match.group(1)), "y": int(coord_match.group(2))}

    is_found = bool(coords)
    found_match = re.search(r"FOUND:\s*(true|false)", response_text, re.IGNORECASE)
    if found_match:
        is_found = found_match.group(1).lower() == "true"

    return {
        "ok": True,
        "action": action,
        "found": is_found,
        "path": str(target_path),
        "width": width,
        "height": height,
        "text": response_text[:50_000],
        "click_coordinates": coords,
        "vision_engine": f"Gemini Multimodal Vision ({used_model})",
        "ocr_bypassed": True,
        "truncated": len(response_text) > 50_000,
    }


async def screen_process(action: str, path: str = "", query: str = "") -> dict[str, Any]:
    if action == "capture":
        captured_data = await asyncio.to_thread(_capture_screen, path)
        return {
            "ok": True,
            "action": action,
            "completed": True,
            "message": f"Desktop screen captured successfully to {captured_data.get('path')}",
            **captured_data,
        }

    # If no path is provided for inspection/ocr/locate, capture current screen automatically
    if not path:
        captured = await asyncio.to_thread(_capture_screen, "")
        path = captured["path"]

    target = resolve_user_path(bounded_text(path, limit=2_000, field="path"), must_exist=True)
    image_module = require_optional_dependency("PIL.Image", "pip install Pillow")

    if action == "info":
        with image_module.open(target) as image:
            return {"action": action, "path": str(target), "width": image.width, "height": image.height, "format": image.format, "mode": image.mode}

    if action in {"ocr", "locate", "ground"}:
        global _USE_LOCAL_TESSERACT_OCR
        if _USE_LOCAL_TESSERACT_OCR:
            pytesseract = require_optional_dependency("pytesseract", "pip install pytesseract")
            with image_module.open(target) as image:
                text = await asyncio.to_thread(pytesseract.image_to_string, image.copy())
                return {"action": action, "path": str(target), "text": text[:50_000], "truncated": len(text) > 50_000}

        return await _gemini_vision_grounding(target, action=action, query=query)

    raise ValueError("action must be capture, info, ocr, locate, or ground")


def _private_host(host: str) -> str:
    try:
        address = ipaddress.ip_address(host.strip())
    except ValueError as error:
        raise ValueError("device_host must be a literal private IP address") from error
    if not address.is_private or address.is_loopback or address.is_unspecified or address.is_multicast:
        raise ValueError("device_host must be a non-loopback private IP address")
    return str(address)


async def smart_home_control(
    action: str,
    device_host: str = "",
    confirmed: bool = False,
    timeout: float = 5,
) -> dict[str, Any]:
    kasa = require_optional_dependency("kasa", "pip install python-kasa")
    bounded_timeout = bounded_number(timeout, minimum=1, maximum=15, field="timeout")
    if action == "discover":
        devices = await kasa.Discover.discover(timeout=bounded_timeout)
        records = []
        for host, device in list(devices.items())[:100]:
            await device.update()
            records.append({"host": str(host), "alias": getattr(device, "alias", ""), "model": getattr(device, "model", ""), "is_on": getattr(device, "is_on", None)})
        return {"action": action, "devices": records, "count": len(records)}
    if action not in {"status", "turn_on", "turn_off", "toggle"}:
        raise ValueError("action must be discover, status, turn_on, turn_off, or toggle")
    host = _private_host(device_host)
    device = await kasa.Discover.discover_single(host, timeout=bounded_timeout)
    if device is None:
        raise RuntimeError("No supported smart-home device responded at that host")
    await device.update()
    if action != "status":
        require_confirmation(f"{action.replace('_', ' ')} smart-home device {host}", confirmed)
        desired = not bool(device.is_on) if action == "toggle" else action == "turn_on"
        await (device.turn_on() if desired else device.turn_off())
        await device.update()
    return {"action": action, "host": host, "alias": getattr(device, "alias", ""), "model": getattr(device, "model", ""), "is_on": bool(device.is_on)}


def register_integration_tools(registry: ToolRegistry) -> None:
    registry.register(ToolDefinition(
        name="send_message",
        description="Open a reviewed message composer for WhatsApp, Telegram, email, or SMS. Always requires confirmation and never claims the message was sent.",
        parameters={"type": "object", "properties": {
            "platform": {"type": "string", "enum": ["whatsapp", "telegram", "email", "sms"]},
            "receiver": {"type": "string"}, "message": {"type": "string", "maxLength": 4000},
            "confirmed": {"type": "boolean", "default": False},
        }, "required": ["platform", "receiver", "message"], "additionalProperties": False},
        handler=send_message,
    ))
    registry.register(ToolDefinition(
        name="youtube_video",
        description="Play or search YouTube, retrieve public video metadata, or fetch a transcript.",
        parameters={"type": "object", "properties": {
            "action": {"type": "string", "enum": ["play", "search", "info", "transcript"]},
            "query": {"type": "string"}, "url": {"type": "string"},
            "languages": {"type": "array", "items": {"type": "string"}, "maxItems": 5},
        }, "required": ["action"], "additionalProperties": False},
        handler=youtube_video,
    ))
    registry.register(ToolDefinition(
        name="screen_process",
        description="Capture the desktop screen or inspect/read/locate UI elements in screenshots using Gemini native multimodal vision. Locates icons, buttons, taskbar items, and text with click coordinates without requiring any external Tesseract binary.",
        parameters={"type": "object", "properties": {
            "action": {"type": "string", "enum": ["capture", "info", "ocr", "locate", "ground"]},
            "path": {"type": "string", "description": "Optional path to the image file. If omitted, captures screen automatically."},
            "query": {"type": "string", "description": "Optional search query, target text, or visual element description to locate on screen."},
        }, "required": ["action"], "additionalProperties": False},
        handler=screen_process,
    ))
    registry.register(ToolDefinition(
        name="smart_home_control",
        description="Discover or control TP-Link Kasa devices on the private local network. State changes require confirmation.",
        parameters={"type": "object", "properties": {
            "action": {"type": "string", "enum": ["discover", "status", "turn_on", "turn_off", "toggle"]},
            "device_host": {"type": "string"}, "confirmed": {"type": "boolean", "default": False},
            "timeout": {"type": "number", "minimum": 1, "maximum": 15, "default": 5},
        }, "required": ["action"], "additionalProperties": False},
        handler=smart_home_control,
    ))
