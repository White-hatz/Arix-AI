import React, { useEffect, useRef } from 'react'
import type { OrbProps } from './types'
import { STATUS_LABELS } from './types'
import type { PipelineStatus } from '../../types/arix'

interface StateProfile {
  label: string
  hint: string
  rgb: string
  accent: string
  spin: number
  intensity: number
  reactive: boolean
}

const STATE_PROFILES: Record<PipelineStatus, StateProfile> = {
  offline: {
    label: 'STANDBY',
    hint: 'Voice channel ready',
    rgb: '91, 107, 140',
    accent: '#5b6b8c',
    spin: 0.35,
    intensity: 0.28,
    reactive: false,
  },
  connecting: {
    label: 'CONNECTING',
    hint: 'Opening the live channel',
    rgb: '255, 189, 102',
    accent: '#ffbd66',
    spin: 1.9,
    intensity: 0.55,
    reactive: false,
  },
  listening: {
    label: 'LISTENING',
    hint: 'Listening to speech...',
    rgb: '34, 211, 238',
    accent: '#22d3ee',
    spin: 0.75,
    intensity: 0.52,
    reactive: true,
  },
  processing: {
    label: 'PROCESSING',
    hint: 'Synthesizing response...',
    rgb: '167, 139, 250',
    accent: '#a78bfa',
    spin: 2.3,
    intensity: 0.72,
    reactive: false,
  },
  speaking: {
    label: 'SPEAKING',
    hint: 'Arix is responding',
    rgb: '74, 222, 128',
    accent: '#4ade80',
    spin: 1.15,
    intensity: 0.68,
    reactive: true,
  },
  error: {
    label: 'LINK ERROR',
    hint: 'Connection needs attention',
    rgb: '244, 63, 94',
    accent: '#f43f5e',
    spin: 0.5,
    intensity: 0.62,
    reactive: false,
  },
}

const PARTICLES = 48
const WAVE_POINTS = 132
const BARS = 56

import { ORB_TOKENS } from '../../lib/orbTokens'

export function JulesOrb({ status, level, size: propSize, className = '' }: OrbProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const statusRef = useRef(status)
  const levelRef = useRef(level)
  const rafRef = useRef(0)

  statusRef.current = status
  levelRef.current = level

  const anim = useRef({
    energy: 0,
    intensity: 0.3,
    spin: 0.4,
    rot: 0,
    rotB: 0,
    t: 0,
    r: 91,
    g: 107,
    b: 140,
    barHistory: new Float32Array(BARS),
  })

  const particles = useRef(
    Array.from({ length: PARTICLES }, () => ({
      angle: Math.random() * Math.PI * 2,
      radius: 0.62 + Math.random() * 0.42,
      speed: 0.0016 + Math.random() * 0.0052,
      size: 0.7 + Math.random() * 1.9,
      phase: Math.random() * Math.PI * 2,
      drift: 0.4 + Math.random() * 0.9,
    }))
  )

  useEffect(() => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container) return
    const ctx = canvas.getContext('2d', { alpha: true })
    if (!ctx) return

    let currentSize = propSize || Math.min(container.clientWidth || 360, container.clientHeight || 360, ORB_TOKENS.jules.homeSize)
    if (currentSize <= 0) currentSize = ORB_TOKENS.jules.homeSize

    const updateDimensions = () => {
      const parent = containerRef.current
      if (!parent || !canvasRef.current) return
      const w = parent.clientWidth || 360
      const h = parent.clientHeight || 360
      const targetSize = propSize || Math.max(120, Math.min(w, h, ORB_TOKENS.jules.homeSize))
      currentSize = targetSize
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      canvas.width = Math.round(targetSize * dpr)
      canvas.height = Math.round(targetSize * dpr)
      canvas.style.width = `${targetSize}px`
      canvas.style.height = `${targetSize}px`
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }

    updateDimensions()

    const resizeObserver = new ResizeObserver(() => {
      updateDimensions()
    })
    resizeObserver.observe(container)

    const A = anim.current
    let last = performance.now()

    const frame = (now: number) => {
      const dt = Math.min(48, now - last)
      last = now
      A.t += dt * 0.001

      const st = statusRef.current
      const profile = STATE_PROFILES[st] ?? STATE_PROFILES.offline
      const [pr, pg, pb] = profile.rgb.split(',').map((n) => parseFloat(n))

      // Live energy easing
      let rawEnergy = 0
      if (st === 'speaking') {
        rawEnergy = Math.max(levelRef.current * 1.4, 0.42 + Math.abs(Math.sin(A.t * 4.5)) * 0.32)
      } else if (st === 'processing') {
        rawEnergy = 0.22 + Math.abs(Math.sin(A.t * 3.2)) * 0.18
      } else if (profile.reactive) {
        // Boost quiet mic levels gracefully
        const boosted = Math.pow(Math.min(1, levelRef.current * 4.8), 0.72)
        rawEnergy = Math.max(0, Math.min(1, boosted))
      }

      const ease = (cur: number, target: number, rate: number) => cur + (target - cur) * rate
      A.energy = ease(A.energy, rawEnergy, rawEnergy > A.energy ? 0.32 : 0.09)
      A.intensity = ease(A.intensity, profile.intensity, 0.05)
      A.spin = ease(A.spin, profile.spin, 0.04)
      A.r = ease(A.r, pr, 0.055)
      A.g = ease(A.g, pg, 0.055)
      A.b = ease(A.b, pb, 0.055)

      A.rot += dt * 0.00022 * A.spin
      A.rotB -= dt * 0.00034 * A.spin

      const rgb = `${A.r | 0}, ${A.g | 0}, ${A.b | 0}`
      const size = currentSize
      const cx = size / 2
      const cy = size / 2

      // Idle breathing keeps the orb alive even in silence
      const breathe = 1 + Math.sin(A.t * 1.15) * 0.018
      const baseR = size * 0.205 * breathe
      const boost = 1 + A.energy * 0.2
      const coreR = baseR * boost
      const glow = A.intensity + A.energy * 0.5

      // Fully transparent clear: preserves app background
      ctx.clearRect(0, 0, size, size)

      // ============================ 1. Outer Aura Bloom ============================
      const auraR = size * 0.49 * (0.86 + A.energy * 0.14)
      const aura = ctx.createRadialGradient(cx, cy, coreR * 0.5, cx, cy, auraR)
      aura.addColorStop(0, `rgba(${rgb}, ${0.22 * glow})`)
      aura.addColorStop(0.45, `rgba(${rgb}, ${0.08 * glow})`)
      aura.addColorStop(1, `rgba(${rgb}, 0)`)
      ctx.fillStyle = aura
      ctx.beginPath()
      ctx.arc(cx, cy, auraR, 0, Math.PI * 2)
      ctx.fill()

      // ========================= 2. Rotating Arc Rings ==========================
      const drawArcRing = (radius: number, rotation: number, span: number, width: number, alpha: number, dashed: boolean) => {
        ctx.save()
        ctx.translate(cx, cy)
        ctx.rotate(rotation)
        ctx.lineWidth = width
        ctx.lineCap = 'round'
        if (dashed) ctx.setLineDash([2.5, 9])
        const grad = ctx.createLinearGradient(-radius, 0, radius, 0)
        grad.addColorStop(0, `rgba(${rgb}, 0)`)
        grad.addColorStop(0.5, `rgba(${rgb}, ${alpha})`)
        grad.addColorStop(1, `rgba(${rgb}, 0)`)
        ctx.strokeStyle = grad
        ctx.beginPath()
        ctx.arc(0, 0, radius, -span / 2, span / 2)
        ctx.stroke()
        ctx.restore()
      }

      drawArcRing(baseR * 1.62, A.rot, Math.PI * 1.35, 1.5, 0.5 * glow, false)
      drawArcRing(baseR * 1.62, A.rot + Math.PI, Math.PI * 0.5, 1.1, 0.3 * glow, false)
      drawArcRing(baseR * 1.95, A.rotB, Math.PI * 1.1, 1, 0.3 * glow, true)
      drawArcRing(baseR * 2.28, A.rot * 0.6, Math.PI * 0.34, 1.6, 0.26 * glow, false)

      // HUD Ticks
      ctx.save()
      ctx.translate(cx, cy)
      ctx.rotate(-A.rotB * 0.5)
      const tickR = baseR * 2.45
      for (let i = 0; i < 48; i++) {
        const a = (i / 48) * Math.PI * 2
        const long = i % 6 === 0
        const len = long ? 5.5 : 2.8
        ctx.strokeStyle = `rgba(${rgb}, ${(long ? 0.32 : 0.14) * glow})`
        ctx.lineWidth = long ? 1.2 : 0.8
        ctx.beginPath()
        ctx.moveTo(Math.cos(a) * tickR, Math.sin(a) * tickR)
        ctx.lineTo(Math.cos(a) * (tickR + len), Math.sin(a) * (tickR + len))
        ctx.stroke()
      }
      ctx.restore()

      // ======================== 3. Reactive Waveform ========================
      const waveAmp = baseR * (0.055 + A.energy * 0.36)
      const drawWave = (phase: number, alpha: number, width: number, harmonic: number) => {
        ctx.beginPath()
        for (let i = 0; i <= WAVE_POINTS; i++) {
          const a = (i / WAVE_POINTS) * Math.PI * 2
          const m =
            Math.sin(a * 3 + A.t * 2.1 + phase) * 0.55 +
            Math.sin(a * 5 - A.t * 1.35 + phase) * 0.3 +
            Math.sin(a * (8 + harmonic) + A.t * 3.1 + phase) * 0.15
          const r = baseR * 1.3 + m * waveAmp
          const x = cx + Math.cos(a) * r
          const y = cy + Math.sin(a) * r
          if (i === 0) ctx.moveTo(x, y)
          else ctx.lineTo(x, y)
        }
        ctx.closePath()
        ctx.strokeStyle = `rgba(${rgb}, ${alpha})`
        ctx.lineWidth = width
        ctx.stroke()
      }

      drawWave(0, (0.34 + A.energy * 0.5) * glow, 1.7, 0)
      drawWave(2.1, (0.18 + A.energy * 0.3) * glow, 1.1, 2)
      drawWave(4.2, (0.1 + A.energy * 0.2) * glow, 0.9, 4)

      // =========================== 4. Core Sphere ===========================
      // Halo bloom
      const halo = ctx.createRadialGradient(cx, cy, coreR * 0.7, cx, cy, coreR * 1.9)
      halo.addColorStop(0, `rgba(${rgb}, ${0.36 * glow})`)
      halo.addColorStop(1, `rgba(${rgb}, 0)`)
      ctx.fillStyle = halo
      ctx.beginPath()
      ctx.arc(cx, cy, coreR * 1.9, 0, Math.PI * 2)
      ctx.fill()

      // 3D sphere gradient body
      const body = ctx.createRadialGradient(
        cx - coreR * 0.32,
        cy - coreR * 0.38,
        coreR * 0.08,
        cx,
        cy,
        coreR
      )
      body.addColorStop(0, `rgba(255, 255, 255, ${0.92 * (0.55 + glow * 0.45)})`)
      body.addColorStop(0.28, `rgba(${rgb}, 0.94)`)
      body.addColorStop(0.72, `rgba(${rgb}, 0.44)`)
      body.addColorStop(1, `rgba(${rgb}, 0.12)`)
      ctx.fillStyle = body
      ctx.beginPath()
      ctx.arc(cx, cy, coreR, 0, Math.PI * 2)
      ctx.fill()

      // Rim light
      ctx.strokeStyle = `rgba(255,255,255,${0.16 + A.energy * 0.22})`
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.arc(cx, cy, coreR, 0, Math.PI * 2)
      ctx.stroke()

      // Specular highlight
      const spec = ctx.createRadialGradient(
        cx - coreR * 0.34,
        cy - coreR * 0.42,
        0,
        cx - coreR * 0.34,
        cy - coreR * 0.42,
        coreR * 0.55
      )
      spec.addColorStop(0, 'rgba(255,255,255,0.55)')
      spec.addColorStop(1, 'rgba(255,255,255,0)')
      ctx.fillStyle = spec
      ctx.beginPath()
      ctx.arc(cx, cy, coreR, 0, Math.PI * 2)
      ctx.fill()

      // Inner iris line
      ctx.strokeStyle = `rgba(255,255,255,${0.1 + A.energy * 0.16})`
      ctx.lineWidth = 0.8
      ctx.beginPath()
      ctx.arc(cx, cy, coreR * 0.58, 0, Math.PI * 2)
      ctx.stroke()

      // ========================== 5. Particle Orbit =========================
      for (const p of particles.current) {
        p.angle += p.speed * (0.35 + A.spin * 0.55) * (dt / 16.7)
        const pull = 1 - A.energy * 0.2
        const wobble = Math.sin(A.t * p.drift + p.phase) * 0.06
        const r = baseR * (1.45 + p.radius * 0.75 + wobble) * pull
        const x = cx + Math.cos(p.angle) * r
        const y = cy + Math.sin(p.angle) * r
        const twinkle = 0.35 + Math.abs(Math.sin(A.t * 1.6 + p.phase)) * 0.65
        ctx.fillStyle = `rgba(${rgb}, ${twinkle * (0.28 + A.energy * 0.45) * glow})`
        ctx.beginPath()
        ctx.arc(x, y, p.size * (1 + A.energy * 0.55), 0, Math.PI * 2)
        ctx.fill()
      }

      // ======================= 6. Bottom Bar Spectrum =======================
      const hist = A.barHistory
      const barW = 2
      const gap = 2.4
      const totalW = BARS * (barW + gap) - gap
      const bx0 = cx - totalW / 2
      const by = cy + size * 0.35

      for (let i = BARS - 1; i > 0; i--) hist[i] = hist[i - 1]
      hist[0] = A.energy

      for (let i = 0; i < BARS; i++) {
        const dist = Math.abs(i - (BARS - 1) / 2) / ((BARS - 1) / 2)
        const idx = Math.floor(dist * (BARS - 1))
        const env = 1 - dist * 0.72
        const jitter = 0.35 + Math.abs(Math.sin(A.t * 5 + i * 0.55)) * 0.65
        const h = Math.max(
          1.5,
          hist[idx] * size * 0.085 * env * jitter + (profile.reactive ? 1.5 : 1)
        )
        const alpha = (0.2 + hist[idx] * 0.7) * env * glow + 0.05
        ctx.fillStyle = `rgba(${rgb}, ${Math.min(0.95, alpha)})`
        const x = bx0 + i * (barW + gap)
        ctx.beginPath()
        if (ctx.roundRect) {
          ctx.roundRect(x, by - h / 2, barW, h, barW / 2)
        } else {
          ctx.rect(x, by - h / 2, barW, h)
        }
        ctx.fill()
      }

      // Connecting hairline behind bars
      ctx.strokeStyle = `rgba(${rgb}, ${0.12 * glow})`
      ctx.lineWidth = 0.8
      ctx.beginPath()
      ctx.moveTo(bx0 - 14, by)
      ctx.lineTo(bx0 + totalW + 14, by)
      ctx.stroke()

      // ===================== Connecting / Error Sweep Overlay =====================
      if (st === 'connecting') {
        const sweep = (A.t * 2.4) % (Math.PI * 2)
        ctx.save()
        ctx.translate(cx, cy)
        ctx.strokeStyle = `rgba(${rgb}, 0.85)`
        ctx.lineWidth = 2.2
        ctx.lineCap = 'round'
        ctx.beginPath()
        ctx.arc(0, 0, baseR * 2.05, sweep, sweep + Math.PI * 0.42)
        ctx.stroke()
        ctx.restore()
      }

      rafRef.current = requestAnimationFrame(frame)
    }

    rafRef.current = requestAnimationFrame(frame)

    return () => {
      cancelAnimationFrame(rafRef.current)
      resizeObserver.disconnect()
    }
  }, [propSize])

  return (
    <section className={`orb-stage jules-stage status-${status} ${className}`} aria-label={`Voice status: ${STATUS_LABELS[status]}`}>
      <div className="orb-coordinates">
        <span>37.6° N</span>
        <span>JULES / RADIAL</span>
        <span>122.4° W</span>
      </div>
      <div ref={containerRef} className="jules-orb-container flex items-center justify-center relative">
        <canvas
          ref={canvasRef}
          className="pointer-events-none block"
          aria-hidden="true"
        />
      </div>
      <div className="orb-state">
        <span className="state-dot" />
        {STATUS_LABELS[status]}
      </div>
    </section>
  )
}
