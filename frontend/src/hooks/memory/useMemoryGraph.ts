import { useEffect, useState } from 'react'
import type { MemoryGraphSnapshot } from '../../types/memory'

const EMPTY: MemoryGraphSnapshot = { nodes: {}, edges: {}, title_index: {}, anchors: {} }
const URL = import.meta.env.VITE_ARIX_MEMORY_WS_URL ?? 'ws://127.0.0.1:8765/ws/memory'

export function useMemoryGraph(enabled: boolean) {
  const [graph, setGraph] = useState(EMPTY)
  const [connected, setConnected] = useState(false)

  useEffect(() => {
    if (!enabled) return
    let disposed = false
    let socket: WebSocket | null = null
    let retry: number | undefined

    const connect = () => {
      if (disposed) return
      socket = new WebSocket(URL)

      socket.onopen = () => {
        if (disposed) {
          socket?.close(1000, 'Unmounted')
          return
        }
        setConnected(true)
      }

      socket.onmessage = (e) => {
        if (disposed) return
        try {
          const event = JSON.parse(e.data) as { type: string; data: MemoryGraphSnapshot }
          if (event.type === 'memory.snapshot') {
            setGraph(event.data)
          }
        } catch {}
      }

      socket.onclose = () => {
        setConnected(false)
        if (!disposed) {
          retry = window.setTimeout(connect, 2000)
        }
      }

      socket.onerror = () => {
        if (!disposed && socket && socket.readyState === WebSocket.OPEN) {
          socket.close()
        }
      }
    }

    connect()

    return () => {
      disposed = true
      if (retry) clearTimeout(retry)
      if (socket) {
        socket.onmessage = null
        socket.onerror = null
        socket.onclose = null
        if (socket.readyState === WebSocket.OPEN) {
          socket.close(1000, 'Unmounted')
        } else if (socket.readyState === WebSocket.CONNECTING) {
          socket.onopen = () => socket?.close(1000, 'Unmounted')
        }
      }
    }
  }, [enabled])

  return { graph, connected }
}
