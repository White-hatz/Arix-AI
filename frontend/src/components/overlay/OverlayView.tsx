import React, { useEffect, useRef, useState } from 'react'
import { Check, X, ExternalLink, ShieldAlert, Radio } from 'lucide-react'
import { QuantumOrb } from '../orbs/QuantumOrb'
import { ORB_TOKENS } from '../../lib/orbTokens'
import type { PipelineStatus } from '../../types/arix'

interface OverlayLiveState {
  status: PipelineStatus
  level: number
  subtitle: string
  userSpeech?: string
  isThinking?: boolean
  isMuted?: boolean
  permissionPrompt?: {
    callId: string
    tool: string
    message: string
    args?: any
  } | null
  desktopControlActive?: boolean
}

export function OverlayView() {
  const [state, setState] = useState<OverlayLiveState>({
    status: 'offline',
    level: 0,
    subtitle: '',
    isThinking: false,
    isMuted: false,
    permissionPrompt: null,
    desktopControlActive: false,
  })

  const [activeSubtitle, setActiveSubtitle] = useState('')
  const [isSubtitleVisible, setIsSubtitleVisible] = useState(false)
  const [isHovered, setIsHovered] = useState(false)
  const subtitleTimerRef = useRef<number | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // Transparent document setup
    document.documentElement.style.background = 'transparent'
    document.body.style.background = 'transparent'
    document.body.style.overflow = 'hidden'

    if (!window.arixOverlay?.onState) return

    const unsubscribe = window.arixOverlay.onState((newState: OverlayLiveState) => {
      setState((prev) => ({ ...prev, ...newState }))

      // Subtitle handling (Section 4)
      if (newState.subtitle && newState.subtitle.trim()) {
        setActiveSubtitle(newState.subtitle)
        setIsSubtitleVisible(true)

        if (subtitleTimerRef.current) {
          window.clearTimeout(subtitleTimerRef.current)
        }
        subtitleTimerRef.current = window.setTimeout(() => {
          setIsSubtitleVisible(false)
        }, 3500)
      }
    })

    return () => {
      unsubscribe()
      if (subtitleTimerRef.current) window.clearTimeout(subtitleTimerRef.current)
    }
  }, [])

  // Auto-resize overlay window when subtitles or permissions appear (Section 3.5 & 4.3)
  useEffect(() => {
    if (!window.arixOverlay?.resize) return
    const el = containerRef.current
    if (!el) return

    const observer = new ResizeObserver(() => {
      const h = el.offsetHeight || 240
      const w = el.offsetWidth || 340
      window.arixOverlay?.resize(w, Math.min(h + 20, 440))
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // Mouse hover management for click-through escape hatch (Section 5.3 & 6.1)
  const handleMouseEnter = () => {
    setIsHovered(true)
    window.arixOverlay?.setIgnoreMouseEvents(false)
  }

  const handleMouseLeave = () => {
    setIsHovered(false)
    // Only re-enable click-through if no permission prompt is blocking
    if (!state.permissionPrompt) {
      window.arixOverlay?.setIgnoreMouseEvents(true, { forward: true })
    }
  }

  const handleOrbClick = () => {
    window.arixOverlay?.restoreMain()
  }

  const handlePermissionDecision = (approved: boolean) => {
    if (state.permissionPrompt?.callId) {
      window.arixOverlay?.sendPermissionDecision(state.permissionPrompt.callId, approved)
      setState((prev) => ({ ...prev, permissionPrompt: null }))
      window.arixOverlay?.setIgnoreMouseEvents(true, { forward: true })
    }
  }

  const orbSize = ORB_TOKENS.quantum.overlaySize

  return (
    <div
      ref={containerRef}
      className="overlay-container select-none flex flex-col items-center justify-start p-3"
      style={{
        background: 'transparent',
        minWidth: '280px',
        maxWidth: '360px',
        transition: 'all 0.2s ease',
      }}
    >
      {/* Interactive Orb Hit-Zone */}
      <div
        className="orb-hitzone relative flex items-center justify-center cursor-pointer group"
        style={{ width: `${orbSize}px`, height: `${orbSize}px` }}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onClick={handleOrbClick}
        title="Click to open Arix AI"
      >
        <QuantumOrb
          status={state.status}
          level={state.level}
          size={orbSize}
          className="pointer-events-none"
        />

        {/* Hover click hint */}
        <div
          className={`absolute inset-0 flex items-center justify-center rounded-full pointer-events-none transition-opacity duration-200 ${
            isHovered ? 'opacity-100' : 'opacity-0'
          }`}
          style={{ background: 'rgba(0, 0, 0, 0.35)', backdropFilter: 'blur(2px)' }}
        >
          <span className="text-[10px] font-bold tracking-widest text-cyan-300 uppercase px-2 py-1 rounded bg-black/60 border border-cyan-500/40">
            Open App
          </span>
        </div>

        {/* Tiny live status pip indicator */}
        <div
          className="absolute bottom-2 right-4 flex items-center gap-1.5 px-2 py-0.5 rounded-full border shadow-lg pointer-events-none"
          style={{
            background: 'rgba(9, 11, 16, 0.88)',
            borderColor: state.status === 'speaking' ? '#60a5fa' : state.status === 'listening' ? '#34d399' : '#94a3b8',
            backdropFilter: 'blur(8px)',
          }}
        >
          <span
            className="w-1.5 h-1.5 rounded-full animate-pulse"
            style={{
              backgroundColor: state.status === 'speaking' ? '#60a5fa' : state.status === 'listening' ? '#34d399' : '#94a3b8',
              boxShadow: state.status === 'speaking' ? '0 0 6px #60a5fa' : '0 0 6px #34d399',
            }}
          />
          <span className="text-[9px] font-semibold text-slate-300 tracking-wider uppercase">
            {state.status === 'speaking' ? 'Speaking' : state.status === 'listening' ? 'Live' : state.status}
          </span>
        </div>
      </div>

      {/* Desktop Control Active Pill (Section 6.3) */}
      {state.desktopControlActive && (
        <div
          className="mt-2 flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-bold text-amber-300 bg-amber-950/80 border border-amber-500/50 shadow-lg animate-pulse"
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
        >
          <Radio size={12} className="animate-spin text-amber-400" />
          <span>Arix Desktop Control Active (Esc to abort)</span>
        </div>
      )}

      {/* Overlay-Safe Permission Prompt Card (Section 6.1) */}
      {state.permissionPrompt && (
        <div
          className="mt-2 w-full p-3 rounded-xl border border-amber-500/60 shadow-2xl animate-in fade-in slide-in-from-top-2 duration-200"
          style={{
            background: 'rgba(15, 18, 26, 0.94)',
            backdropFilter: 'blur(16px)',
          }}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
        >
          <div className="flex items-center gap-2 mb-1.5 text-amber-400 font-bold text-xs uppercase tracking-wider">
            <ShieldAlert size={14} />
            <span>Permission Required</span>
          </div>
          <p className="text-xs text-slate-200 font-medium mb-3 leading-relaxed">
            {state.permissionPrompt.message || `Allow Arix to execute ${state.permissionPrompt.tool}?`}
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => handlePermissionDecision(true)}
              className="flex-1 flex items-center justify-center gap-1 py-1.5 px-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs transition shadow-md"
            >
              <Check size={13} /> Approve
            </button>
            <button
              onClick={() => handlePermissionDecision(false)}
              className="flex-1 flex items-center justify-center gap-1 py-1.5 px-2 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/40 font-bold text-xs transition"
            >
              <X size={13} /> Deny
            </button>
            <button
              onClick={() => window.arixOverlay?.restoreMain()}
              title="View in main app"
              className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition border border-white/10"
            >
              <ExternalLink size={13} />
            </button>
          </div>
        </div>
      )}

      {/* Anime-Style Subtitles (Section 4) */}
      {isSubtitleVisible && activeSubtitle && !state.permissionPrompt && (
        <div
          className="subtitle-wrapper mt-2.5 max-w-[320px] text-center pointer-events-none transition-all duration-200 ease-out"
          style={{
            opacity: isSubtitleVisible ? 1 : 0,
            transform: isSubtitleVisible ? 'translateY(0)' : 'translateY(6px)',
          }}
        >
          <div
            className="subtitle-plate inline-block px-3.5 py-1.5 rounded-xl border border-white/10 shadow-2xl"
            style={{
              background: 'rgba(8, 10, 15, 0.48)',
              backdropFilter: 'blur(8px)',
            }}
          >
            <p
              className="anime-subtitle m-0"
              style={{
                color: '#FFFFFF',
                fontFamily: "'Space Grotesk Variable', 'Segoe UI', 'Trebuchet MS', -apple-system, sans-serif",
                fontSize: '18px',
                fontWeight: 800,
                lineHeight: 1.35,
                WebkitTextStroke: '2.4px #000000',
                textShadow: `
                  -2px -2px 0 #000,
                   2px -2px 0 #000,
                  -2px  2px 0 #000,
                   2px  2px 0 #000,
                  -2px  0px 0 #000,
                   2px  0px 0 #000,
                   0px -2px 0 #000,
                   0px  2px 0 #000
                `,
                letterSpacing: '0.02em',
                wordBreak: 'break-word',
              }}
            >
              {activeSubtitle}
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
