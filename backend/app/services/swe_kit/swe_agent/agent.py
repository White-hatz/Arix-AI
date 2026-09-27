"""SWE Agent implementation binding SWE-Kit tools with Gemini 3.8 Extended Thinking."""

from __future__ import annotations

import logging
import os
from typing import Any

from google import genai
from google.genai import types

from backend.app.api.settings import load_backend_config
from backend.app.services.swe_kit.agent_runner import run_swe_command
from backend.app.services.swe_kit.swe_agent.prompts import (
    SWE_AGENT_SYSTEM_PROMPT,
    SWE_TASK_TEMPLATE,
)

logger = logging.getLogger("backend.services.swe_kit.swe_agent")

# Ensure telemetry is disabled for any imported SWE-Kit modules
os.environ["COMPOSIO_DISABLE_TELEMETRY"] = "true"


class SWEAgent:
    """SWE-Kit scaffolded agent bound to Gemini 3.8 Extended Thinking."""

    def __init__(
        self,
        workspace_root: str,
        api_key: str = "",
        model_name: str = "gemini-3.8-flash",
    ) -> None:
        self.workspace_root = workspace_root
        config = load_backend_config()
        self.api_key = api_key or config.get("apiKey") or os.getenv("GEMINI_API_KEY", "")
        self.model_name = model_name or "gemini-3.8-flash"
        self._client: genai.Client | None = None

    @property
    def client(self) -> genai.Client:
        if self._client is None:
            self._client = genai.Client(api_key=self.api_key)
        return self._client

    async def run(
        self,
        task_description: str,
        repo_path: str = ".",
        mode: str = "live",
        test_command: str = "",
    ) -> dict[str, Any]:
        """Runs the autonomous SWE agent loop for complex engineering tasks."""
        logger.info("[SWEAgent] Starting run: %s (mode=%s)", task_description, mode)

        # Formulate execution plan using Gemini 3.8
        prompt_text = SWE_TASK_TEMPLATE.format(
            repo_path=repo_path,
            mode=mode,
            task_description=task_description,
            test_command=test_command or "None specified",
        )

        plan = "Executing engineering task..."
        if self.api_key:
            try:
                res = self.client.models.generate_content(
                    model=self.model_name,
                    contents=[types.Part.from_text(text=prompt_text)],
                    config=types.GenerateContentConfig(
                        system_instruction=SWE_AGENT_SYSTEM_PROMPT,
                        temperature=0.2,
                    ),
                )
                if res and res.text:
                    plan = res.text
            except Exception as err:
                logger.warning("[SWEAgent] Plan formulation note: %s", err)

        # Run verification command or task command in the target mode
        effective_cmd = test_command or "git status"
        cmd_result = run_swe_command(
            workspace_root=self.workspace_root,
            command=effective_cmd,
            mode=mode,
            terminal_label=f"SWE-Kit: {task_description[:30]}",
        )

        return {
            "success": cmd_result.get("success", False),
            "mode": mode,
            "plan": plan,
            "command_result": cmd_result,
            "trial_id": cmd_result.get("trial_id", ""),
            "diff": cmd_result.get("diff", ""),
            "modified_files": cmd_result.get("modified_files", []),
            "message": cmd_result.get("message", "Task completed."),
        }
