import React, { useEffect, useState } from 'react'
import type { PipelineStatus, OrbModel } from '../types/arix'
import { ClassicOrb } from './orbs/ClassicOrb'
import { JulesOrb } from './orbs/JulesOrb'
import { QuantumOrb } from './orbs/QuantumOrb'

export interface AudioOrbProps {
  status: PipelineStatus
  level: number
  model?: OrbModel
  size?: number
  className?: string
}

/** Global helper to broadcast orb model changes across tabs and components */
export function setAppOrbModel(model: OrbModel) {
  try {
    localStorage.setItem('arix_orb_model', model)
  } catch {}
  window.dispatchEvent(new CustomEvent('arix_orb_model_changed', { detail: model }))
}

export function getAppOrbModel(): OrbModel {
  try {
    const saved = localStorage.getItem('arix_orb_model') as OrbModel | null
    if (saved && ['classic', 'jules', 'quantum'].includes(saved)) {
      return saved
    }
  } catch {}
  return 'classic'
}

export function AudioOrb({ status, level, model: propModel, size, className = '' }: AudioOrbProps) {
  const [activeModel, setActiveModel] = useState<OrbModel>(() => propModel || getAppOrbModel())

  useEffect(() => {
    if (propModel) {
      setActiveModel(propModel)
    }
  }, [propModel])

  useEffect(() => {
    const handleModelChange = (e: Event) => {
      const customEvent = e as CustomEvent<OrbModel>
      if (customEvent.detail && ['classic', 'jules', 'quantum'].includes(customEvent.detail)) {
        setActiveModel(customEvent.detail)
      } else {
        setActiveModel(getAppOrbModel())
      }
    }

    window.addEventListener('arix_orb_model_changed', handleModelChange)
    window.addEventListener('storage', handleModelChange)
    return () => {
      window.removeEventListener('arix_orb_model_changed', handleModelChange)
      window.removeEventListener('storage', handleModelChange)
    }
  }, [])

  switch (activeModel) {
    case 'jules':
      return <JulesOrb status={status} level={level} size={size} className={className} />
    case 'quantum':
      return <QuantumOrb status={status} level={level} size={size} className={className} />
    case 'classic':
    default:
      return <ClassicOrb status={status} level={level} size={size} className={className} />
  }
}
