import React, { useState } from 'react'
import {
  AlertCircle,
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Database,
  FileCode,
  FileText,
  Globe,
  Loader2,
  Monitor,
  Search,
  Terminal,
  Wrench,
} from 'lucide-react'

export interface ToolCallCardProps {
  id?: string
  tool?: string
  toolStatus?: 'running' | 'completed' | 'failed'
  isError?: boolean
  title?: string
  summary?: string
  result?: any
  error?: string
  defaultExpanded?: boolean
  timestamp?: number
  className?: string
}

export function ToolCallCard({
  id,
  tool = 'System Action',
  toolStatus = 'completed',
  isError = false,
  title,
  summary,
  result,
  error,
  defaultExpanded = false,
  className = '',
}: ToolCallCardProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded)
  const [copiedError, setCopiedError] = useState(false)
  const [copiedResult, setCopiedResult] = useState(false)

  const effectiveStatus: 'running' | 'completed' | 'failed' =
    isError || error || toolStatus === 'failed'
      ? 'failed'
      : toolStatus === 'running'
        ? 'running'
        : 'completed'

  const normalizedTool = (tool || '').toLowerCase()

  const getToolIcon = () => {
    if (normalizedTool === 'run_command' || normalizedTool.includes('terminal')) {
      return <Terminal size={14} className="tool-icon-glyph" />
    }
    if (normalizedTool.includes('file') || normalizedTool.includes('document')) {
      return <FileText size={14} className="tool-icon-glyph" />
    }
    if (normalizedTool.includes('memory')) {
      return <Database size={14} className="tool-icon-glyph" />
    }
    if (normalizedTool.includes('search')) {
      return <Search size={14} className="tool-icon-glyph" />
    }
    if (
      normalizedTool.includes('screen') ||
      normalizedTool.includes('computer') ||
      normalizedTool.includes('desktop')
    ) {
      return <Monitor size={14} className="tool-icon-glyph" />
    }
    if (normalizedTool.includes('browser') || normalizedTool.includes('playwright')) {
      return <Globe size={14} className="tool-icon-glyph" />
    }
    if (normalizedTool.endsWith('_app') || normalizedTool.includes('code')) {
      return <FileCode size={14} className="tool-icon-glyph" />
    }
    return <Wrench size={14} className="tool-icon-glyph" />
  }

  // Format tool result if present
  let resultText = ''
  if (result !== undefined && result !== null) {
    if (typeof result === 'string') {
      resultText = result
    } else {
      try {
        resultText = JSON.stringify(result, null, 2)
      } catch {
        resultText = String(result)
      }
    }
  }

  const handleCopyError = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!error) return
    navigator.clipboard.writeText(error)
    setCopiedError(true)
    setTimeout(() => setCopiedError(false), 2000)
  }

  const handleCopyResult = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!resultText) return
    navigator.clipboard.writeText(resultText)
    setCopiedResult(true)
    setTimeout(() => setCopiedResult(false), 2000)
  }

  const displayText = summary || title || ''

  return (
    <article
      className={`tool-call-card status-${effectiveStatus} ${className}`}
      id={id ? `tool-card-${id}` : undefined}
    >
      {/* 1. Standardized Header Row */}
      <div className="tool-card-header">
        <div className="tool-card-identity">
          <div className={`tool-card-icon-wrap icon-${effectiveStatus}`}>
            {getToolIcon()}
          </div>
          <span className="tool-card-name" title={tool}>
            {tool}
          </span>
        </div>

        <div className="tool-card-badge-wrap">
          {effectiveStatus === 'running' ? (
            <span className="tool-card-badge badge-running">
              <Loader2 size={10} className="tool-badge-spinner" />
              <span>RUNNING</span>
            </span>
          ) : effectiveStatus === 'failed' ? (
            <span className="tool-card-badge badge-failed">
              <AlertCircle size={10} />
              <span>FAILED</span>
            </span>
          ) : (
            <span className="tool-card-badge badge-completed">
              <Check size={10} />
              <span>COMPLETED</span>
            </span>
          )}
        </div>
      </div>

      {/* 2. Title / Summary Description Line */}
      {displayText && (
        <div className="tool-card-summary">
          <p>{displayText}</p>
        </div>
      )}

      {/* 3. Clearly Bounded Error Sub-panel (when failed) */}
      {effectiveStatus === 'failed' && error && (
        <div className="tool-card-error-panel">
          <div className="tool-error-panel-header">
            <div className="tool-error-title">
              <AlertTriangle size={12} className="text-red-400" />
              <span>Failure Details</span>
            </div>
            <button
              type="button"
              className={`tool-error-copy-btn ${copiedError ? 'copied' : ''}`}
              onClick={handleCopyError}
              title="Copy error message"
            >
              {copiedError ? (
                <>
                  <Check size={11} className="text-emerald-400" />
                  <span>Copied</span>
                </>
              ) : (
                <>
                  <Copy size={11} />
                  <span>Copy</span>
                </>
              )}
            </button>
          </div>
          <pre className="tool-error-code">
            <code>{error}</code>
          </pre>
        </div>
      )}

      {/* 4. Consistent "View Output" Drawer */}
      {resultText.trim() && (
        <div className="tool-card-output-container">
          <div className="tool-card-output-controls">
            <button
              type="button"
              className="tool-card-expand-btn"
              onClick={() => setIsExpanded((prev) => !prev)}
              aria-expanded={isExpanded}
            >
              {isExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              <span>{isExpanded ? 'Hide output' : 'View output'}</span>
            </button>

            {isExpanded && (
              <button
                type="button"
                className="tool-output-copy-btn"
                onClick={handleCopyResult}
                title="Copy tool output"
              >
                {copiedResult ? <Check size={11} className="text-emerald-400" /> : <Copy size={11} />}
                <span>{copiedResult ? 'Copied' : 'Copy'}</span>
              </button>
            )}
          </div>

          {isExpanded && (
            <div className="tool-card-output-drawer">
              <pre className="tool-output-pre">
                <code>{resultText}</code>
              </pre>
            </div>
          )}
        </div>
      )}
    </article>
  )
}
