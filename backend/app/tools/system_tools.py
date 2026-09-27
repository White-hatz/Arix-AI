from __future__ import annotations

import asyncio
import json
import os
import platform
import shutil
import subprocess
import urllib.error
import urllib.parse
import urllib.request
import webbrowser
from html.parser import HTMLParser
from typing import Any

from backend.app.tools.registry import ToolDefinition, ToolRegistry

_NETWORK_TIMEOUT_SECONDS = 8
_USER_AGENT = "Arix-AI/0.2 (+local desktop assistant)"

_APP_COMMANDS: dict[str, dict[str, tuple[str, ...]]] = {
    "calculator": {
        "Windows": ("calc.exe",),
        "Darwin": ("open", "-a", "Calculator"),
        "Linux": ("gnome-calculator",),
    },
    "notepad": {
        "Windows": ("notepad.exe",),
        "Darwin": ("open", "-a", "TextEdit"),
        "Linux": ("gedit",),
    },
    "paint": {
        "Windows": ("mspaint.exe",),
        "Darwin": ("open", "-a", "Preview"),
        "Linux": ("gimp",),
    },
    "file explorer": {
        "Windows": ("explorer.exe",),
        "Darwin": ("open", "."),
        "Linux": ("xdg-open", "."),
    },
    "task manager": {
        "Windows": ("taskmgr.exe",),
        "Darwin": ("open", "-a", "Activity Monitor"),
        "Linux": ("gnome-system-monitor",),
    },
    "visual studio code": {
        "Windows": ("code",),
        "Darwin": ("open", "-a", "Visual Studio Code"),
        "Linux": ("code",),
    },
    "chrome": {
        "Windows": ("chrome.exe",),
        "Darwin": ("open", "-a", "Google Chrome"),
        "Linux": ("google-chrome",),
    },
    "edge": {
        "Windows": ("msedge.exe",),
        "Darwin": ("open", "-a", "Microsoft Edge"),
        "Linux": ("microsoft-edge",),
    },
    "firefox": {
        "Windows": ("firefox.exe",),
        "Darwin": ("open", "-a", "Firefox"),
        "Linux": ("firefox",),
    },
    "browser": {
        "Windows": ("browser",),
        "Darwin": ("open", "-a", "Safari"),
        "Linux": ("xdg-open", "https://www.google.com"),
    },
    "terminal": {
        "Windows": ("wt.exe",),
        "Darwin": ("open", "-a", "Terminal"),
        "Linux": ("gnome-terminal",),
    },
    "cmd": {
        "Windows": ("cmd.exe",),
        "Darwin": ("open", "-a", "Terminal"),
        "Linux": ("x-terminal-emulator",),
    },
    "powershell": {
        "Windows": ("powershell.exe",),
        "Darwin": ("open", "-a", "Terminal"),
        "Linux": ("pwsh",),
    },
    "settings": {
        "Windows": ("ms-settings:",),
        "Darwin": ("open", "-a", "System Settings"),
        "Linux": ("gnome-control-center",),
    },
    "spotify": {
        "Windows": ("spotify.exe",),
        "Darwin": ("open", "-a", "Spotify"),
        "Linux": ("spotify",),
    },
    "discord": {
        "Windows": ("discord.exe",),
        "Darwin": ("open", "-a", "Discord"),
        "Linux": ("discord",),
    },
    "telegram": {
        "Windows": ("telegram.exe",),
        "Darwin": ("open", "-a", "Telegram"),
        "Linux": ("telegram-desktop",),
    },
    "steam": {
        "Windows": ("steam.exe",),
        "Darwin": ("open", "-a", "Steam"),
        "Linux": ("steam",),
    },
    "vlc": {
        "Windows": ("vlc.exe",),
        "Darwin": ("open", "-a", "VLC"),
        "Linux": ("vlc",),
    },
}

_APP_ALIASES = {
    "calc": "calculator",
    "explorer": "file explorer",
    "files": "file explorer",
    "file manager": "file explorer",
    "directory": "file explorer",
    "folders": "file explorer",
    "my computer": "file explorer",
    "vscode": "visual studio code",
    "code": "visual studio code",
    "google": "chrome",
    "google chrome": "chrome",
    "microsoft edge": "edge",
    "msedge": "edge",
    "web": "browser",
    "web browser": "browser",
    "internet": "browser",
    "default browser": "browser",
    "wt": "terminal",
    "windows terminal": "terminal",
    "command prompt": "cmd",
    "ps": "powershell",
    "control panel": "settings",
}


def _normalized_web_url(target: str) -> str | None:
    value = target.strip()
    if not value:
        return None
    if "://" not in value and "." in value and " " not in value:
        value = f"https://{value}"
    parsed = urllib.parse.urlparse(value)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        return None
    return value


def _launch_command(command: tuple[str, ...]) -> None:
    executable = command[0]
    if platform.system() == "Windows":
        # Handle special protocol URIs or generic browser launch
        if executable in ("ms-settings:", "microsoft-edge:") or executable.startswith(("http://", "https://")):
            os.startfile(executable)
            return

        if executable == "browser":
            webbrowser.open("https://www.google.com")
            return

        # 1. Check if executable exists directly on PATH
        resolved = shutil.which(executable)
        if resolved:
            subprocess.Popen(
                [resolved, *command[1:]],
                stdin=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            return

        # 2. Check well-known Program Files / AppData installation paths on Windows
        clean_base = executable.removesuffix(".exe")
        candidate_paths = [
            executable,
            f"{clean_base}.exe",
            os.path.expandvars(rf"%ProgramFiles%\Google\Chrome\Application\{clean_base}.exe"),
            os.path.expandvars(rf"%ProgramFiles(x86)%\Google\Chrome\Application\{clean_base}.exe"),
            os.path.expandvars(rf"%LocalAppData%\Google\Chrome\Application\{clean_base}.exe"),
            os.path.expandvars(rf"%ProgramFiles(x86)%\Microsoft\Edge\Application\{clean_base}.exe"),
            os.path.expandvars(rf"%ProgramFiles%\Microsoft\Edge\Application\{clean_base}.exe"),
            os.path.expandvars(rf"%LocalAppData%\Programs\Microsoft VS Code\{clean_base}.exe"),
            os.path.expandvars(rf"%ProgramFiles%\Microsoft VS Code\{clean_base}.exe"),
            os.path.expandvars(rf"%LocalAppData%\Microsoft\WindowsApps\{clean_base}.exe"),
            os.path.expandvars(rf"%SystemRoot%\System32\{clean_base}.exe"),
        ]
        for candidate in candidate_paths:
            if candidate and os.path.isfile(candidate):
                subprocess.Popen(
                    [candidate, *command[1:]],
                    stdin=subprocess.DEVNULL,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                )
                return

        # 3. Try Windows Shell Execute via os.startfile (uses Windows App Paths registry)
        try:
            exe_target = executable if executable.endswith(".exe") else f"{executable}.exe"
            os.startfile(exe_target)
            return
        except OSError:
            pass

        # 4. Fallback for Terminal on Windows if Windows Terminal (wt.exe) isn't installed
        if clean_base in ("wt", "terminal"):
            powershell_path = shutil.which("powershell.exe") or "powershell.exe"
            subprocess.Popen([powershell_path], stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            return

        # 5. Fallback for Edge via protocol URI
        if clean_base in ("msedge", "edge"):
            try:
                os.startfile("microsoft-edge:")
                return
            except OSError:
                pass

        raise FileNotFoundError(f"The application executable is not installed: {executable}")

    # Non-Windows platforms
    if executable not in {"open", "xdg-open"} and shutil.which(executable) is None:
        raise FileNotFoundError(f"The application executable is not installed: {executable}")
    subprocess.Popen(
        command,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        close_fds=True,
    )


async def open_app(target: str, target_type: str = "auto") -> dict[str, Any]:
    """Open an allowlisted application or an HTTP(S) website without invoking a shell."""
    target = " ".join(target.split())[:500]
    if not target:
        raise ValueError("A non-empty application name or website is required")
    if target_type not in {"auto", "application", "website"}:
        raise ValueError("target_type must be auto, application, or website")

    url = _normalized_web_url(target)
    if target_type == "website" and not url:
        raise ValueError("Only valid HTTP or HTTPS websites can be opened")
    if url and target_type != "application":
        opened = await asyncio.to_thread(webbrowser.open, url, 2)
        if not opened:
            raise RuntimeError("The default browser did not accept the website request")
        return {"opened": True, "kind": "website", "target": url}

    name = _APP_ALIASES.get(target.casefold(), target.casefold())

    # If asking for generic browser
    if name == "browser":
        opened = await asyncio.to_thread(webbrowser.open, "https://www.google.com", 2)
        return {"opened": True, "kind": "application", "target": "browser", "platform": platform.system()}

    commands = _APP_COMMANDS.get(name)
    if not commands:
        supported = ", ".join(sorted(_APP_COMMANDS))
        raise ValueError(f"Application is not allowlisted. Supported applications: {supported}")
    system = platform.system()
    command = commands.get(system)
    if not command:
        raise RuntimeError(f"Application launch is not supported on {system}")

    await asyncio.to_thread(_launch_command, command)
    return {"opened": True, "kind": "application", "target": name, "platform": system}


def _request_text(url: str) -> str:
    request = urllib.request.Request(url, headers={"User-Agent": _USER_AGENT})
    try:
        with urllib.request.urlopen(request, timeout=_NETWORK_TIMEOUT_SECONDS) as response:
            content_type = response.headers.get_content_type()
            if content_type not in {"text/html", "text/plain"}:
                raise RuntimeError("Search provider returned an unsupported response")
            return response.read(1_500_000).decode(response.headers.get_content_charset() or "utf-8", "replace")
    except (urllib.error.URLError, TimeoutError) as error:
        raise RuntimeError("The search provider could not be reached") from error


def _request_json(url: str) -> dict[str, Any]:
    request = urllib.request.Request(url, headers={"User-Agent": _USER_AGENT})
    try:
        with urllib.request.urlopen(request, timeout=_NETWORK_TIMEOUT_SECONDS) as response:
            return json.loads(response.read(1_500_000))
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as error:
        raise RuntimeError("The weather provider returned no usable data") from error


class _DuckDuckGoParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.results: list[dict[str, str]] = []
        self._field: str | None = None
        self._href = ""
        self._parts: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        values = dict(attrs)
        classes = set((values.get("class") or "").split())
        if tag == "a" and "result__a" in classes:
            self._field = "title"
            self._href = values.get("href") or ""
            self._parts = []
        elif "result__snippet" in classes:
            self._field = "snippet"
            self._parts = []

    def handle_data(self, data: str) -> None:
        if self._field:
            self._parts.append(data)

    def handle_endtag(self, tag: str) -> None:
        if self._field == "title" and tag == "a":
            title = " ".join("".join(self._parts).split())
            parsed = urllib.parse.urlparse(self._href)
            redirect = urllib.parse.parse_qs(parsed.query).get("uddg", [])
            url = redirect[0] if redirect else self._href
            if title and _normalized_web_url(url):
                self.results.append({"title": title[:300], "url": url, "snippet": ""})
            self._field = None
        elif self._field == "snippet" and tag in {"a", "div", "span"}:
            snippet = " ".join("".join(self._parts).split())[:600]
            if self.results and snippet:
                self.results[-1]["snippet"] = snippet
            self._field = None


def _parse_search_results(document: str, limit: int) -> list[dict[str, str]]:
    parser = _DuckDuckGoParser()
    parser.feed(document)
    return parser.results[:limit]


async def web_search(
    query: str = "",
    mode: str = "search",
    items: list[str] | None = None,
    aspect: str = "general",
    max_results: int = 5,
) -> dict[str, Any]:
    """Return bounded DuckDuckGo results for a search or product-comparison query."""
    items = [" ".join(item.split())[:120] for item in (items or []) if item.strip()][:6]
    query = " ".join(query.split())[:500]
    aspect = " ".join(aspect.split())[:120] or "general"
    if mode not in {"search", "compare"}:
        raise ValueError("mode must be search or compare")
    if items:
        mode = "compare"
    if mode == "compare":
        if len(items) < 2:
            raise ValueError("Comparison mode requires at least two items")
        effective_query = f"{' vs '.join(items)} comparison {aspect}"
    else:
        if not query:
            raise ValueError("A search query is required")
        effective_query = query

    limit = max(1, min(8, int(max_results)))
    url = "https://html.duckduckgo.com/html/?" + urllib.parse.urlencode({"q": effective_query})
    document = await asyncio.to_thread(_request_text, url)
    results = _parse_search_results(document, limit)
    return {
        "query": effective_query,
        "mode": mode,
        "results": results,
        "result_count": len(results),
    }


async def weather_report(city: str) -> dict[str, Any]:
    """Fetch current city weather from wttr.in using a bounded HTTPS request."""
    city = " ".join(city.split())[:120]
    if not city:
        raise ValueError("A city is required")
    encoded_city = urllib.parse.quote(city, safe="")
    payload = await asyncio.to_thread(_request_json, f"https://wttr.in/{encoded_city}?format=j1")
    conditions = payload.get("current_condition") or []
    if not conditions:
        raise RuntimeError("No current weather was found for that city")
    current = conditions[0]
    nearest = (payload.get("nearest_area") or [{}])[0]

    def nested_value(container: dict[str, Any], key: str) -> str:
        values = container.get(key) or []
        return str(values[0].get("value", "")) if values else ""

    resolved_city = nested_value(nearest, "areaName") or city
    return {
        "city": resolved_city,
        "country": nested_value(nearest, "country"),
        "condition": nested_value(current, "weatherDesc"),
        "temperature_c": current.get("temp_C"),
        "feels_like_c": current.get("FeelsLikeC"),
        "humidity_percent": current.get("humidity"),
        "wind_kph": current.get("windspeedKmph"),
        "wind_direction": current.get("winddir16Point"),
        "precipitation_mm": current.get("precipMM"),
        "visibility_km": current.get("visibility"),
        "provider": "wttr.in",
    }


def register_system_tools(registry: ToolRegistry) -> None:
    registry.register(ToolDefinition(
        name="open_app",
        description=(
            "Open an allowlisted desktop application or an HTTP(S) website. Use only when the user "
            "explicitly asks to open it; never claim success unless the result says opened is true."
        ),
        parameters={
            "type": "object",
            "properties": {
                "target": {"type": "string", "description": "Application name or HTTP(S) website."},
                "target_type": {
                    "type": "string",
                    "enum": ["auto", "application", "website"],
                    "default": "auto",
                },
            },
            "required": ["target"],
            "additionalProperties": False,
        },
        handler=open_app,
    ))
    registry.register(ToolDefinition(
        name="web_search",
        description="Search the web or retrieve source links for a product comparison.",
        parameters={
            "type": "object",
            "properties": {
                "query": {"type": "string"},
                "mode": {"type": "string", "enum": ["search", "compare"], "default": "search"},
                "items": {"type": "array", "items": {"type": "string"}, "maxItems": 6},
                "aspect": {"type": "string", "default": "general"},
                "max_results": {"type": "integer", "minimum": 1, "maximum": 8, "default": 5},
            },
            "additionalProperties": False,
        },
        handler=web_search,
    ))
    registry.register(ToolDefinition(
        name="weather_report",
        description="Fetch the current weather conditions for a city.",
        parameters={
            "type": "object",
            "properties": {
                "city": {"type": "string", "description": "City and optional state or country."},
            },
            "required": ["city"],
            "additionalProperties": False,
        },
        handler=weather_report,
    ))
