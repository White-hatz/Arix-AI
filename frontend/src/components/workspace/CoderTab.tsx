import React, { useEffect, useRef, useState } from 'react'
import {
  AlertCircle,
  AlertTriangle,
  Boxes,
  Brain,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Code2,
  Copy,
  CornerDownLeft,
  FileCode,
  FileText,
  Globe,
  Paperclip,
  Play,
  RotateCcw,
  Send,
  Sparkles,
  Square,
  Terminal,
  Wrench,
} from 'lucide-react'
import type { ProjectItem } from '../../types/arix'

export interface CoderEvent {
  id: string
  type: 'thought' | 'plan' | 'tool_call' | 'tool_result' | 'message' | 'status' | 'error' | 'system_error'
  role?: string
  content?: string
  tool?: string
  args?: Record<string, any>
  result?: any
  diff?: string
  model?: string
  status?: string
  message?: string
  error?: string
  timestamp: number
}

interface Props {
  project: ProjectItem
  pendingHandoffPrompt?: string
  onClearHandoff?: () => void
  onFileModified?: (filePath: string) => void
}

export function CoderTab({
  project,
  pendingHandoffPrompt,
  onClearHandoff,
  onFileModified,
}: Props) {
  const [events, setEvents] = useState<CoderEvent[]>([])
  const [inputVal, setInputVal] = useState('')
  const [isRunning, setIsRunning] = useState(false)
  const [statusText, setStatusText] = useState('Idle — ready for coding tasks')
  const [collapsedThoughts, setCollapsedThoughts] = useState<Record<string, boolean>>({})
  const [applyingTrialId, setApplyingTrialId] = useState<string | null>(null)
  const [appliedTrials, setAppliedTrials] = useState<Record<string, boolean>>({})
  const [copiedErrorId, setCopiedErrorId] = useState<string | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const timelineEndRef = useRef<HTMLDivElement>(null)

  const handleCopyError = (errText: string, id: string) => {
    navigator.clipboard.writeText(errText)
    setCopiedErrorId(id)
    setTimeout(() => setCopiedErrorId(null), 2500)
  }

  const handleApplyTrial = async (trialId: string) => {
    setApplyingTrialId(trialId)
    try {
      const res = await fetch('http://127.0.0.1:8765/api/swe-kit/trial/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspace_root: project.path,
          trial_id: trialId,
        }),
      })
      const data = await res.json()
      if (data.success) {
        setAppliedTrials((prev) => ({ ...prev, [trialId]: true }))
        if (data.applied_files && onFileModified) {
          data.applied_files.forEach((f: string) => onFileModified(f))
        }
      } else {
        alert(data.error || 'Failed to apply trial')
      }
    } catch (err: any) {
      alert(`Error applying trial: ${err.message}`)
    } finally {
      setApplyingTrialId(null)
    }
  }

  // Auto-fill prompt if handed off from Direct Assistant
  useEffect(() => {
    if (pendingHandoffPrompt) {
      setInputVal(pendingHandoffPrompt)
      if (onClearHandoff) onClearHandoff()
    }
  }, [pendingHandoffPrompt])

  // Scroll to bottom when new events arrive
  useEffect(() => {
    timelineEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [events])

  // Connect Coder WebSocket
  useEffect(() => {
    let isUnmounted = false
    const ws = new WebSocket('ws://127.0.0.1:8765/api/workspace/coder')
    wsRef.current = ws

    ws.onopen = () => {
      if (isUnmounted) {
        ws.close(1000, 'Unmounted')
        return
      }
      ws.send(
        JSON.stringify({
          action: 'init',
          workspace_root: project.path,
          model: 'gemini-3.8-flash',
        }),
      )
    }

    ws.onmessage = (e) => {
      if (isUnmounted) return
      try {
        const data = JSON.parse(e.data)
        const ev: CoderEvent = {
          ...data,
          id: `ev-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
          timestamp: Date.now(),
        }

        if (data.type === 'status') {
          setStatusText(data.message || data.status)
          if (data.status === 'idle' || data.status === 'stopped') {
            setIsRunning(false)
          } else {
            setIsRunning(true)
          }
          if (data.modified_files && onFileModified) {
            data.modified_files.forEach((f: string) => onFileModified(f))
          }
        } else if (data.type === 'error') {
          setIsRunning(false)
          setStatusText(`Error: ${data.message}`)
        }

        setEvents((prev) => [...prev, ev])
      } catch (err) {
        console.error('Failed to parse coder WS message:', err)
      }
    }

    ws.onerror = (err) => {
      if (!isUnmounted) {
        console.warn('Coder WS error:', err)
      }
    }

    ws.onclose = () => {
      if (!isUnmounted) {
        console.info('Coder WS closed')
      }
    }

    return () => {
      isUnmounted = true
      ws.onmessage = null
      ws.onerror = null
      ws.onclose = null
      if (ws.readyState === WebSocket.OPEN) {
        ws.close(1000, 'Unmounted')
      } else if (ws.readyState === WebSocket.CONNECTING) {
        ws.onopen = () => ws.close(1000, 'Unmounted')
      }
    }
  }, [project.path])

  const handleSend = (e?: React.FormEvent) => {
    if (e) e.preventDefault()
    if (!inputVal.trim() || isRunning) return

    const promptText = inputVal.trim()
    setInputVal('')
    setIsRunning(true)
    setStatusText('Coder Agent thinking & analyzing workspace…')

    // Append user event to timeline
    const userEv: CoderEvent = {
      id: `ev-${Date.now()}`,
      type: 'message',
      role: 'user',
      content: promptText,
      timestamp: Date.now(),
    }
    setEvents((prev) => [...prev, userEv])

    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          action: 'prompt',
          prompt: promptText,
          workspace_root: project.path,
        }),
      )
    }
  }

  const handleStop = () => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ action: 'stop' }))
    }
    setIsRunning(false)
    setStatusText('Execution stopped by user.')
  }

  const toggleThought = (id: string) => {
    setCollapsedThoughts((p) => ({ ...p, [id]: !p[id] }))
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    const textData = e.dataTransfer.getData('text/plain')
    if (textData) {
      setInputVal((prev) => (prev ? `${prev} ${textData}` : textData))
    }
  }

  return (
    <div className="coder-tab-container" onDragOver={(e) => e.preventDefault()} onDrop={handleDrop}>
      {/* Top Status Bar */}
      <div className="coder-status-bar">
        <div className="coder-status-left">
          <span className={`status-dot ${isRunning ? 'running' : 'idle'}`} />
          <span className="status-text">{statusText}</span>
        </div>

        <div className="coder-status-right">
          <span className="coder-model-tag">
            <Sparkles size={11} />
            <span>GEMINI 3.8 EXTENDED THINKING</span>
          </span>
          {isRunning && (
            <button className="stop-btn" onClick={handleStop} title="Stop current execution">
              <Square size={12} />
              <span>Stop</span>
            </button>
          )}
        </div>
      </div>

      {/* Timeline Stream */}
      <div className="coder-timeline">
        {events.length === 0 ? (
          <div className="timeline-empty">
            <Code2 size={36} />
            <h3>Autonomous Coder Agent</h3>
            <p>
              Assign a task, bug fix, feature request, or refactoring goal. The Coder Agent will inspect
              relevant code, generate precision diffs, execute commands, and verify changes.
            </p>
            <div className="example-chips">
              <button onClick={() => setInputVal('Review the project structure and run tests')}>
                Review structure & tests
              </button>
              <button onClick={() => setInputVal('Find and fix any TypeScript or lint errors')}>
                Fix lint errors
              </button>
              <button onClick={() => setInputVal('Build and start the local dev server')}>
                Start dev server
              </button>
              <button onClick={() => setInputVal('Use SWE-Kit to refactor and verify with isolated trial')}>
                SWE-Kit isolated trial
              </button>
            </div>
          </div>
        ) : (
          events.map((ev) => {
            if (ev.type === 'thought') {
              const isCollapsed = collapsedThoughts[ev.id]
              return (
                <div key={ev.id} className="timeline-card thought-card">
                  <div className="card-header" onClick={() => toggleThought(ev.id)}>
                    <Brain size={14} className="thought-icon" />
                    <span className="card-label">Extended Thinking & Reasoning</span>
                    <span className="toggle-arrow">
                      {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                    </span>
                  </div>
                  {!isCollapsed && <div className="card-body thought-text">{ev.content}</div>}
                </div>
              )
            }

            if (ev.type === 'tool_call') {
              return (
                <div key={ev.id} className="timeline-card tool-call-card">
                  <div className="card-header">
                    <Wrench size={14} className="tool-icon" />
                    <span className="card-label">Invoking Tool: <b>{ev.tool}</b></span>
                  </div>
                  <div className="card-body tool-args">
                    <pre>{JSON.stringify(ev.args, null, 2)}</pre>
                  </div>
                </div>
              )
            }

            if (ev.type === 'tool_result') {
              const resObj = ev.result && typeof ev.result === 'object' ? ev.result : null
              const isTrial = Boolean(resObj && (resObj.trial_id || resObj.mode === 'isolated_trial'))
              const trialId = resObj?.trial_id || ''
              const isSequential = Boolean(
                ev.tool === 'sequentialthinking' ||
                ev.tool === 'sequential_thinking' ||
                resObj?.is_sequential_thinking
              )
              const isBrowserTool = Boolean(
                ev.tool?.startsWith('browser_') ||
                resObj?.source?.includes('playwright')
              )

              if (isSequential) {
                const thought = resObj?.thought || ev.args?.thought || resObj?.content || ''
                const thoughtNum = resObj?.thoughtNumber || ev.args?.thoughtNumber || 1
                const totalThoughts = resObj?.totalThoughts || ev.args?.totalThoughts || 1
                const isRevision = Boolean(resObj?.isRevision || ev.args?.isRevision)
                const revisesThought = resObj?.revisesThought || ev.args?.revisesThought
                const branchFrom = resObj?.branchFromThought || ev.args?.branchFromThought
                const branchId = resObj?.branchId || ev.args?.branchId
                const nextNeeded = resObj?.nextThoughtNeeded ?? ev.args?.nextThoughtNeeded ?? false
                const isCollapsed = collapsedThoughts[ev.id]

                return (
                  <div key={ev.id} className="timeline-card sequential-card">
                    <div className="card-header" onClick={() => toggleThought(ev.id)}>
                      <Brain size={14} className="sequential-icon" />
                      <span className="card-label">
                        Sequential Reasoning — Step <b>{thoughtNum}</b> of <b>{totalThoughts}</b>
                      </span>
                      <div className="sequential-badges">
                        {isRevision && (
                          <span className="badge badge-revision">
                            Revision #{revisesThought || ''}
                          </span>
                        )}
                        {(branchFrom || branchId) && (
                          <span className="badge badge-branch">
                            Branch {branchId ? `${branchId} ` : ''}(from #{branchFrom})
                          </span>
                        )}
                        <span className="step-progress-pill">
                          {Math.round((thoughtNum / Math.max(totalThoughts, 1)) * 100)}%
                        </span>
                      </div>
                      <span className="toggle-arrow">
                        {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                      </span>
                    </div>
                    {!isCollapsed && (
                      <div className="card-body">
                        <div className="sequential-thought-content">
                          {thought}
                        </div>
                        <div className="sequential-footer">
                          <span className={`next-indicator ${nextNeeded ? 'continuing' : 'complete'}`}>
                            {nextNeeded ? '• Next reasoning step anticipated' : '✓ Reasoning phase completed'}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                )
              }

              if (isBrowserTool) {
                const screenshot = resObj?.screenshot || (resObj?.images && resObj.images[0])
                const hasError = !resObj?.success || Boolean(resObj?.error)
                const errText = resObj?.error || (typeof ev.result === 'string' ? ev.result : JSON.stringify(ev.result, null, 2))
                const isCopied = copiedErrorId === ev.id

                return (
                  <div key={ev.id} className={`timeline-card browser-result-card ${hasError ? 'browser-error-card' : ''}`}>
                    <div className="card-header">
                      {hasError ? <AlertTriangle size={14} className="text-red-400" /> : <Globe size={14} className="browser-icon" />}
                      <span className="card-label">Playwright Browser: <b>{ev.tool}</b></span>
                      <span className={`badge ${hasError ? 'badge-error' : 'badge-playwright'}`}>
                        {hasError ? 'Execution Error' : 'Playwright MCP'}
                      </span>
                      {hasError && (
                        <button
                          type="button"
                          className={`copy-error-mini-btn ${isCopied ? 'copied' : ''}`}
                          onClick={() => handleCopyError(errText, ev.id)}
                          title="Copy browser error to clipboard"
                        >
                          {isCopied ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
                          <span>{isCopied ? 'Copied!' : 'Copy Error'}</span>
                        </button>
                      )}
                    </div>
                    <div className="card-body">
                      {hasError && (
                        <pre className="browser-error-content">{errText}</pre>
                      )}
                      {!hasError && screenshot && (
                        <div className="browser-screenshot-box">
                          <div className="screenshot-label">Live Visual Snapshot</div>
                          <img
                            src={screenshot}
                            alt="Browser snapshot"
                            className="browser-screenshot-img"
                          />
                        </div>
                      )}
                      {!hasError && resObj?.content && (
                        <pre className="browser-content-text">{resObj.content}</pre>
                      )}
                      {!hasError && !screenshot && !resObj?.content && (
                        <pre className="result-json">
                          {typeof ev.result === 'string' ? ev.result : JSON.stringify(ev.result, null, 2)}
                        </pre>
                      )}
                    </div>
                  </div>
                )
              }

              return (
                <div key={ev.id} className="timeline-card tool-result-card">
                  <div className="card-header">
                    {isTrial ? <Boxes size={14} className="result-icon" /> : <CheckCircle2 size={14} className="result-icon" />}
                    <span className="card-label">
                      {isTrial ? <span>SWE-Kit Sandbox Output: <b>{ev.tool}</b></span> : <span>Tool Output: <b>{ev.tool}</b></span>}
                    </span>
                  </div>
                  <div className="card-body">
                    {isTrial ? (
                      <div className="swe-trial-box">
                        <div className="swe-trial-header">
                          <div className="swe-trial-title">
                            <Boxes size={14} />
                            <span>Isolated Sandbox Trial: <code>{trialId}</code></span>
                          </div>
                          <span className={`badge ${appliedTrials[trialId] ? 'badge-success' : 'badge-warning'}`}>
                            {appliedTrials[trialId] ? 'Applied to Workspace' : 'Trial Sandbox (Unapplied)'}
                          </span>
                        </div>

                        {resObj.message && <p className="swe-trial-desc">{resObj.message}</p>}

                        {resObj.modified_files && resObj.modified_files.length > 0 && (
                          <div className="swe-trial-meta-row">
                            <span className="meta-tag">
                              <strong>Files:</strong> {resObj.modified_files.length}
                            </span>
                            {typeof resObj.additions === 'number' && (
                              <span className="meta-tag adds">+{resObj.additions}</span>
                            )}
                            {typeof resObj.deletions === 'number' && (
                              <span className="meta-tag dels">-{resObj.deletions}</span>
                            )}
                          </div>
                        )}

                        {(ev.diff || resObj.diff) && (
                          <div className="diff-viewer">
                            <div className="diff-header">Unified Diff (Pending Workspace Confirmation)</div>
                            <pre className="diff-code">
                              {(ev.diff || resObj.diff).split('\n').map((line: string, lIdx: number) => {
                                let lineClass = 'diff-normal'
                                if (line.startsWith('+')) lineClass = 'diff-add'
                                else if (line.startsWith('-')) lineClass = 'diff-del'
                                else if (line.startsWith('@')) lineClass = 'diff-meta'
                                return (
                                  <div key={lIdx} className={lineClass}>
                                    {line}
                                  </div>
                                )
                              })}
                            </pre>
                          </div>
                        )}

                        <div className="swe-trial-actions">
                          {appliedTrials[trialId] ? (
                            <div className="applied-pill">
                              <CheckCircle2 size={14} />
                              <span>Changes Successfully Merged to Workspace</span>
                            </div>
                          ) : (
                            <button
                              type="button"
                              className="apply-trial-btn"
                              disabled={applyingTrialId === trialId}
                              onClick={() => handleApplyTrial(trialId)}
                            >
                              <CheckCircle2 size={14} />
                              <span>
                                {applyingTrialId === trialId ? 'Applying changes…' : 'Apply Changes to Project'}
                              </span>
                            </button>
                          )}
                        </div>
                      </div>
                    ) : ev.diff ? (
                      <div className="diff-viewer">
                        <div className="diff-header">Unified Diff</div>
                        <pre className="diff-code">
                          {ev.diff.split('\n').map((line, lIdx) => {
                            let lineClass = 'diff-normal'
                            if (line.startsWith('+')) lineClass = 'diff-add'
                            else if (line.startsWith('-')) lineClass = 'diff-del'
                            else if (line.startsWith('@')) lineClass = 'diff-meta'
                            return (
                              <div key={lIdx} className={lineClass}>
                                {line}
                              </div>
                            )
                          })}
                        </pre>
                      </div>
                    ) : (
                      <pre className="result-json">
                        {typeof ev.result === 'string'
                          ? ev.result
                          : JSON.stringify(ev.result, null, 2)}
                      </pre>
                    )}
                  </div>
                </div>
              )
            }

            if (ev.type === 'message') {
              return (
                <div key={ev.id} className={`timeline-card message-card ${ev.role}`}>
                  <div className="card-header">
                    {ev.role === 'user' ? <CornerDownLeft size={14} /> : <Code2 size={14} />}
                    <span className="card-label">{ev.role === 'user' ? 'USER TASK' : 'CODER AGENT'}</span>
                  </div>
                  <div className="card-body message-text">{ev.content}</div>
                </div>
              )
            }

            if (ev.type === 'error' || ev.type === 'system_error') {
              const errText = ev.error || ev.message || 'Execution error'
              const isCopied = copiedErrorId === ev.id
              return (
                <div key={ev.id} className="timeline-card error-card">
                  <div className="card-header">
                    <AlertCircle size={14} className="text-red-400" />
                    <span className="card-label">System Error{ev.tool ? `: ${ev.tool}` : ''}</span>
                    <button
                      type="button"
                      className={`copy-error-mini-btn ${isCopied ? 'copied' : ''}`}
                      onClick={() => handleCopyError(errText, ev.id)}
                      title="Copy error"
                    >
                      {isCopied ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
                      <span>{isCopied ? 'Copied!' : 'Copy Error'}</span>
                    </button>
                  </div>
                  <div className="card-body error-text">
                    <pre className="error-code-view"><code>{errText}</code></pre>
                  </div>
                </div>
              )
            }

            return null
          })
        )}
        <div ref={timelineEndRef} />
      </div>

      {/* Bottom Input Area */}
      <div className="coder-input-dock">
        <form className="coder-input-form" onSubmit={handleSend}>
          <textarea
            className="coder-textarea"
            placeholder="Type instructions, paste code, or drag files from Explorer… (Enter to run, Shift+Enter for newline)"
            value={inputVal}
            onChange={(e) => setInputVal(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                handleSend()
              }
            }}
            rows={2}
          />

          <div className="coder-input-actions">
            <button
              type="button"
              className="attach-btn"
              onClick={() => {
                const path = prompt('Enter relative path to reference (e.g. src/App.tsx):')
                if (path) setInputVal((p) => `${p} @${path}`)
              }}
              title="Reference file"
            >
              <Paperclip size={15} />
              <span>Reference</span>
            </button>

            <button
              type="submit"
              className="run-task-btn"
              disabled={!inputVal.trim() || isRunning}
              title="Run task with Coder Agent"
            >
              {isRunning ? (
                <>
                  <RotateCcw className="spin" size={14} />
                  <span>Executing…</span>
                </>
              ) : (
                <>
                  <Play size={14} />
                  <span>Execute Plan</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
