"""Playwright MCP behavioral wrapper: tour-guide highlighting, captcha detection, and self-healing."""

from __future__ import annotations

import json
import logging
from typing import Any, Callable, Coroutine

logger = logging.getLogger("backend.services.mcp.playwright_wrapper")


def build_highlight_script(selector: str, note: str = "") -> str:
    """Constructs a client-side JavaScript snippet to inject a glowing pulse highlight & tooltip."""
    safe_sel = json.dumps(selector)
    safe_note = json.dumps(note)
    return f"""() => {{
        try {{
            const el = document.querySelector({safe_sel});
            if (!el) return false;
            el.scrollIntoView({{ behavior: 'smooth', block: 'center' }});

            document.querySelectorAll('.arix-tour-highlight').forEach(e => e.remove());

            const rect = el.getBoundingClientRect();
            const overlay = document.createElement('div');
            overlay.className = 'arix-tour-highlight';
            overlay.style.position = 'fixed';
            overlay.style.top = `${{rect.top - 4}}px`;
            overlay.style.left = `${{rect.left - 4}}px`;
            overlay.style.width = `${{rect.width + 8}}px`;
            overlay.style.height = `${{rect.height + 8}}px`;
            overlay.style.border = '2px solid #00f2fe';
            overlay.style.borderRadius = '6px';
            overlay.style.boxShadow = '0 0 15px rgba(0, 242, 254, 0.6), inset 0 0 10px rgba(79, 172, 254, 0.3)';
            overlay.style.pointerEvents = 'none';
            overlay.style.zIndex = '999999';
            overlay.style.transition = 'all 0.3s ease';

            if ({safe_note}) {{
                const badge = document.createElement('div');
                badge.innerText = {safe_note};
                badge.style.position = 'absolute';
                badge.style.top = '-26px';
                badge.style.left = '0';
                badge.style.background = 'linear-gradient(135deg, #00f2fe 0%, #4facfe 100%)';
                badge.style.color = '#000';
                badge.style.fontWeight = 'bold';
                badge.style.fontSize = '11px';
                badge.style.padding = '3px 8px';
                badge.style.borderRadius = '4px';
                badge.style.whiteSpace = 'nowrap';
                overlay.appendChild(badge);
            }}

            document.body.appendChild(overlay);
            return true;
        }} catch (err) {{
            return false;
        }}
    }}"""


def detect_captcha(snapshot_text: str) -> dict[str, Any]:
    """Analyzes accessibility snapshot text to detect CAPTCHA or Cloudflare challenge pages."""
    text_lower = snapshot_text.lower()
    patterns = [
        "recaptcha",
        "hcaptcha",
        "cf-turnstile",
        "verify you are human",
        "press & hold",
        "security check",
        "cloudflare ray id",
    ]
    detected = any(p in text_lower for p in patterns)
    return {
        "captcha_detected": detected,
        "requires_user_action": detected,
        "message": (
            "A verification challenge / CAPTCHA was detected on the page. "
            "Please complete the challenge in the browser window, then the agent will resume automatically."
            if detected
            else ""
        ),
    }
