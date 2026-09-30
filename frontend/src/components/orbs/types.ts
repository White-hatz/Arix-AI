import type { PipelineStatus, OrbModel } from '../../types/arix'

export type { OrbModel }

export interface OrbProps {
  status: PipelineStatus
  level: number
  size?: number
  className?: string
}

export interface OrbModelInfo {
  id: OrbModel
  name: string
  subtitle: string
  engine: 'CSS HUD' | 'Canvas 2D' | 'Three.js WebGL'
  description: string
  features: string[]
}

export const ORB_MODELS: OrbModelInfo[] = [
  {
    id: 'classic',
    name: 'Cyber HUD Orb',
    subtitle: 'Classic Precision Telemetry',
    engine: 'CSS HUD',
    description: 'Tactical holographic telemetry with rotating coordinate rings, radar ticks, and digital frequency bars.',
    features: ['Ultra-lightweight CSS transitions', 'Coordinate telemetry readout', 'Cybernetic rotating reticles'],
  },
  {
    id: 'jules',
    name: 'Jules Radial Canvas',
    subtitle: 'Harmonic Kinetic Sphere',
    engine: 'Canvas 2D',
    description: 'Fluid multi-layer canvas orb featuring counter-rotating arc rings, reactive harmonic waveforms, orbital motes, and bottom spectrum audio meter.',
    features: ['Triple harmonic radial waveforms', '60fps eased state transitions', 'Symmetric audio frequency meter'],
  },
  {
    id: 'quantum',
    name: 'Quantum WebGL Orb',
    subtitle: 'Volumetric Neural Core',
    engine: 'Three.js WebGL',
    description: 'Volumetric 3D neural core with dual tesseract wireframe cages, dashed orbit rings, Fibonacci point clouds, and dynamic particle bursts.',
    features: ['Dual icosahedron tesseract core', 'Dashed 3D orbital trajectory rings', 'Reactive Fibonacci neural node mesh'],
  },
]

export const STATUS_LABELS: Record<PipelineStatus, string> = {
  offline: 'STANDBY',
  connecting: 'CONNECTING',
  listening: 'LISTENING',
  processing: 'PROCESSING',
  speaking: 'SPEAKING',
  error: 'LINK ERROR',
}
