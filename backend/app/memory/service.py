import asyncio
import difflib
import hashlib
import re
from collections import deque
from collections.abc import Awaitable, Callable
from typing import Any

from backend.app.memory.models import CATEGORY_COLORS, MemoryNode, utc_now
from backend.app.memory.repository import GraphRepository
from backend.app.memory.scratchpad import TierOneScratchpad

IngestCallback = Callable[[str, str], Awaitable[None]]
EscalateCallback = Callable[[str], Awaitable[str]]


class MemoryService:
    def __init__(
        self,
        repository: GraphRepository,
        scratchpad: TierOneScratchpad,
        ingest: IngestCallback | None = None,
        escalate: EscalateCallback | None = None,
    ) -> None:
        self.repository = repository
        self.scratchpad = scratchpad
        self.ingest = ingest
        self.escalate = escalate

    def set_manager(self, ingest: IngestCallback, escalate: EscalateCallback) -> None:
        self.ingest = ingest
        self.escalate = escalate

    async def session_context(self, index_limit: int = 80) -> str:
        scratchpad = await self.scratchpad.read()
        index = await self.repository.title_index(index_limit)
        titles = "\n".join(
            f"- {entry.title} [{entry.category}]" for entry in index.values()
        ) or "- No graph memories yet"
        return (
            "\n\n[TIER-1 PRIVATE MEMORY — use naturally]\n"
            f"{scratchpad or '(empty)'}\n"
            "[LONG-TERM MEMORY TITLE INDEX — titles only; call request_memory for summaries]\n"
            f"{titles}\n"
        )

    async def save_direct(
        self,
        text: str,
        title: str | None = None,
        category: str | None = None,
        source: str | None = None,
    ) -> dict[str, Any]:
        from backend.app.api.memory import trigger_memory_update

        clean_text = text.strip()
        saved = await self.scratchpad.append(clean_text)

        # 1. Derive title and category
        first_line = clean_text.splitlines()[0] if clean_text.splitlines() else "Saved Memory"
        derived_title = title or (first_line[:55] + ("..." if len(first_line) > 55 else "")).strip() or "Saved Memory"
        lower = clean_text.lower()
        if not category:
            if any(w in lower for w in ("prefer", "like", "favorite", "dislike", "hate")):
                cat = "preferences"
            elif any(w in lower for w in ("project", "build", "code", "app", "workspace")):
                cat = "projects"
            elif any(w in lower for w in ("name", "call me", "who i am")):
                cat = "identity"
            elif any(w in lower for w in ("wish", "want", "goal", "hope")):
                cat = "wishes"
            else:
                cat = "notes"
        else:
            cat = category

        slug = re.sub(r"[^a-z0-9]+", "-", derived_title.lower()).strip("-")[:40] or "memory"
        digest = hashlib.sha1(clean_text.encode(), usedforsecurity=False).hexdigest()[:8]
        node_id = f"{slug}-{digest}"
        now = utc_now()

        node = MemoryNode(
            id=node_id,
            title=derived_title,
            summary=clean_text,
            category=cat,
            color=CATEGORY_COLORS.get(cat, "#8290A6"),
            size=3.0,
            importance=0.8,
            source=source or "live_direct",
            created_at=now,
            last_accessed=now,
        )

        # 2. Persist directly to graph repository and connect to user_root anchor
        await self.repository.upsert_node(node)
        try:
            await self.repository.connect(node.id, "user_root", "remembers", 0.85)
        except Exception:
            pass

        # 3. Trigger immediate real-time WebSocket broadcast to frontend memory graph
        trigger_memory_update()

        # 4. Asynchronously enqueue for manager enrichment
        if self.ingest:
            try:
                res = self.ingest(clean_text, "live_direct")
                if asyncio.iscoroutine(res):
                    await res
            except Exception:
                pass

        return {
            "saved": True,
            "tier": 1,
            "node_id": node.id,
            "title": derived_title,
            "category": cat,
            "entry": saved,
            "message": f"Memory '{derived_title}' saved and synced to real-time memory graph.",
        }

    async def query(self, query: str, limit: int = 5) -> dict[str, Any]:
        """Performs search across Tier-1 scratchpad and long-term memory graph."""
        normalized_q = self._normalized(query)
        words = set(normalized_q.split())

        # Check Tier 1 scratchpad
        scratchpad_text = await self.scratchpad.read()
        matched_lines = [
            line.strip()
            for line in scratchpad_text.splitlines()
            if any(w in line.lower() for w in words if len(w) > 2)
        ][:limit]

        # Check GraphRepository
        snapshot = await self.repository.snapshot()
        scored: list[tuple[float, Any]] = []

        for node_id, node in snapshot.nodes.items():
            if node_id in snapshot.anchors or node.archived:
                continue
            norm_title = self._normalized(node.title)
            norm_summary = self._normalized(node.summary)

            score = 0.0
            if normalized_q in norm_title:
                score += 1.0
            elif normalized_q in norm_summary:
                score += 0.8
            else:
                title_words = set(norm_title.split())
                overlap = words.intersection(title_words)
                if overlap:
                    score += 0.5 * (len(overlap) / max(1, len(words)))
                summary_words = set(norm_summary.split())
                summary_overlap = words.intersection(summary_words)
                if summary_overlap:
                    score += 0.3 * (len(summary_overlap) / max(1, len(words)))

            if score > 0.15:
                scored.append((score, node))

        scored.sort(key=lambda x: x[0], reverse=True)
        top_memories = [
            {
                "id": node.id,
                "title": node.title,
                "summary": node.summary,
                "category": node.category,
                "relevance": round(score, 2),
            }
            for score, node in scored[:limit]
        ]

        return {
            "query": query,
            "count": len(top_memories),
            "memories": top_memories,
            "scratchpad_matches": matched_lines,
            "summary": f"Found {len(top_memories)} matching node(s) and {len(matched_lines)} line(s) for '{query}'",
        }

    @staticmethod
    def _normalized(value: str) -> str:
        return re.sub(r"[^a-z0-9]+", " ", value.lower()).strip()

    async def _match(self, query: str) -> tuple[str | None, float]:
        index = await self.repository.title_index(200)
        normalized = self._normalized(query)
        best_id: str | None = None
        best_score = 0.0
        for node_id, entry in index.items():
            title = self._normalized(entry.title)
            if title == normalized:
                return node_id, 1.0
            if normalized in title or title in normalized:
                score = 0.92
            else:
                score = difflib.SequenceMatcher(None, normalized, title).ratio()
            if score > best_score:
                best_id, best_score = node_id, score
        return best_id, best_score

    async def request(self, title: str, depth: int = 1, allow_escalation: bool = True) -> dict[str, Any]:
        depth = max(0, min(4, depth))
        node_id, confidence = await self._match(title)
        if not node_id or confidence < 0.78:
            if allow_escalation and self.escalate:
                return {"matched": False, "escalated": True, "answer": await self.escalate(title)}
            return {"matched": False, "escalation_required": True, "confidence": round(confidence, 3)}

        visited: set[str] = set()
        queue: deque[tuple[str, int]] = deque([(node_id, 0)])
        memories: list[dict[str, Any]] = []
        while queue:
            current_id, current_depth = queue.popleft()
            if current_id in visited:
                continue
            visited.add(current_id)
            node = await self.repository.get_node(current_id)
            if not node:
                continue
            memories.append({
                "id": node.id, "title": node.title, "summary": node.summary,
                "category": node.category, "distance": current_depth,
            })
            if current_depth < depth:
                for neighbor in await self.repository.get_neighbors(current_id):
                    if neighbor.id not in visited:
                        queue.append((neighbor.id, current_depth + 1))
        return {
            "matched": True,
            "confidence": round(confidence, 3),
            "depth": depth,
            "memories": memories,
        }
