import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { Brain, ChevronDown, ChevronUp, Mic, MicOff, Power, Settings2, Sparkles, Volume2, VolumeX } from 'lucide-react'
import { AudioOrb, setAppOrbModel, getAppOrbModel } from './components/AudioOrb'
import { OrbModelSelector } from './components/orbs/OrbModelSelector'
import { AiControlOverlay } from './components/common/AiControlOverlay'
import { MicDevicePopover } from './components/common/MicDevicePopover'
import { SpeakerDevicePopover } from './components/common/SpeakerDevicePopover'
import { NavigationRail, type WorkspaceView } from './components/NavigationRail'
import { ProjectsHub } from './components/projects/ProjectsHub'
import { SettingsPage } from './components/settings/SettingsPage'
import { TitleBar } from './components/TitleBar'
import { TranscriptPanel } from './components/TranscriptPanel'
import { ProjectWorkspace } from './components/workspace/ProjectWorkspace'
import { OverlayView } from './components/overlay/OverlayView'
import { useArixSession } from './hooks/useArixSession'
import {
  DEFAULT_LIVE_MODEL,
  type AppSettings,
  type ProjectItem,
  type SessionConfig,
} from './types/arix'

const MemoryGraphWorkspace = lazy(() =>
  import('./components/memory/MemoryGraphWorkspace').then((module) => ({
    default: module.MemoryGraphWorkspace,
  })),
)

const defaultConfig: SessionConfig = {
  apiKey: '',
  model: DEFAULT_LIVE_MODEL,
  voice: 'Kore',
  systemInstruction:
    'You are Arix, a concise, capable voice-first desktop assistant. Speak naturally and use only the tools supplied to this session. Never claim an action succeeded unless its tool result confirms success.',
}

function MainApp() {
  const session = useArixSession()
  const [activeView, setActiveView] = useState<WorkspaceView>('voice')
  const [previousView, setPreviousView] = useState<WorkspaceView>('voice')
  const [activeProject, setActiveProject] = useState<ProjectItem | null>(null)
  const [lastActiveProject, setLastActiveProject] = useState<ProjectItem | null>(null)
  const [isInWorkspace, setIsInWorkspace] = useState(false)
  const [config, setConfig] = useState(defaultConfig)
  const [appSettings, setAppSettings] = useState<Partial<AppSettings>>({ orbModel: getAppOrbModel() })
  const [isMicPopoverOpen, setIsMicPopoverOpen] = useState(false)
  const [isSpeakerPopoverOpen, setIsSpeakerPopoverOpen] = useState(false)
  const [showOrbPicker, setShowOrbPicker] = useState(false)
  const orbPickerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (orbPickerRef.current && !orbPickerRef.current.contains(e.target as Node)) {
        setShowOrbPicker(false)
      }
    }
    if (showOrbPicker) {
      window.addEventListener('mousedown', handleClickOutside)
      return () => window.removeEventListener('mousedown', handleClickOutside)
    }
  }, [showOrbPicker])

  // Resizable Conversation Tab Panel (VS-Code style divider)
  const [transcriptWidth, setTranscriptWidth] = useState<number>(() => {
    try {
      const saved = localStorage.getItem('arix_transcript_panel_width')
      return saved ? Math.max(260, Math.min(window.innerWidth - 300, Number(saved))) : 390
    } catch {
      return 390
    }
  })
  const isDraggingTranscript = useRef(false)
  const [isResizingTranscript, setIsResizingTranscript] = useState(false)

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isDraggingTranscript.current) {
        const newWidth = Math.max(260, Math.min(window.innerWidth - 300, window.innerWidth - e.clientX))
        setTranscriptWidth(newWidth)
        try {
          localStorage.setItem('arix_transcript_panel_width', String(newWidth))
        } catch {}
      }
    }
    const handleMouseUp = () => {
      if (isDraggingTranscript.current) {
        isDraggingTranscript.current = false
        setIsResizingTranscript(false)
      }
    }
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [])

  const connected = !['offline', 'error'].includes(session.status)
  const latest = useMemo(() => session.transcripts.at(-1), [session.transcripts])

  const latestAssistantSpeech = useMemo(() => {
    for (let i = session.transcripts.length - 1; i >= 0; i--) {
      const t = session.transcripts[i]
      if (t.role === 'assistant' && t.text) {
        return t.text
      }
    }
    return ''
  }, [session.transcripts])

  const latestUserSpeech = useMemo(() => {
    for (let i = session.transcripts.length - 1; i >= 0; i--) {
      const t = session.transcripts[i]
      if (t.role === 'user' && t.text) {
        return t.text
      }
    }
    return ''
  }, [session.transcripts])

  // Sync Live session state to Electron main process / Overlay window (Section 3, 5, 6)
  useEffect(() => {
    if (typeof window !== 'undefined' && window.arixOverlay?.broadcastLiveState) {
      window.arixOverlay.broadcastLiveState({
        status: session.status,
        audioLevel: session.isMuted ? 0 : session.audioLevel,
        subtitle: latestAssistantSpeech,
        userText: latestUserSpeech,
        isThinking: session.isThinking,
        isMuted: session.isMicMuted,
        permissionPrompt: session.permissionPrompt,
        desktopControlActive: session.desktopControlActive,
        desktopControlAction: session.desktopControlAction || undefined,
      })
    }
  }, [
    session.status,
    session.audioLevel,
    session.isMuted,
    session.isMicMuted,
    latestAssistantSpeech,
    latestUserSpeech,
    session.isThinking,
    session.permissionPrompt,
    session.desktopControlActive,
    session.desktopControlAction,
  ])

  // Handle IPC commands triggered from Tray or Overlay window (Section 5 & 6)
  useEffect(() => {
    if (typeof window === 'undefined' || !window.arixOverlay) return

    const cleanEnd = window.arixOverlay.onEndLiveSession?.(() => {
      session.disconnect()
    })

    const cleanMute = window.arixOverlay.onToggleMicMute?.(() => {
      session.toggleMicMute()
    })

    const cleanPerm = window.arixOverlay.onPermissionDecisionFromOverlay?.((data) => {
      if (session.resolvePermission) {
        session.resolvePermission(data.callId, data.approved)
      }
    })

    return () => {
      cleanEnd?.()
      cleanMute?.()
      cleanPerm?.()
    }
  }, [session])

  // Restore active project and in-workspace session continuity on boot (A8)
  useEffect(() => {
    try {
      const storedWorkspace = localStorage.getItem('arix_is_in_workspace') === 'true'
      const storedProj = localStorage.getItem('arix_last_active_project')
      if (storedProj) {
        const parsed = JSON.parse(storedProj) as ProjectItem
        setLastActiveProject(parsed)
        if (storedWorkspace) {
          setIsInWorkspace(true)
          setActiveProject(parsed)
        }
      }
    } catch {}
  }, [])

  // Load API key and settings from Electron SafeStorage or backend settings on boot
  useEffect(() => {
    const initSettings = async () => {
      let resolvedKey = ''
      if (window.arixSettings?.get) {
        try {
          const s = await window.arixSettings.get()
          if (s) {
            setAppSettings(s)
            if (s.apiKey) {
              resolvedKey = s.apiKey
              setConfig((prev) => ({ ...prev, apiKey: s.apiKey }))
            }
            if (s.voice) {
              setConfig((prev) => ({ ...prev, voice: s.voice }))
            }
            if (s.orbModel) {
              setAppOrbModel(s.orbModel)
            }
          }
        } catch {}
      }
      if (!resolvedKey) {
        try {
          const res = await fetch('http://127.0.0.1:8765/api/settings')
          const data = await res.json()
          if (data) {
            setAppSettings((prev) => ({ ...data, ...prev }))
            if (data.apiKey) {
              resolvedKey = data.apiKey
              setConfig((prev) => ({ ...prev, apiKey: data.apiKey }))
            }
            if (data.voice) {
              setConfig((prev) => ({ ...prev, voice: data.voice }))
            }
            if (data.orbModel) {
              setAppOrbModel(data.orbModel)
            }
          }
        } catch {}
      }
    }
    initSettings()
  }, [])

  const handleOpenSettings = () => {
    setPreviousView(activeView === 'settings' ? 'voice' : activeView)
    setActiveView('settings')
  }

  // Handle navigation from rail (A8: return to active workspace if user left mid-workspace)
  const handleRailNavigate = (view: WorkspaceView) => {
    if (view === 'settings') {
      handleOpenSettings()
    } else if (view === 'code') {
      if (isInWorkspace && lastActiveProject) {
        setActiveProject(lastActiveProject)
        setActiveView('workspace')
      } else {
        setActiveView('code')
      }
    } else {
      setActiveView(view)
    }
  }

  const toggleSession = async () => {
    if (connected) return session.disconnect()
    const activeKey = (config.apiKey || appSettings.apiKey || '').trim()
    if (!activeKey) return handleOpenSettings()
    try {
      await session.connect({
        ...config,
        apiKey: activeKey,
        voice: appSettings.voice || config.voice || 'Kore',
      })
    } catch {
      handleOpenSettings()
    }
  }

  return (
    <div
      className={`app-shell antialiased ${
        activeView === 'memory'
          ? 'memory-mode'
          : activeView === 'settings'
            ? 'settings-mode'
            : activeView === 'code' || activeView === 'workspace'
              ? 'workspace-mode'
              : ''
      }`}
      style={
        {
          '--transcript-panel-width': `${transcriptWidth}px`,
        } as React.CSSProperties
      }
    >
      <TitleBar />

      {/* Persistent Desktop Automation Control Banner (D3) */}
      {session.desktopControlActive && (
        <div className="desktop-control-banner" role="alert">
          <div className="desktop-banner-indicator" />
          <span className="desktop-banner-text">
            <strong>Arix is controlling your desktop</strong> {session.desktopControlAction ? `(${session.desktopControlAction})` : ''} — Move mouse or press <strong>Esc</strong> to stop immediately.
          </span>
          <button className="desktop-banner-stop-btn" onClick={session.stopDesktopControl}>
            Halt Control
          </button>
        </div>
      )}

      {/* AI In-App Self-Control Overlay (Part B) */}
      <AiControlOverlay
        action={session.inAppAction}
        enabled={appSettings.allowInAppSelfControl === true}
        onNavigate={(view, projectPath) => {
          if (view === 'settings') {
            handleOpenSettings()
          } else if (view === 'workspace' && (projectPath || lastActiveProject)) {
            if (projectPath) {
              const p: ProjectItem = {
                id: projectPath,
                name: projectPath.split('/').pop() || projectPath,
                path: projectPath,
                lastOpened: Date.now(),
              }
              setActiveProject(p)
              setLastActiveProject(p)
            } else if (lastActiveProject) {
              setActiveProject(lastActiveProject)
            }
            setIsInWorkspace(true)
            setActiveView('workspace')
          } else if (view === 'code') {
            setIsInWorkspace(false)
            setActiveView('code')
          } else {
            setActiveView(view)
          }
        }}
        onOverride={() => {
          // User pressed Esc or moved mouse — halt AI control
        }}
      />

      <NavigationRail
        activeView={activeView}
        onNavigate={handleRailNavigate}
        onSettings={handleOpenSettings}
      />

      {activeView === 'settings' ? (
        <SettingsPage
          onBack={() => setActiveView(previousView || 'voice')}
          onSettingsSaved={(saved) => {
            setAppSettings(saved)
            setConfig((prev) => ({
              ...prev,
              apiKey: saved.apiKey || prev.apiKey,
              voice: saved.voice || prev.voice,
              model: saved.directAssistantModel || prev.model,
            }))
            if (saved.voice && session.status !== 'offline') {
              session.setVoice(saved.voice)
            }
            if (saved.orbModel) {
              setAppOrbModel(saved.orbModel)
            }
          }}
        />
      ) : activeView === 'code' ? (
        <ProjectsHub
          onOpenProject={(project) => {
            setActiveProject(project)
            setLastActiveProject(project)
            setIsInWorkspace(true)
            try {
              localStorage.setItem('arix_is_in_workspace', 'true')
              localStorage.setItem('arix_last_active_project', JSON.stringify(project))
            } catch {}
            setActiveView('workspace')
          }}
          onBackToHome={() => setActiveView('voice')}
        />
      ) : activeView === 'workspace' && activeProject ? (
        <ProjectWorkspace
          project={activeProject}
          onBackToHub={() => {
            // Explicitly clicked Back button inside workspace (A8)
            setIsInWorkspace(false)
            try {
              localStorage.setItem('arix_is_in_workspace', 'false')
            } catch {}
            setActiveView('code')
          }}
          onSwitchProject={(p) => {
            setActiveProject(p)
            setLastActiveProject(p)
            try {
              localStorage.setItem('arix_last_active_project', JSON.stringify(p))
            } catch {}
          }}
          liveSession={session}
        />
      ) : activeView === 'memory' ? (
        <Suspense
          fallback={<main className="memory-workspace memory-loading">Loading memory graph…</main>}
        >
          <MemoryGraphWorkspace />
        </Suspense>
      ) : (
        /* Voice Command Center (Default View) */
        <>
          <main className="command-center" id="command-center">
            <header className="workspace-header home-header">
              <div className="home-header-title-row">
                <h1>Voice link</h1>
                <span className="live-badge-green">
                  <span className="live-dot" />
                  {session.isThinking ? 'GEMINI 3.8 LIVE (EXTENDED THINKING)' : 'GEMINI 3.8 LIVE'}
                </span>
                <span className={session.isThinking ? 'model-pill thinking' : 'assistant-model-pill'}>
                  {session.currentModel}
                </span>
              </div>
              <div className="header-actions">
                {/* Quick Orb Model Switcher */}
                <div className="relative orb-quick-switch-wrap" ref={orbPickerRef}>
                  <button
                    className="orb-model-trigger"
                    onClick={() => setShowOrbPicker((v) => !v)}
                    title="Switch kinetic Orb model (Cyber HUD, Jules Radial, or Quantum WebGL)"
                    type="button"
                  >
                    <Sparkles size={14} className="text-cyan-400" />
                    <span>
                      Orb: {appSettings.orbModel === 'jules' ? 'Jules Radial' : appSettings.orbModel === 'quantum' ? 'Quantum WebGL' : 'Cyber HUD'}
                    </span>
                    <ChevronDown size={13} className={`transition-transform duration-200 ${showOrbPicker ? 'rotate-180' : ''}`} />
                  </button>
                  {showOrbPicker && (
                    <div className="orb-quick-picker-dropdown">
                      <div className="orb-picker-header">
                        <span>Select Orb Model</span>
                      </div>
                      <OrbModelSelector
                        selectedModel={appSettings.orbModel || 'classic'}
                        onSelectModel={(model) => {
                          setAppSettings((prev) => ({ ...prev, orbModel: model }))
                          setAppOrbModel(model)
                          setShowOrbPicker(false)
                        }}
                        compact
                      />
                    </div>
                  )}
                </div>

                <button
                  className={`deep-think-toggle ${session.isThinking ? 'active' : ''}`}
                  onClick={session.toggleThinking}
                  title={
                    session.isThinking
                      ? 'Deep Think is ON (gemini-3.8-live-extended-thinking) - Click to switch to normal mode'
                      : 'Deep Think is OFF (gemini-3.8-live) - Click to switch to extended thinking'
                  }
                  id="deep-think-toggle"
                  type="button"
                >
                  <Brain size={15} />
                  <span>Deep Think</span>
                  <span className="toggle-pill">{session.isThinking ? 'ON' : 'OFF'}</span>
                </button>
                <button className="settings-trigger" onClick={handleOpenSettings}>
                  <Settings2 size={16} /> Configure
                </button>
              </div>
            </header>

            <section className="voice-workspace" id="voice-workspace">
              <div className="ambient ambient-one" />
              <div className="ambient ambient-two" />
              <AudioOrb status={session.status} level={session.isMuted ? 0 : session.audioLevel} model={appSettings.orbModel} />
              {latest && session.status !== 'offline' && (
                <div className={`transient-caption ${latest.role}`}>
                  <span>
                    {latest.role === 'user' ? 'YOU' : latest.role === 'system' ? 'SYSTEM' : 'ARIX'}
                  </span>
                  {latest.text}
                </div>
              )}
              <div className="session-controls">
                {/* Audio Dock with Separate Mic and Speaker Windows */}
                <div className="session-dock-container">
                  <div className="discord-voice-dock" role="toolbar" aria-label="Audio and session controls">
                    {/* Microphone Toggle Split Button */}
                    <div className={`discord-dock-group ${session.isMicMuted ? 'is-muted' : ''}`}>
                      <button
                        type="button"
                        className={`discord-dock-btn ${session.isMicMuted ? 'muted' : 'active'}`}
                        onClick={session.toggleMicMute}
                        title={session.isMicMuted ? 'Turn Microphone On' : 'Turn Microphone Off (Mute)'}
                        aria-label={session.isMicMuted ? 'Turn Microphone On' : 'Turn Microphone Off'}
                      >
                        {session.isMicMuted ? (
                          <MicOff size={17} className="text-red-400" />
                        ) : (
                          <Mic size={17} className="text-emerald-400" />
                        )}
                        <span className="dock-btn-label">{session.isMicMuted ? 'Mic Off' : 'Mic'}</span>
                      </button>
                      <button
                        type="button"
                        className={`discord-dock-chevron ${isMicPopoverOpen ? 'open' : ''}`}
                        onClick={() => {
                          setIsMicPopoverOpen((prev) => !prev)
                          setIsSpeakerPopoverOpen(false)
                        }}
                        title="Microphone & Input Audio Settings"
                        aria-label="Microphone settings"
                      >
                        <ChevronUp size={13} />
                      </button>

                      {/* Dedicated Microphone Settings Window */}
                      <MicDevicePopover
                        isOpen={isMicPopoverOpen}
                        onClose={() => setIsMicPopoverOpen(false)}
                        isMicMuted={session.isMicMuted}
                        onToggleMicMute={session.toggleMicMute}
                        inputVolume={session.inputVolume}
                        onChangeInputVolume={session.setInputVolume}
                        inputDeviceId={session.inputDeviceId}
                        onChangeInputDeviceId={session.setInputDevice}
                        inputDevices={session.audioDevices.inputs}
                        onRefreshDevices={session.refreshDevices}
                        rawRmsVal={session.rawRmsVal}
                      />
                    </div>

                    {/* Central Live Session Button */}
                    <button
                      className={`session-button ${connected ? 'disconnect' : ''}`}
                      onClick={toggleSession}
                      disabled={session.status === 'connecting'}
                    >
                      {connected ? <Power size={18} /> : <Mic size={18} />}
                      {session.status === 'connecting'
                        ? 'Establishing link…'
                        : connected
                          ? 'End live session'
                          : 'Start live session'}
                    </button>

                    {/* AI Speaker Voice Mute Split Button */}
                    <div className={`discord-dock-group ${session.isMuted ? 'is-muted' : ''}`}>
                      <button
                        type="button"
                        className={`discord-dock-btn ${session.isMuted ? 'muted' : 'active'}`}
                        onClick={session.toggleMute}
                        title={session.isMuted ? 'Unmute AI Voice Output' : 'Mute AI Voice Output (Deafen)'}
                        aria-label={session.isMuted ? 'Unmute AI Voice Output' : 'Mute AI Voice Output'}
                      >
                        {session.isMuted ? (
                          <VolumeX size={17} className="text-amber-400" />
                        ) : (
                          <Volume2 size={17} className="text-cyan-400" />
                        )}
                        <span className="dock-btn-label">{session.isMuted ? 'AI Muted' : 'AI Voice'}</span>
                      </button>
                      <button
                        type="button"
                        className={`discord-dock-chevron ${isSpeakerPopoverOpen ? 'open' : ''}`}
                        onClick={() => {
                          setIsSpeakerPopoverOpen((prev) => !prev)
                          setIsMicPopoverOpen(false)
                        }}
                        title="Speaker & Output Audio Settings"
                        aria-label="Speaker settings"
                      >
                        <ChevronUp size={13} />
                      </button>

                      {/* Dedicated Speaker & Output Settings Window */}
                      <SpeakerDevicePopover
                        isOpen={isSpeakerPopoverOpen}
                        onClose={() => setIsSpeakerPopoverOpen(false)}
                        isAiMuted={session.isMuted}
                        onToggleAiMute={session.toggleMute}
                        outputVolume={session.outputVolume}
                        onChangeOutputVolume={session.setOutputVolume}
                        outputDeviceId={session.outputDeviceId}
                        onChangeOutputDeviceId={session.setOutputDevice}
                        outputDevices={session.audioDevices.outputs}
                        onRefreshDevices={session.refreshDevices}
                      />
                    </div>
                  </div>
                </div>

                <p>
                  <span className={`connection-pulse ${session.status}`} />
                  {session.statusMessage}
                  {session.isMicMuted && (
                    <span className="muted-indicator-pill mic-muted">
                      <MicOff size={11} className="text-red-400" /> Mic Off
                    </span>
                  )}
                  {session.isMuted && (
                    <span className="muted-indicator-pill">
                      <VolumeX size={11} className="text-amber-400" /> AI Muted
                    </span>
                  )}
                  {session.isThinking && (
                    <span className="thinking-pill-subtle">
                      <Brain size={11} /> Extended Thinking
                    </span>
                  )}
                </p>
                <span className="shortcut-hint">
                  Say &quot;use deep think&quot; to switch to extended thinking anytime
                </span>
              </div>
            </section>
          </main>
          <TranscriptPanel
            status={session.status}
            transcripts={session.transcripts}
            onSend={session.sendText}
            onClear={session.clearTranscripts}
            onStartResize={() => {
              isDraggingTranscript.current = true
              setIsResizingTranscript(true)
            }}
            isResizing={isResizingTranscript}
          />
        </>
      )}
    </div>
  )
}

export default function App() {
  const isOverlayMode = typeof window !== 'undefined' && (
    new URLSearchParams(window.location.search).get('mode') === 'overlay' ||
    window.location.hash === '#overlay'
  )

  if (isOverlayMode) {
    return <OverlayView />
  }

  return <MainApp />
}

