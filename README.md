# Arix AI

Arix AI is a local, voice-first Windows desktop assistant. The current Phase 3 foundation combines a premium Electron interface and Python 3.11 Gemini Live bridge with typed function calling, two-tier long-term memory, an interactive 3D memory graph, and a guarded executable-tool suite.

> Arix is intentionally a desktop application, not a hosted web application. The backend binds to `127.0.0.1`, and the Gemini API key stays on the user's machine.

## Completed features

- Electron desktop shell with a custom Windows title bar
- Responsive command-center interface built with React, TypeScript, Vite, and Tailwind CSS
- Animated audio orb, waveform, state colors, and live captions
- Real-time 16 kHz PCM microphone capture and native Gemini audio playback
- **Gemini 3.8 Live** (`gemini-3.8-live`) as the default low-latency voice model
- **Gemini 3.8 Live Extended Thinking** (`gemini-3.8-live-extended-thinking`) for complex reasoning tasks
- **On-screen Deep Think toggle button** with live visual indicator and glowing mode styling
- **Live conversation tool calling** (`switch_thinking_mode`): say "use deep think", "extended thinking", or "use thinking" to automatically switch models during conversation
- **Direct switch scripts & commands**: `scripts\switch.bat normal/think`, `npm run switch:think`, `npm run switch:normal`, and `/switch think` in chat
- Input/output live transcription and secondary text input

- In-app Gemini API key, model, voice, and system-instruction fields
- Typed Gemini function registry with normalized success and error results
- `save_memory` and `request_memory` live-session tools
- 24 typed Gemini tools with normalized structured results
- Memory: `save_memory` and `request_memory`
- Discovery: `open_app`, `web_search`, `weather_report`, `youtube_video`, and `flight_finder`
- Windows automation: `reminder`, `computer_settings`, `computer_control`, and `shutdown_arix`
- Workspace automation: `browser_control`, `file_controller`, `desktop_control`, `screen_process`, and `file_processor`
- Integrations: reviewed message composers, private-LAN Kasa controls, and Steam update/install requests
- Builders: PowerPoint, Excel, Word, and PDF generation plus structured local agent-task records
- Allowlisted, shell-free application launching and HTTP(S)-only website opening
- Bounded web/network operations, optional-dependency loading, and explicit confirmations for consequential actions
- Tier-1 private text scratchpad injected into each session
- Durable graph memory with atomic local JSON storage or optional Firebase RTDB
- Gemini 2.5 Flash memory extraction, fuzzy retrieval, and conservative maintenance
- Best-effort background ingestion of completed turns without blocking conversation
- Interactive, searchable 3D memory constellation with category and importance filters
- Live memory updates over a local WebSocket and a REST snapshot endpoint
- Legacy memory migration and Firebase upload utilities

## Technology

| Layer | Technology |
| --- | --- |
| Desktop | Electron 43 |
| Interface | React 18, TypeScript, Vite 6, Tailwind CSS 3 |
| Backend | Python 3.11, FastAPI, Uvicorn |
| AI | `google-genai` 1.75, Gemini Live API, Gemini 2.5 Flash memory manager |
| Memory | Atomic local JSON/text fallback or Firebase Realtime Database |
| Visualization | Three.js and `3d-force-graph` (lazy-loaded) |
| Transport | Local WebSockets at `/ws/live` and `/ws/memory` |
| Audio input | Mono PCM16, 16 kHz, little-endian |

Python **3.11** is the supported runtime. Dependency versions are pinned in `backend/requirements.txt` for repeatable Windows installation. Newer Python runtimes are not used because ecosystem compatibility is narrower for the planned Windows automation and audio stack.

## Architecture

```text
Microphone / text
       │
       ▼
Electron renderer (React)
  ├─ audio resampling + playback
  ├─ live transcript and session state
  └─ lazy-loaded 3D memory workspace
       │ local REST + WebSockets
       ▼
Python FastAPI bridge
  ├─ Gemini Live lifecycle and event translation
  ├─ bounded real-time audio queue
  ├─ typed 24-tool registry with confirmation and path guards
  └─ two-tier memory runtime
       ├─ private text scratchpad
       ├─ local graph JSON or Firebase RTDB
       └─ Gemini 2.5 Flash memory manager
       │ secure Gemini connections
       ▼
Gemini 3.1 Flash Live Preview + Gemini 2.5 Flash
```

The renderer never contacts Gemini or Firebase directly. This isolates credentials and establishes a boundary for tool execution, authorization, persistence, and future Windows automation.

## Project structure

```text
Arix-AI/
├── frontend/
│   ├── electron/                  # Secure Electron main process and preload
│   └── src/
│       ├── components/            # Voice UI, navigation, settings, memory graph
│       ├── hooks/                 # Live session, audio, and memory graph streams
│       ├── lib/audio.ts           # PCM conversion and decoding
│       ├── types/                 # UI protocol and memory types
│       ├── App.tsx
│       └── styles.css
├── backend/
│   ├── app/
│   │   ├── api/                   # Live and memory REST/WebSocket endpoints
│   │   ├── core/                  # Settings and protocol validation
│   │   ├── memory/                # Models, repositories, manager, migration
│   │   ├── tools/                 # Registry, safety policy, automation, processors, builders
│   │   ├── services/gemini_live.py
│   │   └── main.py
│   ├── tests/
│   ├── requirements.txt
│   └── pyproject.toml
├── scripts/                       # Windows setup and launch helpers
└── package.json                   # Unified development commands
```

## Windows setup

### Prerequisites

1. Windows 10 or 11
2. [Python 3.11 (64-bit)](https://www.python.org/downloads/) with the Python launcher enabled
3. [Node.js 20 LTS or newer](https://nodejs.org/)
4. A Gemini API key from [Google AI Studio](https://aistudio.google.com/apikey)
5. Optional: the Tesseract desktop binary for OCR actions

### Install

Clone the repository, open PowerShell in the repository, and run:

```powershell
.\scripts\setup-windows.ps1
```

Or use Command Prompt:

```bat
scripts\setup-windows.bat
```

### Start

```powershell
.\scripts\start-windows.ps1
```

The setup scripts also install Playwright's isolated Chromium browser. The start command launches the local Python bridge, Vite, and Electron together. Keep the terminal open while using this development build.

## User guide

1. Launch Arix.
2. Select **Configure** or the Settings icon.
3. Paste your Gemini API key into the in-app field.
4. Keep the default live model unless Google changes the preview model available to your account.
5. Choose a voice and optionally edit the system instruction.
6. Select **Start live session** and allow microphone access.
7. Speak naturally. The orb and waveform respond to microphone activity, and Arix plays audio as it arrives.
8. Use the right-side composer to send text in the same session.
9. Open **Memory** from the navigation rail to inspect the constellation. Search titles, filter categories, adjust minimum importance, inspect nodes, or fit the graph to the viewport.
10. Select **End live session** when finished.

The API key is deliberately not stored. Enter it again after restarting the application. When Firebase is not configured, memory remains local under `backend/data/` (or `ARIX_DATA_DIR`).

## Local endpoints and protocol

- `GET http://127.0.0.1:8765/health` — backend health information
- `GET http://127.0.0.1:8765/api/mode` — current active mode and model
- `POST http://127.0.0.1:8765/api/mode` — dynamically switch mode (`{"mode": "think"|"normal"|"toggle"}`)
- `GET http://127.0.0.1:8765/api/memory/snapshot` — active graph snapshot
- `WS ws://127.0.0.1:8765/ws/live` — live bidirectional session
- `WS ws://127.0.0.1:8765/ws/memory` — changed graph snapshots

First live WebSocket message:

```json
{
  "type": "session.start",
  "apiKey": "...",
  "model": "gemini-3.8-live",
  "voice": "Kore",
  "systemInstruction": "You are Arix..."
}
```


Subsequent binary frames are raw PCM16 microphone chunks. Text frames use `{ "type": "text", "text": "..." }`. Server events include `session.ready`, `status`, `transcript`, `audio`, `tool.result`, `turn.complete`, `interrupted`, and `error`.

### Optional Firebase memory

Leave Firebase variables unset to use local memory. To use Firebase RTDB, copy `backend/.env.example` to `backend/.env`, set `ARIX_FIREBASE_DATABASE_URL`, and provide either `ARIX_FIREBASE_SERVICE_ACCOUNT` (a path outside the repository) or `ARIX_FIREBASE_SERVICE_ACCOUNT_JSON`. Never commit credentials.

## Development commands

```bash
npm run dev        # Backend + Vite + Electron
npm run build      # TypeScript and production renderer build
npm run typecheck  # TypeScript validation
npm run test       # Python tests and frontend lint
npm run switch:think   # Switch model to Gemini 3.8 Live Extended Thinking
npm run switch:normal  # Switch model to Gemini 3.8 Live
npm run switch         # Toggle between normal and think modes
```

Direct script commands (Windows):

```cmd
scripts\switch.bat think               # Switch to Gemini 3.8 Live Extended Thinking
scripts\switch.bat normal              # Switch to Gemini 3.8 Live
scripts\switch.bat switch normal/think # Toggle between normal and think modes
```

Backend only:

```bash
python -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8765 --reload
```


## Data architecture

- `tier1_memory.txt`: bounded private scratchpad for explicit durable facts
- `memory_graph.json`: local adjacency-list graph fallback
- Firebase `/memory/nodes`: full memory nodes
- Firebase `/memory/edges`: bidirectional adjacency data
- Firebase `/memory/title_index`: compact retrieval index
- Firebase `/memory/anchors`: permanent Arix and user root markers

All local writes use a temporary file followed by an atomic replace. Graph nodes support categories, importance, access metadata, source attribution, archiving, and weighted relationships.

## Security notes

- The backend listens only on the loopback interface by default.
- WebSocket browser origins are restricted to local development origins and Electron's local file origin.
- The API key is excluded from logs and is never written by the app.
- Firebase credentials remain backend-only.
- Electron uses context isolation, sandboxing, and no Node.js integration in the renderer.
- `.env` files, generated builds, Python caches, and local secrets are ignored by Git.
- Application launching is restricted to an explicit allowlist and never invokes a command shell.
- Website opening accepts only HTTP(S) URLs; search, weather, image, and metadata calls use bounded requests.
- File operations resolve paths beneath the user profile, reject traversal/symlink escapes, bound reads and traversal, and use the Recycle Bin for deletion.
- Shutdown, delete, overwrite, move, organization, message composition, browser submissions, smart-home state changes, and Steam installs/updates require explicit confirmation.
- Browser automation uses one isolated Playwright context, blocks local/internal URL targets, applies timeouts, and does not log typed values.
- Optional Windows and document dependencies are loaded only when their tool is called, with actionable install errors.
- No executable tool evaluates generated code or accepts arbitrary shell commands.

## Testing status

- Frontend production build: passing
- TypeScript type-check: passing
- ESLint: passing
- Python unit/API tests: passing (46 tests)
- Backend Python compile check: passing
- Memory, registry, safety, confirmation, file, browser, computer, integration, processor, document, and API tests: passing
- Live Gemini and Firebase credentials require manual verification on Windows with valid account access, network access, and microphone permission

## Not implemented yet

- Full conversation history and session resumption (durable fact memory is implemented)
- Production installer containing an embedded Python runtime and OCR binary
- Secure persisted API-key storage
- Per-tool permissions UI, audit-history UI, and session-scoped screen-capture consent
- Direct provider APIs that can prove message delivery; current messaging opens a reviewed composer and correctly reports `sent: false`
- Autonomous arbitrary-code execution; `agent_task` intentionally stores and tracks structured tasks only

## Recommended next steps

1. Add a renderer permission/confirmation dialog and persistent local audit history for every consequential tool result.
2. Add Windows Credential Manager integration for optional key persistence.
3. Bundle a managed Python 3.11 runtime, Playwright Chromium, and optional OCR runtime into the Electron installer.
4. Add SQLite conversation history and session resumption.
5. Add explicit per-session consent controls for screen capture, OCR, keyboard, and mouse automation.
6. Run Windows hardware integration tests for brightness, multi-monitor capture, Task Scheduler, Steam, and Kasa devices.
7. Create a signed Windows installer through a Windows GitHub Actions runner.

## Deployment status

- Platform: Local Windows desktop
- Hosted deployment: Not applicable
- Repository: `https://github.com/itsarixworks-cell/Arix-AI`
- Phase: 3 — voice UI, graph memory, and guarded executable-tool suite
