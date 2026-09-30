import React from 'react'
import { Sparkles, Layers, Box, Check } from 'lucide-react'
import { ORB_MODELS, type OrbModel } from './types'

interface Props {
  selectedModel: OrbModel
  onSelectModel: (model: OrbModel) => void
  compact?: boolean
}

export function OrbModelSelector({ selectedModel, onSelectModel, compact = false }: Props) {
  const getIcon = (id: OrbModel) => {
    switch (id) {
      case 'classic':
        return <Layers size={18} className="text-cyan-400" />
      case 'jules':
        return <Sparkles size={18} className="text-emerald-400" />
      case 'quantum':
        return <Box size={18} className="text-violet-400" />
    }
  }

  const getEngineBadgeClass = (engine: string) => {
    if (engine.includes('CSS')) return 'badge-css'
    if (engine.includes('Canvas')) return 'badge-canvas'
    return 'badge-webgl'
  }

  if (compact) {
    return (
      <div className="orb-model-compact-grid">
        {ORB_MODELS.map((m) => {
          const active = selectedModel === m.id
          return (
            <button
              key={m.id}
              type="button"
              onClick={() => onSelectModel(m.id)}
              className={`orb-compact-btn ${active ? 'active' : ''}`}
              title={m.description}
            >
              <span className="compact-icon">{getIcon(m.id)}</span>
              <span className="compact-title">{m.name}</span>
              {active && <Check size={13} className="text-cyan-400 ml-auto" />}
            </button>
          )
        })}
      </div>
    )
  }

  return (
    <div className="orb-model-selector-grid">
      {ORB_MODELS.map((model) => {
        const isSelected = selectedModel === model.id
        return (
          <div
            key={model.id}
            onClick={() => onSelectModel(model.id)}
            className={`orb-model-card ${isSelected ? 'selected' : ''}`}
            role="radio"
            aria-checked={isSelected}
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onSelectModel(model.id)
              }
            }}
          >
            <div className="card-top">
              <div className="model-icon-box">
                {getIcon(model.id)}
              </div>
              <div className="model-headings">
                <div className="model-title-row">
                  <h3 className="model-name">{model.name}</h3>
                  <span className={`engine-badge ${getEngineBadgeClass(model.engine)}`}>
                    {model.engine}
                  </span>
                </div>
                <span className="model-subtitle">{model.subtitle}</span>
              </div>
              <div className={`radio-dot ${isSelected ? 'active' : ''}`}>
                {isSelected && <span className="inner-dot" />}
              </div>
            </div>

            <p className="model-desc">{model.description}</p>

            <ul className="model-features">
              {model.features.map((feat, idx) => (
                <li key={idx}>
                  <Check size={12} className="feat-check" />
                  <span>{feat}</span>
                </li>
              ))}
            </ul>
          </div>
        )
      })}
    </div>
  )
}
