import React, { useEffect, useState } from 'react'
import { FolderGit2, FolderOpen, Sparkles } from 'lucide-react'
import type { ProjectItem } from '../../types/arix'

interface Props {
  currentProject: ProjectItem
  onSwitchProject: (project: ProjectItem) => void
}

export function ProjectsSwitcherTab({ currentProject, onSwitchProject }: Props) {
  const [projects, setProjects] = useState<ProjectItem[]>([])

  useEffect(() => {
    fetch('http://127.0.0.1:8765/api/projects')
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data.projects)) {
          setProjects(data.projects)
        }
      })
      .catch((err) => console.error('Error fetching switcher projects:', err))
  }, [])

  return (
    <div className="projects-switcher-container">
      <div className="switcher-header">
        <span>Active Workspaces</span>
      </div>
      <div className="switcher-list">
        {projects.map((p) => {
          const isActive = p.id === currentProject.id || p.path === currentProject.path
          return (
            <div
              key={p.id}
              className={`switcher-item ${isActive ? 'active' : ''}`}
              onClick={() => onSwitchProject(p)}
            >
              <div className="switcher-icon">
                {p.isCore ? <Sparkles size={14} /> : <FolderGit2 size={14} />}
              </div>
              <div className="switcher-info">
                <span className="switcher-name">{p.name}</span>
                <span className="switcher-path">{p.path}</span>
              </div>
              {isActive && <span className="current-dot" title="Current Workspace" />}
            </div>
          )
        })}
      </div>
    </div>
  )
}
