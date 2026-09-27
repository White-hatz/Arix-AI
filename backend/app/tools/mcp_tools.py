"""MCP Tools registration for Assistant and Live Bridge sessions."""

from __future__ import annotations

import logging
from typing import Any

from backend.app.services.mcp.manager import mcp_manager
from backend.app.tools.registry import ToolDefinition, ToolRegistry

logger = logging.getLogger("backend.tools.mcp_tools")


async def _sequential_thinking_handler(
    thought: str,
    thoughtNumber: int = 1,
    totalThoughts: int = 3,
    nextThoughtNeeded: bool = True,
    isRevision: bool = False,
    revisesThought: int | None = None,
    branchFromThought: int | None = None,
    branchId: str | None = None,
    needsMoreThoughts: bool = False,
    **kwargs: Any,
) -> dict[str, Any]:
    """Routes sequential thinking requests directly to the Anthropic Sequential Thinking MCP server."""
    args: dict[str, Any] = {
        "thought": thought,
        "thoughtNumber": thoughtNumber,
        "totalThoughts": totalThoughts,
        "nextThoughtNeeded": nextThoughtNeeded,
    }
    if isRevision:
        args["isRevision"] = isRevision
    if revisesThought is not None:
        args["revisesThought"] = revisesThought
    if branchFromThought is not None:
        args["branchFromThought"] = branchFromThought
    if branchId:
        args["branchId"] = branchId
    if needsMoreThoughts:
        args["needsMoreThoughts"] = needsMoreThoughts

    try:
        return await mcp_manager.call_tool("sequentialthinking", args)
    except Exception as err:
        logger.warning("[SequentialThinking] Call failed: %s", err)
        return {
            "success": False,
            "error": str(err),
            "thought": thought,
            "thoughtNumber": thoughtNumber,
        }


def register_mcp_tools(registry: ToolRegistry) -> None:
    """Registers MCP Sequential Thinking into the Live Assistant ToolRegistry."""
    schema = {
        "type": "object",
        "properties": {
            "thought": {
                "type": "string",
                "description": "Your current reasoning step, architectural analysis, or problem decomposition.",
            },
            "thoughtNumber": {
                "type": "integer",
                "description": "The current step number in the thinking sequence (1, 2, 3...).",
            },
            "totalThoughts": {
                "type": "integer",
                "description": "Estimated total number of thinking steps required to complete the analysis.",
            },
            "nextThoughtNeeded": {
                "type": "boolean",
                "description": "Set to true if another reasoning step is required, false if final conclusion is reached.",
            },
            "isRevision": {
                "type": "boolean",
                "description": "Optional: set to true if this step revises or corrects previous thinking.",
            },
            "revisesThought": {
                "type": "integer",
                "description": "Optional: the thoughtNumber being revised if isRevision is true.",
            },
            "branchFromThought": {
                "type": "integer",
                "description": "Optional: the thoughtNumber where this alternative reasoning path branches.",
            },
            "branchId": {
                "type": "string",
                "description": "Optional: branch identifier if exploring multiple hypotheses.",
            },
        },
        "required": ["thought", "thoughtNumber", "totalThoughts", "nextThoughtNeeded"],
    }

    desc = (
        "Structured step-by-step problem decomposition and reflective reasoning via Anthropic Sequential Thinking. "
        "Use this tool when planning complex tasks, designing PLAN.md and TASKS.md, analyzing architectural tradeoffs, "
        "or when the user asks to 'think through this step by step' or 'break this down'."
    )

    registry.register(
        ToolDefinition(
            name="sequentialthinking",
            description=desc,
            parameters=schema,
            handler=_sequential_thinking_handler,
        )
    )

    # Register snake_case alias to prevent failure if model infers sequential_thinking
    registry.register(
        ToolDefinition(
            name="sequential_thinking",
            description=desc,
            parameters=schema,
            handler=_sequential_thinking_handler,
        )
    )

