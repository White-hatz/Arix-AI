import React, { useEffect, useRef, useState } from 'react'
import {
  AlertTriangle,
  ArrowRight,
  Bot,
  Check,
  CheckSquare,
  ClipboardList,
  Copy,
  ExternalLink,
  FileText,
  Mic,
  MicOff,
  Send,
  Sparkles,
  Terminal,
  User,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react'
import { AudioOrb } from '../AudioOrb'
import type { LiveSessionStatus, ProjectItem, TranscriptItem } from '../../types/arix'

interface Props {
  project?: ProjectItem
  status: LiveSessionStatus
  audioLevel: number
  isThinking: boolean
  currentModel: string
  transcripts: TranscriptItem[]
  onSendText: (text: string) => void
  onToggleSession: () => void
  onHandoffToCoder: (prompt: string) => void
  insertedRef?: string
  isMuted?: boolean
  onToggleMute?: () => void
}

export function DirectAssistantTab({
  project,
  status,
  audioLevel,
  isThinking: _isThinking,
  currentModel,
  transcripts,
  onSendText,
  onToggleSession,
  onHandoffToCoder,
  insertedRef,
  isMuted = false,
  onToggleMute,
}: Props) {
  const [inputVal, setInputVal] = useState('')
  const [overlayFile, setOverlayFile] = useState<string | null>(null)
  const [overlayContent, setOverlayContent] = useState('')
  const [overlayLoading, setOverlayLoading] = useState(false)
  const [overlayError, setOverlayError] = useState<string | null>(null)
  const [copiedCmd, setCopiedCmd] = useState(false)
  const [recommendedCmd, setRecommendedCmd] = useState('npm run test')
  const chatStreamRef = useRef<HTMLDivElement>(null)

  const connected = !['offline', 'error'].includes(status)

  // Auto-scroll live messages to bottom
  useEffect(() => {
    chatStreamRef.current?.scrollTo({
      top: chatStreamRef.current.scrollHeight,
      behavior: 'smooth',
    })
  }, [transcripts])

  // Extract recommended command if assistant message contains bash or terminal commands
  useEffect(() => {
    const lastAssistant = [...transcripts].reverse().find((t) => t.role === 'assistant')
    if (lastAssistant) {
      const cmdMatch = lastAssistant.text.match(/```(?:bash|sh|cmd|powershell)?\s*\n([^`]+)\n```/)
      if (cmdMatch && cmdMatch[1]) {
        const firstLine = cmdMatch[1].trim().split('\n')[0].replace(/^[$>]\s*/, '').trim()
        if (firstLine) setRecommendedCmd(firstLine)
      }
    }
  }, [transcripts])

  // Handle inserted references from workspace
  useEffect(() => {
    if (insertedRef) {
      setInputVal((prev) => (prev ? `${prev} **${insertedRef}**` : `**${insertedRef}**`))
    }
  }, [insertedRef])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!inputVal.trim()) return

    // Strip @ prefix from file mentions and format in bold: "@src/App.tsx" -> "**src/App.tsx**"
    const formatted = inputVal.replace(/@([a-zA-Z0-9_\-./]+)/g, '**$1**')
    onSendText(formatted)
    setInputVal('')
  }

  const handleHandoffLatest = () => {
    const lastAssistant = [...transcripts].reverse().find((t) => t.role === 'assistant')
    if (lastAssistant) {
      onHandoffToCoder(lastAssistant.text)
    } else if (inputVal.trim()) {
      onHandoffToCoder(inputVal.trim())
    }
  }

  // Open file context overlay modal on the main window
  const handleOpenFileOverlay = async (filePath: string) => {
    setOverlayFile(filePath)
    setOverlayLoading(true)
    setOverlayError(null)
    setOverlayContent('')

    const root = project?.path || '.'
    try {
      const res = await fetch(
        `http://127.0.0.1:8765/api/workspace/file-content?workspace_root=${encodeURIComponent(
          root,
        )}&path=${encodeURIComponent(filePath)}`,
      )
      const data = await res.json()
      if (data.success && typeof data.content === 'string') {
        setOverlayContent(data.content)
      } else {
        setOverlayError(data.error || `File ${filePath} does not exist yet.`)
      }
    } catch (err: any) {
      setOverlayError(`Failed to fetch file: ${err.message}`)
    } finally {
      setOverlayLoading(false)
    }
  }

  const [copiedErrorId, setCopiedErrorId] = useState<string | null>(null)

  const handleCopyCmd = (cmd: string) => {
    navigator.clipboard.writeText(cmd)
    setCopiedCmd(true)
    setTimeout(() => setCopiedCmd(false), 2000)
  }

  const handleCopyError = (errText: string, id: string) => {
    navigator.clipboard.writeText(errText)
    setCopiedErrorId(id)
    setTimeout(() => setCopiedErrorId(null), 2500)
  }

  // Render text replacing file mentions (@file or **file**) with clickable bold chips
  const renderMessageContent = (text: string) => {
    const parts: (string | JSX.Element)[] = []
    const mentionRegex = /(?:@|\*\*)([a-zA-Z0-9_\-./]+\.[a-zA-Z0-9]+)(?:\*\*)?/g
    let lastIndex = 0
    let match: RegExpExecArray | null

    while ((match = mentionRegex.exec(text)) !== null) {
      if (match.index > lastIndex) {
        parts.push(text.substring(lastIndex, match.index))
      }
      const rawPath = match[1]
      parts.push(
        <span
          key={`${match.index}-${rawPath}`}
          className="file-mention-badge"
          onClick={() => handleOpenFileOverlay(rawPath)}
          title={`Click to preview ${rawPath} in overlay`}
        >
          <strong>{rawPath}</strong>
        </span>,
      )
      lastIndex = mentionRegex.lastIndex
    }

    if (lastIndex < text.length) {
      parts.push(text.substring(lastIndex))
    }

    return parts.length > 0 ? parts : text
  }

  return (
    <div className="direct-assistant-container">
      {/* Top Header Bar */}
      <div className="assistant-top-bar">
        <div className="assistant-model-info">
          <span className="eyebrow">
            <Sparkles size={12} /> ASSISTANT
          </span>
          <span className="assistant-model-pill" title="Active Model">
            {currentModel}
          </span>
        </div>

        <div className="assistant-actions">
          <button
            className={`voice-connect-mini-btn ${connected ? 'connected' : ''}`}
            onClick={status === 'connecting' ? undefined : onToggleSession}
            disabled={status === 'connecting'}
            title={
              status === 'connecting'
                ? 'Connecting Voice...'
                : connected
                  ? 'Disconnect Live Voice'
                  : 'Start Live Voice'
            }
          >
            {connected ? <Mic size={14} /> : <MicOff size={14} />}
            <span>
              {status === 'connecting'
                ? 'Connecting…'
                : connected
                  ? 'Voice Active'
                  : 'Start Voice'}
            </span>
          </button>

          {connected && (
            <button
              className={`voice-mute-btn ${isMuted ? 'muted' : ''}`}
              onClick={onToggleMute}
              title={isMuted ? 'Unmute AI voice output' : 'Mute AI voice output'}
              type="button"
            >
              {isMuted ? <VolumeX size={14} className="text-amber-400" /> : <Volume2 size={14} />}
              <span>{isMuted ? 'Muted' : 'Mute AI'}</span>
            </button>
          )}

          <button
            className="handoff-coder-btn"
            onClick={handleHandoffLatest}
            title="Transfer synthesized plan to Coder Agent"
          >
            <span>Handoff to Coder</span>
            <ArrowRight size={14} />
          </button>
        </div>
      </div>

      {/* Mandatory Planning & Tasks Box */}
      <div className="planning-box-card">
        <div className="planning-box-header">
          <div className="planning-box-title">
            <ClipboardList size={15} className="planning-icon" />
            <h3>Project Execution Plan & Task Tracker</h3>
            <span className="mandatory-pill">Mandatory Planning Active</span>
          </div>
          <p className="planning-box-desc">
            Arix clarifies requirements with proactive questions and establishes <strong>PLAN.md</strong> and <strong>TASKS.md</strong> before execution.
          </p>
        </div>

        <div className="planning-box-actions">
          <button
            className="planning-file-btn"
            onClick={() => handleOpenFileOverlay('PLAN.md')}
            title="Inspect project PLAN.md in overlay"
          >
            <FileText size={13} />
            <span>PLAN.md</span>
            <ExternalLink size={11} className="link-icon" />
          </button>

          <button
            className="planning-file-btn"
            onClick={() => handleOpenFileOverlay('TASKS.md')}
            title="Inspect project TASKS.md in overlay"
          >
            <CheckSquare size={13} />
            <span>TASKS.md</span>
            <ExternalLink size={11} className="link-icon" />
          </button>

          <div className="planning-cmd-chip" title="Recommended verification command">
            <Terminal size={12} className="cmd-icon" />
            <code>{recommendedCmd}</code>
            <button
              className="copy-cmd-btn"
              onClick={() => handleCopyCmd(recommendedCmd)}
              title="Copy verification command"
            >
              {copiedCmd ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
            </button>
          </div>
        </div>
      </div>

      {/* Center Stage: Audio Visualizing Model at Center */}
      <div className="assistant-center-stage">
        <div className="assistant-ambient-glow" />
        <div className="assistant-orb-wrap">
          <AudioOrb status={status} level={isMuted ? 0 : audioLevel} />
          {isMuted && (
            <div className="center-stage-muted-badge">
              <VolumeX size={13} className="text-amber-400" />
              <span>Voice Muted (Listening silently)</span>
            </div>
          )}
        </div>
      </div>

      {/* Live Transcriptions Stream (User and AI messages) */}
      <div className="assistant-chat-history" ref={chatStreamRef}>
        {transcripts.length === 0 ? (
          <div className="assistant-empty-msg">
            <Bot size={28} />
            <p>Voice or text conversation will stream here in real-time.</p>
            <span className="sub">
              Mention files like <strong>@src/App.tsx</strong> to incorporate code contexts into planning.
            </span>
          </div>
        ) : (
          transcripts.map((t, idx) => {
            const isSystemError = Boolean(
              t.isError ||
              t.error ||
              (t.role === 'system' && (t.text.toLowerCase().includes('error') || t.text.toLowerCase().includes('failed')))
            )

            if (isSystemError) {
              const errBody = t.error || t.text
              const bubbleId = t.id || `err-${idx}`
              const isCopied = copiedErrorId === bubbleId

              return (
                <div key={bubbleId} className="chat-bubble system-error-bubble">
                  <div className="bubble-header error-header">
                    <div className="error-title-wrap">
                      <AlertTriangle size={14} className="error-icon" />
                      <span className="bubble-author">SYSTEM ERROR</span>
                      {t.tool && <span className="error-tool-badge">Tool: {t.tool}</span>}
                    </div>
                    <button
                      type="button"
                      className={`copy-error-btn ${isCopied ? 'copied' : ''}`}
                      onClick={() => handleCopyError(errBody, bubbleId)}
                      title="Copy system error to clipboard"
                    >
                      {isCopied ? (
                        <>
                          <Check size={12} className="text-emerald-400" />
                          <span>Copied!</span>
                        </>
                      ) : (
                        <>
                          <Copy size={12} />
                          <span>Copy Error</span>
                        </>
                      )}
                    </button>
                  </div>
                  <div className="bubble-content">
                    <div className="error-desc-text">
                      An error occurred during execution:
                    </div>
                    <pre className="error-code-block">
                      <code>{errBody}</code>
                    </pre>
                  </div>
                </div>
              )
            }

            return (
              <div key={t.id || idx} className={`chat-bubble ${t.role}`}>
                <div className="bubble-header">
                  {t.role === 'user' ? <User size={13} /> : <Bot size={13} />}
                  <span className="bubble-author">{t.role === 'user' ? 'YOU' : 'ARIX'}</span>
                  {t.role === 'assistant' && (
                    <button
                      className="bubble-handoff-btn"
                      onClick={() => onHandoffToCoder(t.text)}
                      title="Send this plan directly to Coder Agent"
                    >
                      <ArrowRight size={11} />
                      <span>Handoff to Coder</span>
                    </button>
                  )}
                </div>
                <div className="bubble-content">{renderMessageContent(t.text)}</div>
              </div>
            )
          })
        )}
      </div>

      {/* Bottom Text Composer with @file Mention Support */}
      <form className="assistant-input-form" onSubmit={handleSubmit}>
        <input
          type="text"
          placeholder="Ask a question, propose architecture, or type @file to reference context…"
          value={inputVal}
          onChange={(e) => setInputVal(e.target.value)}
        />
        <button type="submit" className="send-btn" disabled={!inputVal.trim()}>
          <Send size={15} />
        </button>
      </form>

      {/* File Context Overlay Modal */}
      {overlayFile && (
        <div className="file-context-overlay" onClick={() => setOverlayFile(null)}>
          <div className="file-context-modal" onClick={(e) => e.stopPropagation()}>
            <div className="file-context-modal-header">
              <div className="file-context-info">
                <FileText size={16} className="text-cyan" />
                <h4>{overlayFile}</h4>
                {overlayLoading && <span className="overlay-badge">Loading…</span>}
              </div>
              <div className="file-context-modal-actions">
                <button
                  className="icon-action-btn"
                  onClick={() => {
                    navigator.clipboard.writeText(overlayContent)
                  }}
                  title="Copy file contents"
                >
                  <Copy size={13} />
                </button>
                <button
                  className="icon-action-btn close-btn"
                  onClick={() => setOverlayFile(null)}
                  title="Close overlay"
                >
                  <X size={15} />
                </button>
              </div>
            </div>
            <div className="file-context-body">
              {overlayLoading ? (
                <div className="overlay-loading-state">Loading file context…</div>
              ) : overlayError ? (
                <div className="overlay-empty-state">
                  <p>{overlayError}</p>
                  <span className="sub">
                    Ask Arix in the chat to create or populate <strong>{overlayFile}</strong>.
                  </span>
                </div>
              ) : (
                <pre className="overlay-code-view">
                  <code>{overlayContent}</code>
                </pre>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
