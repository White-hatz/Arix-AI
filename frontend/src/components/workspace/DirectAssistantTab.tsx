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
  Paperclip,
  UploadCloud,
} from 'lucide-react'
import { AudioOrb } from '../AudioOrb'
import { ToolCallCard } from '../common/ToolCallCard'
import { FileUploadModal, AttachedFile } from '../common/FileUploadModal'
import { FileAttachmentBar } from '../common/FileAttachmentBar'
import type { LiveSessionStatus, ProjectItem, TranscriptItem } from '../../types/arix'

const API_URL = import.meta.env.VITE_ARIX_API_URL ?? 'http://127.0.0.1:8765'

interface Props {
  project?: ProjectItem
  status: LiveSessionStatus
  audioLevel: number
  isThinking: boolean
  currentModel: string
  transcripts: TranscriptItem[]
  onSendText: (text: string) => void
  onToggleSession: () => void
  onHandoffToCoder: (prompt: string, autoRun?: boolean) => void
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
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([])
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false)
  const [isDraggingOver, setIsDraggingOver] = useState(false)
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
          console.error('Failed to upload dropped file:', err)
        }
      }
    }
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!inputVal.trim() && attachedFiles.length === 0) return

    let formatted = inputVal.replace(/@([a-zA-Z0-9_\-./]+)/g, '**$1**').trim()
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

      formatted = formatted
        ? `${attachSummary}\n\n${formatted}`
        : `${attachSummary}\n\nPlease inspect the attached file(s).`
      setAttachedFiles([])
    }

    onSendText(formatted)
    setInputVal('')
  }

  const handleProceedWithPlan = async (customPrompt?: string) => {
    let planContent = customPrompt || ''
    if (!planContent) {
      // Check if PLAN.md exists in workspace
      try {
        const root = project?.path || '.'
        const res = await fetch(
          `http://127.0.0.1:8765/api/workspace/file-content?workspace_root=${encodeURIComponent(
            root,
          )}&path=PLAN.md`,
        )
        const data = await res.json()
        if (data.success && data.content) {
          planContent = data.content
        }
      } catch {}
    }
    if (!planContent) {
      const lastAssistant = [...transcripts].reverse().find((t) => t.role === 'assistant')
      planContent = lastAssistant ? lastAssistant.text : inputVal.trim()
    }
    if (!planContent) {
      planContent = 'Proceed with executing the tasks for the active project.'
    }

    const finalPrompt = planContent.startsWith('Execute')
      ? planContent
      : `Execute the following plan and tasks autonomously:\n\n${planContent}`

    onHandoffToCoder(finalPrompt, true)
  }

  // Auto-detect when user says or sends "proceed with plan", "proceed", "execute plan", etc.
  const lastProcessedUserMsgRef = useRef<string | null>(null)
  useEffect(() => {
    const lastUser = [...transcripts].reverse().find((t) => t.role === 'user')
    if (lastUser && lastUser.text && lastUser.text !== lastProcessedUserMsgRef.current) {
      const lower = lastUser.text.toLowerCase().trim()
      const isProceed =
        /^(?:proceed|proceed with (?:the )?(?:plan|task|tasks)|execute (?:the )?(?:plan|task|tasks)|start (?:the )?(?:plan|task|tasks)|let's proceed|go ahead|apply the plan)[.!?,]?$/i.test(
          lower,
        )
      if (isProceed) {
        lastProcessedUserMsgRef.current = lastUser.text
        handleProceedWithPlan()
      }
    }
  }, [transcripts])

  const handleHandoffLatest = () => {
    handleProceedWithPlan()
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
    <div
      className={`direct-assistant-container ${isDraggingOver ? 'dragging-file-active' : ''}`}
      onDragOver={handleContainerDragOver}
      onDragLeave={handleContainerDragLeave}
      onDrop={handleContainerDrop}
    >
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

          <button
            className="proceed-plan-action-btn"
            onClick={() => handleProceedWithPlan()}
            title="Automatically transfer plan and execute in Coder Agent"
          >
            <Sparkles size={13} className="text-cyan-300" />
            <span>Proceed with Plan → Coder Agent</span>
            <ArrowRight size={13} />
          </button>
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
            // Tool call card
            if (t.tool || t.toolStatus) {
              return (
                <ToolCallCard
                  key={t.id || idx}
                  id={t.id}
                  tool={t.tool}
                  toolStatus={t.toolStatus}
                  isError={t.isError}
                  summary={t.text}
                  result={t.toolResult}
                  error={t.error}
                  timestamp={t.timestamp}
                  className="mb-3"
                />
              )
            }

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
                      className="bubble-handoff-btn proceed-btn"
                      onClick={() => handleProceedWithPlan(t.text)}
                      title="Send this plan directly to Coder Agent and execute immediately"
                    >
                      <Sparkles size={11} />
                      <span>Proceed with Plan</span>
                      <ArrowRight size={11} />
                    </button>
                  )}
                </div>
                <div className="bubble-content">{renderMessageContent(t.text)}</div>
              </div>
            )
          })
        )}
      </div>

      {/* File Attachments Bar */}
      <FileAttachmentBar
        files={attachedFiles}
        onRemove={(id) => setAttachedFiles((prev) => prev.filter((f) => f.id !== id))}
      />

      {/* Bottom Text Composer with @file Mention & Attachment Support */}
      <form className="assistant-input-form" onSubmit={handleSubmit}>
        <button
          type="button"
          className="attach-file-btn"
          onClick={() => setIsUploadModalOpen(true)}
          title="Attach or upload files (drag & drop, browse, or host path)"
        >
          <Paperclip size={15} />
        </button>
        <input
          type="text"
          placeholder={
            attachedFiles.length > 0
              ? 'Add instructions for attached file(s) or send directly…'
              : 'Ask a question, propose architecture, or type @file to reference context…'
          }
          value={inputVal}
          onChange={(e) => setInputVal(e.target.value)}
        />
        <button
          type="submit"
          className="send-btn"
          disabled={!inputVal.trim() && attachedFiles.length === 0}
        >
          <Send size={15} />
        </button>
      </form>

      {/* Drag & Drop Visual Overlay */}
      {isDraggingOver && (
        <div className="drag-drop-overlay">
          <div className="drag-drop-box">
            <UploadCloud size={44} className="text-cyan-400" />
            <h3>Drop any files to attach</h3>
            <p>Code, images, PDFs, documents, or archives will be added to chat context</p>
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
