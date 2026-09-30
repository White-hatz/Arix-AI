from __future__ import annotations

import logging
import os
import platform
import sys
from pathlib import Path
from typing import Any

from backend.app.core.config import settings
from backend.app.tools.registry import ToolDefinition, ToolRegistry

logger = logging.getLogger("backend.tools.environment")

# Module-level reference to the active tool registry for live reflection
_ACTIVE_REGISTRY: ToolRegistry | None = None


def set_active_registry(registry: ToolRegistry) -> None:
    global _ACTIVE_REGISTRY
    _ACTIVE_REGISTRY = registry


def get_core_project_path() -> Path:
    """Resolve Arix AI core installation/source root directory."""
    # From backend/app/tools -> up 3 levels to repo root
    return Path(__file__).resolve().parent.parent.parent.parent


def get_environment_info(scope: str = "all") -> dict[str, Any]:
    """Retrieve verified operating environment details, repository paths, registered projects, and storage locations."""
    scope_clean = (scope or "all").lower().strip()
    data_dir = settings.data_directory.resolve()
    core_path = get_core_project_path().resolve()

    info: dict[str, Any] = {"ok": True, "scope": scope_clean}

    # 1. Core System & Installation
    if scope_clean in ("all", "core", "system"):
        info["core_system"] = {
            "name": "Arix AI",
            "installation_path": str(core_path),
            "exists": core_path.exists(),
            "python_executable": sys.executable,
            "os": f"{platform.system()} {platform.release()} ({platform.version()})",
            "current_working_directory": str(Path.cwd().resolve()),
        }

    # 2. Registered Projects from Projects Hub
    if scope_clean in ("all", "projects"):
        from backend.app.api.projects import load_user_projects
        user_projs = load_user_projects()
        projects_list: list[dict[str, Any]] = [
            {
                "id": "core-arix-ai",
                "name": "Arix AI (Core System)",
                "path": str(core_path),
                "is_core": True,
                "exists": core_path.exists(),
            }
        ]
        norm_core = os.path.normpath(str(core_path)).casefold()
        for p in user_projs:
            p_path = p.get("path", "")
            if not p_path or os.path.normpath(p_path).casefold() == norm_core:
                continue
            path_obj = Path(p_path).resolve()
            projects_list.append({
                "id": p.get("id", str(path_obj.name)),
                "name": p.get("name", path_obj.name),
                "path": str(path_obj),
                "is_core": False,
                "exists": path_obj.exists(),
            })
        info["registered_projects"] = projects_list

    # 3. Storage & Working Data Locations
    if scope_clean in ("all", "storage", "data", "memory", "logs"):
        logs_file = data_dir / "logs" / "arix.log"
        memory_graph = data_dir / "memory_graph.json"
        tier1_mem = data_dir / "tier1_memory.txt"
        config_file = data_dir / "config.json"
        sessions_dir = data_dir / "sessions"
        projects_file = data_dir / "projects.json"
        cache_dir = data_dir / ".arix"

        info["storage_locations"] = {
            "data_directory": str(data_dir),
            "memory_graph_file": str(memory_graph),
            "memory_graph_exists": memory_graph.exists(),
            "tier1_memory_file": str(tier1_mem),
            "logs_file": str(logs_file),
            "logs_exist": logs_file.exists(),
            "settings_config_file": str(config_file),
            "sessions_directory": str(sessions_dir),
            "projects_registry_file": str(projects_file),
            "cache_directory": str(cache_dir),
        }

    # 4. Active Workspace & File Tree
    if scope_clean in ("all", "workspace"):
        active_path: Path | None = None
        try:
            from backend.app.tools.in_app_control_tools import _APP_STATE
            proj_str = _APP_STATE.get("active_project")
            if proj_str and Path(proj_str).exists():
                active_path = Path(proj_str).resolve()
        except Exception:
            pass

        if not active_path:
            active_path = core_path

        summary_tree: list[dict[str, Any]] = []
        try:
            ignored = {".git", ".venv", "venv", "node_modules", "__pycache__", "dist", "build"}
            for child in sorted(active_path.iterdir(), key=lambda p: (not p.is_dir(), p.name.lower())):
                if child.name in ignored:
                    continue
                summary_tree.append({
                    "name": child.name,
                    "is_directory": child.is_dir(),
                    "size_bytes": child.stat().st_size if child.is_file() else None,
                })
        except Exception as scan_err:
            logger.warning("Could not read directory tree for %s: %s", active_path, scan_err)

        info["active_workspace"] = {
            "path": str(active_path),
            "exists": active_path.exists(),
            "top_level_items": summary_tree[:50],
        }

    # 5. System Locations & Storage Drives
    if scope_clean in ("all", "core", "system", "storage", "locations", "paths"):
        from backend.app.tools.safety import get_system_drives, get_well_known_system_paths
        well_known = get_well_known_system_paths()
        home = Path.home().resolve()
        info["system_locations"] = {
            "user_home": str(home),
            "downloads": str(well_known.get("downloads", home / "Downloads")),
            "desktop": str(well_known.get("desktop", home / "Desktop")),
            "documents": str(well_known.get("documents", home / "Documents")),
            "pictures": str(well_known.get("pictures", home / "Pictures")),
            "videos": str(well_known.get("videos", home / "Videos")),
            "music": str(well_known.get("music", home / "Music")),
            "appdata": str(well_known.get("appdata", home / "AppData")),
        }
        info["available_drives"] = get_system_drives()

    return info


def list_available_tools(context: str = "") -> dict[str, Any]:
    """Retrieve the complete, live-sourced list of tools currently registered and available in this session."""
    tools_list: list[dict[str, Any]] = []

    if _ACTIVE_REGISTRY:
        tools_list = _ACTIVE_REGISTRY.list_tools()

    if context.strip().lower() == "home":
        # Filter out workspace/coder only tools in home context
        tools_list = [t for t in tools_list if t.get("name") not in ("run_command", "execute_command", "code_symbol_search")]

    # Organize tools into logical functional categories
    categorized: dict[str, list[dict[str, Any]]] = {
        "Environment & System Awareness": [],
        "Desktop & Screen Automation": [],
        "Voice, Mute & Thinking Modes": [],
        "Knowledge Graph & Memory": [],
        "File & Workspace Operations": [],
        "Integration & MCP Tools": [],
        "General": [],
    }

    for tool in tools_list:
        name = tool.get("name", "")
        if name in ("get_environment_info", "list_available_tools", "open_application", "open_app", "web_search", "weather_info"):
            categorized["Environment & System Awareness"].append(tool)
        elif name in ("screen_process", "computer_control", "reminder", "smart_home_control", "in_app_action", "in_app_navigate"):
            categorized["Desktop & Screen Automation"].append(tool)
        elif name in ("switch_thinking_mode", "set_mute_state", "mute_ai"):
            categorized["Voice, Mute & Thinking Modes"].append(tool)
        elif name in ("save_memory", "query_memory", "sequentialthinking"):
            categorized["Knowledge Graph & Memory"].append(tool)
        elif name in ("file_controller", "read_file_slices", "search_files", "edit_file", "run_command", "code_symbol_search", "run_tests"):
            categorized["File & Workspace Operations"].append(tool)
        elif name.startswith("mcp_") or name in ("fetch_youtube_transcript",):
            categorized["Integration & MCP Tools"].append(tool)
        else:
            categorized["General"].append(tool)

    # Filter out empty categories
    active_categories = {k: v for k, v in categorized.items() if v}

    return {
        "ok": True,
        "total_tools": len(tools_list),
        "context": context or "current_session",
        "categories": active_categories,
        "tools": tools_list,
        "all_tool_names": [t["name"] for t in tools_list],
    }


def register_environment_tools(registry: ToolRegistry) -> None:
    set_active_registry(registry)

    registry.register(ToolDefinition(
        name="get_environment_info",
        description=(
            "Retrieve verified environmental self-awareness data: Arix AI core installation path, "
            "registered projects in Projects Hub, memory/data/logs storage paths, and active workspace file tree. "
            "Proactively invoke this tool whenever you need to know where files, projects, memories, logs, or your own code are located."
        ),
        parameters={
            "type": "object",
            "properties": {
                "scope": {
                    "type": "string",
                    "enum": ["all", "core", "projects", "storage", "workspace"],
                    "description": "Information scope to retrieve. Defaults to 'all'.",
                }
            },
            "additionalProperties": False,
        },
        handler=get_environment_info,
    ))

    registry.register(ToolDefinition(
        name="list_available_tools",
        description=(
            "Retrieve the complete, accurate, live-sourced list of every tool currently registered and available "
            "in the current runtime context. Use this whenever the user asks what tools you have or what actions you can perform."
        ),
        parameters={
            "type": "object",
            "properties": {
                "context": {
                    "type": "string",
                    "description": "Optional context descriptor (e.g. 'home', 'workspace').",
                }
            },
            "additionalProperties": False,
        },
        handler=list_available_tools,
    ))
