# Tasks

## Completed: Multi-Modal File Upload System, Downloads Path Resolution & Host Memory Context

- [x] **File Upload System**:
  - [x] Added `POST /api/workspace/upload` for multipart file uploads with automatic deduplication, preview, and MIME detection.
  - [x] Added `POST /api/workspace/attach-path` for attaching any existing host file/folder by exact path, with optional project copy.
  - [x] Added `GET /api/workspace/system-paths` dynamically exposing all verified host drives and system folders.
  - [x] Fixed frontend API routing: added Vite dev proxy in `vite.config.ts` and configured explicit `API_URL` (`http://127.0.0.1:8765`) in `FileUploadModal.tsx`, `DirectAssistantTab.tsx`, `CoderTab.tsx`, and `TranscriptPanel.tsx`.
  - [x] Added automated PDF text extraction using `pypdf` for uploads and attachments so assignment and document contents are immediately available in the prompt preview.
  - [x] Built `frontend/src/components/common/FileUploadModal.tsx` supporting drag-and-drop, native file picker, and host path entry with quick-path buttons (Downloads D:, NIMS Assignment, Downloads C:, Desktop, Documents, C:, D:, E:).
  - [x] Built `frontend/src/components/common/FileAttachmentBar.tsx` with file-type icons, size badges, preview popover, and remove controls.
- [x] **Fix Downloads Folder & NIMS Assignment Access**:
  - [x] Diagnosed user's real Windows Downloads folder: Windows User Shell Folders registry maps Downloads to `D:\Downloads` (138+ items), where `D:\Downloads\NIMS Assignment` resides.
  - [x] Enhanced `get_well_known_system_paths()` in `backend/app/tools/safety.py` to query Windows User Shell Folders registry and scan all drive roots.
  - [x] Enhanced `resolve_user_path()` and `resolve_safe_path()` to check both `D:\Downloads` and user profile Downloads, and directly resolve `Downloads/NIMS Assignment` and `NIMS Assignment`.
  - [x] Removed deprecated `gemini-2.0-flash` from `GeminiMemoryManager` fallback to resolve 404 NOT_FOUND errors in `arix.log`.
- [x] **Memory Context & System Paths for AI**:
  - [x] Updated `backend/data/tier1_memory.txt` with `D:\Downloads` as primary downloads and `D:\Downloads\NIMS Assignment`.
  - [x] Updated `SYSTEM_PATHS_DIRECTIVE` in `gemini_live.py` and `HOST SYSTEM & FILE LOCATIONS` in `coder_agent.py`.
  - [x] Verified with unit tests in `backend/tests/test_workspace_upload.py` (5/5 passed) and full regression suite (21/21 passed).
  - [x] Rebuilt frontend with `npm run build` (`tsc -b && vite build` passed with 0 errors).
