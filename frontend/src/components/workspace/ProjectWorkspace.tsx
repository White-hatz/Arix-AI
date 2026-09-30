import React, { useEffect, useRef, useState } from 'react'
import {
  ArrowLeft,
  Bot,
  Brain,
  Code2,
  ExternalLink,
  FolderGit2,
  Monitor,
  MonitorOff,
  Save,
  Sparkles,
  X,
} from 'lucide-react'
import { ActivityDashboard } from './ActivityDashboard'
import { CoderTab } from './CoderTab'
import { DirectAssistantTab } from './DirectAssistantTab'
import type { OpenEditorTab } from './EditorWorkspaceTab'
import { FileTreeTab } from './FileTreeTab'
import { ProjectsSwitcherTab } from './ProjectsSwitcherTab'
import type { AppSettings, LiveSessionStatus, ProjectItem, TranscriptItem } from '../../types/arix'

interface Props {
  project: ProjectItem
  onBackToHub: () => void
  onSwitchProject: (project: ProjectItem) => void
  liveSession: {
    status: LiveSessionStatus
    audioLevel: number
    isThinking: boolean
    currentModel: string
    transcripts: TranscriptItem[]
    sendText: (text: string) => void
    connect: (config: any) => Promise<void>
    disconnect: () => void
    toggleThinking: () => void
    isMuted?: boolean
    toggleMute?: () => void
  }
}

export function ProjectWorkspace({
  project,
  onBackToHub,
  onSwitchProject,
  liveSession,
}: Props) {
  // Panel widths
  const [leftWidth, setLeftWidth] = useState(260)
  const [rightWidth, setRightWidth] = useState(380)
  const isDraggingLeft = useRef(false)
  const isDraggingRight = useRef(false)

  // Sub-tabs
  const [leftTab, setLeftTab] = useState<'files' | 'projects'>('files')
  const [middleTab, setMiddleTab] = useState<'coder' | 'assistant'>('coder')

  // Workspace files & editor state (A3, A4)
  const [openFiles, setOpenFiles] = useState<OpenEditorTab[]>([])
  const [activeFilePath, setActiveFilePath] = useState<string | undefined>()

  // Droppable active drag overlays
  const [isMiddleDropping, setIsMiddleDropping] = useState(false)
  const [isRightDropping, setIsRightDropping] = useState(false)

  // Settings for Monaco & models (A4, A7)
  const [appSettings, setAppSettings] = useState<Partial<AppSettings>>({})

  // Handoff & reference insertion
  const [pendingHandoff, setPendingHandoff] = useState<{ prompt: string; autoRun?: boolean } | undefined>()
  const [insertedRef, setInsertedRef] = useState<string | undefined>()

  // Screen share state
  const [isScreenSharing, setIsScreenSharing] = useState(false)
  const [screenSources, setScreenSources] = useState<any[]>([])

  // Session continuity banner
  const [continuityMsg, setContinuityMsg] = useState<string | null>(null)

  // Load app settings on mount
  useEffect(() => {
    if (window.arixSettings?.get) {
      window.arixSettings
        .get()
        .then((s) => {
          if (s) setAppSettings(s)
        })
        .catch(() => {})
    } else {
      fetch('http://127.0.0.1:8765/api/settings')
        .then((res) => res.json())
        .then((data) => {
          if (data) setAppSettings(data)
        })
        .catch(() => {})
    }
  }, [])

  // Check previous session on mount and sync active project to backend
  useEffect(() => {
    if (!project?.path) return
    fetch('http://127.0.0.1:8765/api/workspace/active-project', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project_path: project.path }),
    }).catch(() => {})

    fetch(
      `http://127.0.0.1:8765/api/workspace/session-report?workspace_root=${encodeURIComponent(
        project.path,
      )}`,
    )
      .then((res) => res.json())
      .then((data) => {
        if (data?.report?.summary) {
          setContinuityMsg(`Restored context from previous session: "${data.report.summary}"`)
        }
      })
      .catch(() => {})
  }, [project.path])

  // Mouse drag handlers for resizable panels (A3: remove 500px max limit)
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isDraggingLeft.current) {
        const newW = Math.max(180, Math.min(450, e.clientX))
        setLeftWidth(newW)
      }
      if (isDraggingRight.current) {
        // Can expand past 50% width, up to near fullscreen (window.innerWidth - 100px)
        const newW = Math.max(260, Math.min(window.innerWidth - 100, window.innerWidth - e.clientX))
        setRightWidth(newW)
      }
    }

    const handleMouseUp = () => {
      isDraggingLeft.current = false
      isDraggingRight.current = false
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [])

  // Open file in right panel editor tab (A3)
  const handleOpenFile = async (filePath: string) => {
    const filename = filePath.split('/').pop() || filePath
    setActiveFilePath(filePath)

    // If tab already exists, activate it
    const existing = openFiles.find((f) => f.path === filePath)
    if (existing) return

    // Check media extensions
    const ext = filename.split('.').pop()?.toLowerCase() || ''
    const isMedia = [
      'png',
      'jpg',
      'jpeg',
      'gif',
      'svg',
      'webp',
      'bmp',
      'ico',
      'mp4',
      'webm',
      'mov',
      'm4v',
    ].includes(ext)

    if (isMedia) {
      setOpenFiles((prev) => [
        ...prev,
        {
          path: filePath,
          name: filename,
          content: '',
          originalContent: '',
          isDirty: false,
        },
      ])
      return
    }

    // Code/Text file: fetch content from backend
    try {
      const res = await fetch(
        `http://127.0.0.1:8765/api/workspace/file-content?workspace_root=${encodeURIComponent(
          project.path,
        )}&path=${encodeURIComponent(filePath)}`,
      )
      if (res.ok) {
        const data = await res.json()
        setOpenFiles((prev) => [
          ...prev,
          {
            path: filePath,
            name: filename,
            content: data.content || '',
            originalContent: data.content || '',
            isDirty: false,
          },
        ])
      }
    } catch (err) {
      console.error('Failed to open file:', err)
    }
  }

  // Update tab content in editor
  const handleUpdateContent = (filePath: string, content: string) => {
    setOpenFiles((prev) =>
      prev.map((f) =>
        f.path === filePath ? { ...f, content, isDirty: content !== f.originalContent } : f,
      ),
    )
  }

  // Save file to backend
  const handleSaveFile = async (filePath: string, content: string) => {
    try {
      const res = await fetch('http://127.0.0.1:8765/api/workspace/save-file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspace_root: project.path,
          path: filePath,
          content,
        }),
      })
      if (res.ok) {
        setOpenFiles((prev) =>
          prev.map((f) =>
            f.path === filePath ? { ...f, originalContent: content, isDirty: false } : f,
          ),
        )
      }
    } catch (err) {
      console.error('Failed to save file:', err)
    }
  }

  const handleCloseFile = (filePath: string) => {
    setOpenFiles((prev) => {
      const next = prev.filter((f) => f.path !== filePath)
      if (activeFilePath === filePath) {
        setActiveFilePath(next[next.length - 1]?.path)
      }
      return next
    })
  }

  const handleCloseAllFiles = () => {
    setOpenFiles([])
    setActiveFilePath(undefined)
  }

  // Handle saving session report
  const handleSaveSession = async () => {
    try {
      await fetch('http://127.0.0.1:8765/api/workspace/save-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspace_root: project.path,
          data: {
            project_name: project.name,
            summary: `Session snapshot saved manually.`,
            files_modified: openFiles.map((f) => f.path),
            tasks_completed: [],
            tasks_pending: [],
          },
        }),
      })
      alert('Session snapshot saved to .arix/sessions/')
    } catch (err) {
      console.error('Failed to save session:', err)
    }
  }

  // Screen share toggle
  const handleToggleScreenShare = async () => {
    if (isScreenSharing) {
      setIsScreenSharing(false)
      return
    }

    if (window.arixScreenShare?.getSources) {
      try {
        const sources = await window.arixScreenShare.getSources({ types: ['window', 'screen'] })
        setScreenSources(sources)
        setIsScreenSharing(true)
      } catch (err) {
        console.error('Failed to get screen sources:', err)
      }
    } else {
      setIsScreenSharing(!isScreenSharing)
    }
  }

  const handleBack = () => {
    // Trigger auto-save before exit
    fetch('http://127.0.0.1:8765/api/workspace/save-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workspace_root: project.path,
        data: {
          project_name: project.name,
          summary: `Workspace closed.`,
          files_modified: openFiles.map((f) => f.path),
        },
      }),
    }).catch(() => {})
    onBackToHub()
  }

  return (
    <div className="project-workspace-root">
      {/* Top Workspace Bar */}
      <header className="workspace-top-bar">
        <div className="bar-left">
          <button className="workspace-back-btn" onClick={handleBack} title="Return to Projects Hub">
            <ArrowLeft size={16} />
            <span>Projects</span>
          </button>

          <div className="workspace-title-info">
            <div className="title-row">
              <span className="project-name">{project.name}</span>
              {project.isCore && (
                <span className="core-badge">
                  <Sparkles size={11} />
                  <span>Core</span>
                </span>
              )}
            </div>
            <span className="project-path-tag" title={project.path}>
              {project.path}
            </span>
          </div>
        </div>

        <div className="bar-center">
          <div className="model-badge">
            <Brain size={13} />
            <span>Gemini 3.8 Extended Thinking</span>
          </div>
        </div>

        <div className="bar-right">
          <button
            className={`screenshare-btn ${isScreenSharing ? 'active' : ''}`}
            onClick={handleToggleScreenShare}
            title={isScreenSharing ? 'Screen Share Active' : 'Share Screen with Assistant'}
          >
            {isScreenSharing ? <Monitor size={14} /> : <MonitorOff size={14} />}
            <span>{isScreenSharing ? 'Sharing Screen' : 'Share Screen'}</span>
          </button>

          <button
            className="bar-icon-btn"
            onClick={handleSaveSession}
            title="Save session snapshot"
          >
            <Save size={14} />
          </button>

          <button
            className="bar-icon-btn"
            onClick={() => window.arixDesktop?.revealInFolder?.(project.path)}
            title="Reveal in Explorer"
          >
            <ExternalLink size={14} />
          </button>
        </div>
      </header>

      {/* Continuity Banner */}
      {continuityMsg && (
        <div className="continuity-banner">
          <Sparkles size={14} />
          <span>{continuityMsg}</span>
          <button onClick={() => setContinuityMsg(null)}>
            <X size={13} />
          </button>
        </div>
      )}

      {/* 3-Panel Main Layout */}
      <div className="workspace-panels-layout">
        {/* Left Panel: Files & Switcher */}
        <aside className="workspace-panel left-panel" style={{ width: leftWidth }}>
          <div className="panel-tab-nav">
            <button
              className={`panel-tab ${leftTab === 'files' ? 'active' : ''}`}
              onClick={() => setLeftTab('files')}
            >
              Files
            </button>
            <button
              className={`panel-tab ${leftTab === 'projects' ? 'active' : ''}`}
              onClick={() => setLeftTab('projects')}
            >
              Projects
            </button>
          </div>

          <div className="panel-tab-body">
            {leftTab === 'files' ? (
              <FileTreeTab
                workspaceRoot={project.path}
                onFileSelect={handleOpenFile}
                onInsertReference={(ref) => setInsertedRef(ref)}
              />
            ) : (
              <ProjectsSwitcherTab
                currentProject={project}
                onSwitchProject={onSwitchProject}
              />
            )}
          </div>
        </aside>

        {/* Resizer Handle 1 */}
        <div
          className="panel-resizer left-resizer"
          onMouseDown={() => {
            isDraggingLeft.current = true
          }}
        />

        {/* Middle Panel: Coder Timeline vs Assistant (A3: Whole panel is droppable area) */}
        <main
          className={`workspace-panel middle-panel ${isMiddleDropping ? 'droppable-area-active' : ''}`}
          onDragOver={(e) => {
            e.preventDefault()
            e.dataTransfer.dropEffect = 'copy'
            if (!isMiddleDropping) setIsMiddleDropping(true)
          }}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node)) {
              setIsMiddleDropping(false)
            }
          }}
          onDrop={(e) => {
            e.preventDefault()
            setIsMiddleDropping(false)
            const raw =
              e.dataTransfer.getData('text/plain') ||
              e.dataTransfer.getData('application/arix-filepath')
            if (raw) {
              const chip = raw.startsWith('@') ? raw : `@${raw}`
              setInsertedRef(chip)
            }
          }}
        >
          <div className="middle-panel-header">
            <div className="middle-tab-toggle">
              <button
                className={`toggle-tab ${middleTab === 'coder' ? 'active' : ''}`}
                onClick={() => setMiddleTab('coder')}
              >
                <Code2 size={14} />
                <span>Coder Agent</span>
              </button>
              <button
                className={`toggle-tab ${middleTab === 'assistant' ? 'active' : ''}`}
                onClick={() => setMiddleTab('assistant')}
              >
                <Bot size={14} />
                <span>Assistant</span>
              </button>
            </div>
          </div>

          <div className="middle-panel-content">
            {middleTab === 'coder' ? (
              <CoderTab
                project={project}
                pendingHandoffPrompt={pendingHandoff?.prompt}
                autoExecute={pendingHandoff?.autoRun}
                onClearHandoff={() => setPendingHandoff(undefined)}
                onFileModified={(filePath) => handleOpenFile(filePath)}
                onOpenFile={(filePath) => handleOpenFile(filePath)}
              />
            ) : (
              <DirectAssistantTab
                project={project}
                status={liveSession.status}
                audioLevel={liveSession.audioLevel}
                isThinking={liveSession.isThinking}
                currentModel={
                  appSettings.directAssistantModel || liveSession.currentModel || 'gemini-3.8-live'
                }
                transcripts={liveSession.transcripts}
                onSendText={liveSession.sendText}
                onToggleSession={
                  liveSession.status === 'connecting'
                    ? () => {}
                    : !['offline', 'error'].includes(liveSession.status)
                      ? liveSession.disconnect
                      : () =>
                          liveSession.connect({
                            apiKey: appSettings.apiKey || '',
                            voice: appSettings.voice || 'Kore',
                            model: appSettings.directAssistantModel,
                          })
                }
                onHandoffToCoder={(prompt, autoRun = true) => {
                  setPendingHandoff({ prompt, autoRun })
                  setMiddleTab('coder')
                }}
                insertedRef={insertedRef}
                isMuted={liveSession.isMuted}
                onToggleMute={liveSession.toggleMute}
              />
            )}
          </div>
        </main>

        {/* Resizer Handle 2 */}
        <div
          className="panel-resizer right-resizer"
          onMouseDown={() => {
            isDraggingRight.current = true
          }}
        />

        {/* Right Panel: Activity Dashboard (A3: Dropping open as tab, max width unconstrained) */}
        <aside
          className={`workspace-panel right-panel ${isRightDropping ? 'droppable-area-active' : ''}`}
          style={{ width: rightWidth }}
          onDragOver={(e) => {
            e.preventDefault()
            e.dataTransfer.dropEffect = 'copy'
            if (!isRightDropping) setIsRightDropping(true)
          }}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node)) {
              setIsRightDropping(false)
            }
          }}
          onDrop={(e) => {
            e.preventDefault()
            setIsRightDropping(false)
            const raw =
              e.dataTransfer.getData('application/arix-filepath') ||
              e.dataTransfer.getData('text/plain')
            if (raw) {
              const clean = raw.startsWith('@') ? raw.slice(1) : raw
              handleOpenFile(clean)
            }
          }}
        >
          <ActivityDashboard
            project={project}
            openFiles={openFiles}
            activeFilePath={activeFilePath}
            settings={appSettings}
            onSelectFile={handleOpenFile}
            onCloseFile={handleCloseFile}
            onCloseAllFiles={handleCloseAllFiles}
            onUpdateFileContent={handleUpdateContent}
            onSaveFile={handleSaveFile}
            onSaveSession={handleSaveSession}
          />
        </aside>
      </div>
    </div>
  )
}
