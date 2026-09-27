import { useCallback, useEffect, useRef, useState } from 'react'
import { base64ToBytes, float32ToPcm16, rmsLevel } from '../lib/audio'

export function useAudioEngine(onChunk: (chunk: ArrayBuffer) => void) {
  const [level, setLevel] = useState(0)
  const contextRef = useRef<AudioContext | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const processorRef = useRef<ScriptProcessorNode | null>(null)
  const nextPlaybackRef = useRef(0)

  const stopCapture = useCallback(() => {
    processorRef.current?.disconnect()
    processorRef.current = null
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    setLevel(0)
  }, [])

  const startCapture = useCallback(async () => {
    if (streamRef.current && processorRef.current) {
      return
    }
    stopCapture()
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    })
    const context = contextRef.current ?? new AudioContext({ latencyHint: 'interactive' })
    contextRef.current = context
    await context.resume()
    const source = context.createMediaStreamSource(stream)
    const processor = context.createScriptProcessor(4096, 1, 1)
    const silent = context.createGain()
    silent.gain.value = 0
    processor.onaudioprocess = ({ inputBuffer }) => {
      const samples = inputBuffer.getChannelData(0)
      setLevel(rmsLevel(samples))
      onChunk(float32ToPcm16(samples, context.sampleRate))
    }
    source.connect(processor)
    processor.connect(silent)
    silent.connect(context.destination)
    streamRef.current = stream
    processorRef.current = processor
  }, [onChunk, stopCapture])

  const playPcm = useCallback(async (base64: string, sampleRate = 24000) => {
    const context = contextRef.current ?? new AudioContext({ latencyHint: 'interactive' })
    contextRef.current = context
    await context.resume()
    const bytes = base64ToBytes(base64)
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const audioBuffer = context.createBuffer(1, Math.floor(bytes.byteLength / 2), sampleRate)
    const channel = audioBuffer.getChannelData(0)
    for (let index = 0; index < channel.length; index += 1) channel[index] = view.getInt16(index * 2, true) / 32768
    const source = context.createBufferSource()
    source.buffer = audioBuffer
    source.connect(context.destination)
    const startAt = Math.max(context.currentTime + 0.02, nextPlaybackRef.current)
    source.start(startAt)
    nextPlaybackRef.current = startAt + audioBuffer.duration
  }, [])

  const clearPlayback = useCallback(() => {
    nextPlaybackRef.current = 0
  }, [])

  useEffect(() => () => {
    stopCapture()
    void contextRef.current?.close()
  }, [stopCapture])

  return { level, startCapture, stopCapture, playPcm, clearPlayback }
}
