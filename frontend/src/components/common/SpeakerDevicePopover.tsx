import React, { useEffect, useRef } from 'react'
import {
  Headphones,
  RotateCcw,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react'

interface Props {
  isOpen: boolean
  onClose: () => void
  isAiMuted: boolean
  onToggleAiMute: () => void
  outputVolume: number
  onChangeOutputVolume: (val: number) => void
  outputDeviceId: string
  onChangeOutputDeviceId: (id: string) => void
  outputDevices: MediaDeviceInfo[]
  onRefreshDevices: () => void
}

export function SpeakerDevicePopover({
  isOpen,
  onClose,
  isAiMuted,
  onToggleAiMute,
  outputVolume,
  onChangeOutputVolume,
  outputDeviceId,
  onChangeOutputDeviceId,
  outputDevices,
  onRefreshDevices,
}: Props) {
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (isOpen) {
      onRefreshDevices()
    }
  }, [isOpen, onRefreshDevices])

  useEffect(() => {
    if (!isOpen) return
    const handleClickOutside = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('mousedown', handleClickOutside)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('mousedown', handleClickOutside)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen, onClose])

  if (!isOpen) return null

  return (
    <div
      className="discord-audio-popover speaker-popover-anchor"
      ref={panelRef}
      role="dialog"
      aria-label="Speaker & Audio Output Settings"
    >
      <header className="discord-popover-header">
        <div className="discord-header-title">
          <div className="discord-icon-badge">
            <Volume2 size={14} className="text-sky-400" />
          </div>
          <div>
            <h3>Speaker & Output Settings</h3>
            <span>Audio playback device & volume</span>
          </div>
        </div>
        <div className="discord-header-actions">
          <button
            type="button"
            className="discord-icon-btn"
            onClick={() => {
              onChangeOutputVolume(1.0)
              onChangeOutputDeviceId('default')
            }}
            title="Reset speaker to defaults"
          >
            <RotateCcw size={13} />
          </button>
          <button
            type="button"
            className="discord-icon-btn discord-close-btn"
            onClick={onClose}
            title="Close"
          >
            <X size={15} />
          </button>
        </div>
      </header>

      <div className="discord-popover-body">
        <div className="discord-field-group">
          <label className="discord-mini-label">OUTPUT DEVICE (SPEAKERS / HEADPHONES)</label>
          <select
            className="discord-select"
            value={outputDeviceId}
            onChange={(e) => onChangeOutputDeviceId(e.target.value)}
            aria-label="Select output device"
          >
            <option value="default">Default Audio Output</option>
            {outputDevices.map((device, idx) => (
              <option key={device.deviceId || idx} value={device.deviceId}>
                {device.label || `Speaker / Headphone ${idx + 1}`}
              </option>
            ))}
          </select>
        </div>

        <div className="discord-slider-row">
          <div className="discord-slider-header">
            <label>OUTPUT VOLUME</label>
            <span className="discord-vol-badge">{Math.round(outputVolume * 100)}%</span>
          </div>
          <input
            type="range"
            min="0"
            max="1.0"
            step="0.05"
            value={outputVolume}
            onChange={(e) => onChangeOutputVolume(parseFloat(e.target.value))}
            className="discord-range"
          />
        </div>

        <div className="discord-quick-actions">
          <button
            type="button"
            className={`discord-action-pill ${isAiMuted ? 'is-muted' : ''}`}
            onClick={onToggleAiMute}
          >
            {isAiMuted ? <VolumeX size={13} className="text-amber-400" /> : <Volume2 size={13} className="text-sky-400" />}
            <span>{isAiMuted ? 'Unmute AI Voice' : 'Mute AI Voice'}</span>
          </button>
        </div>
      </div>
    </div>
  )
}
