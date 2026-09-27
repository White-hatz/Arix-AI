import React, { useEffect, useState } from 'react'
import {
  ChevronDown,
  ChevronRight,
  File,
  FileCode,
  FileJson,
  FileSpreadsheet,
  FileText,
  Folder,
  FolderOpen,
  RefreshCw,
} from 'lucide-react'

interface FileItem {
  name: string
  path: string
  is_dir: boolean
  size: number
}

interface Props {
  workspaceRoot: string
  onFileSelect: (filePath: string) => void
  onInsertReference: (ref: string) => void
}

function getFileIcon(filename: string) {
  const ext = filename.split('.').pop()?.toLowerCase()
  if (['ts', 'tsx', 'js', 'jsx', 'py', 'html', 'css', 'go', 'rs', 'c', 'cpp'].includes(ext || '')) {
    return <FileCode size={14} className="file-icon-code" />
  }
  if (['json', 'yaml', 'yml', 'toml'].includes(ext || '')) {
    return <FileJson size={14} className="file-icon-json" />
  }
  if (['md', 'txt', 'rtf'].includes(ext || '')) {
    return <FileText size={14} className="file-icon-txt" />
  }
  return <File size={14} className="file-icon-default" />
}

export function FileTreeTab({ workspaceRoot, onFileSelect, onInsertReference }: Props) {
  const [items, setItems] = useState<FileItem[]>([])
  const [expandedDirs, setExpandedDirs] = useState<Record<string, FileItem[]>>({})
  const [loadingDirs, setLoadingDirs] = useState<Record<string, boolean>>({})
  const [refreshing, setRefreshing] = useState(false)

  const loadDirectory = async (subpath = '.') => {
    try {
      if (subpath === '.') setRefreshing(true)
      else setLoadingDirs((p) => ({ ...p, [subpath]: true }))

      const res = await fetch(
        `http://127.0.0.1:8765/api/workspace/files?workspace_root=${encodeURIComponent(
          workspaceRoot,
        )}&subpath=${encodeURIComponent(subpath)}`,
      )
      if (!res.ok) throw new Error('Failed to fetch files')
      const data = await res.json()
      if (subpath === '.') {
        setItems(data.items || [])
      } else {
        setExpandedDirs((p) => ({ ...p, [subpath]: data.items || [] }))
      }
    } catch (err) {
      console.error('Error loading directory:', err)
    } finally {
      if (subpath === '.') setRefreshing(false)
      else setLoadingDirs((p) => ({ ...p, [subpath]: false }))
    }
  }

  useEffect(() => {
    if (workspaceRoot) {
      setExpandedDirs({})
      loadDirectory('.')
    }
  }, [workspaceRoot])

  const toggleFolder = (folderPath: string) => {
    if (expandedDirs[folderPath]) {
      // Collapse
      setExpandedDirs((p) => {
        const copy = { ...p }
        delete copy[folderPath]
        return copy
      })
    } else {
      // Expand
      loadDirectory(folderPath)
    }
  }

  const handleDragStart = (e: React.DragEvent, itemPath: string) => {
    e.dataTransfer.setData('text/plain', `@${itemPath}`)
    e.dataTransfer.setData('application/arix-filepath', itemPath)
    e.dataTransfer.effectAllowed = 'copy'
  }

  const renderTree = (itemList: FileItem[], depth = 0) => {
    return (
      <ul className="file-tree-list" style={{ paddingLeft: depth === 0 ? 0 : 12 }}>
        {itemList.map((item) => {
          const isExpanded = !!expandedDirs[item.path]
          const isLoading = !!loadingDirs[item.path]

          if (item.is_dir) {
            return (
              <li key={item.path} className="file-tree-node">
                <div
                  className="file-tree-item folder"
                  onClick={() => toggleFolder(item.path)}
                  draggable
                  onDragStart={(e) => handleDragStart(e, item.path)}
                  title={`Folder: ${item.path}\n(Drag into chat to reference)`}
                >
                  <span className="expand-arrow">
                    {isLoading ? (
                      <RefreshCw size={12} className="spin" />
                    ) : isExpanded ? (
                      <ChevronDown size={13} />
                    ) : (
                      <ChevronRight size={13} />
                    )}
                  </span>
                  {isExpanded ? (
                    <FolderOpen size={14} className="folder-icon open" />
                  ) : (
                    <Folder size={14} className="folder-icon" />
                  )}
                  <span className="item-name">{item.name}</span>
                </div>
                {isExpanded && expandedDirs[item.path] && renderTree(expandedDirs[item.path], depth + 1)}
              </li>
            )
          }

          return (
            <li key={item.path} className="file-tree-node">
              <div
                className="file-tree-item file"
                onClick={() => onFileSelect(item.path)}
                draggable
                onDragStart={(e) => handleDragStart(e, item.path)}
                title={`File: ${item.path}\n(Click to open, drag into chat to reference)`}
              >
                <span className="file-icon-wrap">{getFileIcon(item.name)}</span>
                <span className="item-name">{item.name}</span>
                <span className="item-action-ref" onClick={(e) => {
                  e.stopPropagation()
                  onInsertReference(`@${item.path}`)
                }} title="Insert reference into prompt">
                  @
                </span>
              </div>
            </li>
          )
        })}
      </ul>
    )
  }

  return (
    <div className="file-tree-container">
      <div className="file-tree-header">
        <span className="file-tree-title">Explorer</span>
        <button
          className={`file-tree-refresh-btn ${refreshing ? 'spin' : ''}`}
          onClick={() => loadDirectory('.')}
          title="Refresh directory tree"
        >
          <RefreshCw size={13} />
        </button>
      </div>

      <div className="file-tree-scroll-area">
        {items.length === 0 && !refreshing ? (
          <div className="empty-tree-msg">No files in directory.</div>
        ) : (
          renderTree(items)
        )}
      </div>

      <div className="file-tree-hint">
        <span>💡 Drag file or click <b>@</b> to reference</span>
      </div>
    </div>
  )
}
