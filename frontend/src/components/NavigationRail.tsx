import { Blocks, BrainCircuit, Clock3, FolderKanban, Home, MessageSquareText, Settings2 } from 'lucide-react'

export type WorkspaceView = 'voice' | 'memory' | 'code' | 'settings' | 'workspace'

interface Props {
  activeView: WorkspaceView
  onNavigate: (view: WorkspaceView) => void
  onSettings: () => void
}

const nav = [
  { icon: Home, label: 'Home', view: 'voice' as const },
  { icon: FolderKanban, label: 'Code Workspaces', view: 'code' as const },
  { icon: BrainCircuit, label: 'Memory Graph', view: 'memory' as const },
  { icon: MessageSquareText, label: 'Conversations', disabled: true },
  { icon: Clock3, label: 'Activity', disabled: true },
  { icon: Blocks, label: 'Tools', disabled: true },
]

export function NavigationRail({ activeView, onNavigate, onSettings }: Props) {
  return (
    <nav className="navigation-rail" aria-label="Primary navigation">
      <div className="rail-logo">A</div>
      <div className="rail-items">
        {nav.map(({ icon: Icon, label, view, disabled }) => {
          const isActive =
            Boolean(view) &&
            (view === activeView || (view === 'code' && activeView === 'workspace'))

          return (
            <button
              className={`rail-button ${isActive ? 'active' : ''}`}
              disabled={disabled}
              aria-label={label}
              data-view={view}
              title={disabled ? `${label} — coming soon` : label}
              onClick={() => view && onNavigate(view)}
              key={label}
            >
              <Icon size={19} strokeWidth={1.8} />
              <span className="rail-tooltip">{label}</span>
            </button>
          )
        })}
      </div>
      <button
        className={`rail-button ${activeView === 'settings' ? 'active' : ''}`}
        onClick={onSettings}
        title="Settings"
        aria-label="Settings"
        data-view="settings"
        id="rail-settings-btn"
      >
        <Settings2 size={19} />
        <span className="rail-tooltip">Settings</span>
      </button>
    </nav>
  )
}
