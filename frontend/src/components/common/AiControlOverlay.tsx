import React, { useEffect, useRef, useState } from 'react'
import { Bot, Sparkles, X } from 'lucide-react'
import type { WorkspaceView } from '../NavigationRail'

export interface InAppAction {
  action: string
  args: any
  id: number
}

interface HighlightInfo {
  rect: DOMRect
  note?: string
}

interface Props {
  action: InAppAction | null
  enabled: boolean
  onNavigate: (view: WorkspaceView, projectPath?: string) => void
  onOverride: () => void
}

export function AiControlOverlay({ action, enabled, onNavigate, onOverride }: Props) {
  const [isInControl, setIsInControl] = useState(false)
  const [cursorPos, setCursorPos] = useState<{ x: number; y: number }>({ x: 300, y: 300 })
  const [isClicking, setIsClicking] = useState(false)
  const [highlight, setHighlight] = useState<HighlightInfo | null>(null)
  const [trail, setTrail] = useState<Array<{ x: number; y: number; id: number }>>([])
  const trailCounter = useRef(0)

  // Listen for user override: Esc or real mouse move
  useEffect(() => {
    if (!isInControl) return

    const handleKeyDown = (e: KeyboardEvent) => {
      // Any physical key or Esc halts control immediately (B3)
      setIsInControl(false)
      setHighlight(null)
      onOverride()
    }

    let lastMousePos: { x: number; y: number } | null = null
    const handleMouseMove = (e: MouseEvent) => {
      if (!lastMousePos) {
        lastMousePos = { x: e.clientX, y: e.clientY }
        return
      }
      const dx = Math.abs(e.clientX - lastMousePos.x)
      const dy = Math.abs(e.clientY - lastMousePos.y)
      if (dx > 25 || dy > 25) {
        setIsInControl(false)
        setHighlight(null)
        onOverride()
      }
      lastMousePos = { x: e.clientX, y: e.clientY }
    }

    window.addEventListener('keydown', handleKeyDown, { capture: true })
    window.addEventListener('mousemove', handleMouseMove, { capture: true })
    return () => {
      window.removeEventListener('keydown', handleKeyDown, { capture: true })
      window.removeEventListener('mousemove', handleMouseMove, { capture: true })
    }
  }, [isInControl, onOverride])

  // Process incoming in-app control actions
  useEffect(() => {
    if (!action || !enabled) return

    setIsInControl(true)
    const { action: toolName, args } = action

    // Helper to add trail dot
    const recordTrail = (x: number, y: number) => {
      trailCounter.current += 1
      const dot = { x, y, id: trailCounter.current }
      setTrail((prev) => [...prev.slice(-4), dot])
    }

    if (toolName === 'navigate_app') {
      const route = args.route as WorkspaceView
      if (['voice', 'code', 'workspace', 'memory', 'settings'].includes(route)) {
        onNavigate(route, args.project_path)
      }
    } else if (toolName === 'move_cursor_app') {
      let targetX = args.x || 300
      let targetY = args.y || 300
      if (args.selector) {
        const el = document.querySelector(args.selector)
        if (el) {
          const r = el.getBoundingClientRect()
          targetX = r.left + r.width / 2
          targetY = r.top + r.height / 2
        }
      }
      setCursorPos({ x: targetX, y: targetY })
      recordTrail(targetX, targetY)
    } else if (toolName === 'click_app') {
      let targetEl: Element | null = null
      let targetX = args.x
      let targetY = args.y

      if (args.selector) {
        targetEl = document.querySelector(args.selector)
        if (targetEl) {
          const r = targetEl.getBoundingClientRect()
          targetX = r.left + r.width / 2
          targetY = r.top + r.height / 2
        }
      } else if (targetX != null && targetY != null) {
        targetEl = document.elementFromPoint(targetX, targetY)
      }

      if (targetX != null && targetY != null) {
        setCursorPos({ x: targetX, y: targetY })
        recordTrail(targetX, targetY)
      }

      setIsClicking(true)
      setTimeout(() => {
        setIsClicking(false)
        if (targetEl && 'click' in targetEl) {
          ;(targetEl as HTMLElement).click()
        }
      }, 350)
    } else if (toolName === 'type_app') {
      let targetEl: Element | null = null
      if (args.selector) {
        targetEl = document.querySelector(args.selector)
      }
      if (!targetEl) {
        targetEl = document.activeElement
      }
      if (targetEl && (targetEl instanceof HTMLInputElement || targetEl instanceof HTMLTextAreaElement)) {
        targetEl.focus()
        targetEl.value = args.text || ''
        targetEl.dispatchEvent(new Event('input', { bubbles: true }))
        targetEl.dispatchEvent(new Event('change', { bubbles: true }))
      }
    } else if (toolName === 'scroll_app') {
      const container = args.target ? document.querySelector(args.target) : window
      const direction = args.direction === 'up' ? -1 : 1
      const amount = (args.amount || 300) * direction
      if (container && 'scrollBy' in container) {
        container.scrollBy({ top: amount, behavior: 'smooth' })
      }
    } else if (toolName === 'highlight_app') {
      if (args.selector) {
        const el = document.querySelector(args.selector)
        if (el) {
          const rect = el.getBoundingClientRect()
          setHighlight({ rect, note: args.note })
          setCursorPos({ x: rect.left + rect.width / 2, y: rect.top - 20 })
          recordTrail(rect.left + rect.width / 2, rect.top - 20)
        }
      }
    } else if (toolName === 'drag_drop_app') {
      const srcEl = document.querySelector(args.source)
      const dstEl = document.querySelector(args.target)
      if (srcEl && dstEl) {
        const srcRect = srcEl.getBoundingClientRect()
        const dstRect = dstEl.getBoundingClientRect()
        setCursorPos({ x: srcRect.left + srcRect.width / 2, y: srcRect.top + srcRect.height / 2 })

        setTimeout(() => {
          setCursorPos({ x: dstRect.left + dstRect.width / 2, y: dstRect.top + dstRect.height / 2 })
          recordTrail(dstRect.left + dstRect.width / 2, dstRect.top + dstRect.height / 2)
        }, 500)
      }
    }

    // Auto-timeout control indicator after 4 seconds of inactivity
    const timer = setTimeout(() => {
      setIsInControl(false)
      setHighlight(null)
    }, 4500)
    return () => clearTimeout(timer)
  }, [action, enabled, onNavigate])

  if (!enabled || !isInControl) return null

  return (
    <div className="ai-control-overlay-root pointer-events-none fixed inset-0 z-[9999] overflow-hidden">
      {/* Top Banner (B3) */}
      <div className="pointer-events-auto absolute top-3 left-1/2 -translate-x-1/2 flex items-center gap-3 px-4 py-1.5 rounded-full bg-[#0a0f18]/90 border border-cyan-400/40 shadow-[0_0_25px_rgba(73,216,255,0.3)] backdrop-blur-md animate-fade-in">
        <span className="w-2.5 h-2.5 rounded-full bg-cyan-400 shadow-[0_0_10px_#49d8ff] animate-ping" />
        <span className="text-xs font-semibold text-cyan-100 flex items-center gap-1.5">
          <Bot size={14} className="text-cyan-400" />
          Arix is in control
        </span>
        <div className="h-3 w-[1px] bg-white/15" />
        <div className="flex items-center gap-1 text-[11px] text-zinc-400">
          <span>Press</span>
          <kbd className="px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-200 border border-zinc-700 font-mono text-[10px]">
            Esc
          </kbd>
          <span>to take over</span>
        </div>
      </div>

      {/* Highlight Box with Note (B2) */}
      {highlight && (
        <div
          className="absolute border-2 border-cyan-400 rounded-lg shadow-[0_0_20px_rgba(73,216,255,0.5)] transition-all duration-300 pointer-events-none"
          style={{
            left: highlight.rect.left - 4,
            top: highlight.rect.top - 4,
            width: highlight.rect.width + 8,
            height: highlight.rect.height + 8,
          }}
        >
          {highlight.note && (
            <div className="absolute -top-9 left-0 bg-cyan-950/90 text-cyan-200 border border-cyan-400/50 text-[11px] px-2.5 py-1 rounded-md shadow-lg whitespace-nowrap flex items-center gap-1.5 backdrop-blur-sm">
              <Sparkles size={11} className="text-cyan-400" />
              <span>{highlight.note}</span>
            </div>
          )}
        </div>
      )}

      {/* Glowing Trail Dots (B3) */}
      {trail.map((dot) => (
        <div
          key={dot.id}
          className="absolute w-3 h-3 rounded-full bg-cyan-400/40 blur-[2px] transition-opacity duration-700 pointer-events-none"
          style={{
            left: dot.x - 6,
            top: dot.y - 6,
            boxShadow: '0 0 12px rgba(73, 216, 255, 0.8)',
          }}
        />
      ))}

      {/* Synthetic Cursor Overlay (B3) */}
      <div
        className="absolute pointer-events-none transition-all duration-300 ease-out z-[10000]"
        style={{
          left: cursorPos.x,
          top: cursorPos.y,
          transform: isClicking ? 'scale(0.85)' : 'scale(1)',
        }}
      >
        {/* Soft bluish glow */}
        <div className="absolute -inset-2 rounded-full bg-cyan-400/30 blur-md animate-pulse" />

        {/* Cursor pointer SVG */}
        <svg
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="relative drop-shadow-[0_4px_12px_rgba(0,0,0,0.8)] filter"
        >
          <path
            d="M3 3L10.5 21L13.8 13.8L21 10.5L3 3Z"
            fill="#49d8ff"
            stroke="#ffffff"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
        </svg>

        {isClicking && (
          <div className="absolute -inset-3 rounded-full border-2 border-cyan-300 animate-ping" />
        )}
      </div>
    </div>
  )
}
