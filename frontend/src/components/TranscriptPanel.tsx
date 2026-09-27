import { useEffect, useRef, useState } from 'react'
import {
  AlertTriangle,
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Database,
  Eraser,
  FileCode,
  FileText,
  Loader2,
  MessageSquare,
  Monitor,
  Search,
  Send,
  Terminal,
  UserRound,
  Wrench,
} from 'lucide-react'
import type { PipelineStatus, TranscriptEntry } from '../types/arix'

interface Props {
  status: PipelineStatus
  transcripts: TranscriptEntry[]
  onSend: (text: string) => boolean | Promise<boolean>
  onClear: () => void
}

export function TranscriptPanel({ status, transcripts, onSend, onClear }: Props) {
  const [draft, setDraft] = useState('')
  const [copiedErrorId, setCopiedErrorId] = useState<string | null>(null)
  const [expandedTools, setExpandedTools] = useState<Record<string, boolean>>({})
  const endRef = useRef<HTMLDivElement>(null)
  const connected = !['offline', 'connecting', 'error'].includes(status)
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [transcripts])

  const handleCopyError = (text: string, id: string) => {
    navigator.clipboard.writeText(text)
    setCopiedErrorId(id)
    setTimeout(() => setCopiedErrorId(null), 2500)
  }

  const getToolIcon = (toolName?: string) => {
    if (!toolName) return <Wrench size={13} className="text-sky-400" />
    if (toolName === 'run_command') return <Terminal size={13} className="text-sky-400" />
    if (toolName.includes('file')) return <FileText size={13} className="text-amber-400" />
    if (toolName.includes('memory')) return <Database size={13} className="text-purple-400" />
    if (toolName.includes('search')) return <Search size={13} className="text-cyan-400" />
    if (toolName.includes('computer') || toolName.includes('desktop')) return <Monitor size={13} className="text-sky-400" />
    if (toolName.endsWith('_app')) return <FileCode size={13} className="text-emerald-400" />
    return <Wrench size={13} className="text-sky-400" />
  }

  const submit = async () => {
    if (!draft.trim()) return
    const text = draft
    setDraft('')
    const ok = await onSend(text)
    if (!ok) {
      setDraft(text)
    }
  }

  return (
    <aside className="transcript-panel" id="live-transcription-panel">
      <header className="panel-heading">
        <div><span className="eyebrow">LIVE FEED</span><h2>Conversation</h2></div>
        <button className="icon-button" onClick={onClear} title="Clear transcript"><Eraser size={16} /></button>
      </header>
      <div className="panel-rule"><span className={connected ? 'online' : ''} />{connected ? 'Channel open' : status === 'connecting' ? 'Connecting...' : 'Channel closed'}</div>
      <div className="transcript-stream">
        {transcripts.length === 0 ? (
          <div className="empty-transcript"><MessageSquare size={24} /><p>Your live transcript will appear here.</p><span>Type a message or start a live voice session.</span></div>
        ) : transcripts.map((entry) => {
          // 1. Tool Call Activity Card
          if (entry.tool || entry.toolStatus) {
            const isRunning = entry.toolStatus === 'running'
            const isFailed = entry.toolStatus === 'failed' || Boolean(entry.isError)
            const isExpanded = Boolean(expandedTools[entry.id])
            const hasResult = entry.toolResult !== undefined

            let resultString = ''
            if (hasResult) {
              if (typeof entry.toolResult === 'string') {
                resultString = entry.toolResult
              } else {
                try {
                  resultString = JSON.stringify(entry.toolResult, null, 2)
                } catch {
                  resultString = String(entry.toolResult)
                }
              }
            }

            return (
              <article
                className={`transcript-entry tool-entry status-${isRunning ? 'running' : isFailed ? 'failed' : 'completed'}`}
                key={entry.id}
              >
                <div className="tool-entry-header">
                  <div className="tool-entry-title">
                    {getToolIcon(entry.tool)}
                    <span>{entry.tool || 'System Action'}</span>
                  </div>
                  <div className="tool-entry-meta">
                    {isRunning ? (
                      <span className="tool-entry-badge tool-badge-running">
                        <Loader2 size={10} className="animate-spin" /> In Progress
                      </span>
                    ) : isFailed ? (
                      <span className="tool-entry-badge tool-badge-failed">
                        Failed
                      </span>
                    ) : (
                      <span className="tool-entry-badge tool-badge-completed">
                        <Check size={10} /> Completed
                      </span>
                    )}
                  </div>
                </div>
                <div className="tool-entry-body">
                  <p>{entry.text}</p>
                  {isFailed && entry.error && (
                    <p className="text-red-400 text-xs mt-1">Error: {entry.error}</p>
                  )}
                  {hasResult && resultString.trim() && (
                    <>
                      <button
                        type="button"
                        className="tool-toggle-result-btn"
                        onClick={() =>
                          setExpandedTools((prev) => ({ ...prev, [entry.id]: !prev[entry.id] }))
                        }
                      >
                        {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                        <span>{isExpanded ? 'Hide output' : 'View output'}</span>
                      </button>
                      {isExpanded && (
                        <div className="tool-result-drawer">
                          <pre><code>{resultString}</code></pre>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </article>
            )
          }

          // 2. System Error Entry
          const isErr = Boolean(entry.isError || entry.error || (entry.role === 'system' && (entry.text.toLowerCase().includes('error') || entry.text.toLowerCase().includes('failed'))))
          if (isErr) {
            const errBody = entry.error || entry.text
            const isCopied = copiedErrorId === entry.id
            return (
              <article className="transcript-entry system-error-entry" key={entry.id}>
                <div className="speaker-icon error-icon"><AlertTriangle size={14} className="text-red-400" /></div>
                <div className="entry-content">
                  <header>
                    <strong className="text-red-400">System Error{entry.tool ? `: ${entry.tool}` : ''}</strong>
                    <button
                      type="button"
                      className={`copy-error-mini-btn ${isCopied ? 'copied' : ''}`}
                      onClick={() => handleCopyError(errBody, entry.id)}
                      title="Copy error"
                    >
                      {isCopied ? <Check size={11} className="text-emerald-400" /> : <Copy size={11} />}
                      <span>{isCopied ? 'Copied' : 'Copy'}</span>
                    </button>
                  </header>
                  <pre className="error-code-view"><code>{errBody}</code></pre>
                </div>
              </article>
            )
          }

          // 3. User & Assistant Chat Bubbles
          return (
            <article className={`transcript-entry ${entry.role}`} key={entry.id}>
              <div className="speaker-icon">{entry.role === 'user' ? <UserRound size={14} /> : <Bot size={14} />}</div>
              <div className="entry-content">
                <header><strong>{entry.role === 'user' ? 'You' : 'Arix'}</strong><time>{new Date(entry.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time></header>
                <p>{entry.text}<span className={!entry.final ? 'typing-caret' : ''} /></p>
              </div>
            </article>
          )
        })}
        <div ref={endRef} />
      </div>
      <footer className="text-composer">
        <input value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && submit()} placeholder={connected ? 'Send a text message or command…' : 'Type a message or command to wake Arix…'} aria-label="Message Arix" />
        <button onClick={submit} disabled={!draft.trim()} aria-label="Send message"><Send size={16} /></button>
      </footer>
    </aside>
  )
}
