import React, { useEffect, useMemo, useRef, useState } from 'react'
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
  Loader2,
  Paperclip,
  Play,
  RotateCcw,
  Search,
  Sparkles,
  Square,
  Terminal,
  UploadCloud,
  Wrench,
} from 'lucide-react'
import type { ProjectItem } from '../../types/arix'
import { MarkdownRenderer } from '../common/MarkdownRenderer'
import { FileUploadModal, AttachedFile } from '../common/FileUploadModal'
import { FileAttachmentBar } from '../common/FileAttachmentBar'

const API_URL = import.meta.env.VITE_ARIX_API_URL ?? 'http://127.0.0.1:8765'

export interface ToolActivity {
  id: string
  tool: string
  args?: Record<string, any>
  result?: any
  diff?: string
  status: 'running' | 'completed' | 'failed'
  error?: string
  timestamp: number
}

export interface CoderTurn {
  id: string
  userPrompt: string
  activities: ToolActivity[]
  assistantReport?: string
  modifiedFiles?: string[]
  error?: string
  isRunning: boolean
  startedAt: number
  completedAt?: number
}

interface Props {
  project: ProjectItem
  pendingHandoffPrompt?: string
  autoExecute?: boolean
  onClearHandoff?: () => void
  onFileModified?: (filePath: string) => void
  onOpenFile?: (filePath: string) => void
}

function formatDuration(seconds: number): string {
  if (seconds < 1) return '< 1s'
  if (seconds < 60) return `${Math.round(seconds)}s`
  const mins = Math.floor(seconds / 60)
  const secs = Math.round(seconds % 60)
  return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`
}

function getBasename(path: string): string {
  if (!path) return ''
  const parts = path.split(/[/\\]/)
  return parts.pop() || path
}

function FileIcon({ path, isFolder }: { path: string; isFolder?: boolean }) {
  if (isFolder) {
    return <span className="lang-icon folder-icon" title="Directory">📁</span>
  }
  const ext = path.split('.').pop()?.toLowerCase() || ''
  if (['tsx', 'jsx'].includes(ext)) {
    return <span className="lang-icon react-icon" title="React / JSX">⚛️</span>
  }
  if (['py', 'pyw'].includes(ext)) {
    return <span className="lang-icon python-icon" title="Python">🐍</span>
  }
  if (['ts', 'js', 'mjs', 'cjs'].includes(ext)) {
    return <span className="lang-icon script-icon" title="TypeScript / JavaScript">📜</span>
  }
  if (['json', 'yaml', 'yml'].includes(ext)) {
    return <span className="lang-icon config-icon" title="Configuration">⚙️</span>
  }
  if (['css', 'scss', 'less'].includes(ext)) {
    return <span className="lang-icon css-icon" title="Styles">🎨</span>
  }
  if (['md', 'txt'].includes(ext)) {
    return <span className="lang-icon doc-icon" title="Documentation">📄</span>
  }
  return <span className="lang-icon default-icon" title="File">📄</span>
}

function parseDiffStats(diff?: string): { additions: number; deletions: number } {
  if (!diff) return { additions: 0, deletions: 0 }
  let additions = 0
  let deletions = 0
  const lines = diff.split('\n')
  for (const line of lines) {
    if (line.startsWith('+') && !line.startsWith('+++')) additions++
    else if (line.startsWith('-') && !line.startsWith('---')) deletions++
  }
  return { additions, deletions }
}

function getExplorationSummary(activities: ToolActivity[], isRunning: boolean): string {
  const readActs = activities.filter((a) => a.tool === 'read_file')
  const editActs = activities.filter((a) => a.tool === 'edit_file' || a.tool === 'write_file')
  const searchActs = activities.filter((a) => a.tool === 'search_in_files')
  const folderActs = activities.filter((a) => a.tool === 'list_directory')
  const taskActs = activities.filter((a) => a.tool.includes('task'))

  const totalFiles = readActs.length + editActs.length
  const totalFolders = folderActs.length
  const totalSearches = searchActs.length
  const totalTasks = taskActs.length

  if (isRunning) {
    const parts: string[] = []
    if (totalFiles > 0) parts.push(`${totalFiles} file${totalFiles === 1 ? '' : 's'}`)
    if (totalFolders > 0) parts.push(`${totalFolders} folder${totalFolders === 1 ? '' : 's'}`)
    if (totalTasks > 0) parts.push(`${totalTasks} task${totalTasks === 1 ? '' : 's'}`)
    if (totalSearches > 0) parts.push(`${totalSearches} search${totalSearches === 1 ? '' : 'es'}`)
    return parts.length > 0 ? `Exploring ${parts.join(', ')}` : 'Exploring 1 file'
  }

  const parts: string[] = []
  if (totalFiles > 0) parts.push(`${totalFiles} file${totalFiles === 1 ? '' : 's'}`)
  if (totalFolders > 0) parts.push(`${totalFolders} folder${totalFolders === 1 ? '' : 's'}`)
  if (totalSearches > 0) parts.push(`${totalSearches} search${totalSearches === 1 ? '' : 'es'}`)
  if (totalTasks > 0) parts.push(`${totalTasks} task${totalTasks === 1 ? '' : 's'}`)

  if (parts.length === 0) return `${activities.length} tool ${activities.length === 1 ? 'call' : 'calls'}`
  return `Explored ${parts.join(', ')}`
}

export function CoderTab({
  project,
  pendingHandoffPrompt,
  autoExecute,
  onClearHandoff,
  onFileModified,
  onOpenFile,
}: Props) {
  const [turns, setTurns] = useState<CoderTurn[]>([])
  const [inputVal, setInputVal] = useState('')
  const [isRunning, setIsRunning] = useState(false)
  const [statusText, setStatusText] = useState('Idle — ready for coding tasks')
  const [currentTool, setCurrentTool] = useState<string | null>(null)
  const [expandedTurns, setExpandedTurns] = useState<Record<string, boolean>>({})
  const [expandedToolDetails, setExpandedToolDetails] = useState<Record<string, boolean>>({})
  const [applyingTrialId, setApplyingTrialId] = useState<string | null>(null)
  const [appliedTrials, setAppliedTrials] = useState<Record<string, boolean>>({})
  const [copiedErrorId, setCopiedErrorId] = useState<string | null>(null)
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([])
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false)
  const [isDraggingOver, setIsDraggingOver] = useState(false)

  const handleContainerDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDraggingOver(true)
  }

  const handleContainerDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.currentTarget.contains(e.relatedTarget as Node)) return
    setIsDraggingOver(false)
  }

  const handleContainerDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDraggingOver(false)

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const root = project?.path || ''
      const files = Array.from(e.dataTransfer.files)
      for (const file of files) {
        try {
          const formData = new FormData()
          formData.append('file', file)
          formData.append('workspace_root', root)
          formData.append('destination_subpath', 'uploads')
          const res = await fetch(`${API_URL}/api/workspace/upload`, {
            method: 'POST',
            body: formData,
          })
          const data = await res.json()
          if (data.ok && data.file) {
            setAttachedFiles((prev) => [
              ...prev,
              {
                id: `att-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                name: data.file.name,
                path: data.file.path,
                relative_path: data.file.relative_path,
                size: data.file.size,
                mime_type: data.file.mime_type,
                is_text: data.file.is_text,
                preview: data.file.preview,
                is_dir: false,
                status: 'ready',
              },
            ])
          }
        } catch (err) {
          console.error('Failed to upload dropped file in CoderTab:', err)
        }
      }
    }
  }

  const wsRef = useRef<WebSocket | null>(null)
  const timelineEndRef = useRef<HTMLDivElement>(null)

  // Scroll to bottom on new updates
  useEffect(() => {
    timelineEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [turns, isRunning])

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

        if (data.type === 'status') {
          // Keep top status text concise
          const msg = data.message || data.status
          setStatusText(msg.length > 60 ? `${msg.slice(0, 57)}…` : msg)

          if (data.status === 'idle' || data.status === 'stopped') {
            setIsRunning(false)
            setCurrentTool(null)
            setTurns((prev) => {
              if (prev.length === 0) return prev
              const last = { ...prev[prev.length - 1] }
              if (last.isRunning) {
                last.isRunning = false
                last.completedAt = Date.now()
                if (data.modified_files) {
                  last.modifiedFiles = Array.from(new Set([...(last.modifiedFiles || []), ...data.modified_files]))
                }
                return [...prev.slice(0, -1), last]
              }
              return prev
            })
          } else {
            setIsRunning(true)
          }

          if (data.modified_files && onFileModified) {
            data.modified_files.forEach((f: string) => onFileModified(f))
          }
        } else if (data.type === 'tool_call') {
          setCurrentTool(data.tool)
          setTurns((prev) => {
            if (prev.length === 0) return prev
            const last = { ...prev[prev.length - 1] }
            const newAct: ToolActivity = {
              id: `act-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
              tool: data.tool,
              args: data.args,
              status: 'running',
              timestamp: Date.now(),
            }
            last.activities = [...last.activities, newAct]
            return [...prev.slice(0, -1), last]
          })
        } else if (data.type === 'tool_result') {
          setCurrentTool(null)
          setTurns((prev) => {
            if (prev.length === 0) return prev
            const last = { ...prev[prev.length - 1] }
            const acts = [...last.activities]
            // Match latest activity with same tool name and running status
            const actIdx = acts.slice().reverse().findIndex((a) => a.tool === data.tool && a.status === 'running')
            const targetIdx = actIdx !== -1 ? acts.length - 1 - actIdx : acts.length - 1

            if (targetIdx >= 0 && acts[targetIdx]) {
              const res = data.result
              const hasErr = !res?.success || !res?.ok || Boolean(res?.error) || Boolean(data.error)
              acts[targetIdx] = {
                ...acts[targetIdx],
                result: res,
                diff: data.diff || res?.diff,
                status: hasErr ? 'failed' : 'completed',
                error: data.error || res?.error,
              }
            } else {
              acts.push({
                id: `act-${Date.now()}`,
                tool: data.tool,
                result: data.result,
                diff: data.diff,
                status: 'completed',
                timestamp: Date.now(),
              })
            }
            last.activities = acts
            return [...prev.slice(0, -1), last]
          })
        } else if (data.type === 'thought') {
          // Sequential thinking or reasoning thoughts
          if (data.content && data.content.trim()) {
            setTurns((prev) => {
              if (prev.length === 0) return prev
              const last = { ...prev[prev.length - 1] }
              // Attach as a thought activity
              last.activities = [
                ...last.activities,
                {
                  id: `thought-${Date.now()}`,
                  tool: 'reasoning',
                  result: { thought: data.content },
                  status: 'completed',
                  timestamp: Date.now(),
                },
              ]
              return [...prev.slice(0, -1), last]
            })
          }
        } else if (data.type === 'message' && data.role === 'assistant') {
          // Final assistant output report!
          setIsRunning(false)
          setCurrentTool(null)
          setTurns((prev) => {
            if (prev.length === 0) {
              return [{
                id: `turn-${Date.now()}`,
                userPrompt: '',
                activities: [],
                assistantReport: data.content,
                isRunning: false,
                startedAt: Date.now(),
                completedAt: Date.now(),
              }]
            }
            const last = { ...prev[prev.length - 1] }
            last.assistantReport = (last.assistantReport ? `${last.assistantReport}\n\n` : '') + data.content
            last.isRunning = false
            last.completedAt = Date.now()
            return [...prev.slice(0, -1), last]
          })
        } else if (data.type === 'error' || data.type === 'system_error') {
          setIsRunning(false)
          setCurrentTool(null)
          const errText = data.error || data.message || 'Execution error occurred.'
          setStatusText(`Error: ${errText.slice(0, 45)}`)
          setTurns((prev) => {
            if (prev.length === 0) return prev
            const last = { ...prev[prev.length - 1] }
            last.error = errText
            last.isRunning = false
            last.completedAt = Date.now()
            return [...prev.slice(0, -1), last]
          })
        }
      } catch (err) {
        console.error('Failed to parse coder WS message:', err)
      }
    }

    return () => {
      isUnmounted = true
      ws.onmessage = null
      ws.onerror = null
      ws.onclose = null
      if (ws.readyState === WebSocket.OPEN) {
        ws.close(1000, 'Unmounted')
      }
    }
  }, [project.path])

  const handleSend = (overridePromptOrEvent?: string | React.FormEvent) => {
    let promptText = ''
    if (typeof overridePromptOrEvent === 'string') {
      promptText = overridePromptOrEvent.trim()
    } else {
      if (
        overridePromptOrEvent &&
        typeof overridePromptOrEvent === 'object' &&
        'preventDefault' in overridePromptOrEvent
      ) {
        overridePromptOrEvent.preventDefault()
      }
      promptText = inputVal.trim()
    }

    if ((!promptText && attachedFiles.length === 0) || isRunning) return

    if (attachedFiles.length > 0) {
      const attachSummary = attachedFiles
        .map((f) => {
          let str = `[Attached File: ${f.name} | Path: ${f.path} | Size: ${f.size} bytes | Type: ${f.mime_type}]`
          if (f.preview && f.is_text) {
            str += `\n\`\`\`\n${f.preview}\n\`\`\``
          }
          return str
        })
        .join('\n\n')

      promptText = promptText
        ? `${attachSummary}\n\nTask:\n${promptText}`
        : `${attachSummary}\n\nTask: Process and implement requirements for the attached file(s).`
      setAttachedFiles([])
    }

    setInputVal('')
    setIsRunning(true)
    setStatusText('Coder Agent analyzing task & workspace…')

    const newTurn: CoderTurn = {
      id: `turn-${Date.now()}`,
      userPrompt: promptText,
      activities: [],
      isRunning: true,
      startedAt: Date.now(),
    }

    setTurns((prev) => [...prev, newTurn])

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

  // Auto-fill prompt if handed off and auto-run immediately if autoExecute is true
  useEffect(() => {
    if (pendingHandoffPrompt) {
      const p = pendingHandoffPrompt
      setInputVal(p)
      if (onClearHandoff) onClearHandoff()
      if (autoExecute) {
        const timer = setTimeout(() => {
          handleSend(p)
        }, 150)
        return () => clearTimeout(timer)
      }
    }
  }, [pendingHandoffPrompt, autoExecute])

  const handleStop = () => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ action: 'stop' }))
    }
    setIsRunning(false)
    setStatusText('Execution stopped by user.')
  }

  const toggleTurnAccordion = (turnId: string) => {
    setExpandedTurns((p) => ({ ...p, [turnId]: !p[turnId] }))
  }

  const toggleToolDetails = (actId: string) => {
    setExpandedToolDetails((p) => ({ ...p, [actId]: !p[actId] }))
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

  const handleCopyError = (errText: string, id: string) => {
    navigator.clipboard.writeText(errText)
    setCopiedErrorId(id)
    setTimeout(() => setCopiedErrorId(null), 2500)
  }

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDraggingOver(false)

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      await handleContainerDrop(e)
      return
    }

    const textData = e.dataTransfer.getData('text/plain')
    if (textData) {
      setInputVal((prev) => (prev ? `${prev} ${textData}` : textData))
    }
  }

  return (
    <div
      className={`antigravity-chat-container ${isDraggingOver ? 'dragging-file-active' : ''}`}
      onDragOver={handleContainerDragOver}
      onDragLeave={handleContainerDragLeave}
      onDrop={handleDrop}
    >
      {/* Top Status Bar */}
      <div className="antigravity-status-bar">
        <div className="status-bar-left">
          <span className={`status-dot ${isRunning ? 'running' : 'idle'}`} />
          <span className="status-text-line" title={statusText}>
            {statusText}
          </span>
        </div>

        <div className="status-bar-right">
          <span className="model-pill">
            <Sparkles size={11} />
            <span>GEMINI 3.8 EXTENDED THINKING</span>
          </span>
          {isRunning && (
            <button className="stop-action-btn" onClick={handleStop} title="Stop current execution">
              <Square size={11} />
              <span>Stop</span>
            </button>
          )}
        </div>
      </div>

      {/* Main Conversation Stream */}
      <div className="antigravity-timeline">
        {turns.length === 0 ? (
          <div className="antigravity-empty-state">
            <Code2 size={38} className="empty-icon text-cyan-400" />
            <h3>Arix Coder Agent</h3>
            <p>
              Autonomous software engineering partner. Provide goals, bug reports, or refactoring tasks.
              Intermediate tool reasoning will stay collapsed, producing clean Markdown reports.
            </p>
            <div className="example-prompt-pills">
              <button onClick={() => setInputVal('Review the project structure and run tests')}>
                Review structure & tests
              </button>
              <button onClick={() => setInputVal('Find and fix any TypeScript or lint errors')}>
                Fix lint errors
              </button>
              <button onClick={() => setInputVal('Use SWE-Kit to refactor and verify with isolated trial')}>
                SWE-Kit isolated trial
              </button>
            </div>
          </div>
        ) : (
          turns.map((turn, tIdx) => {
            const hasActivities = turn.activities.length > 0
            const isTurnExpanded = Boolean(expandedTurns[turn.id])
            const durationSec = turn.completedAt
              ? (turn.completedAt - turn.startedAt) / 1000
              : (Date.now() - turn.startedAt) / 1000

            return (
              <div key={turn.id} className="antigravity-turn-block">
                {/* 1. User Request Card (Image 3 Style) */}
                {turn.userPrompt && (
                  <div className="antigravity-user-card">
                    <div className="user-card-content">
                      <MarkdownRenderer content={turn.userPrompt} />
                    </div>
                  </div>
                )}

                {/* 2. Tool Activity Collapsible in Antigravity IDE Activity Feed Style */}
                {hasActivities && (
                  <div className="antigravity-activities-wrapper">
                    {/* Collapsed Header / Accordion Toggle */}
                    <div
                      className={`antigravity-explored-header ${turn.isRunning ? 'active-working' : 'is-collapsed'}`}
                      onClick={() => toggleTurnAccordion(turn.id)}
                    >
                      <div className="explored-header-left">
                        <span className="explored-header-title">
                          {getExplorationSummary(turn.activities, turn.isRunning)}
                        </span>
                      </div>
                      <span className="explored-toggle-arrow">
                        {isTurnExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      </span>
                    </div>

                    {/* Expanded Activity List (Photo 1, 2, 3, 4, 5 style) */}
                    {isTurnExpanded && (
                      <div className="antigravity-activity-feed">
                        {turn.activities.map((act) => {
                          const isActOpen = Boolean(expandedToolDetails[act.id])
                          const isSequential =
                            act.tool === 'sequentialthinking' ||
                            act.tool === 'sequential_thinking' ||
                            act.tool === 'reasoning'
                          const resObj = act.result && typeof act.result === 'object' ? act.result : null

                          if (isSequential) {
                            const thoughtText = resObj?.thought || act.args?.thought || ''
                            return (
                              <div key={act.id} className="antigravity-activity-thought-wrap">
                                <div
                                  className="antigravity-activity-row thought-row clickable"
                                  onClick={() => toggleToolDetails(act.id)}
                                >
                                  <span className="activity-thought-label">
                                    {turn.isRunning ? 'Thinking for 3s' : 'Thought for 3s'}
                                  </span>
                                  {isActOpen ? (
                                    <ChevronDown size={12} className="text-slate-400" />
                                  ) : (
                                    <ChevronRight size={12} className="text-slate-400" />
                                  )}
                                </div>
                                {(isActOpen || turn.isRunning) && thoughtText && (
                                  <div className="antigravity-thought-text-block">
                                    <p>{thoughtText}</p>
                                  </div>
                                )}
                              </div>
                            )
                          }

                          if (act.tool === 'read_file') {
                            const path = act.args?.path || ''
                            const filename = getBasename(path)
                            const lineInfo =
                              act.args?.start_line && act.args?.end_line
                                ? `#L${act.args.start_line}-${act.args.end_line}`
                                : act.args?.start_line
                                  ? `#L${act.args.start_line}`
                                  : ''
                            return (
                              <div
                                key={act.id}
                                className="antigravity-activity-row file-row clickable"
                                onClick={() => {
                                  if (path && onOpenFile) onOpenFile(path)
                                }}
                                title={path ? `Open ${path} in editor` : undefined}
                              >
                                <span className="activity-verb">Analyzed</span>
                                <FileIcon path={path} />
                                <span className="activity-filename">{filename}</span>
                                {lineInfo && <span className="activity-lines">{lineInfo}</span>}
                              </div>
                            )
                          }

                          if (act.tool === 'list_directory') {
                            const path = act.args?.path || '.'
                            return (
                              <div key={act.id} className="antigravity-activity-row folder-row">
                                <span className="activity-verb">Analyzed</span>
                                <FileIcon path={path} isFolder={true} />
                                <span className="activity-filename">{path}</span>
                                <ChevronRight size={12} className="text-slate-500" />
                              </div>
                            )
                          }

                          if (act.tool === 'search_in_files') {
                            const query = act.args?.query || ''
                            const path = act.args?.path || '.'
                            return (
                              <div key={act.id} className="antigravity-activity-row search-row">
                                <span className="activity-verb">Explored</span>
                                <Search size={13} className="text-blue-400" />
                                <span className="activity-query font-mono">"{query}"</span>
                                {path !== '.' && <span className="activity-lines">in {path}</span>}
                              </div>
                            )
                          }

                          if (act.tool === 'edit_file' || act.tool === 'write_file') {
                            const path = act.args?.path || ''
                            const filename = getBasename(path)
                            const stats = parseDiffStats(act.diff)
                            return (
                              <div key={act.id} className="antigravity-activity-edit-wrap">
                                <div
                                  className="antigravity-activity-row edit-row clickable"
                                  onClick={() => toggleToolDetails(act.id)}
                                  title="Click to toggle diff"
                                >
                                  <span className="activity-verb">Edited</span>
                                  <FileIcon path={path} />
                                  <span className="activity-filename">{filename}</span>
                                  <span className="activity-diff-stats">
                                    <span className="diff-stat-add">+{stats.additions || 1}</span>
                                    <span className="diff-stat-del">-{stats.deletions}</span>
                                  </span>
                                  {isActOpen ? (
                                    <ChevronDown size={12} className="text-slate-500" />
                                  ) : (
                                    <ChevronRight size={12} className="text-slate-500" />
                                  )}
                                </div>

                                {/* Diff drawer */}
                                {isActOpen && act.diff && (
                                  <div className="antigravity-diff-box">
                                    <pre className="diff-code">
                                      {act.diff.split('\n').map((line, lIdx) => {
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
                              </div>
                            )
                          }

                          if (act.tool === 'run_command') {
                            const cmd = act.args?.command || ''
                            return (
                              <div key={act.id} className="antigravity-activity-run-wrap">
                                <div
                                  className="antigravity-activity-row run-row clickable"
                                  onClick={() => toggleToolDetails(act.id)}
                                >
                                  <span className="activity-verb">Run</span>
                                  <span className="activity-cmd-title font-mono">{cmd}</span>
                                  {act.status === 'running' ? (
                                    <Loader2 size={12} className="spin text-cyan-400" />
                                  ) : act.status === 'failed' ? (
                                    <AlertCircle size={12} className="text-red-400" />
                                  ) : (
                                    <Check size={12} className="text-emerald-400" />
                                  )}
                                  {isActOpen ? (
                                    <ChevronDown size={12} className="text-slate-500" />
                                  ) : (
                                    <ChevronRight size={12} className="text-slate-500" />
                                  )}
                                </div>

                                {/* Terminal Dark Code Block (Photo 4) */}
                                <div className="antigravity-terminal-card">
                                  <div className="terminal-cmd-line">
                                    <span className="terminal-prompt">...\Arix-AI &gt;</span>
                                    <span className="terminal-command-text">{cmd}</span>
                                  </div>
                                  {isActOpen && act.result && (act.result.stdout || act.result.stderr) && (
                                    <pre className="terminal-output-body">
                                      {act.result.stdout || act.result.stderr}
                                    </pre>
                                  )}
                                </div>
                              </div>
                            )
                          }

                          if (act.tool.includes('task') || act.tool === 'agent_task') {
                            const taskTitle = act.args?.title || act.args?.task_name || 'Verify step'
                            return (
                              <div key={act.id} className="antigravity-activity-row task-row">
                                <Check size={12} className="text-emerald-400" />
                                <span className="activity-task-checked">Checked Task:</span>
                                <span className="activity-task-name">{taskTitle}</span>
                              </div>
                            )
                          }

                          // Fallback generic tool
                          return (
                            <div key={act.id} className="antigravity-activity-row generic-row">
                              <Wrench size={13} className="text-slate-400" />
                              <span className="activity-verb">{act.tool}</span>
                              {act.args?.path && <span className="activity-filename">{act.args.path}</span>}
                              {act.status === 'running' && <Loader2 size={11} className="spin text-cyan-400" />}
                            </div>
                          )
                        })}

                        {/* Isolated Trial Confirmation Box if present */}
                        {turn.activities.map((act) => {
                          const resObj = act.result && typeof act.result === 'object' ? act.result : null
                          const isTrial = Boolean(resObj?.trial_id || resObj?.mode === 'isolated_trial')
                          const trialId = resObj?.trial_id || ''
                          if (!isTrial) return null
                          return (
                            <div key={`trial-${act.id}`} className="swe-trial-box">
                              <div className="swe-trial-header">
                                <div className="swe-trial-title">
                                  <Boxes size={13} />
                                  <span>Sandbox Trial: <code>{trialId}</code></span>
                                </div>
                                <span className={`badge ${appliedTrials[trialId] ? 'badge-success' : 'badge-warning'}`}>
                                  {appliedTrials[trialId] ? 'Applied' : 'Pending Confirmation'}
                                </span>
                              </div>
                              {appliedTrials[trialId] ? (
                                <div className="applied-pill">
                                  <CheckCircle2 size={13} />
                                  <span>Changes Applied to Project</span>
                                </div>
                              ) : (
                                <button
                                  type="button"
                                  className="apply-trial-btn"
                                  disabled={applyingTrialId === trialId}
                                  onClick={() => handleApplyTrial(trialId)}
                                >
                                  <CheckCircle2 size={13} />
                                  <span>{applyingTrialId === trialId ? 'Applying…' : 'Apply Changes'}</span>
                                </button>
                              )}
                            </div>
                          )
                        })}

                        {/* Pulsing Working indicator while running (Photos 1, 3, 4) */}
                        {turn.isRunning && (
                          <div className="antigravity-working-indicator">
                            <span className="working-pulse-dot" />
                            <span className="working-text">Working...</span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* 3. Error Banner (Sanitized & Dismissible) */}
                {turn.error && (
                  <div className="antigravity-error-banner">
                    <div className="error-banner-header">
                      <AlertTriangle size={15} className="text-amber-400" />
                      <span className="font-semibold text-amber-300">Notice</span>
                      <button
                        type="button"
                        className="copy-error-btn-clean"
                        onClick={() => handleCopyError(turn.error || '', turn.id)}
                      >
                        {copiedErrorId === turn.id ? 'Copied!' : 'Copy Details'}
                      </button>
                    </div>
                    <div className="error-banner-body">
                      {turn.error}
                    </div>
                  </div>
                )}

                {/* 4. Assistant Final Output Report (Image 3 Style) */}
                {turn.assistantReport && (
                  <div className="antigravity-report-card">
                    <MarkdownRenderer content={turn.assistantReport} />

                    {turn.modifiedFiles && turn.modifiedFiles.length > 0 && (
                      <div className="report-modified-row">
                        <span className="modified-label">Modified:</span>
                        {turn.modifiedFiles.map((f) => (
                          <button
                            key={f}
                            className="modified-file-chip"
                            onClick={() => onOpenFile?.(f)}
                            title={`Open ${f} in editor`}
                          >
                            <FileCode size={11} />
                            <span>{f}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })
        )}
        <div ref={timelineEndRef} />
      </div>

      {/* File Attachments Bar */}
      <FileAttachmentBar
        files={attachedFiles}
        onRemove={(id) => setAttachedFiles((prev) => prev.filter((f) => f.id !== id))}
      />

      {/* Bottom Input Dock */}
      <div className="antigravity-input-dock">
        <form className="antigravity-input-form" onSubmit={handleSend}>
          <textarea
            className="antigravity-textarea"
            placeholder={
              attachedFiles.length > 0
                ? 'Type instructions for attached files or click Execute…'
                : 'Type instructions, paste code, or drag files from Explorer… (Enter to run, Shift+Enter for newline)'
            }
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

          <div className="input-actions-bar">
            <div className="input-actions-left" style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <button
                type="button"
                className="reference-file-btn attach-upload-btn"
                onClick={() => setIsUploadModalOpen(true)}
                title="Attach or upload files (drag & drop, browse, or host path)"
              >
                <UploadCloud size={14} />
                <span>Attach / Upload</span>
              </button>

              <button
                type="button"
                className="reference-file-btn"
                onClick={() => {
                  const path = prompt('Enter relative path to reference (e.g. src/App.tsx):')
                  if (path) setInputVal((p) => `${p} @${path}`)
                }}
                title="Reference file"
              >
                <Paperclip size={14} />
                <span>Reference</span>
              </button>
            </div>

            <button
              type="submit"
              className="execute-turn-btn"
              disabled={(!inputVal.trim() && attachedFiles.length === 0) || isRunning}
              title="Run task with Coder Agent"
            >
              {isRunning ? (
                <>
                  <Loader2 className="spin" size={13} />
                  <span>Executing…</span>
                </>
              ) : (
                <>
                  <Play size={13} />
                  <span>Execute Plan</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>

      {/* Drag & Drop Visual Overlay */}
      {isDraggingOver && (
        <div className="drag-drop-overlay">
          <div className="drag-drop-box">
            <UploadCloud size={44} className="text-cyan-400" />
            <h3>Drop any files into Coder Agent</h3>
            <p>Files will be attached and analyzed during code planning & execution</p>
          </div>
        </div>
      )}

      {/* File Upload Modal */}
      <FileUploadModal
        isOpen={isUploadModalOpen}
        onClose={() => setIsUploadModalOpen(false)}
        workspaceRoot={project?.path || ''}
        onFilesAttached={(newFiles) => setAttachedFiles((prev) => [...prev, ...newFiles])}
      />
    </div>
  )
}
