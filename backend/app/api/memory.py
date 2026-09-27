from __future__ import annotations

import asyncio
import hashlib

from fastapi import APIRouter, Request, WebSocket

from backend.app.core.config import settings

router = APIRouter()


def _visible_snapshot(snapshot) -> dict:
    active_nodes = {
        node_id: node.model_dump(mode="json")
        for node_id, node in snapshot.nodes.items()
        if not node.archived
    }
    active_ids = set(active_nodes)
    edges = {
        source: {target: value for target, value in targets.items() if target in active_ids}
        for source, targets in snapshot.edges.items()
        if source in active_ids
    }
    return {
        "nodes": active_nodes,
        "edges": edges,
        "title_index": {
            node_id: entry.model_dump(mode="json")
            for node_id, entry in snapshot.title_index.items()
            if node_id in active_ids
        },
        "anchors": snapshot.anchors,
    }


_MEMORY_UPDATE_EVENT: asyncio.Event = asyncio.Event()


def trigger_memory_update() -> None:
    """Signals all active /ws/memory WebSockets to immediately push updated graph snapshots."""
    _MEMORY_UPDATE_EVENT.set()


@router.get("/api/memory/snapshot")
async def memory_snapshot(request: Request) -> dict:
    snapshot = await request.app.state.memory_runtime.repository.snapshot()
    return _visible_snapshot(snapshot)


@router.websocket("/ws/memory")
async def memory_stream(websocket: WebSocket) -> None:
    origin = websocket.headers.get("origin")
    if origin and origin not in settings.allowed_origins and not origin.startswith("file://"):
        await websocket.close(code=1008, reason="Origin is not allowed")
        return
    await websocket.accept()
    previous = ""
    try:
        while True:
            snapshot = await websocket.app.state.memory_runtime.repository.snapshot()
            payload = _visible_snapshot(snapshot)
            digest = hashlib.sha256(str(payload).encode()).hexdigest()
            if digest != previous:
                await websocket.send_json({"type": "memory.snapshot", "data": payload})
                previous = digest

            # Real-time reactive wake-up or 2-second fallback heartbeat
            try:
                await asyncio.wait_for(_MEMORY_UPDATE_EVENT.wait(), timeout=2.0)
                _MEMORY_UPDATE_EVENT.clear()
            except asyncio.TimeoutError:
                pass
    except Exception:
        # A disconnected renderer is expected and requires no server-side recovery.
        return
