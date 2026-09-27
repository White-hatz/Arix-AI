#!/usr/bin/env python3
"""Arix AI Model & Thinking Mode Switcher CLI.

Usage:
  python scripts/switch.py normal
  python scripts/switch.py think
  python scripts/switch.py toggle
  python scripts/switch.py switch normal/think
"""
from __future__ import annotations

import json
import sys
import urllib.error
import urllib.request
from pathlib import Path

API_URL = "http://127.0.0.1:8765/api/mode"
DATA_FILE = Path("backend/data/mode.json")
DEFAULT_LIVE_MODEL = "gemini-3.8-live"
THINKING_LIVE_MODEL = "gemini-3.8-live-extended-thinking"


def normalize_requested_mode(raw_args: list[str]) -> str:
    joint = " ".join(raw_args).strip().lower()
    if not joint or joint in ("toggle", "switch", "switch normal/think", "switch think/normal", "normal/think"):
        return "toggle"
    if any(k in joint for k in ("think", "deep", "extended")):
        return "think"
    if any(k in joint for k in ("norm", "std", "standard", "default")):
        return "normal"
    return "toggle"


def save_fallback_mode(mode: str) -> None:
    DATA_FILE.parent.mkdir(parents=True, exist_ok=True)
    DATA_FILE.write_text(json.dumps({"mode": mode}, indent=2), encoding="utf-8")


def read_current_mode() -> str:
    if DATA_FILE.exists():
        try:
            data = json.loads(DATA_FILE.read_text(encoding="utf-8"))
            return data.get("mode", "normal")
        except Exception:
            pass
    return "normal"


def main() -> int:
    requested = normalize_requested_mode(sys.argv[1:])

    # First attempt: Send request to running Arix backend
    try:
        req = urllib.request.Request(
            API_URL,
            data=json.dumps({"mode": requested}).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=3.0) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            mode = data.get("mode", requested)
            model = data.get("model", "")
            active = data.get("active_session_updated", False)

            print(f"\n[Arix AI] Mode switch successful!")
            print(f"  - Mode:             {mode.upper()}")
            print(f"  - Model:            {model}")
            if active:
                print(f"  - Active session:   Dynamically switched to {model}")
            else:
                print(f"  - Active session:   No active live session (configured for next session)")
            print()
            return 0
    except (urllib.error.URLError, TimeoutError, ConnectionRefusedError, OSError):
        # Backend not running: persist mode locally to mode.json
        current = read_current_mode()
        target = "normal" if current == "think" else "think" if requested == "toggle" else requested
        target_model = THINKING_LIVE_MODEL if target == "think" else DEFAULT_LIVE_MODEL
        save_fallback_mode(target)

        print(f"\n[Arix AI] Local bridge is offline. Saved preference to disk:")
        print(f"  - Mode:             {target.upper()}")
        print(f"  - Model:            {target_model}")
        print(f"  - Note:             Will take effect when Arix launches.")
        print()
        return 0



if __name__ == "__main__":
    sys.exit(main())
