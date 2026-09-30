import React, { useState, useRef, useEffect } from 'react'
import {
  UploadCloud,
  Folder,
  File,
  FileText,
  FileCode,
  FileImage,
  FileArchive,
  HardDrive,
  X,
  Check,
  AlertCircle,
  Loader2,
  ExternalLink,
  Plus,
} from 'lucide-react'

export interface AttachedFile {
  id: string
  name: string
  path: string
  relative_path?: string
  size: number
  mime_type: string
  is_text?: boolean
  preview?: string | null
  is_dir?: boolean
  status?: 'uploading' | 'ready' | 'error'
  errorMessage?: string
}

interface FileUploadModalProps {
  isOpen: boolean
  onClose: () => void
  workspaceRoot?: string
  onFilesAttached: (files: AttachedFile[]) => void
}

const API_URL = import.meta.env.VITE_ARIX_API_URL ?? 'http://127.0.0.1:8765'

export const FileUploadModal: React.FC<FileUploadModalProps> = ({
  isOpen,
  onClose,
  workspaceRoot = '',
  onFilesAttached,
}) => {
  const [activeTab, setActiveTab] = useState<'upload' | 'path'>('upload')
  const [isDragging, setIsDragging] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pathInput, setPathInput] = useState('')
  const [copyToProject, setCopyToProject] = useState(false)
  const [systemLocations, setSystemLocations] = useState<Record<string, string>>({
    Downloads: 'Downloads',
    Desktop: 'Desktop',
    Documents: 'Documents',
  })
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Fetch live system locations if available
  useEffect(() => {
    if (!isOpen) return
    setError(null)
    fetch(`${API_URL}/api/workspace/system-paths`)
      .then((r) => r.json())
      .then((data) => {
        if (data.ok && data.system_locations) {
          setSystemLocations((prev) => ({
            ...prev,
            ...data.system_locations,
          }))
        }
      })
      .catch(() => {})
  }, [isOpen])

  if (!isOpen) return null

  const formatFileSize = (bytes: number): string => {
    if (bytes <= 0) return '0 B'
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  // Handle file uploads (Drop or File Input)
  const handleUploadFiles = async (fileList: FileList | File[]) => {
    const files = Array.from(fileList)
    if (files.length === 0) return

    setLoading(true)
    setError(null)

    const attached: AttachedFile[] = []
    const errors: string[] = []

    for (const file of files) {
      try {
        const formData = new FormData()
        formData.append('file', file)
        formData.append('workspace_root', workspaceRoot)
        formData.append('destination_subpath', 'uploads')

        const res = await fetch(`${API_URL}/api/workspace/upload`, {
          method: 'POST',
          body: formData,
        })

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}))
          throw new Error(errData.detail || `Upload failed for ${file.name}`)
        }

        const data = await res.json()
        if (data.ok && data.file) {
          attached.push({
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
          })
        }
      } catch (err: any) {
        errors.push(`${file.name}: ${err.message}`)
      }
    }

    setLoading(false)

    if (errors.length > 0) {
      setError(errors.join('; '))
    }

    if (attached.length > 0) {
      onFilesAttached(attached)
      if (errors.length === 0) {
        onClose()
      }
    }
  }

  // Handle attaching by exact file path
  const handleAttachByPath = async (e?: React.FormEvent) => {
    if (e) e.preventDefault()
    const cleanPath = pathInput.trim()
    if (!cleanPath) return

    setLoading(true)
    setError(null)

    try {
      const res = await fetch(`${API_URL}/api/workspace/attach-path`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source_path: cleanPath,
          workspace_root: workspaceRoot,
          copy_to_workspace: copyToProject,
          destination_subpath: 'uploads',
        }),
      })

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}))
        throw new Error(errData.detail || `Could not find or access: ${cleanPath}`)
      }

      const data = await res.json()
      if (data.ok && data.file) {
        const attached: AttachedFile = {
          id: `att-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          name: data.file.name,
          path: data.file.path,
          relative_path: data.file.relative_path,
          size: data.file.size,
          mime_type: data.file.mime_type,
          is_text: data.file.is_text,
          preview: data.file.preview,
          is_dir: data.file.is_dir,
          status: 'ready',
        }
        onFilesAttached([attached])
        setPathInput('')
        onClose()
      }
    } catch (err: any) {
      setError(err.message || 'Failed to attach file path')
    } finally {
      setLoading(false)
    }
  }

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(true)
  }

  const onDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
  }

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleUploadFiles(e.dataTransfer.files)
    }
  }

  return (
    <div className="file-upload-overlay" onClick={onClose}>
      <div className="file-upload-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="file-upload-modal-header">
          <div className="header-title">
            <UploadCloud size={20} className="text-cyan-400" />
            <div>
              <h3>Attach & Upload Files</h3>
              <p className="subtitle">
                Add any files (code, images, documents, archives) via drag & drop or file path
              </p>
            </div>
          </div>
          <button className="icon-close-btn" onClick={onClose} title="Close">
            <X size={18} />
          </button>
        </div>

        {/* Tab Switcher */}
        <div className="file-upload-tabs">
          <button
            type="button"
            className={`upload-tab-btn ${activeTab === 'upload' ? 'active' : ''}`}
            onClick={() => {
              setActiveTab('upload')
              setError(null)
            }}
          >
            <UploadCloud size={15} />
            <span>Upload / Drag & Drop</span>
          </button>
          <button
            type="button"
            className={`upload-tab-btn ${activeTab === 'path' ? 'active' : ''}`}
            onClick={() => {
              setActiveTab('path')
              setError(null)
            }}
          >
            <Folder size={15} />
            <span>Enter Host File Path</span>
          </button>
        </div>

        {/* Modal Body */}
        <div className="file-upload-modal-body">
          {error && (
            <div className="upload-error-banner">
              <AlertCircle size={15} className="text-red-400" />
              <span>{error}</span>
            </div>
          )}

          {activeTab === 'upload' ? (
            <div className="upload-tab-content">
              <div
                className={`upload-dropzone ${isDragging ? 'dragging' : ''} ${loading ? 'loading' : ''}`}
                onDragOver={onDragOver}
                onDragLeave={onDragLeave}
                onDrop={onDrop}
                onClick={() => !loading && fileInputRef.current?.click()}
              >
                <input
                  type="file"
                  ref={fileInputRef}
                  style={{ display: 'none' }}
                  multiple
                  onChange={(e) => {
                    if (e.target.files) handleUploadFiles(e.target.files)
                  }}
                />

                {loading ? (
                  <div className="dropzone-loading">
                    <Loader2 size={36} className="spin text-cyan-400" />
                    <p className="font-medium text-slate-200">Processing & uploading files…</p>
                    <span className="text-xs text-slate-400">Storing in project uploads folder</span>
                  </div>
                ) : (
                  <div className="dropzone-idle">
                    <div className="dropzone-icon-ring">
                      <UploadCloud size={32} className="text-cyan-400" />
                    </div>
                    <h4>Drag and drop files here</h4>
                    <p>or click to browse from your computer</p>
                    <div className="dropzone-pills">
                      <span className="pill">Code & Scripts</span>
                      <span className="pill">Images & UI</span>
                      <span className="pill">PDFs & Docs</span>
                      <span className="pill">Archives (.zip)</span>
                      <span className="pill">Any File Type</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="path-tab-content">
              <form onSubmit={handleAttachByPath} className="path-input-form">
                <label className="input-label">
                  Enter local file or folder path:
                  <span className="sub-label">
                    (Accepts Windows absolute paths, user paths like ~/Downloads, or relative paths)
                  </span>
                </label>

                <div className="path-input-group">
                  <Folder size={16} className="path-icon text-slate-400" />
                  <input
                    type="text"
                    className="path-text-input"
                    placeholder="e.g. C:\path\to\data.csv or /home/user/project/file.py"
                    value={pathInput}
                    onChange={(e) => setPathInput(e.target.value)}
                    autoFocus
                  />
                  <button
                    type="submit"
                    className="attach-path-submit-btn"
                    disabled={!pathInput.trim() || loading}
                  >
                    {loading ? (
                      <Loader2 size={14} className="spin" />
                    ) : (
                      <Plus size={14} />
                    )}
                    <span>Attach Path</span>
                  </button>
                </div>

                <div className="copy-toggle-wrap">
                  <label className="toggle-label">
                    <input
                      type="checkbox"
                      checked={copyToProject}
                      onChange={(e) => setCopyToProject(e.target.checked)}
                    />
                    <span>Copy file into project's <code>uploads/</code> directory</span>
                  </label>
                </div>
              </form>

              {/* Quick Host Shortcuts */}
              <div className="quick-paths-section">
                <span className="quick-paths-title">
                  <HardDrive size={13} className="text-cyan-400" />
                  <span>Important Host Locations (Click to fill):</span>
                </span>
                <div className="quick-path-chips">
                  {Object.entries(systemLocations).map(([label, fullPath]) => (
                    <button
                      key={label}
                      type="button"
                      className="quick-path-chip"
                      onClick={() => setPathInput(fullPath)}
                      title={`Insert ${fullPath}`}
                    >
                      <span className="chip-name">{label}</span>
                      <span className="chip-path">{fullPath}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
