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
from pathlib import Path
from typing import Any

from backend.app.core.config import settings
from backend.app.tools.registry import ToolDefinition, ToolRegistry
from backend.app.tools.safety import resolve_user_path

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


APP_CACHE_FILE = settings.data_directory / "app_cache.json"
_SESSION_GRANTED_APPS: set[str] = set()


def load_app_cache() -> dict[str, str]:
    if not APP_CACHE_FILE.exists():
        return {}
    try:
        data = json.loads(APP_CACHE_FILE.read_text(encoding="utf-8"))
        if isinstance(data, dict):
            return data
    except Exception:
        pass
    return {}


def save_app_cache(cache: dict[str, str]) -> None:
    try:
        APP_CACHE_FILE.parent.mkdir(parents=True, exist_ok=True)
        APP_CACHE_FILE.write_text(json.dumps(cache, indent=2), encoding="utf-8")
    except Exception:
        pass


def remember_app_path(app_name: str, exe_path: str) -> None:
    cache = load_app_cache()
    cache[app_name.strip().casefold()] = str(exe_path)
    save_app_cache(cache)


def resolve_installed_app(app_name: str) -> tuple[str | None, str | None]:
    query = app_name.strip().casefold()
    if not query:
        return None, None

    # 1. Direct path check
    direct = Path(app_name)
    if direct.is_file() and (direct.suffix.lower() in (".exe", ".bat", ".cmd") or os.access(direct, os.X_OK)):
        return str(direct.resolve()), "direct_path"

    # 2. Check cached app mappings
    cache = load_app_cache()
    if query in cache and Path(cache[query]).exists():
        return cache[query], "app_cache"

    # 3. Check system PATH via shutil.which
    found = shutil.which(query) or shutil.which(f"{query}.exe")
    if found:
        remember_app_path(query, found)
        return found, "system_path"

    # 4. Check known common aliases
    aliases: dict[str, list[str]] = {
        "antigravity": ["antigravity", "antigravity ide", "agy"],
        "antigravity ide": ["antigravity ide", "antigravity"],
        "vscode": ["code", "visual studio code"],
        "vs code": ["code", "visual studio code"],
        "code": ["code", "visual studio code"],
        "terminal": ["wt", "powershell", "cmd"],
        "cmd": ["cmd.exe"],
        "powershell": ["powershell.exe", "pwsh"],
        "notepad": ["notepad.exe"],
        "calculator": ["calc.exe"],
        "calc": ["calc.exe"],
        "explorer": ["explorer.exe"],
        "paint": ["mspaint.exe"],
        "chrome": ["chrome.exe"],
        "edge": ["msedge.exe"],
    }
    for alias_target in aliases.get(query, []):
        cand = shutil.which(alias_target) or shutil.which(f"{alias_target}.exe")
        if cand:
            remember_app_path(query, cand)
            return cand, "alias_path"

    if platform.system() == "Windows":
        # 5. Search Windows Start Menu shortcuts (.lnk files)
        start_menus = [
            Path(os.environ.get("APPDATA", "")) / "Microsoft/Windows/Start Menu/Programs",
            Path(os.environ.get("ProgramData", "")) / "Microsoft/Windows/Start Menu/Programs",
        ]
        for sm in start_menus:
            if not sm.exists():
                continue
            for lnk in sm.rglob("*.lnk"):
                stem = lnk.stem.casefold()
                if query == stem or query in stem or stem in query:
                    try:
                        ps = f"(New-Object -ComObject WScript.Shell).CreateShortcut('{lnk}').TargetPath"
                        res = subprocess.run(
                            ["powershell", "-NoProfile", "-Command", ps],
                            capture_output=True,
                            text=True,
                            timeout=5,
                            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
                        )
                        target = res.stdout.strip()
                        if target and Path(target).is_file() and not any(skip in Path(target).name.lower() for skip in ["uninstall", "unins", "helper"]):
                            remember_app_path(query, target)
                            return target, "start_menu_shortcut"
                    except Exception:
                        pass

        # 6. Search Local Programs (%LOCALAPPDATA%\Programs)
        local_progs = Path(os.environ.get("LOCALAPPDATA", "")) / "Programs"
        if local_progs.exists():
            for p in local_progs.iterdir():
                if query in p.name.casefold() or p.name.casefold() in query:
                    for exe in p.glob("*.exe"):
                        if not any(skip in exe.name.lower() for skip in ["uninstall", "unins", "update", "crash"]):
                            target = str(exe.resolve())
                            remember_app_path(query, target)
                            return target, "local_programs"

        # 7. Search Program Files and Program Files (x86)
        for pf in [os.environ.get("ProgramFiles"), os.environ.get("ProgramFiles(x86)")]:
            if not pf:
                continue
            pf_dir = Path(pf)
            if pf_dir.exists():
                for p in pf_dir.iterdir():
                    if query in p.name.casefold() or p.name.casefold() in query:
                        for exe in p.glob("*.exe"):
                            if not any(skip in exe.name.lower() for skip in ["uninstall", "unins", "update", "helper"]):
                                target = str(exe.resolve())
                                remember_app_path(query, target)
                                return target, "program_files"

        # 8. Check Windows Registry App Paths
        try:
            import winreg
            for root_key in (winreg.HKEY_CURRENT_USER, winreg.HKEY_LOCAL_MACHINE):
                try:
                    with winreg.OpenKey(root_key, r"Software\Microsoft\Windows\CurrentVersion\App Paths") as app_paths:
                        num_keys, _, _ = winreg.QueryInfoKey(app_paths)
                        for i in range(num_keys):
                            sub_name = winreg.EnumKey(app_paths, i)
                            if query in sub_name.lower():
                                with winreg.OpenKey(app_paths, sub_name) as sub_key:
                                    val, _ = winreg.QueryValueEx(sub_key, "")
                                    if val and Path(val).is_file():
                                        remember_app_path(query, val)
                                        return val, "registry_app_paths"
                except Exception:
                    pass
        except Exception:
            pass

    return None, None


async def open_application(
    app_name: str,
    target_path: str = "",
    args: list[str] | None = None,
    confirmed: bool = False,
) -> dict[str, Any]:
    """Launch ANY installed application on the machine with optional target folder/file arguments and dynamic permission check."""
    clean_name = " ".join(app_name.split())[:300]
    if not clean_name:
        raise ValueError("app_name is required")

    resolved_exe, source = resolve_installed_app(clean_name)
    if not resolved_exe:
        return {
            "ok": False,
            "status": "app_not_found",
            "message": (
                f"Could not find an installed application matching '{clean_name}'. "
                f"If you know the exact path or executable name, you can specify it, "
                f"and I will cache and remember it."
            ),
        }

    # Dynamic permission check
    app_norm = clean_name.casefold()
    is_app_allowed = (
        app_norm in _SESSION_GRANTED_APPS
        or resolved_exe.casefold() in _SESSION_GRANTED_APPS
    )

    # Check config.json policy for appLaunching
    try:
        cfg_file = settings.data_directory / "config.json"
        if cfg_file.exists():
            cfg = json.loads(cfg_file.read_text(encoding="utf-8"))
            pol = cfg.get("permissionPolicies", {}).get("appLaunching") or cfg.get("appLaunchingPolicy")
            if pol == "always_allow":
                is_app_allowed = True
            for g in cfg.get("grantedPermissions", []):
                if g.get("category") == "app_launching" and (g.get("target", "").casefold() in (app_norm, resolved_exe.casefold())):
                    is_app_allowed = True
    except Exception:
        pass

    if not is_app_allowed and not confirmed:
        target_clause = f" with target '{target_path}'" if target_path else ""
        return {
            "ok": False,
            "requires_permission": True,
            "status": "permission_required",
            "boundary_type": "app_launch",
            "target": clean_name,
            "executable": resolved_exe,
            "message": (
                f"Permission required: I found '{clean_name}' at '{resolved_exe}'. "
                f"Please ask the user: 'I found {clean_name}. May I launch it{target_clause}?' "
                "Once approved, re-invoke open_application with confirmed=True."
            ),
        }

    # Grant for session
    _SESSION_GRANTED_APPS.add(app_norm)
    _SESSION_GRANTED_APPS.add(resolved_exe.casefold())

    # Build command arguments
    cmd = [resolved_exe]
    if args:
        cmd.extend(args)
    if target_path:
        # Resolve target path if provided
        res_target = resolve_user_path(target_path, must_exist=True, confirmed=confirmed)
        cmd.append(str(res_target))

    # Launch detached
    try:
        creation_flags = 0
        if platform.system() == "Windows":
            creation_flags = getattr(subprocess, "DETACHED_PROCESS", 0x00000008) | getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0x00000200)

        proc = subprocess.Popen(
            cmd,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            close_fds=True,
            creationflags=creation_flags,
        )
        return {
            "ok": True,
            "opened": True,
            "app_name": clean_name,
            "executable": resolved_exe,
            "resolution_source": source,
            "target_path": str(target_path) if target_path else None,
            "pid": proc.pid,
            "message": f"Successfully launched {clean_name}" + (f" with target '{target_path}'" if target_path else ""),
        }
    except Exception as launch_err:
        return {
            "ok": False,
            "status": "launch_error",
            "error": str(launch_err),
            "message": f"Failed to launch {clean_name}: {launch_err}",
        }


async def open_app(target: str, target_type: str = "auto") -> dict[str, Any]:
    """Open an application or an HTTP(S) website without invoking a shell."""
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

    # Use generic open_application with auto-confirmation for backward compatibility
    res = await open_application(app_name=target, confirmed=True)
    if res.get("opened") or res.get("ok"):
        return {"ok": True, "opened": True, "kind": "application", "target": target, **res}
    return res


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
        name="open_application",
        description=(
            "Open ANY desktop application installed on the operating system (e.g. Antigravity IDE, VS Code, "
            "Chrome, Notepad, Terminal) with optional arguments and target folder/file paths. "
            "Dynamically discovers applications from Windows Start Menu, Registry, Program Files, and PATH, "
            "caching learned paths. Use target_path to open a folder or file in the application."
        ),
        parameters={
            "type": "object",
            "properties": {
                "app_name": {"type": "string", "description": "Application name (e.g. 'Antigravity', 'VS Code', 'Notepad') or direct executable path."},
                "target_path": {"type": "string", "description": "Optional folder or file path to open within the application (e.g. workspace path for an IDE)."},
                "args": {"type": "array", "items": {"type": "string"}, "description": "Optional CLI arguments."},
                "confirmed": {"type": "boolean", "default": False, "description": "Explicit permission confirmation to launch."},
            },
            "required": ["app_name"],
            "additionalProperties": False,
        },
        handler=open_application,
    ))
    registry.register(ToolDefinition(
        name="open_app",
        description=(
            "Open an application or an HTTP(S) website. Supports all applications dynamically."
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
