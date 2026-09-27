"""Translation bridge between MCP (Model Context Protocol) schemas and Gemini function calling."""

from __future__ import annotations

import logging
from typing import Any
from mcp.types import CallToolResult, TextContent, ImageContent, Tool

logger = logging.getLogger("backend.services.mcp.bridge")

TYPE_MAP = {
    "string": "STRING",
    "number": "NUMBER",
    "integer": "INTEGER",
    "boolean": "BOOLEAN",
    "array": "ARRAY",
    "object": "OBJECT",
}


def _clean_schema_property(prop: dict[str, Any]) -> dict[str, Any]:
    """Recursively converts JSON Schema property types into Gemini-compatible format."""
    cleaned: dict[str, Any] = {}
    raw_type = prop.get("type")

    if isinstance(raw_type, str):
        cleaned["type"] = TYPE_MAP.get(raw_type.lower(), "STRING")
    elif isinstance(raw_type, list):
        # E.g. ["string", "null"] -> pick the first non-null type
        types = [t for t in raw_type if t != "null"]
        first_t = types[0] if types else "string"
        cleaned["type"] = TYPE_MAP.get(first_t.lower(), "STRING")
    else:
        cleaned["type"] = "STRING"

    if "description" in prop:
        cleaned["description"] = str(prop["description"])

    if "enum" in prop:
        cleaned["enum"] = [str(e) for e in prop["enum"]]

    if cleaned["type"] == "ARRAY" and "items" in prop and isinstance(prop["items"], dict):
        cleaned["items"] = _clean_schema_property(prop["items"])

    if cleaned["type"] == "OBJECT" and "properties" in prop and isinstance(prop["properties"], dict):
        cleaned["properties"] = {
            k: _clean_schema_property(v)
            for k, v in prop["properties"].items()
            if isinstance(v, dict)
        }
        if "required" in prop:
            cleaned["required"] = list(prop["required"])

    return cleaned


def mcp_tool_to_gemini_declaration(tool: Tool, server_id: str = "") -> dict[str, Any]:
    """Translates an MCP Tool definition into a Gemini FunctionDeclaration dictionary."""
    input_schema = tool.input_schema or {}
    raw_props = input_schema.get("properties", {})
    required = list(input_schema.get("required", []))

    cleaned_props = {}
    for prop_name, prop_val in raw_props.items():
        if isinstance(prop_val, dict):
            cleaned_props[prop_name] = _clean_schema_property(prop_val)

    description = tool.description or f"MCP tool '{tool.name}' from {server_id or 'server'}"

    return {
        "name": tool.name,
        "description": description,
        "parameters": {
            "type": "OBJECT",
            "properties": cleaned_props,
            "required": required,
        },
    }


def mcp_result_to_dict(result: CallToolResult, server_id: str, tool_name: str) -> dict[str, Any]:
    """Converts an MCP CallToolResult into a normalized dictionary for Gemini and the Arix UI."""
    texts: list[str] = []
    images: list[str] = []

    for item in result.content or []:
        if isinstance(item, TextContent):
            texts.append(item.text)
        elif isinstance(item, ImageContent):
            mime = getattr(item, "mime_type", getattr(item, "mimeType", "image/png"))
            data_url = f"data:{mime};base64,{item.data}"
            images.append(data_url)
        elif hasattr(item, "text"):
            texts.append(str(item.text))

    full_text = "\n".join(texts).strip()
    is_error = bool(getattr(result, "is_error", getattr(result, "isError", False)))

    output: dict[str, Any] = {
        "success": not is_error,
        "source": f"mcp:{server_id}",
        "tool": tool_name,
        "content": full_text,
    }

    if images:
        output["images"] = images
        # Surface first image as primary screenshot if from playwright
        output["screenshot"] = images[0]

    if is_error:
        output["error"] = full_text or f"Tool {tool_name} returned an error"

    # Special handling for Sequential Thinking tool
    if tool_name in ("sequentialthinking", "sequential_thinking"):
        output["is_sequential_thinking"] = True

    return output
