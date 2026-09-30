from __future__ import annotations

import inspect
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

from google.genai import types

ToolHandler = Callable[..., dict[str, Any] | Awaitable[dict[str, Any]]]


@dataclass(slots=True)
class ToolDefinition:
    name: str
    description: str
    parameters: dict[str, Any]
    handler: ToolHandler


class ToolRegistry:
    def __init__(self) -> None:
        self._tools: dict[str, ToolDefinition] = {}

    def register(self, definition: ToolDefinition) -> None:
        if definition.name in self._tools:
            raise ValueError(f"Tool already registered: {definition.name}")
        self._tools[definition.name] = definition

    def declarations(self) -> list[types.Tool]:
        declarations = [
            types.FunctionDeclaration(
                name=item.name,
                description=item.description,
                parameters_json_schema=item.parameters,
            )
            for item in self._tools.values()
        ]
        return [types.Tool(function_declarations=declarations)] if declarations else []

    def list_tools(self) -> list[dict[str, Any]]:
        return [
            {
                "name": item.name,
                "description": item.description,
                "parameters": list(item.parameters.get("properties", {}).keys()) if item.parameters else [],
            }
            for item in self._tools.values()
        ]

    async def execute(self, name: str, arguments: dict[str, Any] | None) -> dict[str, Any]:
        definition = self._tools.get(name)
        if not definition:
            return {"ok": False, "error": f"Unknown tool: {name}", "status": "not_found"}
        try:
            result = definition.handler(**(arguments or {}))
            if inspect.isawaitable(result):
                result = await result

            # End-to-end outcome inspection: check if handler returned a dictionary signaling failure/error
            if isinstance(result, dict):
                # 1. Permission required
                if result.get("requires_permission") or result.get("status") == "permission_required":
                    return {
                        "ok": False,
                        "requires_permission": True,
                        "status": "permission_required",
                        "message": result.get("message", "User permission is required to proceed."),
                        "result": result,
                    }

                # 2. Explicit failure or error status
                has_error = (
                    result.get("ok") is False
                    or result.get("success") is False
                    or bool(result.get("error"))
                    or result.get("status") in {"system_error", "permission_denied", "error"}
                )
                if has_error:
                    err_text = str(result.get("error") or result.get("message") or f"Tool '{name}' execution failed")
                    return {
                        "ok": False,
                        "error": err_text,
                        "status": result.get("status", "system_error"),
                        "message": result.get("message", f"System Error in tool '{name}': {err_text}"),
                        "result": result,
                    }

            return {"ok": True, "result": result}
        except Exception as error:
            # Check for permission-required errors raised by tools
            if getattr(error, "requires_permission", False) or getattr(error, "status", None) == "permission_required":
                return {
                    "ok": False,
                    "requires_permission": True,
                    "status": "permission_required",
                    "boundary_type": getattr(error, "boundary_type", "general"),
                    "target": getattr(error, "target", ""),
                    "message": str(error),
                }

            err_text = str(error)[:1000]
            return {
                "ok": False,
                "error": err_text,
                "status": "system_error",
                "message": (
                    f"System Error in tool '{name}': {err_text}. "
                    f"CRITICAL: Inform the user explicitly that a system error occurred in tool '{name}'. "
                    f"Quote the exact error: '{err_text}'. "
                    f"Explain clearly what went wrong technically (e.g. server not running, bad URL, or missing binary) "
                    f"and provide actionable steps to resolve it."
                ),
            }

    @property
    def names(self) -> tuple[str, ...]:
        return tuple(self._tools)
