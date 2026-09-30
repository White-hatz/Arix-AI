# Architecture & Implementation Plan: Multi-Modal File Upload System, Downloads Path Resolution & Host Memory Context

## 1. Multi-Modal File Upload System
- **Supported Methods**:
  1. **Direct Drag-and-Drop**: Users can drag files and drop them directly onto the Direct Assistant, Coder Agent, or Transcript panels.
  2. **File Browser Picker**: Native modal file input supporting any file type (source code, text, images, PDFs, archives, binaries).
  3. **Host File Path Entry**: Allows users to enter or paste exact host system paths (e.g. `C:\path\to\Downloads\dataset.csv` or `E:\workspace\project`), with option to link directly or copy into the workspace.
  4. **Quick System Path Shortcuts**: One-click shortcut chips for Downloads, Desktop, Documents, C:\, D:\, and E:\.
- **Backend Endpoints**:
  - `POST /api/workspace/upload`: Multipart file upload with auto-deduplication, MIME inspection, and text preview generation.
  - `POST /api/workspace/attach-path`: Validates host path existence, detects folders vs files, generates previews, and optionally copies files into the active project.
- **Frontend Components**:
  - `FileUploadModal.tsx`: Dual-tab modal (Browse & Drop vs Host Path).
  - `FileAttachmentBar.tsx`: Interactive attachment preview chips with remove and inspection capabilities.
  - Integration into `CoderTab.tsx`, `DirectAssistantTab.tsx`, and `TranscriptPanel.tsx`.

## 2. Root Cause & Fix for Downloads Folder Error
- **Root Cause**:
  When the active workspace is set to `E:\Coding World\Arix-AI`, any search or tool targeting `Downloads` or `downloads` resolved relative to the workspace (`E:\Coding World\Arix-AI\Downloads`), which did not exist on disk, throwing `FileNotFoundError` / `ValueError: path must be a directory`.
- **Fix**:
  - `backend/app/tools/safety.py` (`resolve_user_path`) and `backend/app/tools/coder_tools.py` (`resolve_safe_path`) now detect well-known system aliases (`downloads`, `desktop`, `documents`, `pictures`, `videos`, etc.) and fall back to `Path.home() / alias` if the folder does not exist inside the active workspace.
  - Added support for Windows environment variables (`%USERPROFILE%`, `%APPDATA%`, `~`).
  - Fixed deprecated `gemini-1.5-flash` model causing 404 HTTP errors in memory manager.

## 3. Host System Memory & Location Directives
- **Directives & Prompts**:
  - `backend/app/services/gemini_live.py`: Injected `SYSTEM_PATHS_DIRECTIVE` containing exact host paths into system instructions.
  - `backend/app/services/coder_agent.py`: Injected `HOST SYSTEM & FILE LOCATIONS` into the ReAct Coder Agent system prompt.
  - `backend/data/tier1_memory.txt`: Persisted exact user folder, Downloads, Desktop, Documents, and drive roots (`C:\`, `D:\`, `E:\`).
  - `backend/app/tools/environment_tools.py`: Exposed system locations and active drive capacities in `get_environment_info()`.
