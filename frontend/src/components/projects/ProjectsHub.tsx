import React, { useEffect, useMemo, useState } from 'react'
import {
  ArrowLeft,
  Clock,
  ExternalLink,
  FileCode,
  FolderGit2,
  FolderOpen,
  FolderPlus,
  HardDrive,
  Plus,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Sparkles,
  Trash2,
} from 'lucide-react'
import type { ProjectItem, ProjectStats } from '../../types/arix'

interface Props {
  onOpenProject: (project: ProjectItem) => void
  onBackToHome: () => void
}

export function ProjectsHub({ onOpenProject, onBackToHome }: Props) {
  const [projects, setProjects] = useState<ProjectItem[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [sortBy, setSortBy] = useState<'lastOpened' | 'name' | 'size' | 'files'>('lastOpened')
  const [refreshingId, setRefreshingId] = useState<string | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [errorBanner, setErrorBanner] = useState<string | null>(null)

  const loadProjects = async () => {
    try {
      setLoading(true)
      const res = await fetch('http://127.0.0.1:8765/api/projects')
      if (!res.ok) throw new Error(`HTTP error ${res.status}`)
      const data = await res.json()
      if (Array.isArray(data.projects)) {
        setProjects(data.projects)
      }
    } catch (err: any) {
      console.warn('Failed to load projects from backend:', err)
      // Fallback: try preload if available
      if (window.arixProjects?.getProjects) {
        try {
          const fallback = await window.arixProjects.getProjects()
          setProjects(fallback)
        } catch {}
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadProjects()
  }, [])

  const handleRefreshStats = async (project: ProjectItem, e: React.MouseEvent) => {
    e.stopPropagation()
    setRefreshingId(project.id)
    try {
      const res = await fetch('http://127.0.0.1:8765/api/projects/stats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: project.path, refresh: true }),
      })
      if (res.ok) {
        const data = await res.json()
        setProjects((prev) =>
          prev.map((p) => (p.id === project.id ? { ...p, stats: data.stats } : p)),
        )
      }
    } catch (err) {
      console.error('Failed to refresh stats:', err)
    } finally {
      setRefreshingId(null)
    }
  }

  const handleAddProject = async () => {
    setErrorBanner(null)
    let selectedPath: string | null = null
    if (window.arixProjects?.selectFolder) {
      selectedPath = await window.arixProjects.selectFolder()
    } else {
      selectedPath = prompt('Enter absolute directory path for the project:')
    }

    if (!selectedPath) return

    try {
      const res = await fetch('http://127.0.0.1:8765/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: selectedPath }),
      })
      const data = await res.json()
      if (!res.ok) {
        setErrorBanner(data.detail || 'Failed to add project.')
        return
      }
      await loadProjects()
    } catch (err: any) {
      setErrorBanner(`Error adding project: ${err.message}`)
    }
  }

  const handleRemoveProject = async (project: ProjectItem, e: React.MouseEvent) => {
    e.stopPropagation()
    if (project.isCore) return

    if (confirmDeleteId !== project.id) {
      setConfirmDeleteId(project.id)
      return
    }

    try {
      const res = await fetch(
        `http://127.0.0.1:8765/api/projects?path=${encodeURIComponent(project.path)}`,
        { method: 'DELETE' },
      )
      if (res.ok) {
        setProjects((prev) => prev.filter((p) => p.id !== project.id))
        setConfirmDeleteId(null)
      }
    } catch (err) {
      console.error('Failed to remove project:', err)
    }
  }

  const handleReveal = (project: ProjectItem, e: React.MouseEvent) => {
    e.stopPropagation()
    if (window.arixDesktop?.revealInFolder) {
      window.arixDesktop.revealInFolder(project.path)
    }
  }

  const filteredProjects = useMemo(() => {
    let list = [...projects]
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      list = list.filter(
        (p) => p.name.toLowerCase().includes(q) || p.path.toLowerCase().includes(q),
      )
    }

    list.sort((a, b) => {
      // Core project stays on top unless sorted strictly
      if (a.isCore && !b.isCore) return -1
      if (!a.isCore && b.isCore) return 1

      if (sortBy === 'name') {
        return a.name.localeCompare(b.name)
      }
      if (sortBy === 'size') {
        const sizeA = a.stats?.sizeBytes ?? 0
        const sizeB = b.stats?.sizeBytes ?? 0
        return sizeB - sizeA
      }
      if (sortBy === 'files') {
        const filesA = a.stats?.fileCount ?? 0
        const filesB = b.stats?.fileCount ?? 0
        return filesB - filesA
      }
      // default: lastOpened
      const timeA = a.lastOpened || 0
      const timeB = b.lastOpened || 0
      return timeB - timeA
    })

    return list
  }, [projects, searchQuery, sortBy])

  const [refreshingAll, setRefreshingAll] = useState(false)

  const handleRefreshAll = async () => {
    try {
      setRefreshingAll(true)
      const res = await fetch('http://127.0.0.1:8765/api/projects/stats/refresh-all', {
        method: 'POST',
      })
      if (res.ok) {
        await loadProjects()
      }
    } catch (err) {
      console.error('Failed to refresh all stats:', err)
    } finally {
      setRefreshingAll(false)
    }
  }

  const formatDate = (timestamp?: number) => {
    if (!timestamp) return 'Never opened'
    const date = new Date(timestamp)
    return date.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  return (
    <div className="projects-hub-container">
      {/* Top Header */}
      <header className="projects-header">
        <div className="projects-header-left">
          <button className="settings-back-button" onClick={onBackToHome} title="Return to Voice View">
            <ArrowLeft size={17} />
            <span>Back</span>
          </button>
          <div className="projects-title-meta">
            <div className="projects-eyebrow">
              <Sparkles size={13} />
              <span>AUTONOMOUS WORKSPACES</span>
            </div>
            <h1>Projects Hub</h1>
          </div>
        </div>

        <div className="projects-header-actions">
          <button
            className={`hub-refresh-all-btn ${refreshingAll ? 'spin' : ''}`}
            onClick={handleRefreshAll}
            title="Recalculate disk metrics for all projects"
          >
            <RefreshCw size={15} />
            <span>{refreshingAll ? 'Refreshing…' : 'Refresh All'}</span>
          </button>
          <button className="hub-add-btn" onClick={handleAddProject}>
            <FolderPlus size={16} />
            <span>Add Project</span>
          </button>
        </div>
      </header>

      {errorBanner && (
        <div className="hub-error-banner">
          <span>{errorBanner}</span>
          <button onClick={() => setErrorBanner(null)}>Dismiss</button>
        </div>
      )}

      {/* Filter and Search Bar */}
      <section className="projects-filter-bar">
        <div className="hub-search-box">
          <Search size={16} className="search-icon" />
          <input
            type="text"
            placeholder="Search projects by name or directory path…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button className="clear-search-btn" onClick={() => setSearchQuery('')}>
              ×
            </button>
          )}
        </div>

        <div className="hub-sort-box">
          <SlidersHorizontal size={15} />
          <label htmlFor="hub-sort-select">Sort by:</label>
          <select
            id="hub-sort-select"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as any)}
          >
            <option value="lastOpened">Recent</option>
            <option value="name">Name</option>
            <option value="size">Size</option>
            <option value="files">File count</option>
          </select>
        </div>
      </section>

      {/* Projects Grid */}
      <main className="projects-grid-area">
        {loading && projects.length === 0 ? (
          <div className="hub-loading-state">
            <RefreshCw className="spin" size={24} />
            <p>Scanning projects and calculating disk metrics…</p>
          </div>
        ) : filteredProjects.length === 0 ? (
          <div className="hub-empty-state">
            <img src="/assets/empty-projects.svg" alt="No projects" className="empty-illustration" />
            <h3>No matching projects found</h3>
            <p>
              {searchQuery
                ? 'Try a different search keyword or clear the search query.'
                : 'Add a local directory to begin working with the Coder Agent and Direct Assistant.'}
            </p>
            <button className="hub-add-btn primary" onClick={handleAddProject}>
              <FolderPlus size={16} />
              <span>Add Your First Project</span>
            </button>
          </div>
        ) : (
          <div className="projects-grid">
            {filteredProjects.map((project) => {
              const isDeleting = confirmDeleteId === project.id
              return (
                <div
                  key={project.id}
                  className={`project-card ${project.isCore ? 'core-card' : ''}`}
                  onClick={() => onOpenProject(project)}
                >
                  <div className="card-top-row">
                    <div className="card-avatar-wrap">
                      <img
                        src={project.isCore ? '/assets/project-core.svg' : '/assets/project-default.svg'}
                        alt={project.name}
                        className="project-avatar-svg"
                      />
                    </div>
                    <div className="card-badges">
                      {project.isCore ? (
                        <span className="core-badge">
                          <Sparkles size={11} />
                          <span>Core System</span>
                        </span>
                      ) : (
                        <span className="workspace-badge">
                          <FolderGit2 size={11} />
                          <span>Local</span>
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="card-info">
                    <h3 className="project-card-title" title={project.name}>
                      {project.name}
                    </h3>
                    <p className="project-card-path" title={project.path}>
                      {project.path}
                    </p>
                  </div>

                  <div className="card-stats-grid">
                    <div className="stat-pill" title="Total code size">
                      <HardDrive size={13} />
                      <span>{project.stats?.humanSize || 'Calculating…'}</span>
                    </div>
                    <div className="stat-pill" title="File count">
                      <FileCode size={13} />
                      <span>{project.stats?.fileCount ?? 0} files</span>
                    </div>
                    <div className="stat-pill" title="Folder count">
                      <FolderOpen size={13} />
                      <span>{project.stats?.folderCount ?? 0} dirs</span>
                    </div>
                    <div className="stat-pill" title="Last opened">
                      <Clock size={13} />
                      <span>{formatDate(project.lastOpened)}</span>
                    </div>
                  </div>

                  <div className="card-footer" onClick={(e) => e.stopPropagation()}>
                    <button
                      className="card-open-btn"
                      onClick={() => onOpenProject(project)}
                      title="Open full IDE workspace"
                    >
                      <span>Open Workspace</span>
                    </button>

                    <button
                      className="card-icon-btn"
                      onClick={(e) => handleReveal(project, e)}
                      title="Reveal in Explorer"
                    >
                      <ExternalLink size={15} />
                    </button>

                    <button
                      className={`card-icon-btn ${refreshingId === project.id ? 'spin' : ''}`}
                      onClick={(e) => handleRefreshStats(project, e)}
                      title="Refresh disk metrics"
                    >
                      <RefreshCw size={15} />
                    </button>

                    {!project.isCore && (
                      <button
                        className={`card-icon-btn delete-btn ${isDeleting ? 'confirm' : ''}`}
                        onClick={(e) => handleRemoveProject(project, e)}
                        title={isDeleting ? 'Click again to confirm removal' : 'Remove from hub'}
                      >
                        <Trash2 size={15} />
                      </button>
                    )}
                  </div>
                </div>
              )
            })}

            {/* Quick Add Project Card */}
            <div className="project-card add-card" onClick={handleAddProject}>
              <div className="add-card-content">
                <div className="add-icon-circle">
                  <Plus size={28} />
                </div>
                <h3>Add New Project</h3>
                <p>Select any local repository or directory to launch an autonomous workspace</p>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
