from __future__ import annotations

import asyncio
import contextlib
import ctypes
import json
import mimetypes
import os
import shutil
import threading
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any

from backend.app.tools.registry import ToolDefinition, ToolRegistry
from backend.app.tools.safety import (
    MAX_TEXT_BYTES,
    bounded_number,
    bounded_text,
    require_confirmation,
    require_optional_dependency,
    require_platform,
    resolve_user_path,
)

_MAX_RESULTS = 200
_MAX_VISITED = 5_000
_BROWSER_TIMEOUT_MS = 15_000
_IMAGE_LIMIT = 10_000_000


def _bounded_walk(root: Path, query: str = "") -> list[Path]:
    found: list[Path] = []
    visited = 0
    needle = query.casefold()
    for current, directories, files in os.walk(root, followlinks=False):
        directories[:] = [name for name in directories if not (Path(current) / name).is_symlink()]
        for name in [*directories, *files]:
            visited += 1
            if visited > _MAX_VISITED:
                return found
            item = Path(current) / name
            if (not needle or needle in name.casefold()) and not item.is_symlink():
                found.append(item)
                if len(found) >= _MAX_RESULTS:
                    return found
    return found


def _validate_directory_copy(source: Path) -> None:
    files = 0
    total_bytes = 0
    for current, directories, names in os.walk(source, followlinks=False):
        directories[:] = [name for name in directories if not (Path(current) / name).is_symlink()]
        for name in names:
            item = Path(current) / name
            if item.is_symlink():
                raise PermissionError("Directory copies cannot include symbolic links")
            files += 1
            total_bytes += item.stat().st_size
            if files > _MAX_VISITED or total_bytes > 1_000_000_000:
                raise ValueError("Directory copy exceeds the 5,000-file or 1 GB safety limit")


def _file_controller_sync(
    action: str,
    path: str,
    destination: str,
    content: str,
    query: str,
    confirmed: bool,
    overwrite: bool,
) -> dict[str, Any]:
    source = resolve_user_path(path, must_exist=action not in {"create_file", "create_folder"})
    target = resolve_user_path(destination) if destination else None

    if action == "list":
        if not source.is_dir():
            raise ValueError("path must be a directory")
        items = []
        for item in sorted(source.iterdir(), key=lambda value: (not value.is_dir(), value.name.casefold()))[:_MAX_RESULTS]:
            if item.is_symlink():
                continue
            stat = item.stat()
            items.append({"name": item.name, "path": str(item), "kind": "directory" if item.is_dir() else "file", "size": stat.st_size})
        return {"action": action, "path": str(source), "items": items, "count": len(items)}
    if action == "create_folder":
        source.mkdir(parents=True, exist_ok=False)
        return {"action": action, "created": True, "path": str(source)}
    if action == "create_file":
        if source.exists():
            require_confirmation("overwrite the existing file", confirmed and overwrite)
        source.parent.mkdir(parents=True, exist_ok=True)
        data = content.encode("utf-8")
        if len(data) > MAX_TEXT_BYTES:
            raise ValueError("content exceeds the 1 MB text limit")
        source.write_bytes(data)
        return {"action": action, "created": True, "path": str(source), "bytes_written": len(data)}
    if action == "read":
        if not source.is_file():
            raise ValueError("path must be a file")
        raw = source.read_bytes()
        if len(raw) > MAX_TEXT_BYTES:
            raise ValueError("file exceeds the 1 MB text read limit")
        return {"action": action, "path": str(source), "content": raw.decode("utf-8", "replace"), "bytes": len(raw)}
    if action in {"write", "append"}:
        if not source.is_file():
            raise ValueError("path must be an existing file")
        data = content.encode("utf-8")
        if len(data) > MAX_TEXT_BYTES:
            raise ValueError("content exceeds the 1 MB text limit")
        if action == "write":
            require_confirmation("replace the file contents", confirmed)
            source.write_bytes(data)
        else:
            if source.stat().st_size + len(data) > MAX_TEXT_BYTES:
                raise ValueError("resulting file would exceed the 1 MB text limit")
            with source.open("ab") as handle:
                handle.write(data)
        return {"action": action, "path": str(source), "bytes_written": len(data)}
    if action in {"copy", "move", "rename"}:
        if target is None:
            raise ValueError("destination is required")
        if target.exists():
            require_confirmation("overwrite the destination", confirmed and overwrite)
            if target.is_dir():
                shutil.rmtree(target)
            else:
                target.unlink()
        target.parent.mkdir(parents=True, exist_ok=True)
        if action == "copy":
            if source.is_dir():
                _validate_directory_copy(source)
                shutil.copytree(source, target)
            else:
                shutil.copy2(source, target)
        else:
            require_confirmation(f"{action} this item", confirmed)
            shutil.move(str(source), str(target))
        return {"action": action, "completed": True, "source": str(source), "destination": str(target)}
    if action == "delete":
        require_confirmation("move this item to the Recycle Bin", confirmed)
        send2trash = require_optional_dependency("send2trash", "pip install send2trash")
        send2trash.send2trash(str(source))
        return {"action": action, "recycled": True, "path": str(source)}
    if action == "find":
        if not source.is_dir():
            raise ValueError("path must be a directory")
        needle = bounded_text(query, limit=200, field="query")
        matches = _bounded_walk(source, needle)
        return {"action": action, "path": str(source), "matches": [str(item) for item in matches], "count": len(matches), "truncated": len(matches) >= _MAX_RESULTS}
    if action == "info":
        stat = source.stat()
        return {
            "action": action, "path": str(source), "kind": "directory" if source.is_dir() else "file",
            "size": stat.st_size, "modified": stat.st_mtime, "mime_type": mimetypes.guess_type(source.name)[0],
        }
    if action == "disk_usage":
        usage = shutil.disk_usage(source if source.is_dir() else source.parent)
        return {"action": action, "path": str(source), "total": usage.total, "used": usage.used, "free": usage.free}
    raise ValueError("Unsupported file controller action")


async def file_controller(
    action: str,
    path: str,
    destination: str = "",
    content: str = "",
    query: str = "",
    confirmed: bool = False,
    overwrite: bool = False,
) -> dict[str, Any]:
    return await asyncio.to_thread(
        _file_controller_sync, action, path, destination, content, query, confirmed, overwrite
    )


class _BrowserRuntime:
    def __init__(self) -> None:
        self.executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="arix-browser")
        self._playwright: Any = None
        self._browser: Any = None
        self._context: Any = None
        self._page: Any = None
        self._lock = threading.Lock()

    def _ensure(self) -> Any:
        try:
            if self._browser and self._browser.is_connected() and self._page and not self._page.is_closed():
                return self._page
        except Exception:
            pass

        try:
            if self._browser:
                with contextlib.suppress(Exception):
                    self._browser.close()
            if self._playwright:
                with contextlib.suppress(Exception):
                    self._playwright.stop()
        except Exception:
            pass

        sync_api = require_optional_dependency("playwright.sync_api", "pip install playwright && playwright install chromium")
        self._playwright = sync_api.sync_playwright().start()
        self._browser = self._playwright.chromium.launch(headless=False)
        self._context = self._browser.new_context(accept_downloads=False)
        self._page = self._context.new_page()
        self._page.set_default_timeout(_BROWSER_TIMEOUT_MS)
        self._page.set_default_navigation_timeout(_BROWSER_TIMEOUT_MS)
        return self._page

    def execute(self, action: str, url: str, query: str, selector: str, text: str, key: str, amount: int, tab_index: int, confirmed: bool, consequential: bool) -> dict[str, Any]:
        page = self._ensure()
        if action in {"navigate", "open_tab", "open", "launch"}:
            raw_target = (url or text or query).strip() or "https://www.google.com"
            target = _safe_browser_url(raw_target, allow_local=True)
            if action in {"open_tab", "open", "launch"} and self._page and not self._page.is_closed():
                page = self._context.new_page()
                page.set_default_timeout(_BROWSER_TIMEOUT_MS)
                self._page = page
            try:
                page.goto(target, wait_until="domcontentloaded")
            except Exception as nav_err:
                err_str = str(nav_err)
                if "ERR_CONNECTION_REFUSED" in err_str or "net::ERR_" in err_str:
                    raise RuntimeError(
                        f"Cannot connect to '{target}': Connection refused (ERR_CONNECTION_REFUSED). "
                        f"Please ensure your web development server is running and accessible."
                    ) from nav_err
                raise
        elif action == "search":
            search_val = (query or text or url).strip() or "google"
            search = bounded_text(search_val, limit=500, field="query")
            page.goto("https://www.google.com/search?" + urllib.parse.urlencode({"q": search}), wait_until="domcontentloaded")
        elif action in {"click", "type"}:
            css = bounded_text(selector, limit=500, field="selector")
            if consequential:
                require_confirmation("perform this consequential browser action", confirmed)
            if action == "click":
                page.locator(css).first.click()
            else:
                raw_val = text or query
                value = bounded_text(raw_val, limit=10_000, field="text")
                page.locator(css).first.fill(value)
                return {"action": action, "completed": True, "characters_typed": len(value), "url": page.url}
        elif action == "get_text":
            content = page.locator("body").inner_text()[:50_000]
            return {"action": action, "url": page.url, "title": page.title()[:500], "text": content}
        elif action == "scroll":
            delta = int(bounded_number(amount, minimum=-10_000, maximum=10_000, field="amount"))
            page.mouse.wheel(0, delta)
        elif action == "press":
            selected = bounded_text(key, limit=30, field="key")
            if selected not in {"Enter", "Escape", "Tab", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "PageUp", "PageDown", "Home", "End"}:
                raise ValueError("Unsupported browser key")
            page.keyboard.press(selected)
        elif action == "switch_tab":
            pages = self._context.pages
            index = int(bounded_number(tab_index, minimum=0, maximum=max(0, len(pages) - 1), field="tab_index"))
            self._page = pages[index]
            page = self._page
            page.bring_to_front()
        elif action == "list_tabs":
            tabs = [{"index": index, "url": item.url, "title": item.title()[:300]} for index, item in enumerate(self._context.pages[:30])]
            return {"action": action, "tabs": tabs, "count": len(tabs)}
        elif action == "back":
            page.go_back(wait_until="domcontentloaded")
        elif action == "forward":
            page.go_forward(wait_until="domcontentloaded")
        elif action == "reload":
            page.reload(wait_until="domcontentloaded")
        elif action == "close_tab":
            page.close()
            pages = self._context.pages
            self._page = pages[-1] if pages else self._context.new_page()
            page = self._page
        else:
            raise ValueError("Unsupported browser control action")
        return {"action": action, "completed": True, "url": page.url, "title": page.title()[:500]}

    def close_sync(self) -> None:
        for item in (self._context, self._browser, self._playwright):
            if item:
                try:
                    item.close() if hasattr(item, "close") else item.stop()
                except Exception:
                    pass
        self._page = self._context = self._browser = self._playwright = None

    async def close(self) -> None:
        await asyncio.get_running_loop().run_in_executor(self.executor, self.close_sync)
        self.executor.shutdown(wait=False, cancel_futures=True)
        # Lifespan tests may start the same app object again; keep the lazy runtime reusable.
        self.executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="arix-browser")


_BROWSER = _BrowserRuntime()


def _safe_browser_url(url: str, allow_local: bool = False) -> str:
    raw = str(url or "").strip()
    if not raw:
        return "http://localhost:5173" if allow_local else "https://example.com"
    value = bounded_text(raw, limit=2_000, field="url")
    trimmed = value.strip()
    if "://" not in trimmed:
        if trimmed.startswith("localhost") or trimmed.startswith("127.0.0.1") or trimmed.startswith("0.0.0.0"):
            trimmed = "http://" + trimmed
        elif "." in trimmed and " " not in trimmed:
            trimmed = "https://" + trimmed
        else:
            trimmed = "http://" + trimmed
    parsed = urllib.parse.urlparse(trimmed)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise ValueError("Only HTTP and HTTPS browser URLs are allowed")
    host = (parsed.hostname or "").casefold()
    if host in {"169.254.169.254", "metadata.google.internal"}:
        raise ValueError("Cloud metadata destinations are blocked")
    if not allow_local:
        if host in {"localhost", "127.0.0.1", "::1"} or host.endswith(".local"):
            raise ValueError("Local and internal browser destinations are blocked")
    return trimmed


async def browser_control(
    action: str,
    url: str = "",
    query: str = "",
    selector: str = "",
    text: str = "",
    key: str = "",
    amount: int = 0,
    tab_index: int = 0,
    confirmed: bool = False,
    consequential: bool = False,
) -> dict[str, Any]:
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(
        _BROWSER.executor,
        _BROWSER.execute,
        action, url, query, selector, text, key, amount, tab_index, confirmed, consequential,
    )


async def close_browser_runtime() -> None:
    await _BROWSER.close()


def _download_wallpaper(url: str) -> Path:
    target_url = _safe_browser_url(url)
    request = urllib.request.Request(target_url, headers={"User-Agent": "Arix-AI/0.2"})
    with urllib.request.urlopen(request, timeout=10) as response:
        content_type = response.headers.get_content_type()
        if content_type not in {"image/jpeg", "image/png", "image/bmp"}:
            raise ValueError("Wallpaper URL must return JPEG, PNG, or BMP image data")
        data = response.read(_IMAGE_LIMIT + 1)
    if len(data) > _IMAGE_LIMIT:
        raise ValueError("Wallpaper image exceeds the 10 MB limit")
    extension = {"image/jpeg": ".jpg", "image/png": ".png", "image/bmp": ".bmp"}[content_type]
    target = Path.home() / "Pictures" / "Arix" / f"wallpaper{extension}"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(data)
    return target


def _organize_desktop(confirmed: bool) -> dict[str, Any]:
    require_confirmation("organize Desktop files into category folders", confirmed)
    desktop = resolve_user_path(str(Path.home() / "Desktop"), must_exist=True)
    categories = {
        "Images": {".png", ".jpg", ".jpeg", ".gif", ".bmp", ".webp"},
        "Documents": {".txt", ".pdf", ".doc", ".docx", ".rtf", ".odt"},
        "Spreadsheets": {".csv", ".xls", ".xlsx"},
        "Presentations": {".ppt", ".pptx"},
        "Archives": {".zip", ".7z", ".rar", ".tar", ".gz"},
    }
    moved = []
    for item in list(desktop.iterdir())[:500]:
        if not item.is_file() or item.is_symlink() or item.suffix.casefold() == ".lnk":
            continue
        category = next((name for name, suffixes in categories.items() if item.suffix.casefold() in suffixes), "Other")
        destination = desktop / category / item.name
        if destination.exists():
            continue
        destination.parent.mkdir(exist_ok=True)
        shutil.move(str(item), str(destination))
        moved.append({"from": str(item), "to": str(destination)})
    return {"action": "organize", "completed": True, "moved": moved, "count": len(moved)}


def _desktop_control_sync(action: str, path: str, url: str, confirmed: bool) -> dict[str, Any]:
    desktop = Path.home() / "Desktop"
    if action == "list":
        target = resolve_user_path(str(desktop), must_exist=True)
        items = [item.name for item in sorted(target.iterdir(), key=lambda value: value.name.casefold())[:200] if not item.is_symlink()]
        return {"action": action, "items": items, "count": len(items)}
    if action == "stats":
        target = resolve_user_path(str(desktop), must_exist=True)
        items = _bounded_walk(target)
        return {"action": action, "files": sum(item.is_file() for item in items), "directories": sum(item.is_dir() for item in items), "bytes": sum(item.stat().st_size for item in items if item.is_file())}
    if action == "organize":
        return _organize_desktop(confirmed)
    if action in {"set_wallpaper", "set_wallpaper_url"}:
        require_platform("Windows")
        target = resolve_user_path(path, must_exist=True) if action == "set_wallpaper" else _download_wallpaper(url)
        if target.suffix.casefold() not in {".jpg", ".jpeg", ".png", ".bmp"}:
            raise ValueError("Wallpaper must be a JPEG, PNG, or BMP image")
        changed = ctypes.windll.user32.SystemParametersInfoW(20, 0, str(target), 3)
        if not changed:
            raise RuntimeError("Windows did not accept the wallpaper change")
        return {"action": action, "completed": True, "path": str(target)}
    if action == "current_wallpaper":
        require_platform("Windows")
        buffer = ctypes.create_unicode_buffer(32_768)
        if not ctypes.windll.user32.SystemParametersInfoW(0x0073, len(buffer), buffer, 0):
            raise RuntimeError("Could not read the current wallpaper")
        return {"action": action, "path": buffer.value}
    raise ValueError("Unsupported desktop control action")


async def desktop_control(action: str, path: str = "", url: str = "", confirmed: bool = False) -> dict[str, Any]:
    return await asyncio.to_thread(_desktop_control_sync, action, path, url, confirmed)


def register_workspace_tools(registry: ToolRegistry) -> None:
    registry.register(ToolDefinition(
        name="file_controller",
        description="Safely inspect or modify files within the current user's profile. Destructive and overwrite actions require confirmation.",
        parameters={"type": "object", "properties": {
            "action": {"type": "string", "enum": ["list", "create_file", "create_folder", "read", "write", "append", "copy", "move", "rename", "delete", "find", "info", "disk_usage"]},
            "path": {"type": "string"}, "destination": {"type": "string"}, "content": {"type": "string", "maxLength": MAX_TEXT_BYTES},
            "query": {"type": "string", "maxLength": 200}, "confirmed": {"type": "boolean", "default": False}, "overwrite": {"type": "boolean", "default": False},
        }, "required": ["action", "path"], "additionalProperties": False},
        handler=file_controller,
    ))
    registry.register(ToolDefinition(
        name="browser_control",
        description="Control an isolated Playwright browser. Set consequential=true and obtain confirmation before submissions, purchases, messages, uploads, or authentication.",
        parameters={"type": "object", "properties": {
            "action": {"type": "string", "enum": ["navigate", "search", "click", "type", "get_text", "scroll", "press", "open_tab", "switch_tab", "list_tabs", "back", "forward", "reload", "close_tab", "open", "launch"]},
            "url": {"type": "string"}, "query": {"type": "string"}, "selector": {"type": "string"}, "text": {"type": "string", "maxLength": 10000},
            "key": {"type": "string"}, "amount": {"type": "integer", "minimum": -10000, "maximum": 10000}, "tab_index": {"type": "integer", "minimum": 0},
            "confirmed": {"type": "boolean", "default": False}, "consequential": {"type": "boolean", "default": False},
        }, "required": ["action"], "additionalProperties": False},
        handler=browser_control,
    ))
    registry.register(ToolDefinition(
        name="desktop_control",
        description="List or organize Desktop items and manage Windows wallpaper. Organization requires confirmation.",
        parameters={"type": "object", "properties": {
            "action": {"type": "string", "enum": ["list", "stats", "organize", "set_wallpaper", "set_wallpaper_url", "current_wallpaper"]},
            "path": {"type": "string"}, "url": {"type": "string"}, "confirmed": {"type": "boolean", "default": False},
        }, "required": ["action"], "additionalProperties": False},
        handler=desktop_control,
    ))
