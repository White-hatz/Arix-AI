import React, { useState } from 'react'
import { Check, Copy, ExternalLink, Info, AlertTriangle, AlertCircle, CheckCircle2 } from 'lucide-react'

interface MarkdownRendererProps {
  content: string
  className?: string
}

export function MarkdownRenderer({ content, className = '' }: MarkdownRendererProps) {
  if (!content) return null

  const elements = parseMarkdown(content)

  return (
    <div className={`markdown-body ${className}`}>
      {elements}
    </div>
  )
}

function CodeBlock({ code, language }: { code: string; language: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = () => {
    navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const isDiff = language.toLowerCase() === 'diff'

  return (
    <div className="md-code-block-wrapper">
      <div className="md-code-block-header">
        <span className="md-code-lang">{language || 'code'}</span>
        <button
          type="button"
          className="md-code-copy-btn"
          onClick={handleCopy}
          title="Copy code"
        >
          {copied ? (
            <>
              <Check size={12} className="text-emerald-400" />
              <span className="text-emerald-400">Copied!</span>
            </>
          ) : (
            <>
              <Copy size={12} />
              <span>Copy</span>
            </>
          )}
        </button>
      </div>
      <pre className={`md-code-pre ${isDiff ? 'md-diff-pre' : ''}`}>
        <code>
          {isDiff
            ? code.split('\n').map((line, idx) => {
                let cls = 'md-diff-line'
                if (line.startsWith('+') && !line.startsWith('+++')) cls += ' md-diff-add'
                else if (line.startsWith('-') && !line.startsWith('---')) cls += ' md-diff-del'
                else if (line.startsWith('@')) cls += ' md-diff-meta'
                return (
                  <div key={idx} className={cls}>
                    {line}
                  </div>
                )
              })
            : code}
        </code>
      </pre>
    </div>
  )
}

function renderInline(text: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = []
  // Matches inline code: `code`, bold: **bold**, italic: *italic*, links: [text](url)
  const regex = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\([^)]+\))/g

  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.substring(lastIndex, match.index))
    }

    const token = match[0]
    const key = `inline-${match.index}`

    if (token.startsWith('`') && token.endsWith('`')) {
      nodes.push(
        <code key={key} className="md-inline-code">
          {token.slice(1, -1)}
        </code>
      )
    } else if (token.startsWith('**') && token.endsWith('**')) {
      nodes.push(
        <strong key={key} className="md-bold">
          {token.slice(2, -2)}
        </strong>
      )
    } else if (token.startsWith('*') && token.endsWith('*')) {
      nodes.push(
        <em key={key} className="md-italic">
          {token.slice(1, -1)}
        </em>
      )
    } else if (token.startsWith('[') && token.includes('](')) {
      const parts = token.match(/\[([^\]]+)\]\(([^)]+)\)/)
      if (parts) {
        nodes.push(
          <a
            key={key}
            href={parts[2]}
            target="_blank"
            rel="noopener noreferrer"
            className="md-link"
          >
            {parts[1]}
            <ExternalLink size={10} className="inline ml-1 opacity-70" />
          </a>
        )
      } else {
        nodes.push(token)
      }
    } else {
      nodes.push(token)
    }

    lastIndex = match.index + token.length
  }

  if (lastIndex < text.length) {
    nodes.push(text.substring(lastIndex))
  }

  return nodes
}

function parseMarkdown(text: string): React.ReactNode[] {
  const lines = text.split('\n')
  const elements: React.ReactNode[] = []

  let inCodeBlock = false
  let codeLang = ''
  let codeBuffer: string[] = []

  let inList = false
  let listItems: React.ReactNode[] = []

  let inTable = false
  let tableRows: string[][] = []

  const flushList = () => {
    if (inList && listItems.length > 0) {
      elements.push(
        <ul key={`list-${elements.length}`} className="md-ul">
          {listItems}
        </ul>
      )
      listItems = []
      inList = false
    }
  }

  const flushTable = () => {
    if (inTable && tableRows.length > 0) {
      const header = tableRows[0]
      const rows = tableRows.slice(1).filter((r) => !r.every((c) => c.match(/^:?-+:?$/)))
      elements.push(
        <div key={`table-wrap-${elements.length}`} className="md-table-wrapper">
          <table className="md-table">
            <thead>
              <tr>
                {header.map((col, idx) => (
                  <th key={idx}>{renderInline(col.trim())}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rIdx) => (
                <tr key={rIdx}>
                  {row.map((cell, cIdx) => (
                    <td key={cIdx}>{renderInline(cell.trim())}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
      tableRows = []
      inTable = false
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // Code block toggle
    if (line.trim().startsWith('```')) {
      if (inCodeBlock) {
        // End code block
        elements.push(
          <CodeBlock
            key={`code-${elements.length}`}
            code={codeBuffer.join('\n')}
            language={codeLang}
          />
        )
        codeBuffer = []
        codeLang = ''
        inCodeBlock = false
      } else {
        // Start code block
        flushList()
        flushTable()
        codeLang = line.trim().slice(3).trim()
        inCodeBlock = true
      }
      continue
    }

    if (inCodeBlock) {
      codeBuffer.push(line)
      continue
    }

    // Horizontal Rule
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) {
      flushList()
      flushTable()
      elements.push(<hr key={`hr-${elements.length}`} className="md-hr" />)
      continue
    }

    // Table row
    if (line.trim().startsWith('|') && line.trim().endsWith('|')) {
      flushList()
      inTable = true
      const cols = line
        .trim()
        .slice(1, -1)
        .split('|')
      tableRows.push(cols)
      continue
    } else if (inTable) {
      flushTable()
    }

    // Headings
    const headingMatch = line.match(/^(#{1,6})\s+(.*)$/)
    if (headingMatch) {
      flushList()
      flushTable()
      const level = headingMatch[1].length
      const headingText = headingMatch[2]
      const children = renderInline(headingText)

      switch (level) {
        case 1:
          elements.push(<h1 key={`h1-${elements.length}`} className="md-h1">{children}</h1>)
          break
        case 2:
          elements.push(<h2 key={`h2-${elements.length}`} className="md-h2">{children}</h2>)
          break
        case 3:
          elements.push(<h3 key={`h3-${elements.length}`} className="md-h3">{children}</h3>)
          break
        case 4:
          elements.push(<h4 key={`h4-${elements.length}`} className="md-h4">{children}</h4>)
          break
        default:
          elements.push(<h5 key={`h5-${elements.length}`} className="md-h5">{children}</h5>)
          break
      }
      continue
    }

    // Blockquote & Alerts
    if (line.trim().startsWith('>')) {
      flushList()
      flushTable()
      const quoteContent = line.trim().replace(/^>\s*/, '')
      let alertType: 'note' | 'tip' | 'important' | 'warning' | 'caution' | null = null
      let alertBody = quoteContent

      if (quoteContent.startsWith('[!NOTE]')) {
        alertType = 'note'
        alertBody = quoteContent.replace('[!NOTE]', '').trim()
      } else if (quoteContent.startsWith('[!TIP]')) {
        alertType = 'tip'
        alertBody = quoteContent.replace('[!TIP]', '').trim()
      } else if (quoteContent.startsWith('[!IMPORTANT]')) {
        alertType = 'important'
        alertBody = quoteContent.replace('[!IMPORTANT]', '').trim()
      } else if (quoteContent.startsWith('[!WARNING]')) {
        alertType = 'warning'
        alertBody = quoteContent.replace('[!WARNING]', '').trim()
      } else if (quoteContent.startsWith('[!CAUTION]')) {
        alertType = 'caution'
        alertBody = quoteContent.replace('[!CAUTION]', '').trim()
      }

      if (alertType) {
        elements.push(
          <div key={`alert-${elements.length}`} className={`md-alert md-alert-${alertType}`}>
            <div className="md-alert-header">
              {alertType === 'warning' || alertType === 'caution' ? (
                <AlertTriangle size={14} />
              ) : alertType === 'important' ? (
                <AlertCircle size={14} />
              ) : alertType === 'tip' ? (
                <CheckCircle2 size={14} />
              ) : (
                <Info size={14} />
              )}
              <span className="capitalize font-semibold text-xs">{alertType}</span>
            </div>
            <div className="md-alert-content">{renderInline(alertBody)}</div>
          </div>
        )
      } else {
        elements.push(
          <blockquote key={`quote-${elements.length}`} className="md-blockquote">
            {renderInline(quoteContent)}
          </blockquote>
        )
      }
      continue
    }

    // Lists (unordered)
    const listMatch = line.match(/^(\s*)([-*+])\s+(.*)$/)
    if (listMatch) {
      flushTable()
      inList = true
      const itemText = listMatch[3]
      listItems.push(
        <li key={`li-${listItems.length}`} className="md-li">
          {renderInline(itemText)}
        </li>
      )
      continue
    }

    // Lists (ordered)
    const orderedMatch = line.match(/^(\s*)(\d+)\.\s+(.*)$/)
    if (orderedMatch) {
      flushTable()
      inList = true
      const itemText = orderedMatch[3]
      listItems.push(
        <li key={`oli-${listItems.length}`} className="md-li">
          {renderInline(itemText)}
        </li>
      )
      continue
    }

    // Blank line
    if (!line.trim()) {
      flushList()
      flushTable()
      continue
    }

    // Regular paragraph
    flushList()
    flushTable()
    elements.push(
      <p key={`p-${elements.length}`} className="md-p">
        {renderInline(line)}
      </p>
    )
  }

  flushList()
  flushTable()

  if (inCodeBlock && codeBuffer.length > 0) {
    elements.push(
      <CodeBlock
        key={`code-${elements.length}`}
        code={codeBuffer.join('\n')}
        language={codeLang}
      />
    )
  }

  return elements
}
