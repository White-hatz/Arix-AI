import { useCallback, useEffect, useRef, useState } from 'react'
import {
  DEFAULT_LIVE_MODEL,
  THINKING_LIVE_MODEL,
  type PipelineStatus,
  type ServerEvent,
  type SessionConfig,
  type TranscriptEntry,
} from '../types/arix'
import { useAudioEngine } from './useAudioEngine'

const SOCKET_URL = import.meta.env.VITE_ARIX_WS_URL ?? 'ws://127.0.0.1:8765/ws/live'
const API_URL = import.meta.env.VITE_ARIX_API_URL ?? 'http://127.0.0.1:8765'

export function useArixSession() {
  const [status, setStatus] = useState<PipelineStatus>('offline')
  const [statusMessage, setStatusMessage] = useState('Ready when you are')
  const [transcripts, setTranscripts] = useState<TranscriptEntry[]>([])
  const [isThinking, setIsThinking] = useState(false)
  const [currentModel, setCurrentModel] = useState(DEFAULT_LIVE_MODEL)
  const [isMuted, setIsMuted] = useState(false)
  const isMutedRef = useRef(false)
  isMutedRef.current = isMuted
  const [inAppAction, setInAppAction] = useState<{ action: string; args: any; id: number } | null>(null)
  const [desktopControlActive, setDesktopControlActive] = useState(false)
  const [desktopControlAction, setDesktopControlAction] = useState<string | null>(null)
  const socketRef = useRef<WebSocket | null>(null)
  const pendingQueueRef = useRef<string[]>([])
  const isConnectingRef = useRef(false)

  const stopDesktopControl = useCallback(async () => {
    setDesktopControlActive(false)
    setDesktopControlAction(null)
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({ type: 'abort_desktop_control' }))
    }
    try {
      await fetch(`${API_URL}/api/settings/desktop-control/abort`, { method: 'POST' })
    } catch {}
  }, [])

  const sendAudio = useCallback((chunk: ArrayBuffer) => {
    if (socketRef.current?.readyState === WebSocket.OPEN) socketRef.current.send(chunk)
  }, [])
  const { level: audioLevel, startCapture, stopCapture, playPcm, clearPlayback } = useAudioEngine(sendAudio)

  const upsertTranscript = useCallback((role: 'user' | 'assistant' | 'system', text: string, final = false) => {
    setTranscripts((current) => {
      const last = current.at(-1)
      if (last?.role === role && !last.final) {
        return [...current.slice(0, -1), { ...last, text: `${last.text}${text}`, final }]
      }
      return [...current, { id: crypto.randomUUID(), role, text, timestamp: Date.now(), final }]
    })
  }, [])

  const disconnect = useCallback(() => {
    isConnectingRef.current = false
    stopCapture()
    if (socketRef.current) {
      const s = socketRef.current
      s.onopen = null
      s.onmessage = null
      s.onerror = null
      s.onclose = null
      try {
        s.close(1000, 'User ended the session')
      } catch {}
      socketRef.current = null
    }
    setStatus('offline')
    setStatusMessage('Session ended')
  }, [stopCapture])

  const switchMode = useCallback((mode: 'think' | 'normal') => {
    const thinking = mode === 'think'
    setIsThinking(thinking)
    const targetModel = thinking ? THINKING_LIVE_MODEL : DEFAULT_LIVE_MODEL
    setCurrentModel(targetModel)
    clearPlayback()
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({ type: 'switch_mode', mode }))
      return true
    }
    return false
  }, [clearPlayback])

  const toggleThinking = useCallback(() => {
    const next = !isThinking
    switchMode(next ? 'think' : 'normal')
    return next
  }, [isThinking, switchMode])

  const setMuted = useCallback((muted: boolean) => {
    setIsMuted(muted)
    isMutedRef.current = muted
    if (muted) {
      clearPlayback()
    }
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({ type: 'set_mute', muted }))
    }
  }, [clearPlayback])

  const toggleMute = useCallback(() => {
    const next = !isMutedRef.current
    setMuted(next)
    return next
  }, [setMuted])

  const connect = useCallback(async (config: Partial<SessionConfig> = {}) => {
    if (isConnectingRef.current) return
    isConnectingRef.current = true

    let resolvedApiKey = (config?.apiKey || '').trim()
    if (!resolvedApiKey && typeof window !== 'undefined') {
      try {
        if (window.arixSettings?.get) {
          const s = await window.arixSettings.get()
          if (s?.apiKey) resolvedApiKey = s.apiKey.trim()
        }
      } catch {}
      if (!resolvedApiKey) {
        try {
          const res = await fetch('http://127.0.0.1:8765/api/settings')
          const data = await res.json()
          if (data?.apiKey) resolvedApiKey = data.apiKey.trim()
        } catch {}
      }
    }

    if (!resolvedApiKey) {
      isConnectingRef.current = false
      setStatus('error')
      setStatusMessage('Enter a Gemini API key in Settings first.')
      throw new Error('Enter a Gemini API key in Settings first.')
    }

    if (socketRef.current) {
      const old = socketRef.current
      old.onopen = null
      old.onmessage = null
      old.onerror = null
      old.onclose = null
      try {
        old.close(1000, 'Reconnecting')
      } catch {}
      socketRef.current = null
    }
    clearPlayback()
    setStatus('connecting')
    setStatusMessage('Opening a secure live channel')
    const socket = new WebSocket(SOCKET_URL)
    socket.binaryType = 'arraybuffer'
    socketRef.current = socket

    const effectiveModel = isThinking ? THINKING_LIVE_MODEL : (config.model || DEFAULT_LIVE_MODEL)

    socket.onopen = () => {
      if (socketRef.current !== socket) return
      isConnectingRef.current = false
      socket.send(JSON.stringify({ type: 'session.start', ...config, apiKey: resolvedApiKey, model: effectiveModel }))
    }
    socket.onmessage = (message) => {
      if (socketRef.current !== socket) return
      const event = JSON.parse(message.data) as ServerEvent
      if (event.type === 'status') {
        setStatus(event.status)
        setStatusMessage(event.message ?? event.status)
      } else if (event.type === 'session.ready') {
        setCurrentModel(event.model)
        setIsThinking(event.model.includes('thinking'))
        setStatus('listening')
        setStatusMessage('Listening for your voice')

        // Flush any queued text messages sent before socket was open
        while (pendingQueueRef.current.length > 0) {
          const queued = pendingQueueRef.current.shift()
          if (queued && socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ type: 'text', text: queued }))
            setStatus('processing')
            setStatusMessage('Arix is thinking')
          }
        }

        void startCapture().catch((error: Error) => {
          console.warn('Microphone unavailable:', error)
          setStatusMessage('Microphone unavailable (text mode ready)')
        })
      } else if (event.type === 'thinking.changed') {
        setIsThinking(event.enabled)
        setCurrentModel(event.model)
        clearPlayback()
        setStatusMessage(event.enabled ? 'Deep Think mode active' : 'Normal mode active')
      } else if ((event as any).type === 'mute_state') {
        const muted = Boolean((event as any).muted)
        setIsMuted(muted)
        isMutedRef.current = muted
        if (muted) {
          clearPlayback()
          setStatusMessage('Arix is muted (listening silently)')
        } else {
          setStatusMessage('Arix unmuted')
        }
      } else if (event.type === 'audio') {
        if (isMutedRef.current) {
          return
        }
        setStatus('speaking')
        setStatusMessage('Arix is speaking')
        const sampleRate = Number(event.mime_type.match(/rate=(\d+)/)?.[1] ?? 24000)
        void playPcm(event.data, sampleRate)
      } else if (event.type === 'transcript') {
        upsertTranscript(event.role, event.text, event.final)
      } else if (event.type === 'turn.complete') {
        setTranscripts((current) => current.map((entry) => ({ ...entry, final: true })))
        setStatus('listening')
        setStatusMessage('Listening for your voice')
      } else if (event.type === 'interrupted') {
        clearPlayback()
        setStatus('listening')
        setStatusMessage('Interrupted — listening')
      } else if ((event as any).type === 'system_error') {
        const ev = event as any
        const errText = ev.error || ev.message || 'System execution error'
        setTranscripts((current) => [
          ...current,
          {
            id: crypto.randomUUID(),
            role: 'system',
            isError: true,
            tool: ev.tool,
            error: errText,
            text: errText,
            timestamp: Date.now(),
            final: true,
          },
        ])
      } else if ((event as any).type === 'tool.call') {
        const ev = event as any
        const callId = ev.call_id || crypto.randomUUID()
        const toolName = ev.name || 'tool'
        const args = ev.args || {}

        let label = `Executing ${toolName}`
        if (toolName === 'run_command') {
          label = `Running command: ${args.command || ''}`
        } else if (toolName === 'read_file') {
          label = `Reading file: ${args.path || ''}`
        } else if (toolName === 'write_file') {
          label = `Writing file: ${args.path || ''}`
        } else if (toolName === 'edit_file') {
          label = `Editing file: ${args.path || ''}`
        } else if (toolName === 'list_directory') {
          label = `Listing directory: ${args.path || '.'}`
        } else if (toolName === 'search_in_files') {
          label = `Searching files for: "${args.query || ''}"`
        } else if (toolName === 'query_memory') {
          label = `Searching memory for: "${args.query_text || ''}"`
        } else if (toolName === 'save_memory') {
          label = `Saving to memory: "${args.content ? String(args.content).slice(0, 45) : ''}..."`
        } else if (toolName === 'computer_control') {
          label = `Desktop action: ${args.action || 'control'}`
        } else if (toolName === 'computer_settings') {
          label = `System setting: ${args.action || 'adjust'}`
        } else if (toolName.endsWith('_app')) {
          label = `App UI action: ${toolName.replace('_app', '')}`
        }

        setTranscripts((current) => [
          ...current,
          {
            id: callId,
            role: 'system',
            tool: toolName,
            toolCallId: callId,
            toolStatus: 'running',
            toolArgs: args,
            text: label,
            timestamp: Date.now(),
            final: false,
          },
        ])
      } else if ((event as any).type === 'tool.result') {
        const ev = event as any
        const callId = ev.call_id
        const toolName = ev.name || 'tool'
        const res = ev.result
        const isFail = res && (res.ok === false || res.success === false || Boolean(res.error) || res.status === 'permission_denied')
        const errDetail = isFail ? String(res.error || res.message || 'Tool execution failed') : undefined

        setTranscripts((current) => {
          const idx = current.findIndex(
            (entry) => (callId && entry.toolCallId === callId) || (entry.tool === toolName && entry.toolStatus === 'running')
          )
          if (idx !== -1) {
            const updated = [...current]
            const existing = updated[idx]
            updated[idx] = {
              ...existing,
              toolStatus: isFail ? 'failed' : 'completed',
              isError: isFail,
              error: errDetail,
              toolResult: res,
              text: isFail ? `${existing.text} — Failed` : `${existing.text} — Completed`,
              final: true,
            }
            return updated
          }

          return [
            ...current,
            {
              id: crypto.randomUUID(),
              role: 'system',
              tool: toolName,
              toolCallId: callId,
              toolStatus: isFail ? 'failed' : 'completed',
              isError: isFail,
              error: errDetail,
              toolResult: res,
              text: `${toolName}: ${isFail ? 'Failed' : 'Completed'}`,
              timestamp: Date.now(),
              final: true,
            },
          ]
        })
      } else if ((event as any).type === 'desktop_control_active') {
        const ev = event as any
        const active = Boolean(ev.active)
        setDesktopControlActive(active)
        setDesktopControlAction(active ? (ev.action || 'controlling') : null)
      } else if (event.type === 'error') {
        setStatus('error')
        setStatusMessage(event.message)
        setTranscripts((current) => [
          ...current,
          {
            id: crypto.randomUUID(),
            role: 'system',
            isError: true,
            error: event.message,
            text: event.message,
            timestamp: Date.now(),
            final: true,
          },
        ])
      } else if ((event as any).type === 'in_app_control') {
        const e = event as any
        setInAppAction({ action: e.action, args: e.args || {}, id: Date.now() })
      }
    }
    socket.onerror = () => {
      if (socketRef.current !== socket) return
      isConnectingRef.current = false
      setStatus('error')
      setStatusMessage('Cannot reach the local Arix backend')
    }
    socket.onclose = () => {
      if (socketRef.current !== socket) return
      isConnectingRef.current = false
      stopCapture()
      socketRef.current = null
      setStatus((current) => current === 'error' ? current : 'offline')
    }
  }, [clearPlayback, isThinking, playPcm, startCapture, stopCapture, upsertTranscript])

  const sendText = useCallback(async (text: string) => {
    const trimmed = text.trim()
    if (!trimmed) return false
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({ type: 'text', text: trimmed }))
      upsertTranscript('user', trimmed, true)
      setStatus('processing')
      setStatusMessage('Arix is thinking')
      return true
    }

    // If already connecting, queue and return
    if (isConnectingRef.current) {
      pendingQueueRef.current.push(trimmed)
      upsertTranscript('user', trimmed, true)
      return true
    }

    // Auto-connect if offline
    try {
      pendingQueueRef.current.push(trimmed)
      upsertTranscript('user', trimmed, true)
      setStatus('connecting')
      setStatusMessage('Connecting to Arix...')
      await connect()
      return true
    } catch {
      pendingQueueRef.current = []
      return false
    }
  }, [connect, upsertTranscript])

  const clearTranscripts = useCallback(() => setTranscripts([]), [])

  // Sync initial mode preference from backend if available
  useEffect(() => {
    fetch(`${API_URL}/api/mode`)
      .then((res) => res.json())
      .then((data) => {
        if (data.mode === 'think' || (typeof data.model === 'string' && data.model.includes('thinking'))) {
          setIsThinking(true)
          setCurrentModel(data.model || THINKING_LIVE_MODEL)
        } else if (data.model) {
          setCurrentModel(data.model)
        }
      })
      .catch(() => {})
  }, [])

  // Instant override for desktop control: Esc or user mouse movement halts control immediately
  useEffect(() => {
    if (!desktopControlActive) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        stopDesktopControl()
      }
    }

    let lastMousePos: { x: number; y: number } | null = null
    const handleMouseMove = (e: MouseEvent) => {
      if (!lastMousePos) {
        lastMousePos = { x: e.clientX, y: e.clientY }
        return
      }
      const dx = Math.abs(e.clientX - lastMousePos.x)
      const dy = Math.abs(e.clientY - lastMousePos.y)
      if (dx > 30 || dy > 30) {
        stopDesktopControl()
      }
      lastMousePos = { x: e.clientX, y: e.clientY }
    }

    window.addEventListener('keydown', handleKeyDown, { capture: true })
    window.addEventListener('mousemove', handleMouseMove, { capture: true })
    return () => {
      window.removeEventListener('keydown', handleKeyDown, { capture: true })
      window.removeEventListener('mousemove', handleMouseMove, { capture: true })
    }
  }, [desktopControlActive, stopDesktopControl])

  useEffect(() => () => socketRef.current?.close(), [])

  return {
    status,
    statusMessage,
    transcripts,
    audioLevel,
    isThinking,
    currentModel,
    isMuted,
    setMuted,
    toggleMute,
    connect,
    disconnect,
    sendText,
    clearTranscripts,
    switchMode,
    toggleThinking,
    inAppAction,
    desktopControlActive,
    desktopControlAction,
    stopDesktopControl,
  }
}

