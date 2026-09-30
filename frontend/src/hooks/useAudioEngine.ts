import { useCallback, useEffect, useRef, useState } from 'react'
import { base64ToBytes, float32ToPcm16, rawRms } from '../lib/audio'

export interface AudioEngineConfig {
  inputDeviceId?: string
  outputDeviceId?: string
  inputVolume?: number // 0.0 to 1.5
  outputVolume?: number // 0.0 to 1.0
  sensitivityThreshold?: number // 0.005 to 0.08
  isMicMuted?: boolean
}

export function useAudioEngine(onChunk: (chunk: ArrayBuffer) => void, initialConfig?: AudioEngineConfig) {
  const [level, setLevel] = useState(0)
  const [rawRmsVal, setRawRmsVal] = useState(0)
  const [isMicMuted, setIsMicMutedState] = useState(() => {
    try {
      return localStorage.getItem('arix_is_mic_muted') === 'true'
    } catch {
      return false
    }
  })
  const [inputVolume, setInputVolumeState] = useState<number>(() => {
    try {
      const v = localStorage.getItem('arix_input_volume')
      return v ? Number(v) : (initialConfig?.inputVolume ?? 1.0)
    } catch {
      return 1.0
    }
  })
  const [outputVolume, setOutputVolumeState] = useState<number>(() => {
    try {
      const v = localStorage.getItem('arix_output_volume')
      return v ? Number(v) : (initialConfig?.outputVolume ?? 1.0)
    } catch {
      return 1.0
    }
  })
  const [sensitivityThreshold, setSensitivityThresholdState] = useState<number>(() => {
    try {
      const v = localStorage.getItem('arix_sensitivity_threshold')
      return v ? Number(v) : (initialConfig?.sensitivityThreshold ?? 0.022)
    } catch {
      return 0.022
    }
  })
  const [inputDeviceId, setInputDeviceIdState] = useState<string>(() => {
    try {
      return localStorage.getItem('arix_input_device_id') || 'default'
    } catch {
      return 'default'
    }
  })
  const [outputDeviceId, setOutputDeviceIdState] = useState<string>(() => {
    try {
      return localStorage.getItem('arix_output_device_id') || 'default'
    } catch {
      return 'default'
    }
  })
  const [audioDevices, setAudioDevices] = useState<{ inputs: MediaDeviceInfo[]; outputs: MediaDeviceInfo[] }>({
    inputs: [],
    outputs: [],
  })

  const contextRef = useRef<AudioContext | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const processorRef = useRef<ScriptProcessorNode | null>(null)
  const outputGainRef = useRef<GainNode | null>(null)
  const nextPlaybackRef = useRef(0)
  const lastVoiceTimeRef = useRef(0)

  const isMicMutedRef = useRef(isMicMuted)
  isMicMutedRef.current = isMicMuted
  const inputVolumeRef = useRef(inputVolume)
  inputVolumeRef.current = inputVolume
  const outputVolumeRef = useRef(outputVolume)
  outputVolumeRef.current = outputVolume
  const sensitivityThresholdRef = useRef(sensitivityThreshold)
  sensitivityThresholdRef.current = sensitivityThreshold
  const inputDeviceIdRef = useRef(inputDeviceId)
  inputDeviceIdRef.current = inputDeviceId
  const outputDeviceIdRef = useRef(outputDeviceId)
  outputDeviceIdRef.current = outputDeviceId

  const refreshDevices = useCallback(async () => {
    try {
      if (!navigator.mediaDevices?.enumerateDevices) return
      const list = await navigator.mediaDevices.enumerateDevices()
      const inputs = list.filter((d) => d.kind === 'audioinput')
      const outputs = list.filter((d) => d.kind === 'audiooutput')
      setAudioDevices({ inputs, outputs })
    } catch (err) {
      console.warn('[AudioEngine] Could not enumerate devices:', err)
    }
  }, [])

  useEffect(() => {
    void refreshDevices()
    navigator.mediaDevices?.addEventListener?.('devicechange', refreshDevices)
    return () => {
      navigator.mediaDevices?.removeEventListener?.('devicechange', refreshDevices)
    }
  }, [refreshDevices])

  const setInputVolume = useCallback((val: number) => {
    const clamped = Math.max(0, Math.min(1.5, val))
    setInputVolumeState(clamped)
    inputVolumeRef.current = clamped
    try {
      localStorage.setItem('arix_input_volume', String(clamped))
    } catch {}
  }, [])

  const setOutputVolume = useCallback((val: number) => {
    const clamped = Math.max(0, Math.min(1.0, val))
    setOutputVolumeState(clamped)
    outputVolumeRef.current = clamped
    if (outputGainRef.current) {
      outputGainRef.current.gain.value = clamped
    }
    try {
      localStorage.setItem('arix_output_volume', String(clamped))
    } catch {}
  }, [])

  const setSensitivityThreshold = useCallback((val: number) => {
    const clamped = Math.max(0.005, Math.min(0.08, val))
    setSensitivityThresholdState(clamped)
    sensitivityThresholdRef.current = clamped
    try {
      localStorage.setItem('arix_sensitivity_threshold', String(clamped))
    } catch {}
  }, [])

  const setIsMicMuted = useCallback((muted: boolean) => {
    setIsMicMutedState(muted)
    isMicMutedRef.current = muted
    if (muted) {
      setLevel(0)
      setRawRmsVal(0)
    }
    try {
      localStorage.setItem('arix_is_mic_muted', String(muted))
    } catch {}
  }, [])

  const toggleMicMute = useCallback(() => {
    const next = !isMicMutedRef.current
    setIsMicMuted(next)
    return next
  }, [setIsMicMuted])

  const setInputDevice = useCallback((devId: string) => {
    setInputDeviceIdState(devId)
    inputDeviceIdRef.current = devId
    try {
      localStorage.setItem('arix_input_device_id', devId)
    } catch {}
  }, [])

  const setOutputDevice = useCallback(async (devId: string) => {
    setOutputDeviceIdState(devId)
    outputDeviceIdRef.current = devId
    try {
      localStorage.setItem('arix_output_device_id', devId)
      if (contextRef.current && typeof (contextRef.current as any).setSinkId === 'function') {
        await (contextRef.current as any).setSinkId(devId === 'default' ? '' : devId)
      }
    } catch (err) {
      console.warn('[AudioEngine] Failed to setSinkId on AudioContext:', err)
    }
  }, [])

  const stopCapture = useCallback(() => {
    processorRef.current?.disconnect()
    processorRef.current = null
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    setLevel(0)
    setRawRmsVal(0)
  }, [])

  const startCapture = useCallback(async (overrideDeviceId?: string) => {
    if (streamRef.current && processorRef.current) {
      return
    }
    stopCapture()

    const targetDevId = overrideDeviceId || inputDeviceIdRef.current

    // Request audio stream with natural sensitivity and standard processing
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        deviceId: targetDevId && targetDevId !== 'default' ? { exact: targetDevId } : undefined,
      },
    })

    // Standard interactive AudioContext
    let context = contextRef.current
    if (!context || context.state === 'closed') {
      context = new AudioContext({ latencyHint: 'interactive' })
      contextRef.current = context
    }
    await context.resume()

    // Output gain node for volume control
    if (!outputGainRef.current) {
      const outGain = context.createGain()
      outGain.gain.value = outputVolumeRef.current
      outGain.connect(context.destination)
      outputGainRef.current = outGain
    }

    const source = context.createMediaStreamSource(stream)
    const processor = context.createScriptProcessor(4096, 1, 1)
    const silent = context.createGain()
    silent.gain.value = 0

    processor.onaudioprocess = ({ inputBuffer }) => {
      // 1. If mic is muted, suppress all capture
      if (isMicMutedRef.current) {
        setLevel(0)
        setRawRmsVal(0)
        return
      }

      const samples = inputBuffer.getChannelData(0)
      const rms = rawRms(samples)
      setRawRmsVal(rms)

      // Visual meter level (0 to 1)
      const visualLevel = Math.min(1, rms * 4.5)
      setLevel(visualLevel)

      // 2. High sensitivity PCM conversion with input volume gain (no blocking noise gate)
      const pcm16 = float32ToPcm16(samples, context.sampleRate, 16000, inputVolumeRef.current)
      onChunk(pcm16)
    }

    source.connect(processor)
    processor.connect(silent)
    silent.connect(context.destination)
    streamRef.current = stream
    processorRef.current = processor

    void refreshDevices()
  }, [onChunk, refreshDevices, stopCapture])

  const playPcm = useCallback(async (base64: string, sampleRate = 24000) => {
    let context = contextRef.current
    if (!context || context.state === 'closed') {
      context = new AudioContext({ latencyHint: 'interactive' })
      contextRef.current = context
    }
    await context.resume()

    // Ensure output gain node is connected
    if (!outputGainRef.current) {
      const outGain = context.createGain()
      outGain.gain.value = outputVolumeRef.current
      outGain.connect(context.destination)
      outputGainRef.current = outGain
    }

    const bytes = base64ToBytes(base64)
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const audioBuffer = context.createBuffer(1, Math.floor(bytes.byteLength / 2), sampleRate)
    const channel = audioBuffer.getChannelData(0)
    for (let index = 0; index < channel.length; index += 1) {
      channel[index] = view.getInt16(index * 2, true) / 32768
    }

    const source = context.createBufferSource()
    source.buffer = audioBuffer
    source.connect(outputGainRef.current)

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

  return {
    level,
    rawRmsVal,
    isMicMuted,
    setIsMicMuted,
    toggleMicMute,
    inputVolume,
    setInputVolume,
    outputVolume,
    setOutputVolume,
    sensitivityThreshold,
    setSensitivityThreshold,
    inputDeviceId,
    setInputDevice,
    outputDeviceId,
    setOutputDevice,
    audioDevices,
    refreshDevices,
    startCapture,
    stopCapture,
    playPcm,
    clearPlayback,
  }
}
