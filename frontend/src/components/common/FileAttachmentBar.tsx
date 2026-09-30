import React, { useState } from 'react'
import {
  File,
  FileCode,
  FileImage,
  FileText,
  FileArchive,
  Folder,
  X,
  Eye,
  Copy,
  Check,
  Download,
} from 'lucide-react'
import { AttachedFile } from './FileUploadModal'

interface FileAttachmentBarProps {
  files: AttachedFile[]
  onRemove: (id: string) => void
}

export const FileAttachmentBar: React.FC<FileAttachmentBarProps> = ({ files, onRemove }) => {
  const [previewFile, setPreviewFile] = useState<AttachedFile | null>(null)
  const [copied, setCopied] = useState(false)

  if (!files || files.length === 0) return null

  const getFileIcon = (file: AttachedFile) => {
    if (file.is_dir) return <Folder size={14} className="text-amber-400" />
    const mime = (file.mime_type || '').toLowerCase()
    const name = file.name.toLowerCase()

    if (
      mime.startsWith('image/') ||
      name.endsWith('.png') ||
      name.endsWith('.jpg') ||
      name.endsWith('.jpeg') ||
      name.endsWith('.webp') ||
      name.endsWith('.svg') ||
      name.endsWith('.gif')
    ) {
      return <FileImage size={14} className="text-purple-400" />
    }

    if (
      mime.includes('json') ||
      mime.includes('javascript') ||
      mime.includes('typescript') ||
      name.endsWith('.ts') ||
      name.endsWith('.tsx') ||
      name.endsWith('.js') ||
      name.endsWith('.py') ||
      name.endsWith('.css') ||
      name.endsWith('.html') ||
      name.endsWith('.json') ||
      name.endsWith('.yaml') ||
      name.endsWith('.yml') ||
      name.endsWith('.sh')
    ) {
      return <FileCode size={14} className="text-cyan-400" />
    }

    if (
      name.endsWith('.zip') ||
      name.endsWith('.tar') ||
      name.endsWith('.gz') ||
      name.endsWith('.7z') ||
      name.endsWith('.rar')
    ) {
      return <FileArchive size={14} className="text-amber-500" />
    }

    if (
      mime.includes('pdf') ||
      mime.includes('document') ||
      name.endsWith('.pdf') ||
      name.endsWith('.docx') ||
      name.endsWith('.txt') ||
      name.endsWith('.md') ||
      name.endsWith('.csv')
    ) {
      return <FileText size={14} className="text-blue-400" />
    }

    return <File size={14} className="text-slate-400" />
  }

  const formatSize = (bytes: number) => {
    if (bytes <= 0) return '0 B'
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <>
      <div className="file-attachments-container">
        <div className="attachments-list">
          {files.map((file) => (
            <div key={file.id} className="attachment-chip" title={file.path}>
              <div className="chip-icon">{getFileIcon(file)}</div>
              <span className="chip-name">{file.name}</span>
              <span className="chip-size">{formatSize(file.size)}</span>

              {file.preview && (
                <button
                  type="button"
                  className="chip-action-btn"
                  onClick={() => setPreviewFile(file)}
                  title="Preview file"
                >
                  <Eye size={12} />
                </button>
              )}

              <button
                type="button"
                className="chip-remove-btn"
                onClick={() => onRemove(file.id)}
                title="Remove attachment"
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Preview Modal */}
      {previewFile && (
        <div className="file-context-overlay" onClick={() => setPreviewFile(null)}>
          <div className="file-context-modal" onClick={(e) => e.stopPropagation()}>
            <div className="file-context-modal-header">
              <div className="file-context-info">
                {getFileIcon(previewFile)}
                <h4>{previewFile.name}</h4>
                <span className="overlay-badge">{formatSize(previewFile.size)}</span>
              </div>
              <div className="file-context-modal-actions">
                <button
                  className="icon-action-btn"
                  onClick={() => handleCopy(previewFile.path)}
                  title="Copy full path"
                >
                  {copied ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
                </button>
                <button
                  className="icon-action-btn close-btn"
                  onClick={() => setPreviewFile(null)}
                  title="Close preview"
                >
                  <X size={15} />
                </button>
              </div>
            </div>
            <div className="file-context-body">
              <div className="preview-path-bar">
                <span className="path-label">Host Path:</span>
                <code>{previewFile.path}</code>
              </div>
              {previewFile.preview ? (
                <pre className="overlay-code-view">
                  <code>{previewFile.preview}</code>
                </pre>
              ) : (
                <div className="overlay-empty-state">
                  <p>Binary or non-text file preview not available in text format.</p>
                  <span className="sub">Path will be referenced directly in model context.</span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
