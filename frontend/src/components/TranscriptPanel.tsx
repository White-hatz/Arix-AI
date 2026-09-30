import { useEffect, useRef, useState } from 'react'
import {
  AlertTriangle,
  Bot,
  Check,
  Copy,
  Eraser,
  MessageSquare,
  Paperclip,
  Send,
  UploadCloud,
  UserRound,
} from 'lucide-react'
import type { PipelineStatus, TranscriptEntry } from '../types/arix'
import { ToolCallCard } from './common/ToolCallCard'
import { FileUploadModal, AttachedFile } from './common/FileUploadModal'
import { FileAttachmentBar } from './common/FileAttachmentBar'

const API_URL = import.meta.env.VITE_ARIX_API_URL ?? 'http://127.0.0.1:8765'

interface Props {
  status: PipelineStatus
  transcripts: TranscriptEntry[]
  onSend: (text: string) => boolean | Promise<boolean>
  onClear: () => void
  onStartResize?: () => void
  isResizing?: boolean
}

export function TranscriptPanel({
  status,
  transcripts,
  onSend,
  onClear,
  onStartResize,
  isResizing = false,
}: Props) {
  const [draft, setDraft] = useState('')
  const [copiedErrorId, setCopiedErrorId] = useState<string | null>(null)
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([])
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false)
  const [isDraggingOver, setIsDraggingOver] = useState(false)
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

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDraggingOver(true)
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.currentTarget.contains(e.relatedTarget as Node)) return
    setIsDraggingOver(false)
  }

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDraggingOver(false)

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const files = Array.from(e.dataTransfer.files)
      for (const file of files) {
        try {
          const formData = new FormData()
          formData.append('file', file)
          formData.append('workspace_root', '')
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
          console.error('Failed to upload dropped file in TranscriptPanel:', err)
        }
      }
    }
  }

  const submit = async () => {
    if (!draft.trim() && attachedFiles.length === 0) return

    let text = draft.trim()
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

      text = text ? `${attachSummary}\n\n${text}` : `${attachSummary}\n\nPlease inspect the attached file(s).`
      setAttachedFiles([])
    }

    setDraft('')
    const ok = await onSend(text)
    if (!ok) {
      setDraft(text)
    }
  }

  return (
    <aside
      className={`transcript-panel ${isDraggingOver ? 'dragging-file-active' : ''}`}
      id="live-transcription-panel"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* VS-Code Style Draggable Left Divider */}
      {onStartResize && (
        <div
          className={`panel-resizer transcript-panel-resizer ${isResizing ? 'active' : ''}`}
          onMouseDown={onStartResize}
          title="Drag to resize conversation panel"
        />
      )}

      {/* Header with 'LIVE FEED' removed and height normalized to 56px */}
      <header className="panel-heading">
        <div className="panel-heading-title">
          <h2>Conversation</h2>
        </div>
        <button
          className="icon-button"
          onClick={onClear}
          title="Clear transcript"
          aria-label="Clear transcript"
        >
          <Eraser size={16} />
        </button>
      </header>

      <div className="panel-rule">
        <span className={connected ? 'online' : ''} />
        {connected ? 'Channel open' : status === 'connecting' ? 'Connecting...' : 'Channel closed'}
      </div>

      <div className="transcript-stream">
        {transcripts.length === 0 ? (
          <div className="empty-transcript">
            <MessageSquare size={24} />
            <p>Your live transcript will appear here.</p>
            <span>Type a message or start a live voice session.</span>
          </div>
        ) : (
          transcripts.map((entry) => {
            // 1. Tool Call Activity Card (Unified, standardized UI)
            if (entry.tool || entry.toolStatus) {
              return (
                <ToolCallCard
                  key={entry.id}
                  id={entry.id}
                  tool={entry.tool}
                  toolStatus={entry.toolStatus}
                  isError={entry.isError}
                  summary={entry.text}
                  result={entry.toolResult}
                  error={entry.error}
                  timestamp={entry.timestamp}
                />
              )
            }

            // 2. Standalone System Error Entry
            const isErr = Boolean(
              entry.isError ||
                entry.error ||
                (entry.role === 'system' &&
                  (entry.text.toLowerCase().includes('error') ||
                    entry.text.toLowerCase().includes('failed'))),
            )
            if (isErr) {
              const errBody = entry.error || entry.text
              const isCopied = copiedErrorId === entry.id
              return (
                <article className="transcript-entry system-error-entry" key={entry.id}>
                  <div className="speaker-icon error-icon">
                    <AlertTriangle size={14} className="text-red-400" />
                  </div>
                  <div className="entry-content">
                    <header>
                      <strong className="text-red-400">
                        System Error{entry.tool ? `: ${entry.tool}` : ''}
                      </strong>
                      <button
                        type="button"
                        className={`copy-error-mini-btn ${isCopied ? 'copied' : ''}`}
                        onClick={() => handleCopyError(errBody, entry.id)}
                        title="Copy error"
                      >
                        {isCopied ? (
                          <Check size={11} className="text-emerald-400" />
                        ) : (
                          <Copy size={11} />
                        )}
                        <span>{isCopied ? 'Copied' : 'Copy'}</span>
                      </button>
                    </header>
                    <pre className="error-code-view">
                      <code>{errBody}</code>
                    </pre>
                  </div>
                </article>
              )
            }

            // 3. User & Assistant Chat Bubbles
            return (
              <article className={`transcript-entry ${entry.role}`} key={entry.id}>
                <div className="speaker-icon">
                  {entry.role === 'user' ? <UserRound size={14} /> : <Bot size={14} />}
                </div>
                <div className="entry-content">
                  <header>
                    <strong>{entry.role === 'user' ? 'You' : 'Arix'}</strong>
                    <time>
                      {new Date(entry.timestamp).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </time>
                  </header>
                  <p>
                    {entry.text}
                    <span className={!entry.final ? 'typing-caret' : ''} />
                  </p>
                </div>
              </article>
            )
          })
        )}
        <div ref={endRef} />
      </div>

      {/* File Attachments Bar */}
      <FileAttachmentBar
        files={attachedFiles}
        onRemove={(id) => setAttachedFiles((prev) => prev.filter((f) => f.id !== id))}
      />

      <footer className="text-composer">
        <button
          type="button"
          className="attach-button"
          onClick={() => setIsUploadModalOpen(true)}
          title="Attach or upload files (drag & drop, browse, or host path)"
        >
          <Paperclip size={16} />
        </button>
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => event.key === 'Enter' && submit()}
          placeholder={
            attachedFiles.length > 0
              ? 'Add instructions for attached files or click Send…'
              : connected
                ? 'Send a text message or command…'
                : 'Type a message or command to wake Arix…'
          }
          aria-label="Message Arix"
        />
        <button
          onClick={submit}
          disabled={!draft.trim() && attachedFiles.length === 0}
          aria-label="Send message"
        >
          <Send size={16} />
        </button>
      </footer>

      {/* Drag & Drop Overlay */}
      {isDraggingOver && (
        <div className="drag-drop-overlay">
          <div className="drag-drop-box">
            <UploadCloud size={44} className="text-cyan-400" />
            <h3>Drop any files to attach</h3>
            <p>Files will be attached to the active session</p>
          </div>
        </div>
      )}

      {/* File Upload Modal */}
      <FileUploadModal
        isOpen={isUploadModalOpen}
        onClose={() => setIsUploadModalOpen(false)}
        workspaceRoot=""
        onFilesAttached={(newFiles) => setAttachedFiles((prev) => [...prev, ...newFiles])}
      />
    </aside>
  )
}
