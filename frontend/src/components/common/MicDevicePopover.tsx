import React, { useEffect, useRef } from 'react'
import {
  Check,
  Mic,
  MicOff,
  RotateCcw,
  Sliders,
  X,
} from 'lucide-react'

interface Props {
  isOpen: boolean
  onClose: () => void
  isMicMuted: boolean
  onToggleMicMute: () => void
  inputVolume: number
  onChangeInputVolume: (val: number) => void
  inputDeviceId: string
  onChangeInputDeviceId: (id: string) => void
  inputDevices: MediaDeviceInfo[]
  onRefreshDevices: () => void
  rawRmsVal: number
}

export function MicDevicePopover({
  isOpen,
  onClose,
  isMicMuted,
  onToggleMicMute,
  inputVolume,
  onChangeInputVolume,
  inputDeviceId,
  onChangeInputDeviceId,
  inputDevices,
  onRefreshDevices,
  rawRmsVal,
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

  const livePercent = Math.min(100, Math.round((rawRmsVal / 0.10) * 100))

  return (
    <div
      className="discord-audio-popover mic-popover-anchor"
      ref={panelRef}
      role="dialog"
      aria-label="Microphone Settings"
    >
      <header className="discord-popover-header">
        <div className="discord-header-title">
          <div className="discord-icon-badge">
            <Mic size={14} className="text-emerald-400" />
          </div>
          <div>
            <h3>Microphone Settings</h3>
            <span>Device, volume & input meter</span>
          </div>
        </div>
        <div className="discord-header-actions">
          <button
            type="button"
            className="discord-icon-btn"
            onClick={() => {
              onChangeInputVolume(1.0)
              onChangeInputDeviceId('default')
            }}
            title="Reset microphone to defaults"
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
          <label className="discord-mini-label">INPUT DEVICE (MICROPHONE)</label>
          <select
            className="discord-select"
            value={inputDeviceId}
            onChange={(e) => onChangeInputDeviceId(e.target.value)}
            aria-label="Select input device"
          >
            <option value="default">Default Communication Microphone</option>
            {inputDevices.map((device, idx) => (
              <option key={device.deviceId || idx} value={device.deviceId}>
                {device.label || `Microphone ${idx + 1}`}
              </option>
            ))}
          </select>
        </div>

        <div className="discord-slider-row">
          <div className="discord-slider-header">
            <label>INPUT VOLUME</label>
            <span className="discord-vol-badge">{Math.round(inputVolume * 100)}%</span>
          </div>
          <input
            type="range"
            min="0"
            max="1.5"
            step="0.05"
            value={inputVolume}
            onChange={(e) => onChangeInputVolume(parseFloat(e.target.value))}
            className="discord-range"
          />
        </div>

        {/* Real-time Mic Activity Meter */}
        <div className="discord-sensitivity-block">
          <div className="discord-slider-header">
            <div>
              <label>MICROPHONE ACTIVITY</label>
              <span className="discord-subtext">Live sound level from chosen microphone</span>
            </div>
            <span className={`discord-thresh-badge ${rawRmsVal > 0.008 && !isMicMuted ? 'active' : ''}`}>
              {isMicMuted ? 'MUTED' : rawRmsVal > 0.008 ? 'CAPTURING' : 'IDLE'}
            </span>
          </div>

          <div className="discord-meter-wrapper" title="Real-time mic capture volume">
            <div
              className={`discord-meter-fill ${rawRmsVal > 0.008 && !isMicMuted ? 'active' : ''}`}
              style={{ width: `${isMicMuted ? 0 : livePercent}%` }}
            />
          </div>
        </div>

        <div className="discord-quick-actions">
          <button
            type="button"
            className={`discord-action-pill ${isMicMuted ? 'is-muted' : ''}`}
            onClick={onToggleMicMute}
          >
            {isMicMuted ? <MicOff size={13} className="text-red-400" /> : <Mic size={13} className="text-emerald-400" />}
            <span>{isMicMuted ? 'Turn Microphone On' : 'Mute Microphone'}</span>
          </button>
        </div>
      </div>
    </div>
  )
}
