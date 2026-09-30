import React from 'react'
import type { OrbProps } from './types'
import { STATUS_LABELS } from './types'

export function ClassicOrb({ status, level, className = '' }: OrbProps) {
  const activity = status === 'speaking' ? 0.75 : status === 'processing' ? 0.38 : level
  const bars = Array.from({ length: 42 }, (_, index) => {
    const wave = Math.abs(Math.sin(index * 0.63 + activity * 4.2))
    return Math.max(3, 4 + wave * activity * 34)
  })

  return (
    <section className={`orb-stage status-${status} ${className}`} aria-label={`Voice status: ${STATUS_LABELS[status]}`}>
      <div className="orb-coordinates">
        <span>37.6° N</span>
        <span>ARX / LIVE</span>
        <span>122.4° W</span>
      </div>
      <div className="orb-field" style={{ '--level': Math.max(0.08, activity) } as React.CSSProperties}>
        <div className="orb-grid" />
        <div className="orb-ring ring-one" />
        <div className="orb-ring ring-two" />
        <div className="orb-ring ring-three" />
        <div className="orb-ticks" />
        <div className="orb-core">
          <div className="orb-surface" />
          <div className="orb-glint" />
        </div>
        <span className="target-corner corner-a" />
        <span className="target-corner corner-b" />
        <span className="target-corner corner-c" />
        <span className="target-corner corner-d" />
      </div>
      <div className="waveform" aria-hidden="true">
        {bars.map((height, index) => (
          <i key={index} style={{ height: `${height}px`, opacity: 0.25 + activity * 0.75 }} />
        ))}
      </div>
      <div className="orb-state">
        <span className="state-dot" />
        {STATUS_LABELS[status]}
      </div>
    </section>
  )
}
