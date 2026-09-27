import React, { useEffect, useState } from 'react'
import {
  AlertTriangle,
  ArrowLeft,
  Bot,
  Boxes,
  Brain,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Cpu,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  FolderLock,
  FolderOpen,
  Github,
  Globe,
  KeyRound,
  Layers,
  Mic,
  MonitorCheck,
  Palette,
  RefreshCw,
  RotateCcw,
  Sliders,
  Sparkles,
  Terminal,
  Volume2,
  Wrench,
  XCircle,
} from 'lucide-react'
import {
  DEFAULT_LIVE_MODEL,
  THINKING_LIVE_MODEL,
  type AppSettings,
  type MCPStatusData,
  type SweKitStatus,
} from '../../types/arix'

interface Props {
  onBack: () => void
  onSettingsSaved?: (settings: AppSettings) => void
}

const defaultSettings: AppSettings = {
  apiKey: '',
  directAssistantModel: DEFAULT_LIVE_MODEL,
  coderAgentModel: THINKING_LIVE_MODEL,
  extendedThinkingEnabled: true,
  thinkingBudget: 'high',
  voice: 'Kore',
  inputDeviceId: 'default',
  outputDeviceId: 'default',
  vadSensitivity: 'medium',
  pushToTalk: false,
  directAssistantInstructions:
    'You are Arix, an articulate, voice-first desktop engineering partner. Listen to the user, understand their goals, synthesize clear structured plans, and coordinate with the Coder Agent.',
  coderAgentInstructions:
    'You are Arix Coder, an autonomous coding agent. Execute plans thoroughly, read minimal necessary file slices, make batched edits, verify code with tests and browser automation, and report clearly.',
  longTermMemoryEnabled: true,
  memoryLocation: 'local',
  allowMouseKeyboardControl: true,
  allowDesktopControl: true,
  desktopControlAlwaysAllowedSession: false,
  allowAutoTerminalCommands: false,
  allowAutonomousBrowser: true,
  allowInAppSelfControl: false,
  allowedWorkspaceDirectories: [],
  theme: 'glass-black',
  editorTheme: 'vs-dark',
  editorFontSize: 13,
  editorFontFamily: "'Cascadia Code', 'Fira Code', 'JetBrains Mono', Consolas, monospace",
  editorTabSize: 2,
  editorMinimap: true,
  composioApiKey: '',
  githubToken: '',
  githubUsername: '',
  githubAvatarUrl: '',
}

export function SettingsPage({ onBack, onSettingsSaved }: Props) {
  const [settings, setSettings] = useState<AppSettings>(defaultSettings)
  const [showKey, setShowKey] = useState(false)
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'success' | 'failed'>('idle')
  const [testMessage, setTestMessage] = useState('')
  const [saveToast, setSaveToast] = useState(false)
  const [activeSection, setActiveSection] = useState<'api' | 'voice' | 'behavior' | 'permissions' | 'appearance' | 'integrations' | 'mcp' | 'diagnostics'>('api')
  const [resetConfirm, setResetConfirm] = useState(false)
  const [audioInputs, setAudioInputs] = useState<MediaDeviceInfo[]>([])
  const [audioOutputs, setAudioOutputs] = useState<MediaDeviceInfo[]>([])

  // SWE-Kit & Integrations state
  const [sweStatus, setSweStatus] = useState<SweKitStatus | null>(null)
  const [loadingSweStatus, setLoadingSweStatus] = useState(false)
  const [showComposioKey, setShowComposioKey] = useState(false)
  const [githubTokenInput, setGithubTokenInput] = useState('')
  const [githubLoading, setGithubLoading] = useState(false)
  const [githubMsg, setGithubMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [installStatus, setInstallStatus] = useState<{
    status: 'idle' | 'running' | 'completed' | 'failed'
    step: string
    progress: number
    logs: string[]
    error?: string | null
  }>({ status: 'idle', step: '', progress: 0, logs: [] })

  // MCP Servers state
  const [mcpStatus, setMcpStatus] = useState<MCPStatusData | null>(null)
  const [loadingMcp, setLoadingMcp] = useState(false)
  const [togglingServer, setTogglingServer] = useState<string | null>(null)
  const [restartingServer, setRestartingServer] = useState<string | null>(null)
  const [expandedMcpTools, setExpandedMcpTools] = useState<Record<string, boolean>>({})
  const [expandedMcpLogs, setExpandedMcpLogs] = useState<Record<string, boolean>>({})

  useEffect(() => {
    // Load persisted settings from Electron IPC or fallback to backend REST
    if (window.arixSettings?.get) {
      window.arixSettings.get().then((loaded) => {
        if (loaded) setSettings((prev) => ({ ...prev, ...loaded }))
      }).catch(console.error)
    } else {
      fetch('http://127.0.0.1:8765/api/settings')
        .then((res) => res.json())
        .then((data) => {
          if (data) setSettings((prev) => ({ ...prev, ...data }))
        })
        .catch(() => {})
    }

    // Enumerate media devices
    if (navigator.mediaDevices?.enumerateDevices) {
      navigator.mediaDevices.enumerateDevices().then((devices) => {
        setAudioInputs(devices.filter((d) => d.kind === 'audioinput'))
        setAudioOutputs(devices.filter((d) => d.kind === 'audiooutput'))
      }).catch(() => {})
    }

    loadSweStatus()
  }, [])

  const loadSweStatus = async () => {
    setLoadingSweStatus(true)
    try {
      const res = await fetch('http://127.0.0.1:8765/api/swe-kit/status')
      if (res.ok) {
        const data = await res.json()
        setSweStatus(data)
      }
    } catch (err) {
      console.error('Failed to load SWE-Kit status:', err)
    } finally {
      setLoadingSweStatus(false)
    }
  }

  const handleConnectGithub = async () => {
    if (!githubTokenInput.trim()) return
    setGithubLoading(true)
    setGithubMsg(null)
    try {
      const res = await fetch('http://127.0.0.1:8765/api/swe-kit/github/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: githubTokenInput.trim() }),
      })
      const data = await res.json()
      if (data.ok) {
        setGithubMsg({ type: 'success', text: data.message })
        update('githubToken', githubTokenInput.trim())
        update('githubUsername', data.username)
        update('githubAvatarUrl', data.avatar_url)
        setGithubTokenInput('')
        loadSweStatus()
      } else {
        setGithubMsg({ type: 'error', text: data.error || 'Failed to connect GitHub account' })
      }
    } catch (err: any) {
      setGithubMsg({ type: 'error', text: err.message || 'Connection request failed' })
    } finally {
      setGithubLoading(false)
    }
  }

  const handleDisconnectGithub = async () => {
    setGithubLoading(true)
    try {
      await fetch('http://127.0.0.1:8765/api/swe-kit/github/disconnect', { method: 'POST' })
      update('githubToken', '')
      update('githubUsername', '')
      update('githubAvatarUrl', '')
      setGithubMsg(null)
      loadSweStatus()
    } catch (err) {
      console.error(err)
    } finally {
      setGithubLoading(false)
    }
  }

  const handleInstallSweTools = async () => {
    try {
      setInstallStatus({
        status: 'running',
        step: 'Starting background installation...',
        progress: 5,
        logs: ['Spawning background pip installer for swekit and composio-core...'],
      })
      const res = await fetch('http://127.0.0.1:8765/api/swe-kit/install', { method: 'POST' })
      if (!res.ok) {
        const data = await res.json()
        setInstallStatus({
          status: 'failed',
          step: 'Failed to start installation',
          progress: 0,
          logs: [],
          error: data.error || 'Installation start request failed',
        })
        return
      }
      const interval = setInterval(async () => {
        try {
          const pollRes = await fetch('http://127.0.0.1:8765/api/swe-kit/install-status')
          if (pollRes.ok) {
            const pollData = await pollRes.json()
            setInstallStatus(pollData)
            if (pollData.status === 'completed' || pollData.status === 'failed') {
              clearInterval(interval)
              loadSweStatus()
            }
          }
        } catch {
          // ignore transient poll error
        }
      }, 1200)
    } catch (err: any) {
      setInstallStatus({
        status: 'failed',
        step: 'Network error',
        progress: 0,
        logs: [],
        error: err.message,
      })
    }
  }

  const loadMcpStatus = async () => {
    setLoadingMcp(true)
    try {
      const res = await fetch('http://127.0.0.1:8765/api/mcp/status')
      if (res.ok) {
        const data = await res.json()
        setMcpStatus(data)
      }
    } catch (err) {
      console.error('Failed to load MCP status:', err)
    } finally {
      setLoadingMcp(false)
    }
  }

  const handleToggleMcpServer = async (serverId: string, enabled: boolean) => {
    setTogglingServer(serverId)
    try {
      const res = await fetch('http://127.0.0.1:8765/api/mcp/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ server_id: serverId, enabled }),
      })
      if (res.ok) {
        await loadMcpStatus()
      }
    } catch (err) {
      console.error('Failed to toggle MCP server:', err)
    } finally {
      setTogglingServer(null)
    }
  }

  const handleRestartMcpServer = async (serverId: string) => {
    setRestartingServer(serverId)
    try {
      const res = await fetch('http://127.0.0.1:8765/api/mcp/restart', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ server_id: serverId }),
      })
      if (res.ok) {
        await loadMcpStatus()
      }
    } catch (err) {
      console.error('Failed to restart MCP server:', err)
    } finally {
      setRestartingServer(null)
    }
  }

  useEffect(() => {
    if (activeSection === 'mcp') {
      loadMcpStatus()
    }
  }, [activeSection])

  const update = <K extends keyof AppSettings>(key: K, val: AppSettings[K]) => {
    setSettings((prev) => ({ ...prev, [key]: val }))
  }

  const handleSave = async () => {
    try {
      if (window.arixSettings?.set) {
        await window.arixSettings.set(settings)
      } else {
        await fetch('http://127.0.0.1:8765/api/settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(settings),
        })
      }
      onSettingsSaved?.(settings)
      setSaveToast(true)
      setTimeout(() => setSaveToast(false), 3000)
    } catch (err) {
      console.error('Save failed:', err)
    }
  }

  const handleTestConnection = async () => {
    setTestStatus('testing')
    setTestMessage('Testing API credentials...')
    try {
      if (window.arixSettings?.testApiKey) {
        const res = await window.arixSettings.testApiKey(settings.apiKey)
        if (res.ok) {
          setTestStatus('success')
          setTestMessage(res.message || 'Connected successfully to Gemini API.')
        } else {
          setTestStatus('failed')
          setTestMessage(res.message || 'Verification failed. Check your API key.')
        }
      } else {
        const res = await fetch('http://127.0.0.1:8765/api/settings/test-key', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ apiKey: settings.apiKey }),
        })
        const data = await res.json()
        if (data.ok) {
          setTestStatus('success')
          setTestMessage(data.message || 'Connected successfully!')
        } else {
          setTestStatus('failed')
          setTestMessage(data.message || 'Connection failed.')
        }
      }
    } catch (err: any) {
      setTestStatus('failed')
      setTestMessage(`Test failed: ${err.message || err}`)
    }
  }

  const handleReset = async () => {
    if (window.arixSettings?.reset) {
      const reset = await window.arixSettings.reset()
      setSettings(reset)
    } else {
      setSettings(defaultSettings)
      await fetch('http://127.0.0.1:8765/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(defaultSettings),
      })
    }
    setResetConfirm(false)
    setSaveToast(true)
    setTimeout(() => setSaveToast(false), 2500)
  }

  const handleOpenLogs = () => {
    if (window.arixDesktop?.openLogsFolder) {
      window.arixDesktop.openLogsFolder()
    } else {
      window.open('http://127.0.0.1:8765/api/logs', '_blank')
    }
  }

  return (
    <div className="settings-page-root">
      {/* Top Header */}
      <header className="settings-header">
        <div className="settings-header-left">
          <button className="back-button" onClick={onBack} title="Return to previous view">
            <ArrowLeft size={18} />
            <span>Back</span>
          </button>
          <div className="settings-header-title">
            <div className="eyebrow">
              <Sparkles size={12} /> SYSTEM PREFERENCES
            </div>
            <h1>Arix AI Settings</h1>
          </div>
        </div>
        <div className="settings-header-actions">
          {saveToast && (
            <div className="save-toast">
              <CheckCircle2 size={16} />
              <span>Settings saved to secure disk store</span>
            </div>
          )}
          <button className="primary-button" onClick={handleSave}>
            Save Changes
          </button>
        </div>
      </header>

      {/* Main Container */}
      <div className="settings-container">
        {/* Navigation Sidebar */}
        <aside className="settings-nav-sidebar">
          <button
            className={`nav-tab ${activeSection === 'api' ? 'active' : ''}`}
            onClick={() => setActiveSection('api')}
          >
            <KeyRound size={17} />
            <span>AI Provider & Models</span>
          </button>
          <button
            className={`nav-tab ${activeSection === 'voice' ? 'active' : ''}`}
            onClick={() => setActiveSection('voice')}
          >
            <Mic size={17} />
            <span>Voice & Audio</span>
          </button>
          <button
            className={`nav-tab ${activeSection === 'behavior' ? 'active' : ''}`}
            onClick={() => setActiveSection('behavior')}
          >
            <Brain size={17} />
            <span>AI Behavior & Memory</span>
          </button>
          <button
            className={`nav-tab ${activeSection === 'permissions' ? 'active' : ''}`}
            onClick={() => setActiveSection('permissions')}
          >
            <MonitorCheck size={17} />
            <span>Automation & Safety</span>
          </button>
          <button
            className={`nav-tab ${activeSection === 'appearance' ? 'active' : ''}`}
            onClick={() => setActiveSection('appearance')}
          >
            <Palette size={17} />
            <span>Appearance & Editor</span>
          </button>
          <button
            className={`nav-tab ${activeSection === 'integrations' ? 'active' : ''}`}
            onClick={() => setActiveSection('integrations')}
          >
            <Wrench size={17} />
            <span>Integrations & SWE-Kit</span>
          </button>
          <button
            className={`nav-tab ${activeSection === 'mcp' ? 'active' : ''}`}
            onClick={() => setActiveSection('mcp')}
          >
            <Boxes size={17} />
            <span>MCP Servers</span>
          </button>
          <button
            className={`nav-tab ${activeSection === 'diagnostics' ? 'active' : ''}`}
            onClick={() => setActiveSection('diagnostics')}
          >
            <Cpu size={17} />
            <span>Diagnostics & Logs</span>
          </button>
        </aside>

        {/* Content Area */}
        <main className="settings-content-panel">
          {/* Section 1: AI Provider / API */}
          {activeSection === 'api' && (
            <section className="settings-card">
              <div className="card-header">
                <div className="card-icon"><KeyRound size={20} /></div>
                <div>
                  <h2>AI Provider & API Configuration</h2>
                  <p className="card-desc">Google Gemini API credentials, Live voice models, and Extended Thinking agents.</p>
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">
                  <span>Gemini API Key</span>
                  <a
                    href="https://aistudio.google.com/apikey"
                    target="_blank"
                    rel="noreferrer"
                    className="helper-link"
                  >
                    <ExternalLink size={12} /> Get API Key from Google AI Studio
                  </a>
                </label>
                <div className="secret-input-wrapper">
                  <input
                    type={showKey ? 'text' : 'password'}
                    value={settings.apiKey}
                    onChange={(e) => update('apiKey', e.target.value)}
                    placeholder="AIzaSy..."
                    className="glass-input"
                    autoComplete="off"
                  />
                  <button
                    type="button"
                    className="toggle-reveal"
                    onClick={() => setShowKey(!showKey)}
                    title={showKey ? 'Hide key' : 'Show key'}
                  >
                    {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                  <button
                    type="button"
                    className="test-btn"
                    onClick={handleTestConnection}
                    disabled={!settings.apiKey || testStatus === 'testing'}
                  >
                    {testStatus === 'testing' ? <RefreshCw size={14} className="spin" /> : 'Test Connection'}
                  </button>
                </div>
                {testStatus !== 'idle' && (
                  <div className={`status-banner ${testStatus}`}>
                    {testStatus === 'success' ? <CheckCircle2 size={15} /> : <XCircle size={15} />}
                    <span>{testMessage}</span>
                  </div>
                )}
                <small className="field-hint">
                  Your key is securely encrypted on disk using OS-level credential protection (safeStorage).
                </small>
              </div>

              <div className="form-grid-2">
                <div className="form-group">
                  <label className="form-label">Direct Assistant Model (Live Voice)</label>
                  <select
                    className="glass-select"
                    value={settings.directAssistantModel}
                    onChange={(e) => update('directAssistantModel', e.target.value)}
                  >
                    <option value="gemini-3.8-live">gemini-3.8-live (Default & Recommended)</option>
                    <option value="gemini-3.1-flash-live-preview">gemini-3.1-flash-live-preview</option>
                    <option value="gemini-2.0-flash-exp">gemini-2.0-flash-exp</option>
                  </select>
                  <small className="field-hint">Used for bidirectional real-time conversation.</small>
                </div>

                <div className="form-group">
                  <label className="form-label">Coder Agent Model (Autonomous Coding)</label>
                  <select
                    className="glass-select"
                    value={settings.coderAgentModel}
                    onChange={(e) => update('coderAgentModel', e.target.value)}
                  >
                    <option value="gemini-3.8-live-extended-thinking">gemini-3.8-live-extended-thinking</option>
                    <option value="gemini-3.8-flash">gemini-3.8-flash</option>
                    <option value="gemini-3-pro">gemini-3-pro</option>
                    <option value="gemini-2.5-pro">gemini-2.5-pro</option>
                  </select>
                  <small className="field-hint">Executes code editing, file management, and tool calls.</small>
                </div>
              </div>

              <div className="form-group checkbox-group">
                <label className="switch-label">
                  <input
                    type="checkbox"
                    checked={settings.extendedThinkingEnabled}
                    onChange={(e) => update('extendedThinkingEnabled', e.target.checked)}
                  />
                  <span className="switch-slider" />
                  <span className="switch-text">Enable Extended Thinking by default</span>
                </label>
                <small className="field-hint">
                  Allows models to reason thoroughly before committing code changes and tool calls.
                </small>
              </div>

              {settings.extendedThinkingEnabled && (
                <div className="form-group">
                  <label className="form-label">Thinking Budget / Depth</label>
                  <div className="radio-pill-group">
                    {(['minimal', 'low', 'medium', 'high'] as const).map((level) => (
                      <button
                        key={level}
                        type="button"
                        className={`pill-btn ${settings.thinkingBudget === level ? 'active' : ''}`}
                        onClick={() => update('thinkingBudget', level)}
                      >
                        {level.toUpperCase()}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </section>
          )}

          {/* Section 2: Voice & Audio */}
          {activeSection === 'voice' && (
            <section className="settings-card">
              <div className="card-header">
                <div className="card-icon"><Mic size={20} /></div>
                <div>
                  <h2>Voice & Audio Engine</h2>
                  <p className="card-desc">Configure prebuilt neural voices, microphone inputs, and detection thresholds.</p>
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">Gemini Live Voice Persona</label>
                <div className="voice-selector-grid">
                  {(['Kore', 'Aoede', 'Charon', 'Fenrir', 'Puck'] as const).map((v) => (
                    <button
                      key={v}
                      type="button"
                      className={`voice-card ${settings.voice === v ? 'selected' : ''}`}
                      onClick={() => update('voice', v)}
                    >
                      <Volume2 size={18} />
                      <span className="voice-name">{v}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="form-grid-2">
                <div className="form-group">
                  <label className="form-label">Input Device (Microphone)</label>
                  <select
                    className="glass-select"
                    value={settings.inputDeviceId}
                    onChange={(e) => update('inputDeviceId', e.target.value)}
                  >
                    <option value="default">System Default</option>
                    {audioInputs.map((d) => (
                      <option key={d.deviceId} value={d.deviceId}>
                        {d.label || `Microphone ${d.deviceId.slice(0, 5)}`}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="form-group">
                  <label className="form-label">Output Device (Speakers)</label>
                  <select
                    className="glass-select"
                    value={settings.outputDeviceId}
                    onChange={(e) => update('outputDeviceId', e.target.value)}
                  >
                    <option value="default">System Default</option>
                    {audioOutputs.map((d) => (
                      <option key={d.deviceId} value={d.deviceId}>
                        {d.label || `Speaker ${d.deviceId.slice(0, 5)}`}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="form-grid-2">
                <div className="form-group">
                  <label className="form-label">Voice Activity Detection (VAD) Sensitivity</label>
                  <div className="radio-pill-group">
                    {(['low', 'medium', 'high'] as const).map((lvl) => (
                      <button
                        key={lvl}
                        type="button"
                        className={`pill-btn ${settings.vadSensitivity === lvl ? 'active' : ''}`}
                        onClick={() => update('vadSensitivity', lvl)}
                      >
                        {lvl.toUpperCase()}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="form-group checkbox-group">
                  <label className="switch-label">
                    <input
                      type="checkbox"
                      checked={settings.pushToTalk}
                      onChange={(e) => update('pushToTalk', e.target.checked)}
                    />
                    <span className="switch-slider" />
                    <span className="switch-text">Push-to-Talk Mode</span>
                  </label>
                  <small className="field-hint">Audio is only streamed while holding Spacebar.</small>
                </div>
              </div>
            </section>
          )}

          {/* Section 3: AI Behavior & Memory */}
          {activeSection === 'behavior' && (
            <section className="settings-card">
              <div className="card-header">
                <div className="card-icon"><Brain size={20} /></div>
                <div>
                  <h2>AI Behavior & Memory System</h2>
                  <p className="card-desc">System directives for the Direct Assistant, Coder Agent persona, and persistent memory.</p>
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">Direct Assistant Directive</label>
                <textarea
                  className="glass-textarea"
                  rows={4}
                  value={settings.directAssistantInstructions}
                  onChange={(e) => update('directAssistantInstructions', e.target.value)}
                  placeholder="Direct Assistant behavior and persona..."
                />
              </div>

              <div className="form-group">
                <label className="form-label">Coder Agent Directive</label>
                <textarea
                  className="glass-textarea"
                  rows={4}
                  value={settings.coderAgentInstructions}
                  onChange={(e) => update('coderAgentInstructions', e.target.value)}
                  placeholder="Autonomous Coder behavior, code formatting, and verification guidelines..."
                />
              </div>

              <div className="form-group checkbox-group">
                <label className="switch-label">
                  <input
                    type="checkbox"
                    checked={settings.longTermMemoryEnabled}
                    onChange={(e) => update('longTermMemoryEnabled', e.target.checked)}
                  />
                  <span className="switch-slider" />
                  <span className="switch-text">Enable Continuous Long-Term Knowledge Graph Memory</span>
                </label>
                <small className="field-hint">
                  Stores user preferences, project insights, and architectural decisions across sessions.
                </small>
              </div>
            </section>
          )}

          {/* Section 4: Automation & Safety */}
          {activeSection === 'permissions' && (
            <section className="settings-card">
              <div className="card-header">
                <div className="card-icon"><MonitorCheck size={20} /></div>
                <div>
                  <h2>Automation & Execution Permissions</h2>
                  <p className="card-desc">Control autonomous machine interaction, terminal execution, and browser automation.</p>
                </div>
              </div>

              <div className="form-group checkbox-group">
                <label className="switch-label">
                  <input
                    type="checkbox"
                    checked={settings.allowMouseKeyboardControl}
                    onChange={(e) => update('allowMouseKeyboardControl', e.target.checked)}
                  />
                  <span className="switch-slider" />
                  <span className="switch-text">Allow AI to interact with Mouse & Keyboard</span>
                </label>
                <small className="field-hint">
                  Enables OS-level click, coordinate movement, and typing automation when requested.
                </small>
              </div>

              <div className="form-group checkbox-group">
                <label className="switch-label">
                  <input
                    type="checkbox"
                    checked={settings.allowAutoTerminalCommands}
                    onChange={(e) => update('allowAutoTerminalCommands', e.target.checked)}
                  />
                  <span className="switch-slider" />
                  <span className="switch-text">Run Safe Terminal Commands Automatically</span>
                </label>
                <small className="field-hint">
                  If disabled, all destructive/consequential terminal commands require explicit user confirmation.
                </small>
              </div>

              <div className="form-group checkbox-group">
                <label className="switch-label">
                  <input
                    type="checkbox"
                    checked={settings.allowAutonomousBrowser}
                    onChange={(e) => update('allowAutonomousBrowser', e.target.checked)}
                  />
                  <span className="switch-slider" />
                  <span className="switch-text">Allow Autonomous Headless/Visible Browser Automation</span>
                </label>
                <small className="field-hint">
                  Allows the Coder Agent to launch Playwright browser sessions to verify frontend rendering and test web apps.
                </small>
              </div>

              <div className="form-group checkbox-group">
                <label className="switch-label">
                  <input
                    type="checkbox"
                    checked={settings.allowInAppSelfControl || false}
                    onChange={(e) => update('allowInAppSelfControl', e.target.checked)}
                  />
                  <span className="switch-slider" />
                  <span className="switch-text">Allow AI to control the Arix AI app UI during Live sessions</span>
                </label>
                <small className="field-hint">
                  Enables in-app navigation, DOM clicks, UI highlighting, and file-drag demonstrations during Live sessions. Pressing Esc or any mouse/keyboard action instantly halts AI control.
                </small>
              </div>

              <div className="form-group checkbox-group">
                <label className="switch-label">
                  <input
                    type="checkbox"
                    checked={settings.allowDesktopControl ?? true}
                    onChange={(e) => update('allowDesktopControl', e.target.checked)}
                  />
                  <span className="switch-slider" />
                  <span className="switch-text">Allow AI to request desktop control when needed (Master Toggle)</span>
                </label>
                <small className="field-hint">
                  Enables the AI to request desktop-level OS screen viewing, clicking, and keyboard automation when a task has no direct tool mapping. Explicit permission is still requested by default before taking control.
                </small>
              </div>

              {settings.allowDesktopControl && (
                <div className="form-group checkbox-group ml-6">
                  <label className="switch-label">
                    <input
                      type="checkbox"
                      checked={settings.desktopControlAlwaysAllowedSession || false}
                      onChange={(e) => update('desktopControlAlwaysAllowedSession', e.target.checked)}
                    />
                    <span className="switch-slider" />
                    <span className="switch-text">Don't ask again this session (Pre-grant session approval)</span>
                  </label>
                  <small className="field-hint">
                    Reduces friction by pre-approving subsequent desktop automation actions for the duration of this session without prompting each time.
                  </small>
                </div>
              )}
            </section>
          )}

          {/* Section 5: Appearance & Editor */}
          {activeSection === 'appearance' && (
            <section className="settings-card">
              <div className="card-header">
                <div className="card-icon"><Palette size={20} /></div>
                <div>
                  <h2>Appearance & Code Editor</h2>
                  <p className="card-desc">Visual tokens, Monaco editor themes, fonts, tab size, and layout settings.</p>
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">Theme Mode</label>
                <div className="theme-card-preview active">
                  <div className="theme-swatch glass-black" />
                  <div>
                    <strong>Black Liquid Glass (Default)</strong>
                    <p>Frosted dark panels, translucent gradients, cyan & violet illumination.</p>
                  </div>
                </div>
              </div>

              <div className="form-grid-2">
                <div className="form-group">
                  <label className="form-label">Editor Theme Preset</label>
                  <select
                    className="glass-select"
                    value={settings.editorTheme || 'vs-dark'}
                    onChange={(e) => update('editorTheme', e.target.value as any)}
                  >
                    <option value="vs-dark">VS Code Dark+ (Default & Recommended)</option>
                    <option value="vs-light">VS Code Light+</option>
                    <option value="hc-black">High Contrast Dark</option>
                  </select>
                  <small className="field-hint">Applies to Monaco Editor tabs across all languages.</small>
                </div>

                <div className="form-group">
                  <label className="form-label">Editor Font Family</label>
                  <select
                    className="glass-select"
                    value={settings.editorFontFamily || "'Cascadia Code', 'Fira Code', 'JetBrains Mono', Consolas, monospace"}
                    onChange={(e) => update('editorFontFamily', e.target.value)}
                  >
                    <option value="'Cascadia Code', 'Fira Code', 'JetBrains Mono', Consolas, monospace">Cascadia Code / Fira Code (Recommended)</option>
                    <option value="'JetBrains Mono', 'Fira Code', monospace">JetBrains Mono</option>
                    <option value="'Fira Code', monospace">Fira Code</option>
                    <option value="Consolas, 'Courier New', monospace">Consolas</option>
                  </select>
                  <small className="field-hint">Monospace typography for editor and diff viewers.</small>
                </div>
              </div>

              <div className="form-grid-2">
                <div className="form-group">
                  <label className="form-label">Editor Font Size ({settings.editorFontSize}px)</label>
                  <input
                    type="range"
                    min={11}
                    max={20}
                    value={settings.editorFontSize}
                    onChange={(e) => update('editorFontSize', Number(e.target.value))}
                    className="range-slider"
                  />
                  <small className="field-hint">Line height and code scaling adjust proportionally.</small>
                </div>

                <div className="form-group">
                  <label className="form-label">Tab Size</label>
                  <select
                    className="glass-select"
                    value={settings.editorTabSize || 2}
                    onChange={(e) => update('editorTabSize', Number(e.target.value))}
                  >
                    <option value={2}>2 Spaces (Modern Web/TS Standard)</option>
                    <option value={4}>4 Spaces (Python/Java Standard)</option>
                  </select>
                  <small className="field-hint">Indentation indentation width on Tab key.</small>
                </div>
              </div>

              <div className="form-group checkbox-group">
                <label className="switch-label">
                  <input
                    type="checkbox"
                    checked={settings.editorMinimap !== false}
                    onChange={(e) => update('editorMinimap', e.target.checked)}
                  />
                  <span className="switch-slider" />
                  <span className="switch-text">Show Code Minimap</span>
                </label>
                <small className="field-hint">
                  Displays the miniature outline scroll preview on the right edge of the editor.
                </small>
              </div>
            </section>
          )}

          {/* Section 6: Integrations & SWE-Kit */}
          {activeSection === 'integrations' && (
            <section className="settings-card">
              <div className="card-header">
                <div className="card-icon"><Wrench size={20} /></div>
                <div style={{ flex: 1 }}>
                  <h2>Integrations & SWE-Kit Engineering Tools</h2>
                  <p className="card-desc">
                    Manage Docker sandbox isolation, Composio tool execution, and GitHub version control integrations.
                  </p>
                </div>
                <button
                  type="button"
                  className="secondary-btn icon-only"
                  onClick={loadSweStatus}
                  title="Refresh Environment & Tool Status"
                >
                  <RefreshCw size={15} className={loadingSweStatus ? 'spin' : ''} />
                </button>
              </div>

              {/* 1. Docker & Runtime Environment */}
              <div className="integration-block">
                <div className="integration-block-header">
                  <div className="block-title">
                    <Layers size={16} />
                    <span>Runtime Sandbox & Docker Status</span>
                  </div>
                  {sweStatus?.docker.running ? (
                    <span className="badge badge-success">
                      <CheckCircle2 size={13} /> Docker Active ({sweStatus.docker.version})
                    </span>
                  ) : sweStatus?.docker.installed ? (
                    <span className="badge badge-warning">
                      <AlertTriangle size={13} /> Docker Installed (Not Running)
                    </span>
                  ) : (
                    <span className="badge badge-neutral">
                      <AlertTriangle size={13} /> Docker Not Detected
                    </span>
                  )}
                </div>
                <div className="integration-block-body">
                  <p className="integration-desc">
                    {sweStatus?.docker.running
                      ? 'Docker daemon is active. SWE-Kit trial sandboxes and background commands run in isolated volume-mounted containers.'
                      : 'Docker is not active on this system. SWE-Kit automatically and gracefully falls back to isolated local workspace snapshotting (.arix/trials) without requiring containers.'}
                  </p>
                  <div className="integration-env-chips">
                    <span className="env-chip">
                      <strong>Host Git:</strong> {sweStatus?.git.installed ? `Installed (${sweStatus.git.version})` : 'Not Detected'}
                    </span>
                    <span className="env-chip">
                      <strong>Sandbox Mode:</strong> {sweStatus?.docker.running ? 'Docker Volume Mount' : 'Local Directory Sandbox (.arix/trials)'}
                    </span>
                  </div>
                  {!sweStatus?.docker.running && (
                    <div className="integration-actions-row">
                      <a
                        href="https://www.docker.com/products/docker-desktop"
                        target="_blank"
                        rel="noreferrer"
                        className="secondary-btn small-btn"
                      >
                        <Download size={13} />
                        <span>Get Docker Desktop (Optional)</span>
                        <ExternalLink size={12} />
                      </a>
                    </div>
                  )}
                </div>
              </div>

              {/* 2. Composio API Configuration */}
              <div className="integration-block">
                <div className="integration-block-header">
                  <div className="block-title">
                    <KeyRound size={16} />
                    <span>Composio API Key & Telemetry Privacy</span>
                  </div>
                  <span className={`badge ${settings.composioApiKey || sweStatus?.composio.configured ? 'badge-success' : 'badge-neutral'}`}>
                    {settings.composioApiKey || sweStatus?.composio.configured ? 'Configured' : 'Not Configured'}
                  </span>
                </div>
                <div className="integration-block-body">
                  <div className="form-group">
                    <label>Composio API Key</label>
                    <div className="input-with-action">
                      <input
                        type={showComposioKey ? 'text' : 'password'}
                        value={settings.composioApiKey || ''}
                        onChange={(e) => update('composioApiKey', e.target.value)}
                        placeholder="Enter your Composio API Key (e.g. comp_...)"
                        className="text-input"
                      />
                      <button
                        type="button"
                        className="input-action-btn"
                        onClick={() => setShowComposioKey(!showComposioKey)}
                        title={showComposioKey ? 'Hide Key' : 'Show Key'}
                      >
                        {showComposioKey ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                    </div>
                    <small className="field-hint">
                      Encrypted and stored in Electron secure credential store. Never logged or exposed.
                    </small>
                  </div>
                  <div className="privacy-pill">
                    <CheckCircle2 size={13} />
                    <span>Local-First Privacy: <code>COMPOSIO_DISABLE_TELEMETRY=true</code> is strictly enforced across all agent processes.</span>
                  </div>
                  <div className="integration-actions-row">
                    <a
                      href="https://composio.dev"
                      target="_blank"
                      rel="noreferrer"
                      className="link-btn"
                    >
                      <span>Obtain API key at composio.dev</span>
                      <ExternalLink size={12} />
                    </a>
                  </div>
                </div>
              </div>

              {/* 3. GitHub Account Integration */}
              <div className="integration-block">
                <div className="integration-block-header">
                  <div className="block-title">
                    <Github size={16} />
                    <span>GitHub Account & PR Automation</span>
                  </div>
                  {sweStatus?.github.connected || settings.githubToken ? (
                    <span className="badge badge-success">
                      <CheckCircle2 size={13} /> Connected
                    </span>
                  ) : (
                    <span className="badge badge-neutral">Not Connected</span>
                  )}
                </div>
                <div className="integration-block-body">
                  {sweStatus?.github.connected || settings.githubToken ? (
                    <div className="github-connected-card">
                      <div className="github-user-info">
                        {sweStatus?.github.avatar_url ? (
                          <img src={sweStatus.github.avatar_url} alt="GitHub Avatar" className="github-avatar" />
                        ) : (
                          <div className="github-avatar-placeholder"><Github size={20} /></div>
                        )}
                        <div>
                          <div className="github-username">@{sweStatus?.github.username || settings.githubUsername || 'connected'}</div>
                          <div className="github-subtext">Active for repository branch management and PR creation</div>
                        </div>
                      </div>
                      <button
                        type="button"
                        className="danger-btn small-btn"
                        onClick={handleDisconnectGithub}
                        disabled={githubLoading}
                      >
                        <span>Disconnect</span>
                      </button>
                    </div>
                  ) : (
                    <div className="github-connect-form">
                      <p className="integration-desc">
                        Connect a GitHub Personal Access Token (with <code>repo</code> scope) to enable autonomous feature branching, commits, and Pull Request creation from Arix Coder.
                      </p>
                      <div className="form-row">
                        <input
                          type="password"
                          value={githubTokenInput}
                          onChange={(e) => setGithubTokenInput(e.target.value)}
                          placeholder="ghp_... or github_pat_..."
                          className="text-input"
                        />
                        <button
                          type="button"
                          className="secondary-btn"
                          onClick={handleConnectGithub}
                          disabled={githubLoading || !githubTokenInput.trim()}
                        >
                          {githubLoading ? 'Connecting…' : 'Connect GitHub'}
                        </button>
                      </div>
                      {githubMsg && (
                        <div className={`status-banner ${githubMsg.type}`}>
                          {githubMsg.text}
                        </div>
                      )}
                      <div className="integration-actions-row">
                        <a
                          href="https://github.com/settings/tokens/new?scopes=repo,read:user"
                          target="_blank"
                          rel="noreferrer"
                          className="link-btn"
                        >
                          <span>Generate GitHub Token (repo & read:user scopes)</span>
                          <ExternalLink size={12} />
                        </a>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* 4. Engineering Packages (SWE-Kit & Composio) */}
              <div className="integration-block">
                <div className="integration-block-header">
                  <div className="block-title">
                    <Boxes size={16} />
                    <span>SWE-Kit Engineering Tools Package</span>
                  </div>
                  {sweStatus?.packages.swekit && sweStatus?.packages.composio_core ? (
                    <span className="badge badge-success">
                      <CheckCircle2 size={13} /> Installed
                    </span>
                  ) : (
                    <span className="badge badge-warning">
                      <AlertTriangle size={13} /> Not Installed
                    </span>
                  )}
                </div>
                <div className="integration-block-body">
                  <p className="integration-desc">
                    Specialized agent scaffolds and engineering tools (<code>swekit</code> and <code>composio-core</code>). Automated one-click background installation without any terminal commands required.
                  </p>
                  <div className="pkg-status-grid">
                    <div className="pkg-status-item">
                      <span className="pkg-name">swekit</span>
                      <span className={`pkg-ver ${sweStatus?.packages.swekit ? 'active' : ''}`}>
                        {sweStatus?.packages.swekit ? `v${sweStatus.packages.swekit_version || 'installed'}` : 'Missing'}
                      </span>
                    </div>
                    <div className="pkg-status-item">
                      <span className="pkg-name">composio-core</span>
                      <span className={`pkg-ver ${sweStatus?.packages.composio_core ? 'active' : ''}`}>
                        {sweStatus?.packages.composio_core ? `v${sweStatus.packages.composio_core_version || 'installed'}` : 'Missing'}
                      </span>
                    </div>
                  </div>

                  {installStatus.status === 'running' && (
                    <div className="install-progress-box">
                      <div className="install-progress-header">
                        <span>{installStatus.step || 'Installing packages...'}</span>
                        <span>{installStatus.progress}%</span>
                      </div>
                      <div className="progress-bar-track">
                        <div
                          className="progress-bar-fill"
                          style={{ width: `${installStatus.progress}%` }}
                        />
                      </div>
                      {installStatus.logs.length > 0 && (
                        <pre className="install-log-terminal">
                          {installStatus.logs.slice(-8).join('\n')}
                        </pre>
                      )}
                    </div>
                  )}

                  {installStatus.status === 'completed' && (
                    <div className="status-banner success">
                      <CheckCircle2 size={14} />
                      <span>SWE-Kit engineering packages installed and ready!</span>
                    </div>
                  )}

                  {installStatus.status === 'failed' && (
                    <div className="status-banner error">
                      <AlertTriangle size={14} />
                      <span>Installation failed: {installStatus.error || 'Check logs'}</span>
                    </div>
                  )}

                  <div className="integration-actions-row">
                    <button
                      type="button"
                      className="primary-button small-btn"
                      onClick={handleInstallSweTools}
                      disabled={installStatus.status === 'running'}
                    >
                      <Download size={14} />
                      <span>
                        {sweStatus?.packages.swekit && sweStatus?.packages.composio_core
                          ? 'Reinstall / Update Engineering Tools'
                          : 'Install Engineering Tools'}
                      </span>
                    </button>
                  </div>
                </div>
              </div>
            </section>
          )}

          {/* Section: MCP Servers */}
          {activeSection === 'mcp' && (
            <section className="settings-card">
              <div className="card-header">
                <div className="card-icon"><Boxes size={20} /></div>
                <div>
                  <h2>Model Context Protocol (MCP) Servers</h2>
                  <p className="card-desc">
                    Official MCP server processes connecting Gemini to external capabilities. Standardized tool discovery, child-process management, and lifecycle controls.
                  </p>
                </div>
                <button
                  type="button"
                  className="secondary-btn icon-only"
                  onClick={loadMcpStatus}
                  title="Refresh MCP Server Status"
                  disabled={loadingMcp}
                >
                  <RefreshCw size={15} className={loadingMcp ? 'spin' : ''} />
                </button>
              </div>

              {/* Node.js Runtime Status */}
              <div className="integration-block">
                <div className="integration-block-header">
                  <div className="block-title">
                    <Layers size={16} />
                    <span>Host Node.js & npx Runtime</span>
                  </div>
                  {mcpStatus?.node.available ? (
                    <span className="badge badge-success">
                      <CheckCircle2 size={13} /> Node.js & npx Active
                    </span>
                  ) : (
                    <span className="badge badge-error">
                      <AlertTriangle size={13} /> Node.js Missing
                    </span>
                  )}
                </div>
                <div className="integration-block-body">
                  <p className="integration-desc">
                    {mcpStatus?.node.available
                      ? 'Local Node.js and npx runtimes detected. MCP child processes are launched on-demand via isolated stdio pipes.'
                      : mcpStatus?.node.message || 'Node.js is required to run MCP servers.'}
                  </p>
                  {mcpStatus?.node.available ? (
                    <div className="integration-env-chips">
                      <span className="env-chip">
                        <strong>Node:</strong> {mcpStatus.node.node_path}
                      </span>
                      <span className="env-chip">
                        <strong>npx:</strong> {mcpStatus.node.npx_path}
                      </span>
                    </div>
                  ) : (
                    <div className="integration-actions-row">
                      <a
                        href="https://nodejs.org"
                        target="_blank"
                        rel="noreferrer"
                        className="primary-button small-btn"
                      >
                        <Download size={13} />
                        <span>Install Node.js</span>
                        <ExternalLink size={12} />
                      </a>
                    </div>
                  )}
                </div>
              </div>

              {/* Registered MCP Servers */}
              {mcpStatus?.servers && Object.values(mcpStatus.servers).map((srv) => {
                const isConnecting = srv.status === 'connecting' || togglingServer === srv.id
                const isRestarting = restartingServer === srv.id
                const isConnected = srv.status === 'connected'
                const hasTools = srv.tools && srv.tools.length > 0
                const toolsExpanded = expandedMcpTools[srv.id]
                const logsExpanded = expandedMcpLogs[srv.id]

                return (
                  <div key={srv.id} className="integration-block mcp-server-block">
                    <div className="integration-block-header">
                      <div className="block-title">
                        {srv.id === 'playwright' ? <Globe size={16} /> : <Brain size={16} />}
                        <span>{srv.name}</span>
                        <code className="server-id-tag">({srv.id})</code>
                      </div>
                      <div className="mcp-header-controls">
                        {isConnected ? (
                          <span className="badge badge-success">
                            <CheckCircle2 size={13} /> Connected ({srv.tool_count} tools)
                          </span>
                        ) : isConnecting ? (
                          <span className="badge badge-warning">
                            <RefreshCw size={13} className="spin" /> Connecting…
                          </span>
                        ) : srv.status === 'error' ? (
                          <span className="badge badge-error">
                            <AlertTriangle size={13} /> Error
                          </span>
                        ) : (
                          <span className="badge badge-neutral">Disconnected</span>
                        )}
                        <label className="toggle-switch mcp-toggle">
                          <input
                            type="checkbox"
                            checked={srv.enabled}
                            disabled={isConnecting || isRestarting}
                            onChange={(e) => handleToggleMcpServer(srv.id, e.target.checked)}
                          />
                          <span className="toggle-slider" />
                        </label>
                      </div>
                    </div>

                    <div className="integration-block-body">
                      <p className="integration-desc">{srv.description}</p>

                      <div className="mcp-meta-row">
                        <span className="meta-tag">
                          <strong>Assigned Agents:</strong> {srv.agents.join(', ')}
                        </span>
                        <span className="meta-tag">
                          <strong>Tools Discovered:</strong> {srv.tool_count}
                        </span>
                        {srv.last_error && (
                          <span className="meta-tag error-tag">
                            <strong>Last Error:</strong> {srv.last_error}
                          </span>
                        )}
                      </div>

                      <div className="integration-actions-row mcp-actions">
                        <button
                          type="button"
                          className="secondary-btn small-btn"
                          disabled={!srv.enabled || isRestarting}
                          onClick={() => handleRestartMcpServer(srv.id)}
                          title="Restart server child process and rediscover tools"
                        >
                          <RefreshCw size={13} className={isRestarting ? 'spin' : ''} />
                          <span>{isRestarting ? 'Restarting…' : 'Restart Server'}</span>
                        </button>

                        {hasTools && (
                          <button
                            type="button"
                            className="secondary-btn small-btn"
                            onClick={() =>
                              setExpandedMcpTools((prev) => ({
                                ...prev,
                                [srv.id]: !prev[srv.id],
                              }))
                            }
                          >
                            <span>{toolsExpanded ? 'Hide Tools' : `View Discovered Tools (${srv.tools.length})`}</span>
                            {toolsExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                          </button>
                        )}

                        {srv.logs && srv.logs.length > 0 && (
                          <button
                            type="button"
                            className="secondary-btn small-btn"
                            onClick={() =>
                              setExpandedMcpLogs((prev) => ({
                                ...prev,
                                [srv.id]: !prev[srv.id],
                              }))
                            }
                          >
                            <Terminal size={13} />
                            <span>{logsExpanded ? 'Hide Logs' : 'View Subprocess Logs'}</span>
                          </button>
                        )}
                      </div>

                      {/* Discovered Tools Drawer */}
                      {toolsExpanded && hasTools && (
                        <div className="mcp-tools-drawer">
                          <div className="drawer-header">
                            <span>Discovered MCP Tools & Parameters</span>
                          </div>
                          <div className="mcp-tool-grid">
                            {srv.tools.map((t) => (
                              <div key={t.name} className="mcp-tool-card">
                                <div className="tool-card-title">
                                  <code>{t.name}</code>
                                </div>
                                <p className="tool-card-desc">{t.description}</p>
                                {t.required && t.required.length > 0 && (
                                  <div className="tool-required-args">
                                    <small>Required: {t.required.join(', ')}</small>
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Subprocess Logs Drawer */}
                      {logsExpanded && srv.logs && srv.logs.length > 0 && (
                        <div className="mcp-logs-drawer">
                          <div className="drawer-header">
                            <span>Recent Subprocess Logs (Last 20 entries)</span>
                          </div>
                          <pre className="mcp-log-terminal">
                            {srv.logs.join('\n')}
                          </pre>
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </section>
          )}

          {/* Section 7: About & Diagnostics */}
          {activeSection === 'diagnostics' && (
            <section className="settings-card">
              <div className="card-header">
                <div className="card-icon"><Cpu size={20} /></div>
                <div>
                  <h2>System Diagnostics & Runtime Logs</h2>
                  <p className="card-desc">App telemetry, log file inspection, and factory reset options.</p>
                </div>
              </div>

              <div className="diagnostics-grid">
                <div className="diag-item">
                  <span className="diag-label">App Version</span>
                  <span className="diag-val">0.3.0 Desktop</span>
                </div>
                <div className="diag-item">
                  <span className="diag-label">Python Backend</span>
                  <span className="diag-val active">127.0.0.1:8765 (Online)</span>
                </div>
                <div className="diag-item">
                  <span className="diag-label">Active Storage</span>
                  <span className="diag-val">Local UserData (Encrypted)</span>
                </div>
              </div>

              <div className="diagnostics-actions">
                <button type="button" className="action-btn" onClick={handleOpenLogs}>
                  <FolderOpen size={16} />
                  <span>Open Logs Folder in Explorer</span>
                </button>
                <button
                  type="button"
                  className="danger-btn"
                  onClick={() => setResetConfirm(true)}
                >
                  <RotateCcw size={16} />
                  <span>Reset All Settings to Factory Defaults</span>
                </button>
              </div>

              {resetConfirm && (
                <div className="confirm-box">
                  <p>Are you sure you want to restore all settings to default? This cannot be undone.</p>
                  <div className="confirm-actions">
                    <button type="button" className="confirm-btn" onClick={handleReset}>
                      Yes, Reset Everything
                    </button>
                    <button type="button" className="cancel-btn" onClick={() => setResetConfirm(false)}>
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </section>
          )}
        </main>
      </div>
    </div>
  )
}
