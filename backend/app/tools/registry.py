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

    async def execute(self, name: str, arguments: dict[str, Any] | None) -> dict[str, Any]:
        definition = self._tools.get(name)
        if not definition:
            return {"ok": False, "error": f"Unknown tool: {name}"}
        try:
            result = definition.handler(**(arguments or {}))
            if inspect.isawaitable(result):
                result = await result
            return {"ok": True, "result": result}
        except Exception as error:
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
