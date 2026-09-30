import React, { useEffect, useRef } from 'react'
import * as THREE from 'three'
import type { OrbProps } from './types'
import { STATUS_LABELS } from './types'
import type { PipelineStatus } from '../../types/arix'

interface ThemeColors {
  core: number
  glow: number
  accent: number
  ring: number
  ray: number
  particle: number
  bar: number
  network: number
}

const THEMES: Record<PipelineStatus, ThemeColors> = {
  offline: {
    core: 0xffffff,
    glow: 0x64748b,
    accent: 0x94a3b8,
    ring: 0x475569,
    ray: 0x94a3b8,
    particle: 0xcfd8dc,
    bar: 0x64748b,
    network: 0x475569,
  },
  connecting: {
    core: 0xffffff,
    glow: 0xfbbf24,
    accent: 0xf59e0b,
    ring: 0xfcd34d,
    ray: 0xfde68a,
    particle: 0xfef3c7,
    bar: 0xf59e0b,
    network: 0xfbbf24,
  },
  listening: {
    core: 0xffffff,
    glow: 0x22d3ee,
    accent: 0x38bdf8,
    ring: 0x67e8f9,
    ray: 0x7dd3fc,
    particle: 0xe0f2fe,
    bar: 0x06b6d4,
    network: 0x0ea5e9,
  },
  processing: {
    core: 0xffffff,
    glow: 0xc084fc,
    accent: 0xa855f7,
    ring: 0xd8b4fe,
    ray: 0xe9d5ff,
    particle: 0xf3e8ff,
    bar: 0x9333ea,
    network: 0x7e22ce,
  },
  speaking: {
    core: 0xffffff,
    glow: 0x4ade80,
    accent: 0x22c55e,
    ring: 0x86efac,
    ray: 0xbbf7d0,
    particle: 0xdcfce7,
    bar: 0x16a34a,
    network: 0x15803d,
  },
  error: {
    core: 0xffffff,
    glow: 0xf43f5e,
    accent: 0xe11d48,
    ring: 0xfb7185,
    ray: 0xfecdd3,
    particle: 0xffe4e6,
    bar: 0xbe123c,
    network: 0x9f1239,
  },
}

// Procedural Canvas Textures
function makeCanvas(size: number) {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas context failure')
  return { canvas, ctx, size }
}

function createGlowTexture(size = 256): THREE.CanvasTexture {
  const { canvas, ctx } = makeCanvas(size)
  const cx = size / 2
  const cy = size / 2
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, cx)
  g.addColorStop(0, 'rgba(255,255,255,1)')
  g.addColorStop(0.12, 'rgba(255,255,255,0.92)')
  g.addColorStop(0.3, 'rgba(200,240,255,0.4)')
  g.addColorStop(0.55, 'rgba(120,200,255,0.12)')
  g.addColorStop(0.8, 'rgba(60,140,255,0.03)')
  g.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, size, size)
  const tex = new THREE.CanvasTexture(canvas)
  tex.needsUpdate = true
  return tex
}

function createFlareTexture(size = 512): THREE.CanvasTexture {
  const { canvas, ctx } = makeCanvas(size)
  const cx = size / 2
  const cy = size / 2

  const streak = (x0: number, y0: number, x1: number, y1: number, width: number, alpha: number) => {
    ctx.save()
    ctx.strokeStyle = `rgba(255,255,255,${alpha})`
    ctx.lineWidth = width
    ctx.lineCap = 'round'
    ctx.shadowColor = 'rgba(255,255,255,0.85)'
    ctx.shadowBlur = width * 2
    ctx.beginPath()
    ctx.moveTo(x0, y0)
    ctx.lineTo(x1, y1)
    ctx.stroke()
    ctx.restore()
  }

  streak(8, cy, size - 8, cy, 2.2, 0.55)
  streak(size * 0.18, cy, size * 0.82, cy, 6, 0.18)
  streak(cx, 10, cx, size - 10, 1.6, 0.42)
  streak(cx, size * 0.22, cx, size * 0.78, 4.5, 0.12)

  const diag = size * 0.28
  streak(cx - diag, cy - diag, cx + diag, cy + diag, 1.2, 0.22)
  streak(cx - diag, cy + diag, cx + diag, cy - diag, 1.2, 0.18)

  const rg = ctx.createRadialGradient(cx, cy, 0, cx, cy, size * 0.22)
  rg.addColorStop(0, 'rgba(255,255,255,1)')
  rg.addColorStop(0.25, 'rgba(255,255,255,0.7)')
  rg.addColorStop(0.55, 'rgba(200,230,255,0.15)')
  rg.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = rg
  ctx.fillRect(0, 0, size, size)

  const tex = new THREE.CanvasTexture(canvas)
  tex.needsUpdate = true
  return tex
}

function createHexGlowTexture(size = 256): THREE.CanvasTexture {
  const { canvas, ctx, size: s } = makeCanvas(size)
  const cx = s / 2
  const cy = s / 2
  const r = s * 0.38
  ctx.strokeStyle = 'rgba(255,255,255,0.85)'
  ctx.lineWidth = 3
  ctx.shadowColor = 'rgba(180,240,255,0.9)'
  ctx.shadowBlur = 18
  ctx.beginPath()
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i - Math.PI / 6
    const x = cx + Math.cos(a) * r
    const y = cy + Math.sin(a) * r
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.closePath()
  ctx.stroke()

  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 1.2)
  g.addColorStop(0, 'rgba(255,255,255,0.35)')
  g.addColorStop(0.6, 'rgba(255,255,255,0.05)')
  g.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = g
  ctx.fill()

  const tex = new THREE.CanvasTexture(canvas)
  tex.needsUpdate = true
  return tex
}

const RING_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

const RING_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uTime;
uniform float uAudio;
uniform float uOpacity;
uniform float uDashes;
varying vec2 vUv;
void main() {
  float pattern = fract(vUv.x * uDashes - uTime * (0.35 + uAudio * 1.8));
  float dash = smoothstep(0.0, 0.06, pattern) * smoothstep(0.58, 0.48, pattern);
  float edge = smoothstep(0.0, 0.28, vUv.y) * smoothstep(1.0, 0.72, vUv.y);
  float glow = 0.55 + uAudio * 0.9;
  gl_FragColor = vec4(uColor * glow, dash * edge * uOpacity);
}
`

function ellipsePath(rx: number, ry: number, segments = 120): THREE.CatmullRomCurve3 {
  const pts: THREE.Vector3[] = []
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2
    pts.push(new THREE.Vector3(Math.cos(a) * rx, Math.sin(a) * ry, 0))
  }
  return new THREE.CatmullRomCurve3(pts, true)
}

function fibonacciSphere(n: number, radius: number): THREE.Vector3[] {
  const pts: THREE.Vector3[] = []
  const phi = Math.PI * (3 - Math.sqrt(5))
  for (let i = 0; i < n; i++) {
    const y = 1 - (i / (n - 1)) * 2
    const r = Math.sqrt(Math.max(0, 1 - y * y))
    const theta = phi * i
    pts.push(new THREE.Vector3(Math.cos(theta) * r * radius, y * radius, Math.sin(theta) * r * radius))
  }
  return pts
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t
}

interface Particle {
  x: number
  y: number
  z: number
  vx: number
  vy: number
  vz: number
  rx: number
  ry: number
  rz: number
  rvx: number
  rvy: number
  rvz: number
  scale: number
  seed: number
}

interface Ray {
  dir: THREE.Vector3
  offset: number
  speed: number
  length: number
  inner: number
}

import { ORB_TOKENS } from '../../lib/orbTokens'

export function QuantumOrb({ status, level, size: propSize, className = '' }: OrbProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const statusRef = useRef(status)
  const levelRef = useRef(level)

  statusRef.current = status
  levelRef.current = level

  useEffect(() => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container) return

    let disposed = false
    let rafId = 0

    // WebGL Renderer with full transparency
    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    renderer.setClearColor(0x000000, 0) // PURE TRANSPARENT BACKGROUND
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.05

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(46, 1, 0.1, 100)
    camera.position.set(0, 0, 10.6)

    const isOverlayOrSmall = Boolean(propSize && propSize <= 220)
    const baseScale = isOverlayOrSmall ? ORB_TOKENS.quantum.rootScaleOverlay : ORB_TOKENS.quantum.rootScaleHome

    const root = new THREE.Group()
    root.scale.setScalar(baseScale)
    const coreGroup = new THREE.Group()
    scene.add(root)
    root.add(coreGroup)

    let theme = THEMES[statusRef.current] ?? THEMES.offline

    // Textures
    const glowTex = createGlowTexture(256)
    const flareTex = createFlareTexture(512)
    const hexTex = createHexGlowTexture(256)

    // Central Sphere & Glow
    const coreGeo = new THREE.SphereGeometry(0.2, 32, 32)
    const coreMat = new THREE.MeshBasicMaterial({ color: 0xffffff })
    const coreSphere = new THREE.Mesh(coreGeo, coreMat)
    coreGroup.add(coreSphere)

    const innerGlowGeo = new THREE.SphereGeometry(0.44, 24, 24)
    const innerGlowMat = new THREE.MeshBasicMaterial({
      color: theme.glow,
      transparent: true,
      opacity: 0.45,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
    const innerGlow = new THREE.Mesh(innerGlowGeo, innerGlowMat)
    coreGroup.add(innerGlow)

    // Sprites
    const makeSprite = (map: THREE.Texture, color: number, scale: number, opacity: number) => {
      const mat = new THREE.SpriteMaterial({
        map,
        color,
        transparent: true,
        opacity,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
      const s = new THREE.Sprite(mat)
      s.scale.setScalar(scale)
      return s
    }

    const glowSprite = makeSprite(glowTex, theme.glow, 2.4, 0.6)
    const flareSprite = makeSprite(flareTex, 0xffffff, 2.7, 0.55)
    const hexSprite = makeSprite(hexTex, theme.glow, 1.6, 0.35)
    coreGroup.add(glowSprite, flareSprite, hexSprite)

    // Concentric Icosahedrons (Tesseract Wireframes)
    const makeIco = (radius: number) => {
      const geo = new THREE.IcosahedronGeometry(radius, 0)
      const edges = new THREE.EdgesGeometry(geo, 1)
      const mat = new THREE.LineBasicMaterial({
        color: theme.glow,
        transparent: true,
        opacity: 0.95,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
      geo.dispose()
      const segs = new THREE.LineSegments(edges, mat)
      segs.renderOrder = 5
      return segs
    }

    const icoOuter = makeIco(1.55)
    const icoInner = makeIco(0.92)
    ;(icoInner.material as THREE.LineBasicMaterial).color.setHex(theme.accent)
    coreGroup.add(icoOuter, icoInner)

    // Rotating Orbital Tube Rings
    interface RingObj {
      mesh: THREE.Mesh
      speed: number
      axis: THREE.Vector3
      mat: THREE.ShaderMaterial
    }
    const rings: RingObj[] = []
    const ringSpecs = [
      {
        path: ellipsePath(2.6, 1.15),
        radius: 0.038,
        dashes: 54,
        opacity: 0.85,
        rot: new THREE.Euler(0.72, 0.15, 0.2),
        speed: 0.18,
        axis: new THREE.Vector3(0.2, 1, 0.15).normalize(),
      },
      {
        path: ellipsePath(2.3, 0.95),
        radius: 0.032,
        dashes: 48,
        opacity: 0.72,
        rot: new THREE.Euler(-0.55, 0.4, -0.3),
        speed: -0.15,
        axis: new THREE.Vector3(-0.3, 1, 0.2).normalize(),
      },
    ]

    for (const spec of ringSpecs) {
      const geo = new THREE.TubeGeometry(spec.path, 120, spec.radius, 6, true)
      const mat = new THREE.ShaderMaterial({
        uniforms: {
          uColor: { value: new THREE.Color(theme.ring) },
          uTime: { value: 0 },
          uAudio: { value: 0 },
          uOpacity: { value: spec.opacity },
          uDashes: { value: spec.dashes },
        },
        vertexShader: RING_VERT,
        fragmentShader: RING_FRAG,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      })
      const mesh = new THREE.Mesh(geo, mat)
      mesh.rotation.copy(spec.rot)
      root.add(mesh)
      rings.push({ mesh, speed: spec.speed, axis: spec.axis, mat })
    }

    // Radiating Rays
    const rayCount = 80
    const rays: Ray[] = []
    const rayPositions = new Float32Array(rayCount * 6)
    for (let i = 0; i < rayCount; i++) {
      const y = 1 - (i / (rayCount - 1)) * 2
      const r = Math.sqrt(Math.max(0, 1 - y * y))
      const theta = Math.PI * (3 - Math.sqrt(5)) * i
      const dir = new THREE.Vector3(Math.cos(theta) * r, y, Math.sin(theta) * r).normalize()
      const ray: Ray = {
        dir,
        offset: Math.random() * 5,
        speed: 1.5 + Math.random() * 2.0,
        length: 1.6 + Math.random() * 1.4,
        inner: 1.2 + Math.random() * 0.3,
      }
      rays.push(ray)
      const inner = ray.inner
      const outer = inner + ray.length
      rayPositions[i * 6] = dir.x * inner
      rayPositions[i * 6 + 1] = dir.y * inner
      rayPositions[i * 6 + 2] = dir.z * inner
      rayPositions[i * 6 + 3] = dir.x * outer
      rayPositions[i * 6 + 4] = dir.y * outer
      rayPositions[i * 6 + 5] = dir.z * outer
    }
    const rayGeo = new THREE.BufferGeometry()
    rayGeo.setAttribute('position', new THREE.BufferAttribute(rayPositions, 3))
    const rayMat = new THREE.LineDashedMaterial({
      color: theme.ray,
      transparent: true,
      opacity: 0.35,
      dashSize: 0.32,
      gapSize: 0.42,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
    const rayLines = new THREE.LineSegments(rayGeo, rayMat)
    rayLines.computeLineDistances()
    root.add(rayLines)

    // Instanced Particles
    const particleCount = 130
    const dummy = new THREE.Object3D()
    const pGeo = new THREE.PlaneGeometry(0.12, 0.12)
    const pMat = new THREE.MeshBasicMaterial({
      color: theme.particle,
      transparent: true,
      opacity: 0.72,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    })
    const particleMesh = new THREE.InstancedMesh(pGeo, pMat, particleCount)
    particleMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)

    const particles: Particle[] = []
    const spawnParticle = (anywhere: boolean): Particle => {
      const r = anywhere ? 1.8 + Math.random() * 2.6 : 1.8 + Math.random() * 1.2
      const dir = new THREE.Vector3(
        Math.random() * 2 - 1,
        Math.random() * 2 - 1,
        Math.random() * 2 - 1
      ).normalize()
      return {
        x: dir.x * r,
        y: dir.y * r,
        z: dir.z * r,
        vx: (Math.random() - 0.5) * 0.2,
        vy: (Math.random() - 0.5) * 0.18,
        vz: (Math.random() - 0.5) * 0.2,
        rx: Math.random() * Math.PI * 2,
        ry: Math.random() * Math.PI * 2,
        rz: Math.random() * Math.PI * 2,
        rvx: (Math.random() - 0.5) * 1.0,
        rvy: (Math.random() - 0.5) * 1.0,
        rvz: (Math.random() - 0.5) * 1.0,
        scale: 0.4 + Math.random() * 0.9,
        seed: Math.random() * 100,
      }
    }

    for (let i = 0; i < particleCount; i++) {
      const p = spawnParticle(true)
      particles.push(p)
      dummy.position.set(p.x, p.y, p.z)
      dummy.rotation.set(p.rx, p.ry, p.rz)
      dummy.scale.setScalar(p.scale)
      dummy.updateMatrix()
      particleMesh.setMatrixAt(i, dummy.matrix)
    }
    root.add(particleMesh)

    // Fibonacci Network Nodes
    const nodes = fibonacciSphere(32, 3.8)
    const nodeGeo = new THREE.OctahedronGeometry(0.055, 0)
    const nodeMat = new THREE.MeshBasicMaterial({
      color: theme.glow,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
    const nodeMesh = new THREE.InstancedMesh(nodeGeo, nodeMat, nodes.length)
    for (let i = 0; i < nodes.length; i++) {
      dummy.position.copy(nodes[i])
      dummy.rotation.set(0, 0, 0)
      dummy.scale.setScalar(1)
      dummy.updateMatrix()
      nodeMesh.setMatrixAt(i, dummy.matrix)
    }
    root.add(nodeMesh)

    // Radial Visualizer Bars around perimeter
    const barCount = 48
    const barGeo = new THREE.BoxGeometry(0.042, 1, 0.042)
    barGeo.translate(0, 0.5, 0)
    const barMat = new THREE.MeshBasicMaterial({
      color: theme.bar,
      transparent: true,
      opacity: 0.75,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
    const barMesh = new THREE.InstancedMesh(barGeo, barMat, barCount)
    barMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    const barRadius = 2.3
    for (let i = 0; i < barCount; i++) {
      const a = (i / barCount) * Math.PI * 2
      dummy.position.set(Math.cos(a) * barRadius, Math.sin(a) * barRadius, 0)
      dummy.rotation.set(0, 0, a - Math.PI / 2)
      dummy.scale.set(1, 0.1, 1)
      dummy.updateMatrix()
      barMesh.setMatrixAt(i, dummy.matrix)
    }
    root.add(barMesh)

    // Wave Ribbon
    const waveN = 140
    const wavePos = new Float32Array(waveN * 3)
    for (let i = 0; i < waveN; i++) {
      const a = (i / waveN) * Math.PI * 2
      wavePos[i * 3] = Math.cos(a) * 1.95
      wavePos[i * 3 + 1] = Math.sin(a) * 1.95
      wavePos[i * 3 + 2] = 0
    }
    const waveGeo = new THREE.BufferGeometry()
    waveGeo.setAttribute('position', new THREE.BufferAttribute(wavePos, 3))
    const waveMat = new THREE.LineBasicMaterial({
      color: theme.accent,
      transparent: true,
      opacity: 0.55,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
    const waveLine = new THREE.LineLoop(waveGeo, waveMat)
    root.add(waveLine)

    // Light
    const pointLight = new THREE.PointLight(theme.glow, 7, 24, 1.6)
    scene.add(pointLight)

    // Sizing & Backing Resolution
    const handleResize = () => {
      const parent = containerRef.current
      if (!parent || !canvasRef.current) return
      const w = parent.clientWidth || (propSize || 560)
      const h = parent.clientHeight || (propSize || 460)
      const targetW = propSize ? propSize : Math.max(300, Math.min(w, ORB_TOKENS.quantum.maxBufferWidth))
      const targetH = propSize ? propSize : Math.max(260, Math.min(h, ORB_TOKENS.quantum.maxBufferHeight))
      renderer.setSize(targetW, targetH)
      camera.aspect = targetW / targetH
      camera.updateProjectionMatrix()
    }

    handleResize()
    const resizeObserver = new ResizeObserver(() => handleResize())
    resizeObserver.observe(container)

    // Audio & Motion State
    let smoothVol = 0
    let smoothBass = 0
    let smoothMid = 0
    let smoothTreble = 0
    let pulse = 0
    let lastTime = performance.now()
    let elapsed = 0

    const updateThemeColors = (st: PipelineStatus) => {
      theme = THEMES[st] ?? THEMES.offline
      pointLight.color.setHex(theme.glow)
      ;(icoOuter.material as THREE.LineBasicMaterial).color.setHex(theme.glow)
      ;(icoInner.material as THREE.LineBasicMaterial).color.setHex(theme.accent)
      glowSprite.material.color.setHex(theme.glow)
      hexSprite.material.color.setHex(theme.glow)
      rayMat.color.setHex(theme.ray)
      pMat.color.setHex(theme.particle)
      nodeMat.color.setHex(theme.glow)
      barMat.color.setHex(theme.bar)
      waveMat.color.setHex(theme.accent)
      innerGlowMat.color.setHex(theme.glow)
      for (const r of rings) {
        r.mat.uniforms.uColor.value.setHex(theme.ring)
      }
    }

    let currentStatus = statusRef.current
    let lastRenderTime = 0

    // Render Loop
    const animate = (now: number) => {
      if (disposed) return
      rafId = requestAnimationFrame(animate)

      // Section 8.4: Dynamic FPS throttle when idle (20-30fps) to keep GPU silent, 60fps when active
      const st = statusRef.current
      const isIdle = st === 'offline' || (st === 'listening' && smoothVol < 0.08)
      const targetFps = isIdle ? (isOverlayOrSmall ? 20 : 30) : 60
      const minInterval = 1000 / targetFps
      if (now - lastRenderTime < minInterval - 1) {
        return
      }
      lastRenderTime = now

      const dt = Math.min(0.048, (now - lastTime) * 0.001)
      lastTime = now
      elapsed += dt

      if (st !== currentStatus) {
        currentStatus = st
        updateThemeColors(st)
      }

      // Audio analysis simulation based on live level
      let targetVol = 0
      let targetBass = 0
      let targetMid = 0
      let targetTreble = 0

      if (st === 'speaking') {
        const speech = 0.45 + Math.abs(Math.sin(elapsed * 6.2)) * 0.35 + Math.abs(Math.sin(elapsed * 11.5)) * 0.2
        targetVol = Math.max(levelRef.current * 1.5, speech * 0.8)
        targetBass = targetVol * (0.6 + 0.4 * Math.sin(elapsed * 4))
        targetMid = targetVol * (0.5 + 0.5 * Math.cos(elapsed * 7))
        targetTreble = targetVol * (0.4 + 0.6 * Math.sin(elapsed * 12))
      } else if (st === 'processing') {
        targetVol = 0.28 + Math.abs(Math.sin(elapsed * 4)) * 0.18
        targetBass = 0.35 + Math.sin(elapsed * 3) * 0.15
        targetMid = 0.4 + Math.cos(elapsed * 5) * 0.2
        targetTreble = 0.35
      } else if (st === 'listening') {
        const lvl = levelRef.current
        targetVol = Math.pow(Math.min(1, lvl * 3.5), 0.8)
        targetBass = targetVol * 0.95
        targetMid = targetVol * 0.85
        targetTreble = targetVol * 0.75
      } else {
        // Idle gentle breathing
        const breath = 0.07 + 0.04 * (0.5 + 0.5 * Math.sin(elapsed * 0.85))
        targetVol = breath
        targetBass = breath * 0.8
        targetMid = breath * 0.5
        targetTreble = breath * 0.3
      }

      smoothVol = lerp(smoothVol, targetVol, dt * 8)
      smoothBass = lerp(smoothBass, targetBass, dt * 9)
      smoothMid = lerp(smoothMid, targetMid, dt * 8)
      smoothTreble = lerp(smoothTreble, targetTreble, dt * 8)

      if (smoothVol > 0.32 && Math.random() < 0.06) {
        pulse = 1
      }
      pulse *= Math.pow(0.12, dt)

      const v = smoothVol
      const energy = v * 0.7 + smoothBass * 0.3

      // Rotations
      root.rotation.y += dt * (0.06 + smoothMid * 0.35)
      coreGroup.rotation.y += dt * (0.2 + energy * 1.5)
      coreGroup.rotation.x += dt * (0.08 + smoothTreble * 0.4)
      icoInner.rotation.y -= dt * (0.35 + energy * 1.2)
      icoInner.rotation.z += dt * 0.14

      // Scale pulses
      const coreScale = 1 + smoothBass * 0.32 + pulse * 0.22
      icoOuter.scale.setScalar(coreScale)
      coreSphere.scale.setScalar(1 + v * 0.9 + pulse * 0.5)
      innerGlow.scale.setScalar(1 + v * 0.6 + pulse * 0.3)
      glowSprite.scale.setScalar(2.0 + v * 2.0 + pulse * 0.9)
      flareSprite.scale.setScalar(2.4 + v * 1.8 + pulse * 0.7)
      flareSprite.material.rotation = elapsed * 0.1
      hexSprite.scale.setScalar(1.5 + smoothBass * 0.8)
      hexSprite.material.rotation = -elapsed * 0.18
      pointLight.intensity = 4 + v * 8 + pulse * 4

      // Rings update
      for (const ring of rings) {
        ring.mesh.rotateOnAxis(ring.axis, dt * ring.speed * (1 + smoothMid * 2.4))
        ring.mesh.scale.setScalar(1 + smoothBass * 0.09 + pulse * 0.07)
        ring.mat.uniforms.uTime.value = elapsed
        ring.mat.uniforms.uAudio.value = energy
      }

      // Radiating Rays update
      const rayArr = (rayGeo.attributes.position as THREE.BufferAttribute).array as Float32Array
      const raySpeed = 0.5 + v * 6 + pulse * 4
      for (let i = 0; i < rays.length; i++) {
        const r = rays[i]
        r.offset += r.speed * dt * raySpeed * 0.35
        if (r.offset > 5.5) r.offset -= 5.5
        const inner = r.inner + r.offset
        const outer = inner + r.length
        rayArr[i * 6] = r.dir.x * inner
        rayArr[i * 6 + 1] = r.dir.y * inner
        rayArr[i * 6 + 2] = r.dir.z * inner
        rayArr[i * 6 + 3] = r.dir.x * outer
        rayArr[i * 6 + 4] = r.dir.y * outer
        rayArr[i * 6 + 5] = r.dir.z * outer
      }
      rayGeo.attributes.position.needsUpdate = true
      rayLines.computeLineDistances()
      rayMat.opacity = 0.2 + v * 0.4 + smoothTreble * 0.25

      // Particles drift and burst outward with voice
      const outward = 0.3 + v * 5.2 + pulse * 7
      for (let i = 0; i < particles.length; i++) {
        const p = particles[i]
        const dist = Math.hypot(p.x, p.y, p.z) || 1
        p.x += (p.vx + (p.x / dist) * outward * 0.14) * dt
        p.y += (p.vy + (p.y / dist) * outward * 0.14) * dt
        p.z += (p.vz + (p.z / dist) * outward * 0.14) * dt
        p.rx += p.rvx * dt
        p.ry += p.rvy * dt
        p.rz += p.rvz * dt
        if (Math.hypot(p.x, p.y, p.z) > 7.5) {
          const n = spawnParticle(false)
          particles[i] = n
          Object.assign(p, n)
        }
        const s = p.scale * (1 + smoothTreble * 0.45 + Math.sin(elapsed * 2.5 + p.seed) * 0.1)
        dummy.position.set(p.x, p.y, p.z)
        dummy.rotation.set(p.rx, p.ry, p.rz)
        dummy.scale.setScalar(s)
        dummy.updateMatrix()
        particleMesh.setMatrixAt(i, dummy.matrix)
      }
      particleMesh.instanceMatrix.needsUpdate = true

      // Fibonacci nodes
      const netScale = 1 + smoothBass * 0.14 + pulse * 0.09
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i]
        const nodePulse = 1 + Math.sin(elapsed * 2.5 + i) * 0.16 + v * 0.55
        dummy.position.set(n.x * netScale, n.y * netScale, n.z * netScale)
        dummy.rotation.set(elapsed * 0.3, elapsed * 0.2, 0)
        dummy.scale.setScalar(nodePulse)
        dummy.updateMatrix()
        nodeMesh.setMatrixAt(i, dummy.matrix)
      }
      nodeMesh.instanceMatrix.needsUpdate = true

      // Wave Ribbon deform
      const waveArr = (waveGeo.attributes.position as THREE.BufferAttribute).array as Float32Array
      const amp = 0.16 + v * 1.6
      for (let i = 0; i < waveN; i++) {
        const a = (i / waveN) * Math.PI * 2
        const harmonic =
          Math.sin(a * 4 + elapsed * 3.5) * 0.5 +
          Math.sin(a * 8 - elapsed * 2.2) * 0.3 +
          Math.sin(a * 12 + elapsed * 5.1) * 0.2
        const r = 2.15 + harmonic * amp + pulse * 0.08
        waveArr[i * 3] = Math.cos(a) * r
        waveArr[i * 3 + 1] = Math.sin(a) * r
        waveArr[i * 3 + 2] = Math.sin(a * 3 + elapsed * 2) * 0.1 * smoothTreble
      }
      waveGeo.attributes.position.needsUpdate = true

      // Bars around perimeter
      for (let i = 0; i < barCount; i++) {
        const a = (i / barCount) * Math.PI * 2 + elapsed * 0.08
        const waveH =
          Math.abs(Math.sin(i * 0.65 + elapsed * 4)) * 0.55 +
          Math.abs(Math.sin(i * 1.3 - elapsed * 2.5)) * 0.45
        const h = Math.max(0.08, 0.08 + waveH * (v * 1.6 + 0.1))
        dummy.position.set(Math.cos(a) * (barRadius + smoothBass * 0.12), Math.sin(a) * (barRadius + smoothBass * 0.12), 0)
        dummy.rotation.set(0, 0, a - Math.PI / 2)
        dummy.scale.set(1, h, 1)
        dummy.updateMatrix()
        barMesh.setMatrixAt(i, dummy.matrix)
      }
      barMesh.instanceMatrix.needsUpdate = true
      barMesh.rotation.z = elapsed * 0.06

      // Camera gentle breath
      camera.position.z = 10.6 - v * 0.4 - pulse * 0.2
      camera.lookAt(0, 0, 0)

      // Direct WebGL render with transparent alpha clear
      renderer.render(scene, camera)
    }

    rafId = requestAnimationFrame(animate)

    return () => {
      disposed = true
      cancelAnimationFrame(rafId)
      resizeObserver.disconnect()

      // Comprehensive GPU memory cleanup
      scene.traverse((obj) => {
        const mesh = obj as THREE.Mesh
        if (mesh.geometry) mesh.geometry.dispose()
        const mat = mesh.material
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose())
        else if (mat) mat.dispose()
      })

      glowTex.dispose()
      flareTex.dispose()
      hexTex.dispose()
      renderer.dispose()
    }
  }, [propSize])

  return (
    <section className={`orb-stage quantum-stage status-${status} ${className}`} aria-label={`Voice status: ${STATUS_LABELS[status]}`}>
      <div className="orb-coordinates">
        <span>37.6° N</span>
        <span>QUANTUM / 3D WEBGL</span>
        <span>122.4° W</span>
      </div>
      <div ref={containerRef} className="quantum-orb-container flex items-center justify-center relative">
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
