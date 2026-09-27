import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { Brain, Mic, Power, Settings2, Sparkles, Volume2, VolumeX } from 'lucide-react'
import { AudioOrb } from './components/AudioOrb'
import { AiControlOverlay } from './components/common/AiControlOverlay'
import { NavigationRail, type WorkspaceView } from './components/NavigationRail'
import { ProjectsHub } from './components/projects/ProjectsHub'
import { SettingsPage } from './components/settings/SettingsPage'
import { TitleBar } from './components/TitleBar'
import { TranscriptPanel } from './components/TranscriptPanel'
import { ProjectWorkspace } from './components/workspace/ProjectWorkspace'
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

export default function App() {
  const session = useArixSession()
  const [activeView, setActiveView] = useState<WorkspaceView>('voice')
  const [previousView, setPreviousView] = useState<WorkspaceView>('voice')
  const [activeProject, setActiveProject] = useState<ProjectItem | null>(null)
  const [lastActiveProject, setLastActiveProject] = useState<ProjectItem | null>(null)
  const [isInWorkspace, setIsInWorkspace] = useState(false)
  const [config, setConfig] = useState(defaultConfig)
  const [appSettings, setAppSettings] = useState<Partial<AppSettings>>({})

  const connected = !['offline', 'error'].includes(session.status)
  const latest = useMemo(() => session.transcripts.at(-1), [session.transcripts])

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
      await session.connect({ ...config, apiKey: activeKey })
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
            if (saved.apiKey) setConfig((prev) => ({ ...prev, apiKey: saved.apiKey }))
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
            <header className="workspace-header">
              <div>
                <div className="header-meta">
                  <span className="eyebrow">
                    <Sparkles size={12} /> {session.isThinking ? 'GEMINI 3.8 LIVE (EXTENDED THINKING)' : 'GEMINI 3.8 LIVE'}
                  </span>
                  <span className={session.isThinking ? 'model-pill thinking' : 'assistant-model-pill'}>
                    {session.currentModel}
                  </span>
                </div>
                <h1>Voice link</h1>
              </div>
              <div className="header-actions">
                {connected && (
                  <button
                    className={`voice-mute-btn ${session.isMuted ? 'muted' : ''}`}
                    onClick={session.toggleMute}
                    title={session.isMuted ? 'Unmute AI voice output' : 'Mute AI voice output'}
                    type="button"
                  >
                    {session.isMuted ? <VolumeX size={15} className="text-amber-400" /> : <Volume2 size={15} />}
                    <span>{session.isMuted ? 'Muted' : 'Mute AI'}</span>
                  </button>
                )}
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
              <AudioOrb status={session.status} level={session.isMuted ? 0 : session.audioLevel} />
              {latest && session.status !== 'offline' && (
                <div className={`transient-caption ${latest.role}`}>
                  <span>
                    {latest.role === 'user' ? 'YOU' : latest.role === 'system' ? 'SYSTEM' : 'ARIX'}
                  </span>
                  {latest.text}
                </div>
              )}
              <div className="session-controls">
                <p>
                  <span className={`connection-pulse ${session.status}`} />
                  {session.statusMessage}
                  {session.isMuted && (
                    <span className="muted-indicator-pill">
                      <VolumeX size={11} className="text-amber-400" /> Voice Muted
                    </span>
                  )}
                  {session.isThinking && (
                    <span className="thinking-pill-subtle">
                      <Brain size={11} /> Extended Thinking
                    </span>
                  )}
                </p>
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
          />
        </>
      )}
    </div>
  )
}
