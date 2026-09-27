from __future__ import annotations

from backend.app.memory.service import MemoryService
from backend.app.tools.registry import ToolDefinition, ToolRegistry


def register_memory_tools(registry: ToolRegistry, memory: MemoryService) -> None:
    registry.register(ToolDefinition(
        name="save_memory",
        description=(
            "Save an important durable fact, user preference, decision, or insight in persistent memory. "
            "Instantly creates and syncs a node to the memory graph and persists to Tier-1 storage. "
            "Use whenever the user says 'remember this', 'keep this in mind', or shares long-term information."
        ),
        parameters={
            "type": "object",
            "properties": {
                "text": {"type": "string", "description": "A self-contained fact or preference worth remembering."},
                "title": {"type": "string", "description": "Optional short descriptive title for the memory graph node."},
                "category": {"type": "string", "enum": ["preferences", "projects", "identity", "relationships", "wishes", "notes"], "description": "Optional memory category."},
            },
            "required": ["text"],
            "additionalProperties": False,
        },
        handler=memory.save_direct,
    ))
    registry.register(ToolDefinition(
        name="request_memory",
        description=(
            "Retrieve a memory by a title visible in the title index. Returns its summary and direct "
            "connections at depth 1. Increase depth only when another graph layer is needed."
        ),
        parameters={
            "type": "object",
            "properties": {
                "title": {"type": "string", "description": "Exact or close memory title."},
                "depth": {"type": "integer", "minimum": 0, "maximum": 4, "default": 1},
            },
            "required": ["title"],
            "additionalProperties": False,
        },
        handler=memory.request,
    ))
    registry.register(ToolDefinition(
        name="query_memory",
        description=(
            "Actively search and recall relevant memories from your persistent memory store and graph. "
            "Invoke autonomously when past conversation context or user preferences are useful, or on explicit request "
            "(e.g. 'what did we talk about regarding X before?', 'do you remember when I said...')."
        ),
        parameters={
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "Search text, keywords, or topic to recall."},
                "limit": {"type": "integer", "description": "Maximum number of relevant memories to retrieve (default 5).", "default": 5},
            },
            "required": ["query"],
            "additionalProperties": False,
        },
        handler=memory.query,
    ))
