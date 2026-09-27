import React, { useEffect, useMemo, useRef, useState } from 'react'
import Editor, { loader } from '@monaco-editor/react'
import * as monaco from 'monaco-editor'
import {
  Code2,
  FileCode,
  FileImage,
  FileText,
  FileVideo,
  Play,
  Save,
  Sparkles,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import type { AppSettings } from '../../types/arix'

import editorWorker from 'monaco-editor/editor/editor.worker?worker'
import jsonWorker from 'monaco-editor/language/json/json.worker?worker'
import cssWorker from 'monaco-editor/language/css/css.worker?worker'
import htmlWorker from 'monaco-editor/language/html/html.worker?worker'
import tsWorker from 'monaco-editor/language/typescript/ts.worker?worker'

// Configure Monaco with local package and web workers to prevent remote CDN downloads & main-thread freezes
if (typeof window !== 'undefined') {
  ;(window as any).MonacoEnvironment = {
    getWorker(_: any, label: string) {
      if (label === 'json') return new jsonWorker()
      if (label === 'css' || label === 'scss' || label === 'less') return new cssWorker()
      if (label === 'html' || label === 'handlebars' || label === 'razor') return new htmlWorker()
      if (label === 'typescript' || label === 'javascript') return new tsWorker()
      return new editorWorker()
    },
  }
}

loader.config({ monaco })

export interface OpenEditorTab {
  path: string
  name: string
  content?: string
  originalContent?: string
  isDirty?: boolean
}

interface Props {
  workspaceRoot: string
  openTabs: OpenEditorTab[]
  activeFilePath?: string
  settings?: Partial<AppSettings>
  onSelectTab: (path: string) => void
  onCloseTab: (path: string) => void
  onCloseAllTabs: () => void
  onUpdateContent: (path: string, content: string) => void
  onSaveFile: (path: string, content: string) => Promise<void>
}

// Map extensions to Monaco languages
const EXTENSION_LANGUAGE_MAP: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  html: 'html',
  htm: 'html',
  css: 'css',
  scss: 'scss',
  less: 'less',
  json: 'json',
  py: 'python',
  java: 'java',
  php: 'php',
  c: 'c',
  cpp: 'cpp',
  h: 'cpp',
  hpp: 'cpp',
  cs: 'csharp',
  go: 'go',
  rs: 'rust',
  sh: 'shell',
  bash: 'shell',
  ps1: 'powershell',
  sql: 'sql',
  md: 'markdown',
  markdown: 'markdown',
  xml: 'xml',
  svg: 'xml',
  yaml: 'yaml',
  yml: 'yaml',
  toml: 'toml',
  ini: 'ini',
  txt: 'plaintext',
}

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp', 'ico'])
const VIDEO_EXTENSIONS = new Set(['mp4', 'webm', 'mov', 'm4v', 'ogg', 'mkv'])

export function EditorWorkspaceTab({
  workspaceRoot,
  openTabs,
  activeFilePath,
  settings,
  onSelectTab,
  onCloseTab,
  onCloseAllTabs,
  onUpdateContent,
  onSaveFile,
}: Props) {
  const activeTab = useMemo(
    () => openTabs.find((t) => t.path === activeFilePath) || openTabs[0],
    [openTabs, activeFilePath],
  )

  const [saving, setSaving] = useState(false)
  const [imageZoom, setImageZoom] = useState(1)
  const editorRef = useRef<any>(null)

  const ext = useMemo(() => {
    if (!activeTab) return ''
    const parts = activeTab.name.split('.')
    return parts.length > 1 ? parts.pop()?.toLowerCase() || '' : ''
  }, [activeTab])

  const fileType = useMemo<'code' | 'image' | 'video'>(() => {
    if (IMAGE_EXTENSIONS.has(ext)) return 'image'
    if (VIDEO_EXTENSIONS.has(ext)) return 'video'
    return 'code'
  }, [ext])

  const language = useMemo(() => {
    return EXTENSION_LANGUAGE_MAP[ext] || 'plaintext'
  }, [ext])

  // Save handler (Ctrl+S or Save button)
  const handleSaveActive = async () => {
    if (!activeTab || !activeTab.content) return
    setSaving(true)
    try {
      await onSaveFile(activeTab.path, activeTab.content)
    } finally {
      setSaving(false)
    }
  }

  // Handle Monaco editor mount
  const handleEditorDidMount = (editor: any, monacoInstance: any) => {
    editorRef.current = editor

    // Add Ctrl+S save action
    editor.addCommand(monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyCode.KeyS, () => {
      handleSaveActive()
    })

    // Keybinding: Ctrl+D for select next occurrence is native in Monaco
    // Keybinding: Alt+Up/Down for move line is native in Monaco
    // Keybinding: Shift+Alt+Up/Down for copy line is native in Monaco
    // Keybinding: Ctrl+Shift+K for delete line is native in Monaco
    // Keybinding: Ctrl+/ for comment toggle is native in Monaco
  }

  const rawFileUrl = useMemo(() => {
    if (!activeTab) return ''
    return `http://127.0.0.1:8765/api/workspace/raw-file?workspace_root=${encodeURIComponent(
      workspaceRoot,
    )}&path=${encodeURIComponent(activeTab.path)}`
  }, [workspaceRoot, activeTab])

  // Get file icon based on type
  const getTabIcon = (name: string) => {
    const e = name.split('.').pop()?.toLowerCase() || ''
    if (IMAGE_EXTENSIONS.has(e)) return <FileImage size={13} className="text-amber-400" />
    if (VIDEO_EXTENSIONS.has(e)) return <FileVideo size={13} className="text-purple-400" />
    if (['ts', 'tsx', 'js', 'jsx', 'py', 'java', 'go', 'rs', 'cpp'].includes(e)) {
      return <FileCode size={13} className="text-cyan-400" />
    }
    return <FileText size={13} className="text-zinc-400" />
  }

  if (openTabs.length === 0) {
    return (
      <div className="editor-empty-state">
        <Code2 size={36} className="text-zinc-600 mb-3" />
        <p className="font-medium text-zinc-400 text-sm">No Files Open</p>
        <span className="text-xs text-zinc-500 mt-1 max-w-[280px] text-center">
          Click or drop any file from the explorer on the left to edit code, inspect images, or preview videos.
        </span>
      </div>
    )
  }

  return (
    <div className="editor-workspace-tab-root">
      {/* Tab Strip */}
      <div className="editor-tab-strip">
        <div className="editor-tabs-scroll-area">
          {openTabs.map((tab) => {
            const isActive = tab.path === activeTab?.path
            return (
              <div
                key={tab.path}
                className={`editor-sub-tab ${isActive ? 'active' : ''}`}
                onClick={() => onSelectTab(tab.path)}
                title={tab.path}
              >
                {getTabIcon(tab.name)}
                <span className="tab-title">{tab.name}</span>
                {tab.isDirty && <span className="tab-dirty-dot" title="Unsaved changes" />}
                <button
                  className="tab-close-btn"
                  onClick={(e) => {
                    e.stopPropagation()
                    onCloseTab(tab.path)
                  }}
                  title="Close tab"
                >
                  <X size={12} />
                </button>
              </div>
            )
          })}
        </div>

        <div className="editor-tab-strip-actions">
          {activeTab && activeTab.isDirty && (
            <button
              className="editor-save-btn"
              onClick={handleSaveActive}
              disabled={saving}
              title="Save File (Ctrl+S)"
            >
              <Save size={13} />
              <span>{saving ? 'Saving…' : 'Save'}</span>
            </button>
          )}
          <button
            className="editor-close-all-btn"
            onClick={onCloseAllTabs}
            title="Close all open tabs"
          >
            Close All
          </button>
        </div>
      </div>

      {/* Editor Viewer Surface */}
      <div className="editor-content-area">
        {fileType === 'code' && activeTab && (
          <div className="monaco-host-wrapper">
            <Editor
              height="100%"
              path={activeTab.path}
              defaultLanguage={language}
              language={language}
              value={activeTab.content || ''}
              theme={settings?.editorTheme || 'vs-dark'}
              onChange={(value) => onUpdateContent(activeTab.path, value || '')}
              onMount={handleEditorDidMount}
              options={{
                fontSize: settings?.editorFontSize || 13,
                fontFamily:
                  settings?.editorFontFamily ||
                  "'Cascadia Code', 'Fira Code', 'JetBrains Mono', Consolas, monospace",
                tabSize: settings?.editorTabSize || 2,
                minimap: { enabled: settings?.editorMinimap !== false },
                lineNumbers: 'on',
                lineNumbersMinChars: 3,
                scrollBeyondLastLine: false,
                wordWrap: 'on',
                bracketPairColorization: { enabled: true },
                autoClosingBrackets: 'always',
                autoClosingQuotes: 'always',
                formatOnPaste: true,
                formatOnType: true,
                renderLineHighlight: 'all',
                cursorBlinking: 'smooth',
                cursorSmoothCaretAnimation: 'on',
                smoothScrolling: true,
                scrollbar: {
                  vertical: 'visible',
                  horizontal: 'visible',
                  verticalScrollbarSize: 8,
                  horizontalScrollbarSize: 8,
                  useShadows: false,
                },
              }}
            />
          </div>
        )}

        {fileType === 'image' && activeTab && (
          <div className="media-preview-container image-viewer">
            <div className="media-preview-toolbar">
              <span className="media-info-text">{activeTab.name}</span>
              <div className="media-zoom-controls">
                <button
                  onClick={() => setImageZoom((prev) => Math.max(0.25, prev - 0.25))}
                  title="Zoom Out"
                >
                  <ZoomOut size={13} />
                </button>
                <span className="zoom-level">{Math.round(imageZoom * 100)}%</span>
                <button
                  onClick={() => setImageZoom((prev) => Math.min(4, prev + 0.25))}
                  title="Zoom In"
                >
                  <ZoomIn size={13} />
                </button>
                <button onClick={() => setImageZoom(1)} className="reset-zoom-btn">
                  Reset
                </button>
              </div>
            </div>

            <div className="image-stage checkered-bg">
              <img
                src={rawFileUrl}
                alt={activeTab.name}
                style={{ transform: `scale(${imageZoom})`, transformOrigin: 'center center' }}
                className="preview-img-tag"
              />
            </div>
          </div>
        )}

        {fileType === 'video' && activeTab && (
          <div className="media-preview-container video-viewer">
            <div className="media-preview-toolbar">
              <span className="media-info-text">{activeTab.name}</span>
            </div>
            <div className="video-stage">
              <video
                src={rawFileUrl}
                controls
                className="preview-video-tag"
                playsInline
                preload="metadata"
              />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
