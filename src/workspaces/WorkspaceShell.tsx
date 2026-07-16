import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertCircle,
  ArrowRight,
  BarChart3,
  Bell,
  CheckCircle2,
  FileArchive,
  FolderOpen,
  FolderSync,
  LayoutDashboard,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react'
import App, { UpdateModal } from '@/App'
import { platform } from '@/platform'
import { checkForUpdate } from '@/services/updateChecker'
import type { ReportFilters, UpdateInfo } from '@/types'
import { createWorkspace, emptyWorkspaceStore, loadWorkspaceStore, saveWorkspaceStore } from './repository'
import { loadWorkspaceSource } from './source'
import type { SourceStatus, WorkspaceRecord, WorkspaceSourceSnapshot, WorkspaceStoreData } from './types'

type ShellView = 'workspaces' | 'dashboard'

function sourceStatusLabel(status: SourceStatus): string {
  if (status === 'scanning') return 'Scanning source folder'
  if (status === 'watching') return 'Folder sync active'
  if (status === 'ready') return 'Reports ready'
  if (status === 'warning') return 'Showing last good report'
  if (status === 'error') return 'Source needs attention'
  return 'Source folder not selected'
}

function folderName(path: string | null): string {
  if (!path) return 'No folder selected'
  return path.replace(/\\/g, '/').split('/').filter(Boolean).pop() ?? path
}

function formatOpened(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Not opened yet'
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function CreateWorkspaceModal({ open, onClose, onCreate }: {
  open: boolean
  onClose: () => void
  onCreate: (name: string) => void
}) {
  const [name, setName] = useState('')

  useEffect(() => {
    if (open) setName('')
  }, [open])

  if (!open) return null
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <div className="modal workspace-create-modal" role="dialog" aria-modal="true" aria-label="New workspace" onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <div>
            <span className="modal-kicker">New workspace</span>
            <h2>Start a project report</h2>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        <form
          className="workspace-create-form"
          onSubmit={(event) => {
            event.preventDefault()
            onCreate(name)
          }}
        >
          <label className="field">
            <span>Project name</span>
            <input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="Project or site name" />
          </label>
          <div className="template-choice selected">
            <span className="template-choice-icon"><BarChart3 size={19} /></span>
            <div>
              <strong>Weekly QA/QC</strong>
              <span>Built-in report template</span>
            </div>
            <CheckCircle2 size={18} />
          </div>
          <div className="modal-actions">
            <button className="button secondary" type="button" onClick={onClose}>Cancel</button>
            <button className="button primary" type="submit" disabled={!name.trim()}>
              <Plus size={16} />
              Create workspace
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default function WorkspaceShell() {
  const [store, setStore] = useState<WorkspaceStoreData>(emptyWorkspaceStore)
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState<ShellView>('workspaces')
  const [createOpen, setCreateOpen] = useState(false)
  const [updateOpen, setUpdateOpen] = useState(false)
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null)
  const [updateChecking, setUpdateChecking] = useState(false)
  const [lastUpdateCheck, setLastUpdateCheck] = useState<Date | null>(null)
  const [sourceStatus, setSourceStatus] = useState<SourceStatus>('idle')
  const [sourceMessage, setSourceMessage] = useState('Select the local folder synced by SharePoint or OneDrive.')
  const [sourceSnapshot, setSourceSnapshot] = useState<WorkspaceSourceSnapshot | null>(null)
  const sourceSnapshotRef = useRef<WorkspaceSourceSnapshot | null>(null)
  const refreshInFlight = useRef(false)
  const refreshQueued = useRef(false)

  const activeWorkspace = useMemo(
    () => store.workspaces.find((workspace) => workspace.id === store.activeWorkspaceId) ?? store.workspaces[0] ?? null,
    [store],
  )

  const commitStore = useCallback((updater: (current: WorkspaceStoreData) => WorkspaceStoreData): void => {
    setStore((current) => {
      const next = updater(current)
      void saveWorkspaceStore(platform, next)
      return next
    })
  }, [])

  const updateWorkspace = useCallback((id: string, updates: Partial<WorkspaceRecord>): void => {
    commitStore((current) => ({
      ...current,
      workspaces: current.workspaces.map((workspace) => workspace.id === id
        ? { ...workspace, ...updates, updatedAt: new Date().toISOString() }
        : workspace),
    }))
  }, [commitStore])

  const refreshSource = useCallback(async (): Promise<void> => {
    if (!activeWorkspace?.sourceFolder) {
      setSourceStatus('idle')
      setSourceMessage('Select the local folder synced by SharePoint or OneDrive.')
      return
    }
    if (refreshInFlight.current) {
      refreshQueued.current = true
      return
    }
    refreshInFlight.current = true
    setSourceStatus('scanning')
    setSourceMessage('Waiting for synced files to settle before reading them.')
    try {
      const snapshot = await loadWorkspaceSource(platform, activeWorkspace.sourceFolder)
      sourceSnapshotRef.current = snapshot
      setSourceSnapshot(snapshot)
      setSourceStatus('watching')
      setSourceMessage(`${snapshot.displayNames.join(', ')} - refreshed ${new Date(snapshot.loadedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'The selected source folder could not be read.'
      setSourceStatus(sourceSnapshotRef.current ? 'warning' : 'error')
      setSourceMessage(message)
    } finally {
      refreshInFlight.current = false
      if (refreshQueued.current) {
        refreshQueued.current = false
        window.setTimeout(() => void refreshSource(), 1000)
      }
    }
  }, [activeWorkspace?.id, activeWorkspace?.sourceFolder])

  useEffect(() => {
    let active = true
    void loadWorkspaceStore(platform).then((saved) => {
      if (!active) return
      setStore(saved)
      setLoading(false)
      const lastWorkspace = saved.workspaces.find((workspace) => workspace.id === saved.activeWorkspaceId)
      if (lastWorkspace?.sourceFolder) setView('dashboard')
    }).catch(() => {
      if (active) setLoading(false)
    })
    return () => { active = false }
  }, [])

  const checkUpdates = useCallback(async (): Promise<void> => {
    if (updateChecking) return
    setUpdateChecking(true)
    try {
      setUpdateInfo(await checkForUpdate())
      setLastUpdateCheck(new Date())
    } finally {
      setUpdateChecking(false)
    }
  }, [updateChecking])

  useEffect(() => {
    if (view === 'workspaces' && import.meta.env.PROD) void checkUpdates()
  }, [view])

  useEffect(() => {
    if (view !== 'dashboard' || !activeWorkspace?.sourceFolder) return
    sourceSnapshotRef.current = null
    setSourceSnapshot(null)
    void refreshSource()
    let stopWatching: (() => void) | undefined
    let cancelled = false
    let refreshTimer: number | undefined
    void platform.watchDirectory(activeWorkspace.sourceFolder, () => {
      window.clearTimeout(refreshTimer)
      refreshTimer = window.setTimeout(() => void refreshSource(), 1200)
    }).then((stop) => {
      if (cancelled) stop()
      else stopWatching = stop
    }).catch((error) => {
      setSourceStatus(sourceSnapshotRef.current ? 'warning' : 'error')
      setSourceMessage(error instanceof Error ? error.message : 'Folder monitoring could not be started.')
    })
    return () => {
      cancelled = true
      window.clearTimeout(refreshTimer)
      stopWatching?.()
    }
  }, [view, activeWorkspace?.id, activeWorkspace?.sourceFolder])

  const handleFiltersChange = useCallback((filters: ReportFilters): void => {
    if (activeWorkspace) updateWorkspace(activeWorkspace.id, { filters })
  }, [activeWorkspace?.id, updateWorkspace])

  function selectWorkspace(id: string): void {
    sourceSnapshotRef.current = null
    setSourceSnapshot(null)
    setSourceStatus('idle')
    commitStore((current) => ({ ...current, activeWorkspaceId: id }))
  }

  function addWorkspace(name: string): void {
    const workspace = createWorkspace(name)
    commitStore((current) => ({
      ...current,
      activeWorkspaceId: workspace.id,
      workspaces: [workspace, ...current.workspaces],
    }))
    setCreateOpen(false)
    sourceSnapshotRef.current = null
    setSourceSnapshot(null)
    setSourceStatus('idle')
  }

  async function chooseSourceFolder(): Promise<void> {
    if (!activeWorkspace) return
    const folder = await platform.chooseDirectory()
    if (!folder) return
    updateWorkspace(activeWorkspace.id, { sourceFolder: folder })
    sourceSnapshotRef.current = null
    setSourceSnapshot(null)
    setView('dashboard')
  }

  function openDashboard(): void {
    if (!activeWorkspace) return
    updateWorkspace(activeWorkspace.id, { lastOpenedAt: new Date().toISOString() })
    setView('dashboard')
  }

  function deleteWorkspace(): void {
    if (!activeWorkspace || !window.confirm(`Delete the workspace "${activeWorkspace.name}"? Source files will not be changed.`)) return
    commitStore((current) => {
      const workspaces = current.workspaces.filter((workspace) => workspace.id !== activeWorkspace.id)
      return { ...current, workspaces, activeWorkspaceId: workspaces[0]?.id ?? null }
    })
    sourceSnapshotRef.current = null
    setSourceSnapshot(null)
    setSourceStatus('idle')
  }

  if (loading) {
    return (
      <div className="shell-loading">
        <span className="shell-loading-mark"><ShieldCheck size={28} /></span>
        <strong>QCx Intelligence</strong>
        <RefreshCw className="spin" size={18} />
      </div>
    )
  }

  if (view === 'dashboard' && activeWorkspace) {
    return (
      <App
        key={activeWorkspace.id}
        autoImport={sourceSnapshot}
        initialFilters={activeWorkspace.filters}
        onFiltersChange={handleFiltersChange}
        workspaceContext={{
          workspaceName: activeWorkspace.name,
          sourceStatus: sourceStatusLabel(sourceStatus),
          sourceMessage,
          onShowWorkspaces: () => setView('workspaces'),
          onRefresh: () => void refreshSource(),
        }}
      />
    )
  }

  return (
    <div className="workspace-shell">
      <header className="shell-header">
        <div className="shell-brand">
          <span><ShieldCheck size={23} /></span>
          <div>
            <h1>QCx Intelligence</h1>
            <p>Project reporting workspaces</p>
          </div>
        </div>
        <div className="shell-header-actions">
          <button
            className={`icon-button update-button ${updateInfo ? 'has-update' : ''}`}
            type="button"
            aria-label="Updates"
            title="Updates"
            onClick={() => setUpdateOpen(true)}
          >
            <Bell size={18} />
            {updateInfo && <span className="update-dot" />}
          </button>
          <button className="button primary" type="button" onClick={() => setCreateOpen(true)}>
            <Plus size={16} />
            New workspace
          </button>
        </div>
      </header>

      <main className="shell-layout">
        <aside className="workspace-rail">
          <div className="workspace-rail-head">
            <span>Workspaces</span>
            <strong>{store.workspaces.length}</strong>
          </div>
          <div className="workspace-list">
            {store.workspaces.map((workspace) => (
              <button
                className={`workspace-list-item ${workspace.id === activeWorkspace?.id ? 'active' : ''}`}
                type="button"
                key={workspace.id}
                onClick={() => selectWorkspace(workspace.id)}
              >
                <span className="workspace-list-icon"><LayoutDashboard size={17} /></span>
                <span>
                  <strong>{workspace.name}</strong>
                  <small>{folderName(workspace.sourceFolder)}</small>
                </span>
                <ArrowRight size={15} />
              </button>
            ))}
          </div>
          <div className="workspace-rail-footer">Created by Noah Garrett</div>
        </aside>

        <section className="shell-content">
          {activeWorkspace ? (
            <>
              <div className="workspace-title-row">
                <div>
                  <span className="workspace-kicker">Weekly QA/QC</span>
                  <input
                    className="workspace-name-input"
                    value={activeWorkspace.name}
                    aria-label="Workspace name"
                    onChange={(event) => updateWorkspace(activeWorkspace.id, { name: event.target.value })}
                  />
                  <p>Last opened {formatOpened(activeWorkspace.lastOpenedAt)}</p>
                </div>
                <button className="icon-button danger" type="button" onClick={deleteWorkspace} aria-label="Delete workspace" title="Delete workspace">
                  <Trash2 size={17} />
                </button>
              </div>

              <div className="workspace-setup-grid">
                <section className="source-panel">
                  <div className="panel-title-row">
                    <span className="panel-icon"><FolderSync size={19} /></span>
                    <div>
                      <h2>Source folder</h2>
                      <p>SharePoint or OneDrive sync</p>
                    </div>
                  </div>
                  <div className={`source-path ${activeWorkspace.sourceFolder ? 'connected' : ''}`}>
                    <FolderOpen size={19} />
                    <div>
                      <strong>{folderName(activeWorkspace.sourceFolder)}</strong>
                      <span>{activeWorkspace.sourceFolder ?? 'Folder access is stored only for this workspace.'}</span>
                    </div>
                    {activeWorkspace.sourceFolder && <CheckCircle2 size={18} />}
                  </div>
                  <div className="source-actions">
                    {platform.supportsPersistentFolders ? (
                      <button className="button secondary" type="button" onClick={() => void chooseSourceFolder()}>
                        <FolderOpen size={16} />
                        {activeWorkspace.sourceFolder ? 'Change folder' : 'Choose folder'}
                      </button>
                    ) : (
                      <span className="browser-mode-note"><AlertCircle size={15} /> Folder watching is enabled in the desktop build.</span>
                    )}
                    <button className="button primary" type="button" onClick={openDashboard}>
                      <LayoutDashboard size={16} />
                      Open dashboard
                    </button>
                  </div>
                </section>

                <section className="template-panel">
                  <div className="panel-title-row">
                    <span className="panel-icon template"><BarChart3 size={19} /></span>
                    <div>
                      <h2>Weekly QA/QC</h2>
                      <p>Template v{activeWorkspace.templateVersion}</p>
                    </div>
                  </div>
                  <div className="template-metadata">
                    <div><FileArchive size={16} /><span>4 report sources</span></div>
                    <div><LayoutDashboard size={16} /><span>3 report views</span></div>
                    <div><CheckCircle2 size={16} /><span>PDF and PowerPoint</span></div>
                  </div>
                  <div className="template-status"><span /> Built-in template</div>
                </section>
              </div>
            </>
          ) : (
            <div className="workspace-empty">
              <span><LayoutDashboard size={28} /></span>
              <h2>No workspaces yet</h2>
              <p>Create a project workspace to begin.</p>
              <button className="button primary" type="button" onClick={() => setCreateOpen(true)}>
                <Plus size={16} />
                New workspace
              </button>
            </div>
          )}
        </section>
      </main>

      <CreateWorkspaceModal open={createOpen} onClose={() => setCreateOpen(false)} onCreate={addWorkspace} />
      <UpdateModal
        open={updateOpen}
        onClose={() => setUpdateOpen(false)}
        info={updateInfo}
        defaultTab={updateInfo ? 'update' : 'changelog'}
        checking={updateChecking}
        lastChecked={lastUpdateCheck}
        onCheck={checkUpdates}
      />
    </div>
  )
}
