from __future__ import annotations

import hashlib
from dataclasses import dataclass
from pathlib import Path

from backend.app.memory.firebase_repository import FirebaseGraphRepository
from backend.app.memory.manager import GeminiMemoryManager
from backend.app.memory.repository import GraphRepository, LocalGraphRepository
from backend.app.memory.scratchpad import TierOneScratchpad
from backend.app.memory.service import MemoryService
from backend.app.tools.computer_tools import register_computer_tools
from backend.app.tools.document_tools import register_document_tools
from backend.app.tools.environment_tools import register_environment_tools
from backend.app.tools.in_app_control_tools import register_in_app_control_tools
from backend.app.tools.integration_tools import register_integration_tools
from backend.app.tools.mcp_tools import register_mcp_tools
from backend.app.tools.memory_tools import register_memory_tools
from backend.app.tools.mode_tools import register_mode_tools
from backend.app.tools.processor_tools import register_processor_tools
from backend.app.tools.registry import ToolRegistry
from backend.app.tools.system_tools import register_system_tools
from backend.app.tools.workspace_tools import close_browser_runtime, register_workspace_tools


@dataclass(slots=True)
class MemoryRuntime:
    repository: GraphRepository
    service: MemoryService
    tools: ToolRegistry
    manager: GeminiMemoryManager | None = None
    _manager_key_fingerprint: str = ""

    async def configure_manager(self, api_key: str) -> GeminiMemoryManager:
        fingerprint = hashlib.sha256(api_key.encode()).hexdigest()
        if self.manager and fingerprint == self._manager_key_fingerprint:
            return self.manager
        if self.manager:
            await self.manager.close()
        self.manager = GeminiMemoryManager(api_key, self.repository)
        self._manager_key_fingerprint = fingerprint
        self.service.set_manager(self.manager.ingest, self.manager.resolve)
        return self.manager

    async def close(self) -> None:
        await self.service.scratchpad.flush()
        if self.manager:
            await self.manager.close()
        await close_browser_runtime()


async def create_memory_runtime(
    data_directory: Path,
    firebase_database_url: str = "",
    firebase_service_account: str = "",
    firebase_service_account_json: str = "",
) -> MemoryRuntime:
    if firebase_database_url:
        repository: GraphRepository = FirebaseGraphRepository(
            database_url=firebase_database_url,
            service_account_path=Path(firebase_service_account) if firebase_service_account else None,
            service_account_json=firebase_service_account_json,
        )
    else:
        repository = LocalGraphRepository(data_directory / "memory_graph.json")
    await repository.ensure_anchors()
    service = MemoryService(repository, TierOneScratchpad(data_directory / "tier1_memory.txt"))
    tools = ToolRegistry()
    register_memory_tools(tools, service)
    register_system_tools(tools)
    register_computer_tools(tools)
    register_workspace_tools(tools)
    register_integration_tools(tools)
    register_processor_tools(tools)
    register_document_tools(tools)
    register_mode_tools(tools)
    register_in_app_control_tools(tools)
    register_environment_tools(tools)
    register_mcp_tools(tools)
    return MemoryRuntime(repository=repository, service=service, tools=tools)
