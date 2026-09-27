"""FastAPI endpoints for Model Context Protocol (MCP) server lifecycle and tool management."""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from backend.app.services.mcp.manager import mcp_manager

logger = logging.getLogger("backend.api.mcp")
router = APIRouter(prefix="/api/mcp", tags=["mcp"])


class MCPToggleInput(BaseModel):
    server_id: str = Field(min_length=1)
    enabled: bool


class MCPRestartInput(BaseModel):
    server_id: str = Field(min_length=1)


@router.get("/status")
async def get_mcp_status() -> dict[str, Any]:
    """Returns aggregated status of all registered MCP servers, discovered tools, and host Node.js runtime."""
    try:
        return mcp_manager.get_full_status()
    except Exception as err:
        logger.error("Failed to fetch MCP status: %s", err)
        raise HTTPException(status_code=500, detail=f"Failed to fetch MCP status: {err}")


@router.post("/toggle")
async def toggle_server(payload: MCPToggleInput) -> dict[str, Any]:
    """Enables or disables an MCP server process."""
    res = await mcp_manager.toggle_server(payload.server_id, payload.enabled)
    if not res.get("ok"):
        raise HTTPException(status_code=400, detail=res.get("error", "Failed to toggle MCP server"))
    return res


@router.post("/restart")
async def restart_server(payload: MCPRestartInput) -> dict[str, Any]:
    """Restarts an MCP server child process and rediscovers its tools."""
    res = await mcp_manager.restart_server(payload.server_id)
    if not res.get("ok"):
        raise HTTPException(status_code=500, detail=res.get("error", "Failed to restart MCP server"))
    return res


@router.get("/tools")
async def get_tools_for_agent(agent: str = Query("coder", min_length=1)) -> dict[str, Any]:
    """Returns active tool declarations mapped for the specified agent ('coder' | 'assistant')."""
    try:
        declarations = await mcp_manager.get_tools_for_agent(agent)
        return {
            "agent": agent,
            "count": len(declarations),
            "tools": declarations,
        }
    except Exception as err:
        logger.error("Failed to discover tools for agent '%s': %s", agent, err)
        raise HTTPException(status_code=500, detail=f"Failed to discover tools: {err}")
