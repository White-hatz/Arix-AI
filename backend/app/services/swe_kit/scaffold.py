"""Scaffold management for SWE-Kit agent in Arix AI."""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

from backend.app.services.swe_kit.swe_agent.agent import SWEAgent

logger = logging.getLogger("backend.services.swe_kit.scaffold")


def ensure_swe_agent_scaffold() -> dict[str, Any]:
    """Ensures the SWE agent scaffold files exist and are ready for execution."""
    scaffold_dir = Path(__file__).parent / "swe_agent"
    agent_file = scaffold_dir / "agent.py"
    prompts_file = scaffold_dir / "prompts.py"

    ready = agent_file.exists() and prompts_file.exists()
    return {
        "ready": ready,
        "scaffold_path": str(scaffold_dir),
        "files": ["agent.py", "prompts.py", "__init__.py"] if ready else [],
    }


def create_swe_agent(workspace_root: str, api_key: str = "", model_name: str = "") -> SWEAgent:
    """Factory function returning a configured SWEAgent instance."""
    return SWEAgent(workspace_root=workspace_root, api_key=api_key, model_name=model_name)
