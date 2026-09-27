import React, { useEffect, useState } from 'react'
import {
  Clock,
  ExternalLink,
  FileCode,
  Plus,
  Power,
  RefreshCw,
  Save,
  Send,
  Square,
  Terminal,
  X,
} from 'lucide-react'
import type { AppSettings, ProjectItem } from '../../types/arix'
import { EditorWorkspaceTab, type OpenEditorTab } from './EditorWorkspaceTab'

interface ProcessInfo {
  id: string
  pid: number
  command: string
  cwd: string
  startTime: number
  status: string
  detectedPort?: number
  recentLogs?: string[]
}

interface UserTerminalItem {
  id: string
  name: string
  history: string[]
}

interface Props {
  project: ProjectItem
  openFiles: OpenEditorTab[]
  activeFilePath?: string
  settings?: Partial<AppSettings>
  onSelectFile: (path: string) => void
  onCloseFile: (path: string) => void
  onCloseAllFiles: () => void
  onUpdateFileContent: (path: string, content: string) => void
  onSaveFile: (path: string, content: string) => Promise<void>
  onSaveSession: () => void
}

export function ActivityDashboard({
  project,
  openFiles,
  activeFilePath,
  settings,
  onSelectFile,
  onCloseFile,
  onCloseAllFiles,
  onUpdateFileContent,
  onSaveFile,
  onSaveSession,
}: Props) {
  const [processes, setProcesses] = useState<ProcessInfo[]>([])
  const [activeTab, setActiveTab] = useState<'files' | 'servers' | 'session'>('files')
  const [sessionReport, setSessionReport] = useState<any>(null)
  const [loadingSession, setLoadingSession] = useState(false)
  const [killingId, setKillingId] = useState<string | null>(null)

  // User PowerShell terminals state (A9)
  const [userTerminals, setUserTerminals] = useState<UserTerminalItem[]>([])
  const [activeTerminalId, setActiveTerminalId] = useState<string>('ai-procs')
  const [termInput, setTermInput] = useState('')
  const [executingCmd, setExecutingCmd] = useState(false)

  const fetchProcesses = async () => {
    try {
      const res = await fetch(
        `http://127.0.0.1:8765/api/workspace/processes?workspace_root=${encodeURIComponent(
          project.path,
        )}`,
      )
      if (res.ok) {
        const data = await res.json()
        setProcesses(data.processes || [])
      }
    } catch (err) {
      console.error('Failed to fetch processes:', err)
    }
  }

  const fetchUserTerminals = async () => {
    try {
      const res = await fetch(
        `http://127.0.0.1:8765/api/workspace/terminal/list?workspace_root=${encodeURIComponent(
          project.path,
        )}`,
      )
      if (res.ok) {
        const data = await res.json()
        if (Array.isArray(data.terminals)) {
          setUserTerminals(data.terminals)
        }
      }
    } catch {}
  }

  const fetchSessionReport = async () => {
    try {
      setLoadingSession(true)
      const res = await fetch(
        `http://127.0.0.1:8765/api/workspace/session-report?workspace_root=${encodeURIComponent(
          project.path,
        )}`,
      )
      if (res.ok) {
        const data = await res.json()
        setSessionReport(data.report)
      }
    } catch (err) {
      console.error('Failed to fetch session report:', err)
    } finally {
      setLoadingSession(false)
    }
  }

  useEffect(() => {
    fetchProcesses()
    fetchUserTerminals()
    fetchSessionReport()
    const interval = setInterval(fetchProcesses, 3000)
    return () => clearInterval(interval)
  }, [project.path])

  const handleKillProcess = async (procId: string) => {
    setKillingId(procId)
    try {
      await fetch('http://127.0.0.1:8765/api/workspace/processes/kill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ process_id: procId }),
      })
      await fetchProcesses()
    } catch (err) {
      console.error('Failed to kill process:', err)
    } finally {
      setKillingId(null)
    }
  }

  // Create new PowerShell terminal (A9)
  const handleCreateTerminal = async () => {
    try {
      const nextNum = userTerminals.length + 1
      const res = await fetch('http://127.0.0.1:8765/api/workspace/terminal/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspace_root: project.path,
          name: `Terminal ${nextNum}`,
        }),
      })
      if (res.ok) {
        const data = await res.json()
        if (data.terminal) {
          setUserTerminals((prev) => [...prev, data.terminal])
          setActiveTerminalId(data.terminal.id)
        }
      }
    } catch (err) {
      console.error('Failed to create terminal:', err)
    }
  }

  // Execute command in current user terminal (A9)
  const handleExecTerminalCmd = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!termInput.trim() || executingCmd || activeTerminalId === 'ai-procs') return
    const cmd = termInput.trim()
    setTermInput('')
    setExecutingCmd(true)

    try {
      const res = await fetch('http://127.0.0.1:8765/api/workspace/terminal/exec', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspace_root: project.path,
          terminal_id: activeTerminalId,
          command: cmd,
        }),
      })
      if (res.ok) {
        const data = await res.json()
        setUserTerminals((prev) =>
          prev.map((t) =>
            t.id === activeTerminalId ? { ...t, history: data.history } : t,
          ),
        )
      }
    } catch (err) {
      console.error('Failed to execute terminal command:', err)
    } finally {
      setExecutingCmd(false)
    }
  }

  // Close user terminal (A9)
  const handleCloseTerminal = async (termId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      await fetch(`http://127.0.0.1:8765/api/workspace/terminal/${termId}`, {
        method: 'DELETE',
      })
      setUserTerminals((prev) => prev.filter((t) => t.id !== termId))
      if (activeTerminalId === termId) {
        setActiveTerminalId('ai-procs')
      }
    } catch (err) {
      console.error('Failed to close terminal:', err)
    }
  }

  const currentActiveUserTerm = userTerminals.find((t) => t.id === activeTerminalId)

  return (
    <div className="activity-dashboard-container">
      {/* Top Tab Bar */}
      <div className="dashboard-nav-tabs">
        <button
          className={`dash-tab ${activeTab === 'files' ? 'active' : ''}`}
          onClick={() => setActiveTab('files')}
          title="Open files & editor"
        >
          <FileCode size={13} />
          <span>Files ({openFiles.length})</span>
        </button>

        <button
          className={`dash-tab ${activeTab === 'servers' ? 'active' : ''}`}
          onClick={() => setActiveTab('servers')}
          title="Running terminals and dev servers"
        >
          <Terminal size={13} />
          <span>
            Servers & Terminals (
            {processes.filter((p) => p.status === 'running').length + userTerminals.length})
          </span>
        </button>

        <button
          className={`dash-tab ${activeTab === 'session' ? 'active' : ''}`}
          onClick={() => setActiveTab('session')}
          title="Session continuity & history"
        >
          <Clock size={13} />
          <span>Continuity</span>
        </button>
      </div>

      {/* Tab Content Area */}
      <div className="dashboard-tab-content">
        {/* TAB 1: FILES (Tabbed Monaco Editor & Media Viewer - A3, A4) */}
        {activeTab === 'files' && (
          <EditorWorkspaceTab
            workspaceRoot={project.path}
            openTabs={openFiles}
            activeFilePath={activeFilePath}
            settings={settings}
            onSelectTab={onSelectFile}
            onCloseTab={onCloseFile}
            onCloseAllTabs={onCloseAllFiles}
            onUpdateContent={onUpdateFileContent}
            onSaveFile={onSaveFile}
          />
        )}

        {/* TAB 2: SERVERS & TERMINALS (A9) */}
        {activeTab === 'servers' && (
          <div className="terminal-manager-container">
            {/* Terminal Tab Bar */}
            <div className="terminal-header-bar">
              <div className="terminal-tabs-strip">
                <button
                  className={`term-tab-pill ${activeTerminalId === 'ai-procs' ? 'active' : ''}`}
                  onClick={() => setActiveTerminalId('ai-procs')}
                  title="Dev servers spawned by AI Coder"
                >
                  <Terminal size={12} />
                  <span>Dev Servers</span>
                  <span className="term-tab-badge ai">AI</span>
                </button>

                {userTerminals.map((term) => (
                  <button
                    key={term.id}
                    className={`term-tab-pill ${activeTerminalId === term.id ? 'active' : ''}`}
                    onClick={() => setActiveTerminalId(term.id)}
                    title="User PowerShell terminal"
                  >
                    <span>{term.name}</span>
                    <span className="term-tab-badge user">User</span>
                    <span
                      className="tab-close-btn"
                      onClick={(e) => handleCloseTerminal(term.id, e)}
                      title="Close terminal"
                    >
                      <X size={11} />
                    </span>
                  </button>
                ))}
              </div>

              <button
                className="new-terminal-btn"
                onClick={handleCreateTerminal}
                title="Open new PowerShell instance in project root"
              >
                <Plus size={13} />
                <span>New PowerShell</span>
              </button>
            </div>

            {/* Display AI background processes */}
            {activeTerminalId === 'ai-procs' ? (
              <div className="dash-servers-view p-3 overflow-y-auto flex-1">
                <div className="section-title">
                  <span>AI Background Dev Servers</span>
                  <button className="refresh-icon-btn" onClick={fetchProcesses} title="Refresh">
                    <RefreshCw size={12} />
                  </button>
                </div>

                {processes.length === 0 ? (
                  <div className="dash-empty">
                    No background servers running. Ask Coder Agent to launch a development server or
                    click &quot;New PowerShell&quot; above to run manual commands.
                  </div>
                ) : (
                  <div className="processes-list">
                    {processes.map((p) => (
                      <div key={p.id} className="process-card">
                        <div className="proc-header">
                          <div className="proc-command" title={p.command}>
                            <Terminal size={13} />
                            <code>{p.command}</code>
                          </div>
                          <span className={`proc-status-badge ${p.status}`}>{p.status}</span>
                        </div>

                        {p.detectedPort && (
                          <div className="proc-port-link">
                            <span className="port-label">Listening:</span>
                            <a
                              href={`http://localhost:${p.detectedPort}`}
                              target="_blank"
                              rel="noreferrer"
                              title="Open in local browser"
                            >
                              <span>http://localhost:{p.detectedPort}</span>
                              <ExternalLink size={12} />
                            </a>
                          </div>
                        )}

                        {p.recentLogs && p.recentLogs.length > 0 && (
                          <div className="proc-logs-preview">
                            <pre>{p.recentLogs.slice(-6).join('\n')}</pre>
                          </div>
                        )}

                        <div className="proc-footer">
                          <span className="proc-pid">PID: {p.pid}</span>
                          {p.status === 'running' && (
                            <button
                              className="kill-proc-btn"
                              disabled={killingId === p.id}
                              onClick={() => handleKillProcess(p.id)}
                              title="Terminate process"
                            >
                              <Square size={11} />
                              <span>Stop</span>
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : currentActiveUserTerm ? (
              /* User PowerShell Terminal Console (A9) */
              <div className="flex-1 flex flex-col min-h-0 bg-[#050608]">
                <div className="term-console-viewport">
                  {currentActiveUserTerm.history.map((line, idx) => (
                    <div
                      key={idx}
                      className={`term-line ${line.startsWith('PS ') ? 'prompt' : ''}`}
                    >
                      {line}
                    </div>
                  ))}
                  {executingCmd && (
                    <div className="term-line text-cyan-400 opacity-70 animate-pulse">
                      Running PowerShell command…
                    </div>
                  )}
                </div>

                <form className="term-input-form" onSubmit={handleExecTerminalCmd}>
                  <span className="term-ps-label">PS &gt;</span>
                  <input
                    type="text"
                    className="term-input-field"
                    placeholder="Type PowerShell command here (e.g. dir, git status, npm test)..."
                    value={termInput}
                    onChange={(e) => setTermInput(e.target.value)}
                    disabled={executingCmd}
                    autoFocus
                  />
                  <button
                    type="submit"
                    className="send-btn"
                    disabled={!termInput.trim() || executingCmd}
                  >
                    <Send size={13} />
                  </button>
                </form>
              </div>
            ) : null}
          </div>
        )}

        {/* TAB 3: CONTINUITY */}
        {activeTab === 'session' && (
          <div className="dash-session-view">
            <div className="section-title">
              <span>Workspace Continuity</span>
              <button
                className="save-session-btn"
                onClick={onSaveSession}
                title="Save current session snapshot"
              >
                <Save size={12} />
                <span>Save Report</span>
              </button>
            </div>

            {loadingSession ? (
              <div className="dash-empty">Loading session data…</div>
            ) : !sessionReport ? (
              <div className="dash-empty">
                No previous session reports found in <code>.arix/sessions/</code>. Reports are
                automatically saved as you complete coding tasks.
              </div>
            ) : (
              <div className="session-report-card">
                <div className="report-meta">
                  <span className="report-time">
                    {sessionReport.formatted_time || 'Recent Session'}
                  </span>
                  <span className="report-id">{sessionReport.session_id}</span>
                </div>

                <div className="report-summary">
                  <h4>Summary</h4>
                  <p>{sessionReport.summary}</p>
                </div>

                {sessionReport.tasks_completed && sessionReport.tasks_completed.length > 0 && (
                  <div className="report-section">
                    <h4>Completed Tasks</h4>
                    <ul>
                      {sessionReport.tasks_completed.map((t: string, i: number) => (
                        <li key={i}>{t}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {sessionReport.files_modified && sessionReport.files_modified.length > 0 && (
                  <div className="report-section">
                    <h4>Modified Files</h4>
                    <ul>
                      {sessionReport.files_modified.map((f: string, i: number) => (
                        <li key={i}>
                          <code>{f}</code>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
