import {
  BarChart3,
  Bell,
  ChevronDown,
  ChevronRight,
  Cloud,
  Copy,
  FileBarChart,
  FileInput,
  Folder,
  FolderInput,
  FolderOpen,
  FolderPlus,
  FolderSync,
  Home,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Sparkles,
  Star,
  Trash2,
  RefreshCw,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import type {
  DashboardRecord,
  LibraryFolderRecord,
  LibrarySelection,
  LibraryStore,
  ProjectRecord,
} from './model'

type TreeItemKind = 'folder' | 'project' | 'dashboard'

interface LibrarySidebarProps {
  store: LibraryStore
  updateAvailable: boolean
  onSelect: (selection: LibrarySelection) => void
  onCreateFolder: (parentId: string | null) => void
  onCreateProject: (folderId: string | null) => void
  onCreateDashboard: (projectId: string) => void
  onAddTeamLibrary: () => void
  onImportPackage: () => void
  onRefreshTeamLibrary: (id: string) => void
  onRemoveTeamLibrary: (id: string) => void
  onRename: (kind: TreeItemKind, id: string, name: string) => void
  onDelete: (kind: TreeItemKind, id: string) => void
  onDuplicateDashboard: (id: string) => void
  onToggleFavorite: (id: string) => void
  onToggleFolder: (id: string) => void
  onToggleProject: (id: string) => void
  onMove: (kind: TreeItemKind, id: string, targetKind: 'folder' | 'project' | 'root', targetId: string | null) => void
  onShowUpdates: () => void
}

interface EditingState {
  kind: TreeItemKind
  id: string
  value: string
}

function dragPayload(event: React.DragEvent, kind: TreeItemKind, id: string): void {
  event.dataTransfer.setData('application/kpintelligence-tree', JSON.stringify({ kind, id }))
  event.dataTransfer.effectAllowed = 'move'
}

function readDragPayload(event: React.DragEvent): { kind: TreeItemKind; id: string } | null {
  try {
    const value = JSON.parse(event.dataTransfer.getData('application/kpintelligence-tree')) as {
      kind?: TreeItemKind
      id?: string
    }
    if (!value.kind || !value.id) return null
    return { kind: value.kind, id: value.id }
  } catch {
    return null
  }
}

function keyboardActivate(event: React.KeyboardEvent, action: () => void): void {
  if (event.key !== 'Enter' && event.key !== ' ') return
  event.preventDefault()
  event.stopPropagation()
  action()
}

export default function LibrarySidebar({
  store,
  updateAvailable,
  onSelect,
  onCreateFolder,
  onCreateProject,
  onCreateDashboard,
  onAddTeamLibrary,
  onImportPackage,
  onRefreshTeamLibrary,
  onRemoveTeamLibrary,
  onRename,
  onDelete,
  onDuplicateDashboard,
  onToggleFavorite,
  onToggleFolder,
  onToggleProject,
  onMove,
  onShowUpdates,
}: LibrarySidebarProps) {
  const [search, setSearch] = useState('')
  const [newMenuOpen, setNewMenuOpen] = useState(false)
  const [menuKey, setMenuKey] = useState<string | null>(null)
  const [editing, setEditing] = useState<EditingState | null>(null)

  const query = search.trim().toLowerCase()
  const matchingDashboardIds = useMemo(() => {
    if (!query) return null
    return new Set(store.dashboards
      .filter((dashboard) => dashboard.name.toLowerCase().includes(query))
      .map((dashboard) => dashboard.id))
  }, [query, store.dashboards])
  const matchingProjectIds = useMemo(() => {
    if (!query) return null
    return new Set(store.projects
      .filter((project) => project.name.toLowerCase().includes(query)
        || store.dashboards.some((dashboard) =>
          dashboard.projectId === project.id && matchingDashboardIds?.has(dashboard.id)))
      .map((project) => project.id))
  }, [query, store.projects, store.dashboards, matchingDashboardIds])

  function beginRename(kind: TreeItemKind, id: string, value: string): void {
    setEditing({ kind, id, value })
    setMenuKey(null)
  }

  function finishRename(): void {
    if (!editing) return
    const value = editing.value.trim()
    if (value) onRename(editing.kind, editing.id, value)
    setEditing(null)
  }

  function editableLabel(kind: TreeItemKind, id: string, name: string) {
    if (editing?.kind === kind && editing.id === id) {
      return (
        <input
          className="library-rename-input"
          autoFocus
          value={editing.value}
          onClick={(event) => event.stopPropagation()}
          onChange={(event) => setEditing({ ...editing, value: event.target.value })}
          onBlur={finishRename}
          onKeyDown={(event) => {
            if (event.key === 'Enter') finishRename()
            if (event.key === 'Escape') setEditing(null)
          }}
        />
      )
    }
    return <strong onDoubleClick={(event) => {
      event.stopPropagation()
      beginRename(kind, id, name)
    }}>{name}</strong>
  }

  function contextMenu(kind: TreeItemKind, id: string, name: string) {
    const key = `${kind}:${id}`
    if (menuKey !== key) return null
    return (
      <div className="library-context-menu" onClick={(event) => event.stopPropagation()}>
        <button type="button" onClick={() => beginRename(kind, id, name)}><Pencil size={14} /> Rename</button>
        {kind === 'dashboard' && (
          <>
            <button type="button" onClick={() => { onDuplicateDashboard(id); setMenuKey(null) }}><Copy size={14} /> Duplicate</button>
            <button type="button" onClick={() => { onToggleFavorite(id); setMenuKey(null) }}><Star size={14} /> Favorite</button>
          </>
        )}
        <label className="library-move-control">
          <span><FolderInput size={14} /> Move to</span>
          <select
            value=""
            aria-label={`Move ${name}`}
            onChange={(event) => {
              const [targetKind, targetId = ''] = event.target.value.split(':', 2)
              if (!targetKind) return
              onMove(
                kind,
                id,
                targetKind as 'folder' | 'project' | 'root',
                targetId || null,
              )
              setMenuKey(null)
            }}
          >
            <option value="">Choose destination…</option>
            {kind !== 'dashboard' && <option value="root:">Library root</option>}
            {kind === 'dashboard'
              ? store.projects.map((project) => (
                  <option value={`project:${project.id}`} key={project.id}>{project.name}</option>
                ))
              : store.folders
                .filter((folder) => !(kind === 'folder' && folder.id === id))
                .map((folder) => (
                  <option value={`folder:${folder.id}`} key={folder.id}>{folder.name}</option>
                ))}
          </select>
        </label>
        <button className="danger" type="button" onClick={() => { onDelete(kind, id); setMenuKey(null) }}>
          <Trash2 size={14} /> Delete
        </button>
      </div>
    )
  }

  function dashboardRow(dashboard: DashboardRecord) {
    if (matchingDashboardIds && !matchingDashboardIds.has(dashboard.id)) return null
    const active = store.selection.kind === 'dashboard' && store.selection.id === dashboard.id
    return (
      <div className="library-tree-row-wrap dashboard-row-wrap" key={dashboard.id}>
        <div
          className={`library-tree-row dashboard-row ${active ? 'active' : ''}`}
          role="treeitem"
          tabIndex={0}
          aria-selected={active}
          draggable
          onDragStart={(event) => dragPayload(event, 'dashboard', dashboard.id)}
          onClick={() => onSelect({ kind: 'dashboard', id: dashboard.id })}
          onKeyDown={(event) => {
            if (event.target === event.currentTarget) {
              keyboardActivate(event, () => onSelect({ kind: 'dashboard', id: dashboard.id }))
            }
          }}
        >
          <span className="tree-spacer" />
          <span className={`tree-item-icon ${dashboard.featured ? 'featured' : ''}`}>
            {dashboard.featured ? <Sparkles size={15} /> : <FileBarChart size={15} />}
          </span>
          <span className="tree-row-label">
            {editableLabel('dashboard', dashboard.id, dashboard.name)}
          </span>
          {dashboard.favorite && <Star className="favorite-star" size={12} fill="currentColor" />}
          <button
            type="button"
            className="tree-more"
            aria-label={`Options for ${dashboard.name}`}
            onKeyDown={(event) => keyboardActivate(event, () =>
              setMenuKey((value) => value === `dashboard:${dashboard.id}` ? null : `dashboard:${dashboard.id}`))}
            onClick={(event) => {
              event.stopPropagation()
              setMenuKey((value) => value === `dashboard:${dashboard.id}` ? null : `dashboard:${dashboard.id}`)
            }}
          >
            <MoreHorizontal size={14} />
          </button>
        </div>
        {contextMenu('dashboard', dashboard.id, dashboard.name)}
      </div>
    )
  }

  function projectRow(project: ProjectRecord) {
    if (matchingProjectIds && !matchingProjectIds.has(project.id)) return null
    const expanded = query ? true : store.expandedProjectIds.includes(project.id)
    const dashboards = store.dashboards.filter((dashboard) => dashboard.projectId === project.id)
    const active = store.selection.kind === 'project' && store.selection.id === project.id
    return (
      <div className="library-project-node" key={project.id}>
        <div className="library-tree-row-wrap">
          <div
            className={`library-tree-row project-row ${active ? 'active' : ''}`}
            role="treeitem"
            tabIndex={0}
            aria-selected={active}
            draggable
            onDragStart={(event) => dragPayload(event, 'project', project.id)}
            onDragOver={(event) => {
              if (event.dataTransfer.types.includes('application/kpintelligence-tree')) event.preventDefault()
            }}
            onDrop={(event) => {
              event.preventDefault()
              const payload = readDragPayload(event)
              if (payload?.kind === 'dashboard') onMove('dashboard', payload.id, 'project', project.id)
            }}
            onClick={() => onSelect({ kind: 'project', id: project.id })}
            onKeyDown={(event) => {
              if (event.target === event.currentTarget) {
                keyboardActivate(event, () => onSelect({ kind: 'project', id: project.id }))
              }
            }}
          >
            <button
              type="button"
              className="tree-chevron"
              aria-label={expanded ? `Collapse ${project.name}` : `Expand ${project.name}`}
              aria-expanded={expanded}
              onKeyDown={(event) => keyboardActivate(event, () => onToggleProject(project.id))}
              onClick={(event) => {
                event.stopPropagation()
                onToggleProject(project.id)
              }}
            >
              {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </button>
            <span className="tree-item-icon"><BarChart3 size={15} /></span>
            <span className="tree-row-label">
              {editableLabel('project', project.id, project.name)}
              <small>{dashboards.length} dashboard{dashboards.length === 1 ? '' : 's'}</small>
            </span>
            <button
              type="button"
              className="tree-more"
              aria-label={`Options for ${project.name}`}
              onKeyDown={(event) => keyboardActivate(event, () =>
                setMenuKey((value) => value === `project:${project.id}` ? null : `project:${project.id}`))}
              onClick={(event) => {
                event.stopPropagation()
                setMenuKey((value) => value === `project:${project.id}` ? null : `project:${project.id}`)
              }}
            >
              <MoreHorizontal size={14} />
            </button>
          </div>
          {contextMenu('project', project.id, project.name)}
        </div>
        {expanded && (
          <div className="library-project-children">
            {dashboards.map(dashboardRow)}
            <button className="library-add-dashboard" type="button" onClick={() => onCreateDashboard(project.id)}>
              <Plus size={13} /> Dashboard
            </button>
          </div>
        )}
      </div>
    )
  }

  function folderContainsMatch(folderId: string, visited = new Set<string>()): boolean {
    if (!query) return true
    if (visited.has(folderId)) return false
    visited.add(folderId)
    const folder = store.folders.find((candidate) => candidate.id === folderId)
    if (!folder) return false
    if (folder.name.toLowerCase().includes(query)) return true
    if (store.projects.some((project) =>
      project.folderId === folderId && matchingProjectIds?.has(project.id))) return true
    return store.folders
      .filter((candidate) => candidate.parentId === folderId)
      .some((candidate) => folderContainsMatch(candidate.id, visited))
  }

  function folderNode(folder: LibraryFolderRecord, depth = 0): React.ReactNode {
    const childFolders = store.folders.filter((candidate) => candidate.parentId === folder.id)
    const projects = store.projects.filter((project) => project.folderId === folder.id)
    if (!folderContainsMatch(folder.id)) return null

    const expanded = query ? true : store.expandedFolderIds.includes(folder.id)
    const active = store.selection.kind === 'folder' && store.selection.id === folder.id
    return (
      <div className="library-folder-node" key={folder.id} style={{ '--tree-depth': depth } as React.CSSProperties}>
        <div className="library-tree-row-wrap">
          <div
            className={`library-tree-row folder-row ${active ? 'active' : ''}`}
            role="treeitem"
            tabIndex={0}
            aria-selected={active}
            draggable
            onDragStart={(event) => dragPayload(event, 'folder', folder.id)}
            onDragOver={(event) => {
              if (event.dataTransfer.types.includes('application/kpintelligence-tree')) event.preventDefault()
            }}
            onDrop={(event) => {
              event.preventDefault()
              event.stopPropagation()
              const payload = readDragPayload(event)
              if (payload && !(payload.kind === 'folder' && payload.id === folder.id)) {
                onMove(payload.kind, payload.id, 'folder', folder.id)
              }
            }}
            onClick={() => onSelect({ kind: 'folder', id: folder.id })}
            onKeyDown={(event) => {
              if (event.target === event.currentTarget) {
                keyboardActivate(event, () => onSelect({ kind: 'folder', id: folder.id }))
              }
            }}
          >
            <button
              type="button"
              className="tree-chevron"
              aria-label={expanded ? `Collapse ${folder.name}` : `Expand ${folder.name}`}
              aria-expanded={expanded}
              onKeyDown={(event) => keyboardActivate(event, () => onToggleFolder(folder.id))}
              onClick={(event) => {
                event.stopPropagation()
                onToggleFolder(folder.id)
              }}
            >
              {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </button>
            <span className="tree-item-icon">{expanded ? <FolderOpen size={15} /> : <Folder size={15} />}</span>
            <span className="tree-row-label">{editableLabel('folder', folder.id, folder.name)}</span>
            <button
              type="button"
              className="tree-more"
              aria-label={`Options for ${folder.name}`}
              onKeyDown={(event) => keyboardActivate(event, () =>
                setMenuKey((value) => value === `folder:${folder.id}` ? null : `folder:${folder.id}`))}
              onClick={(event) => {
                event.stopPropagation()
                setMenuKey((value) => value === `folder:${folder.id}` ? null : `folder:${folder.id}`)
              }}
            >
              <MoreHorizontal size={14} />
            </button>
          </div>
          {contextMenu('folder', folder.id, folder.name)}
        </div>
        {expanded && (
          <div className="library-folder-children">
            {childFolders.map((child) => folderNode(child, depth + 1))}
            {projects.map(projectRow)}
          </div>
        )}
      </div>
    )
  }

  const rootFolders = store.folders.filter((folder) => folder.parentId === null)
  const rootProjects = store.projects.filter((project) => project.folderId === null)
  const favoriteDashboards = store.dashboards.filter((dashboard) => dashboard.favorite)
  const contextualProjectId = store.selection.kind === 'project'
    ? store.selection.id
    : store.selection.kind === 'dashboard'
      ? store.dashboards.find((dashboard) => dashboard.id === store.selection.id)?.projectId ?? ''
      : ''

  return (
    <aside
      className="library-sidebar"
      onClick={() => setMenuKey(null)}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return
        setMenuKey(null)
        setNewMenuOpen(false)
      }}
    >
      <div className="library-brand">
        <span className="library-brand-mark"><BarChart3 size={21} /></span>
        <div>
          <strong>KPIntelligence</strong>
          <span>Dashboard studio</span>
        </div>
        <button className={`library-update-button ${updateAvailable ? 'available' : ''}`} type="button" onClick={onShowUpdates} aria-label="Updates" title="Updates">
          <Bell size={16} />
          {updateAvailable && <span />}
        </button>
      </div>

      <div className="library-create">
        <button
          type="button"
          aria-haspopup="menu"
          aria-expanded={newMenuOpen}
          onClick={() => setNewMenuOpen((open) => !open)}
        >
          <Plus size={16} /> New <ChevronDown size={14} />
        </button>
        {newMenuOpen && (
          <div className="library-new-menu" role="menu">
            <button role="menuitem" type="button" onClick={() => { onCreateProject(null); setNewMenuOpen(false) }}>
              <BarChart3 size={16} /><span><strong>Project</strong><small>Group dashboards and data</small></span>
            </button>
            <button role="menuitem" type="button" onClick={() => { onCreateDashboard(contextualProjectId); setNewMenuOpen(false) }}>
              <FileBarChart size={16} /><span><strong>Dashboard</strong><small>Build a custom report</small></span>
            </button>
            <button role="menuitem" type="button" onClick={() => { onCreateFolder(null); setNewMenuOpen(false) }}>
              <FolderPlus size={16} /><span><strong>Folder</strong><small>Organize projects</small></span>
            </button>
            <button role="menuitem" type="button" onClick={() => { onImportPackage(); setNewMenuOpen(false) }}>
              <FileInput size={16} /><span><strong>Import package</strong><small>Add a shared .kpidashboard</small></span>
            </button>
            <button role="menuitem" type="button" onClick={() => { onAddTeamLibrary(); setNewMenuOpen(false) }}>
              <FolderSync size={16} /><span><strong>Team Library</strong><small>Watch a shared synced folder</small></span>
            </button>
          </div>
        )}
      </div>

      <label className="library-search">
        <Search size={15} />
        <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search library" />
      </label>

      <nav className="library-nav" aria-label="Dashboard library">
        <button
          type="button"
          className={`library-home-row ${store.selection.kind === 'home' ? 'active' : ''}`}
          onClick={() => onSelect({ kind: 'home', id: 'home' })}
        >
          <Home size={16} /> Home
        </button>

        {favoriteDashboards.length > 0 && !query && (
          <section className="library-section favorites">
            <h2>Favorites</h2>
            {favoriteDashboards.slice(0, 5).map((dashboard) => (
              <button
                type="button"
                className={store.selection.kind === 'dashboard' && store.selection.id === dashboard.id ? 'active' : ''}
                key={dashboard.id}
                onClick={() => onSelect({ kind: 'dashboard', id: dashboard.id })}
              >
                <Star size={14} fill="currentColor" />
                <span>{dashboard.name}</span>
              </button>
            ))}
          </section>
        )}

        {!query && (
          <section className="library-section team-libraries">
            <div className="library-section-heading">
              <h2>Team Libraries</h2>
              <button type="button" onClick={onAddTeamLibrary} aria-label="Add Team Library" title="Add Team Library">
                <FolderSync size={14} />
              </button>
            </div>
            {store.teamLibraries.map((library) => {
              const active = store.selection.kind === 'teamLibrary' && store.selection.id === library.id
              const key = `teamLibrary:${library.id}`
              return (
                <div className="library-team-row-wrap" key={library.id}>
                  <button
                    type="button"
                    className={`library-team-row ${active ? 'active' : ''}`}
                    onClick={() => onSelect({ kind: 'teamLibrary', id: library.id })}
                  >
                    <Cloud size={15} />
                    <span><strong>{library.name}</strong><small>{library.packageCount} package{library.packageCount === 1 ? '' : 's'}</small></span>
                  </button>
                  <button
                    type="button"
                    className="tree-more"
                    aria-label={`Options for ${library.name}`}
                    aria-haspopup="menu"
                    aria-expanded={menuKey === key}
                    onClick={(event) => {
                      event.stopPropagation()
                      setMenuKey((value) => value === key ? null : key)
                    }}
                  >
                    <MoreHorizontal size={14} />
                  </button>
                  {menuKey === key && (
                    <div className="library-context-menu team-library-menu" role="menu" onClick={(event) => event.stopPropagation()}>
                      <button role="menuitem" type="button" onClick={() => { onRefreshTeamLibrary(library.id); setMenuKey(null) }}>
                        <RefreshCw size={14} /> Refresh
                      </button>
                      <button role="menuitem" className="danger" type="button" onClick={() => { onRemoveTeamLibrary(library.id); setMenuKey(null) }}>
                        <Trash2 size={14} /> Remove
                      </button>
                    </div>
                  )}
                </div>
              )
            })}
            {store.teamLibraries.length === 0 && (
              <button className="library-add-team" type="button" onClick={onAddTeamLibrary}>
                <FolderSync size={14} /> Add shared folder
              </button>
            )}
          </section>
        )}

        <section className="library-section tree">
          <div className="library-section-heading">
            <h2>Library</h2>
            <div>
              <button type="button" onClick={() => onCreateProject(null)} aria-label="Create project in library" title="New project"><Plus size={14} /></button>
              <button type="button" onClick={() => onCreateFolder(null)} aria-label="New folder" title="New folder"><FolderPlus size={14} /></button>
            </div>
          </div>
          <div
            className="library-tree"
            role="tree"
            onDragOver={(event) => {
              if (event.dataTransfer.types.includes('application/kpintelligence-tree')) event.preventDefault()
            }}
            onDrop={(event) => {
              if (event.target !== event.currentTarget) return
              const payload = readDragPayload(event)
              if (payload) onMove(payload.kind, payload.id, 'root', null)
            }}
          >
            {rootFolders.map((folder) => folderNode(folder))}
            {rootProjects.map(projectRow)}
            {query && rootFolders.length === 0 && rootProjects.length === 0 && (
              <div className="library-no-results">No dashboards match “{search}”.</div>
            )}
          </div>
        </section>
      </nav>

      <footer className="library-footer">
        <span>Private, local-first</span>
        <strong>Created by Noah Garrett</strong>
      </footer>
    </aside>
  )
}
