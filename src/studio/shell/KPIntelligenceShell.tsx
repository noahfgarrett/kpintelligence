import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  Database,
  Download,
  FileBarChart,
  FileSpreadsheet,
  Folder,
  FolderOpen,
  LayoutDashboard,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Star,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import App, { UpdateModal, type DashboardAutoImport } from '@/App'
import { useModalFocus } from '@/hooks/useModalFocus'
import { platform } from '@/platform'
import { checkForUpdate } from '@/services/updateChecker'
import type { ReportFilters, UpdateInfo } from '@/types'
import { isUsableSourceFile, loadWorkspaceSource } from '@/workspaces/source'
import type { WorkspaceSourceSnapshot } from '@/workspaces/types'
import DashboardStudio from '../builder/DashboardStudio'
import {
  isSupportedSpreadsheet,
  isZipArchive,
  profileSpreadsheetInputs,
  rebindDashboardSources,
  type SpreadsheetCatalogProfile,
} from '../data'
import LibrarySidebar from '../library/LibrarySidebar'
import {
  createId,
  type DashboardRecord,
  type ExportProfileRecord,
  type LibrarySelection,
  type LibraryStore,
  type ProjectRecord,
} from '../library/model'
import { createEmptyLibrary, loadLibrary, saveLibrary } from '../library/repository'

type SourceState = {
  status: 'idle' | 'loading' | 'ready' | 'warning' | 'error'
  message: string
  catalog: SpreadsheetCatalogProfile | null
}

type CreateRequest =
  | { kind: 'folder'; parentId: string | null }
  | { kind: 'project'; folderId: string | null }
  | { kind: 'dashboard'; projectId: string }

const MAX_PROJECT_SOURCE_FILES = 500
const MAX_PROJECT_SOURCE_BYTES = 750 * 1024 * 1024
const MAX_SOURCE_FILE_BYTES = 250 * 1024 * 1024

async function mapWithConcurrency<T, R>(
  values: readonly T[],
  limit: number,
  worker: (value: T) => Promise<R>,
): Promise<R[]> {
  const output = new Array<R>(values.length)
  let cursor = 0
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, async () => {
    while (cursor < values.length) {
      const index = cursor
      cursor += 1
      output[index] = await worker(values[index])
    }
  }))
  return output
}

function now(): string {
  return new Date().toISOString()
}

function folderName(path: string | null): string {
  if (!path) return 'No folder selected'
  return path.replace(/\\/g, '/').split('/').filter(Boolean).pop() ?? path
}

function formatRelative(value: string | null): string {
  if (!value) return 'Never'
  const time = new Date(value).getTime()
  if (Number.isNaN(time)) return 'Never'
  const minutes = Math.round((Date.now() - time) / 60_000)
  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function sameReportFilters(left: ReportFilters | undefined, right: ReportFilters): boolean {
  if (!left || left.oac !== right.oac) return false
  const sameList = (a: string[], b: string[]) =>
    a.length === b.length && a.every((value, index) => value === b[index])
  return sameList(left.workWeeks, right.workWeeks)
    && sameList(left.disciplines, right.disciplines)
    && sameList(left.contractors, right.contractors)
    && sameList(left.subtypes, right.subtypes)
    && sameList(left.statuses, right.statuses)
}

function dashboardHasDataBindings(dashboard: DashboardRecord): boolean {
  return dashboard.pages.some((page) => page.widgets.some((widget) =>
    widget.visualType !== 'text' && Boolean(widget.query.datasetId)))
}

function dashboardBindingsResolve(
  dashboard: DashboardRecord,
  catalog: SpreadsheetCatalogProfile,
): boolean {
  return dashboard.pages.every((page) => page.widgets.every((widget) => {
    if (widget.visualType === 'text' || !widget.query.datasetId) return true
    const dataset = catalog.datasets.find((candidate) => candidate.id === widget.query.datasetId)
    if (!dataset) return false
    const fieldIds = new Set(dataset.fields.map((field) => field.id))
    return [
      widget.query.measureFieldId,
      widget.query.secondaryMeasureFieldId,
      widget.query.groupByFieldId,
      widget.query.seriesFieldId,
      ...widget.query.tableFieldIds,
      ...widget.query.conditions.map((condition) => condition.fieldId),
    ].filter((id): id is string => Boolean(id)).every((id) => fieldIds.has(id))
  }))
}

function dashboardIcon(dashboard: DashboardRecord) {
  return dashboard.featured ? <Sparkles size={19} /> : <FileBarChart size={19} />
}

function CreateModal({
  request,
  projects,
  onClose,
  onCreate,
}: {
  request: CreateRequest | null
  projects: ProjectRecord[]
  onClose: () => void
  onCreate: (request: CreateRequest, name: string, dashboardKind?: DashboardRecord['kind']) => void
}) {
  const [name, setName] = useState('')
  const [dashboardKind, setDashboardKind] = useState<DashboardRecord['kind']>('custom')
  const [projectId, setProjectId] = useState('')
  const dialogRef = useRef<HTMLDivElement>(null)
  useModalFocus(Boolean(request), dialogRef, onClose)

  useEffect(() => {
    if (!request) return
    setName(request.kind === 'folder' ? 'New folder' : request.kind === 'project' ? 'New project' : 'Untitled dashboard')
    setDashboardKind('custom')
    setProjectId(request.kind === 'dashboard' ? request.projectId : '')
  }, [request])

  if (!request) return null
  const title = request.kind === 'folder'
    ? 'Create folder'
    : request.kind === 'project'
      ? 'Create project'
      : 'Create dashboard'
  return (
    <div className="kp-modal-backdrop" role="presentation" onMouseDown={onClose}>
      <div
        ref={dialogRef}
        className="kp-modal create-modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <span>KPIntelligence library</span>
            <h2>{title}</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Close"><X size={17} /></button>
        </header>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            const value = name.trim()
            if (!value) return
            const resolved = request.kind === 'dashboard' && projectId
              ? { ...request, projectId }
              : request
            onCreate(resolved, value, dashboardKind)
          }}
        >
          <label className="kp-field">
            <span>Name</span>
            <input autoFocus value={name} onFocus={(event) => event.currentTarget.select()} onChange={(event) => setName(event.target.value)} />
          </label>
          {request.kind === 'dashboard' && (
            <>
              <label className="kp-field">
                <span>Project</span>
                <select value={projectId} onChange={(event) => setProjectId(event.target.value)}>
                  {projects.map((project) => <option value={project.id} key={project.id}>{project.name}</option>)}
                </select>
              </label>
              <div className="dashboard-template-choices">
                <button
                  type="button"
                  className={dashboardKind === 'custom' ? 'active' : ''}
                  onClick={() => setDashboardKind('custom')}
                >
                  <span><LayoutDashboard size={19} /></span>
                  <div><strong>Blank dashboard</strong><small>Build from any spreadsheet</small></div>
                  {dashboardKind === 'custom' && <CheckCircle2 size={17} />}
                </button>
                <button
                  type="button"
                  className={dashboardKind === 'oacWeekly' ? 'active' : ''}
                  onClick={() => setDashboardKind('oacWeekly')}
                >
                  <span><Sparkles size={19} /></span>
                  <div><strong>Weekly QA/QC</strong><small>Featured OAC report template</small></div>
                  {dashboardKind === 'oacWeekly' && <CheckCircle2 size={17} />}
                </button>
              </div>
            </>
          )}
          <footer>
            <button className="kp-button secondary" type="button" onClick={onClose}>Cancel</button>
            <button className="kp-button primary" type="submit" disabled={!name.trim() || (request.kind === 'dashboard' && !projectId)}>
              <Plus size={15} /> Create
            </button>
          </footer>
        </form>
      </div>
    </div>
  )
}

function ExportProfileModal({
  open,
  profile,
  dashboard,
  onClose,
  onChange,
  onExport,
  canExport,
}: {
  open: boolean
  profile: ExportProfileRecord | null
  dashboard: DashboardRecord | null
  onClose: () => void
  onChange: (profile: ExportProfileRecord) => void
  onExport: (profile: ExportProfileRecord) => void
  canExport: boolean
}) {
  const dialogRef = useRef<HTMLDivElement>(null)
  useModalFocus(open && Boolean(profile) && Boolean(dashboard), dialogRef, onClose)
  if (!open || !profile || !dashboard) return null
  return (
    <div className="kp-modal-backdrop" role="presentation" onMouseDown={onClose}>
      <div
        ref={dialogRef}
        className="kp-modal export-profile-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Export setup"
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <span>Export profile</span>
            <h2>Prepare {dashboard.name}</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Close"><X size={17} /></button>
        </header>
        <div className="export-profile-body">
          <section>
            <h3>File</h3>
            <div className="export-format-picker">
              {(['pptx', 'pdf', 'png'] as const).map((format) => (
                <button
                  type="button"
                  key={format}
                  className={profile.format === format ? 'active' : ''}
                  onClick={() => onChange({ ...profile, format, updatedAt: now() })}
                >
                  <FileBarChart size={17} />
                  {format.toUpperCase()}
                </button>
              ))}
            </div>
            <label className="kp-field">
              <span>Profile name</span>
              <input value={profile.name} onChange={(event) => onChange({ ...profile, name: event.target.value, updatedAt: now() })} />
            </label>
          </section>
          <section className="export-setting-grid">
            <label className="kp-field">
              <span>Page size</span>
              <select value={profile.pageSize} onChange={(event) => onChange({ ...profile, pageSize: event.target.value as typeof profile.pageSize, updatedAt: now() })}>
                <option value="widescreen">Widescreen 16:9</option>
                <option value="standard">Standard 4:3</option>
                <option value="letter">US Letter</option>
                <option value="a4">A4</option>
              </select>
            </label>
            <label className="kp-field">
              <span>Orientation</span>
              <select value={profile.orientation} onChange={(event) => onChange({ ...profile, orientation: event.target.value as typeof profile.orientation, updatedAt: now() })}>
                <option value="landscape">Landscape</option>
                <option value="portrait">Portrait</option>
              </select>
            </label>
            <label className="kp-field">
              <span>Safe margin</span>
              <select value={profile.margin} onChange={(event) => onChange({ ...profile, margin: Number(event.target.value), updatedAt: now() })}>
                <option value={0}>None</option>
                <option value={0.2}>Compact</option>
                <option value={0.35}>Standard</option>
                <option value={0.5}>Generous</option>
              </select>
            </label>
            <label className="kp-field">
              <span>Image quality</span>
              <select value={profile.scale} onChange={(event) => onChange({ ...profile, scale: Number(event.target.value) as typeof profile.scale, updatedAt: now() })}>
                <option value={2}>High</option>
                <option value={3}>Very high</option>
                <option value={4}>Maximum</option>
              </select>
            </label>
          </section>
          <section>
            <h3>Presentation furniture</h3>
            <label className="kp-field">
              <span>Header text</span>
              <input value={profile.headerText} placeholder="Optional client or project header" onChange={(event) => onChange({ ...profile, headerText: event.target.value, updatedAt: now() })} />
            </label>
            <label className="kp-field">
              <span>Footer text</span>
              <input value={profile.footerText} placeholder="Optional confidentiality or project footer" onChange={(event) => onChange({ ...profile, footerText: event.target.value, updatedAt: now() })} />
            </label>
            <div className="export-checks">
              <label><input type="checkbox" checked={profile.includeTitle} onChange={(event) => onChange({ ...profile, includeTitle: event.target.checked, updatedAt: now() })} /> Page titles</label>
              <label><input type="checkbox" checked={profile.includeGeneratedAt} onChange={(event) => onChange({ ...profile, includeGeneratedAt: event.target.checked, updatedAt: now() })} /> Generated date</label>
              <label><input type="checkbox" checked={profile.includePageNumbers} onChange={(event) => onChange({ ...profile, includePageNumbers: event.target.checked, updatedAt: now() })} /> Page numbers</label>
            </div>
          </section>
          <div className="export-profile-note">
            <ShieldCheck size={16} />
            Charts use SVG in the app and maximum-quality rasterization for portable exports.
          </div>
        </div>
        <footer>
          <button className="kp-button secondary" type="button" onClick={onClose}>Cancel</button>
          <button
            className="kp-button primary"
            type="button"
            onClick={() => onExport(profile)}
            disabled={!canExport}
            title={canExport ? 'Export dashboard' : 'Wait for the spreadsheet source to finish loading.'}
          >
            <Download size={15} /> Export {profile.format.toUpperCase()}
          </button>
        </footer>
      </div>
    </div>
  )
}

function HomeView({
  store,
  onOpen,
  onCreateDashboard,
}: {
  store: LibraryStore
  onOpen: (dashboard: DashboardRecord) => void
  onCreateDashboard: () => void
}) {
  const recent = store.recentDashboardIds
    .map((id) => store.dashboards.find((dashboard) => dashboard.id === id))
    .filter((dashboard): dashboard is DashboardRecord => Boolean(dashboard))
  const favorites = store.dashboards.filter((dashboard) => dashboard.favorite)
  return (
    <div className="library-home">
      <header className="library-page-header">
        <div>
          <span className="page-kicker">Dashboard library</span>
          <h1>Your intelligence workspace</h1>
          <p>Turn project spreadsheets into dashboards without formulas, helper sheets, or measure syntax.</p>
        </div>
        <button className="kp-button primary" type="button" onClick={onCreateDashboard}><Plus size={16} /> New dashboard</button>
      </header>
      <section className="home-summary">
        <div><span><Folder size={18} /></span><strong>{store.projects.length}</strong><small>Projects</small></div>
        <div><span><LayoutDashboard size={18} /></span><strong>{store.dashboards.length}</strong><small>Dashboards</small></div>
        <div><span><Star size={18} /></span><strong>{favorites.length}</strong><small>Favorites</small></div>
        <div><span><Database size={18} /></span><strong>{store.projects.filter((project) => project.sourceFolder).length}</strong><small>Live folders</small></div>
      </section>
      <section className="library-content-section">
        <div className="section-heading">
          <div><h2>Featured</h2><p>Ready-to-use dashboards built from real reporting workflows.</p></div>
        </div>
        <div className="featured-dashboard-row">
          {store.dashboards.filter((dashboard) => dashboard.featured).map((dashboard) => {
            const project = store.projects.find((candidate) => candidate.id === dashboard.projectId)
            return (
              <button type="button" key={dashboard.id} onClick={() => onOpen(dashboard)}>
                <span className="featured-dashboard-icon"><Sparkles size={22} /></span>
                <div>
                  <span>Featured template</span>
                  <strong>{dashboard.name}</strong>
                  <p>{dashboard.description}</p>
                  <small>{project?.name}</small>
                </div>
                <ArrowRight size={18} />
              </button>
            )
          })}
        </div>
      </section>
      <section className="library-content-section">
        <div className="section-heading">
          <div><h2>Recent dashboards</h2><p>Pick up where you left off.</p></div>
        </div>
        <div className="dashboard-list-grid">
          {(recent.length > 0 ? recent : store.dashboards.slice(0, 4)).map((dashboard) => {
            const project = store.projects.find((candidate) => candidate.id === dashboard.projectId)
            return (
              <button type="button" key={dashboard.id} onClick={() => onOpen(dashboard)}>
                <span className={dashboard.featured ? 'featured' : ''}>{dashboardIcon(dashboard)}</span>
                <div>
                  <strong>{dashboard.name}</strong>
                  <small>{project?.name ?? 'Project'} · {dashboard.pages.length || 3} page{dashboard.pages.length === 1 ? '' : 's'}</small>
                </div>
                <ChevronRight size={16} />
              </button>
            )
          })}
        </div>
      </section>
    </div>
  )
}

function ProjectView({
  project,
  dashboards,
  source,
  persistentFolders,
  onOpen,
  onCreateDashboard,
  onChooseSource,
  onRefresh,
}: {
  project: ProjectRecord
  dashboards: DashboardRecord[]
  source: SourceState
  persistentFolders: boolean
  onOpen: (dashboard: DashboardRecord) => void
  onCreateDashboard: () => void
  onChooseSource: () => void
  onRefresh: () => void
}) {
  return (
    <div className="project-overview">
      <header className="library-page-header">
        <div>
          <span className="page-kicker">Project</span>
          <h1>{project.name}</h1>
          <p>{project.description || 'Dashboards, project data, and exports in one place.'}</p>
        </div>
        <button className="kp-button primary" type="button" onClick={onCreateDashboard}><Plus size={16} /> New dashboard</button>
      </header>
      <section className={`project-source-band ${source.status}`}>
        <div className="project-source-icon"><FolderOpen size={21} /></div>
        <div>
          <span>Project data</span>
          <strong>{folderName(project.sourceFolder)}</strong>
          <p>{source.message}</p>
        </div>
        <div className="project-source-stats">
          <span><strong>{source.catalog?.workbooks.length ?? project.sourceFileCount}</strong> files</span>
          <span><strong>{source.catalog?.datasets.length ?? project.sourceDatasetCount}</strong> worksheets</span>
          <span><strong>{formatRelative(project.sourceRefreshedAt)}</strong> refresh</span>
        </div>
        <div className="project-source-actions">
          {persistentFolders && (
            <button className="kp-button secondary" type="button" onClick={onChooseSource}>
              <FolderOpen size={15} /> {project.sourceFolder ? 'Change folder' : 'Choose folder'}
            </button>
          )}
          <button className="kp-icon-button" type="button" onClick={onRefresh} disabled={!project.sourceFolder || source.status === 'loading'} aria-label="Refresh project data">
            <RefreshCw className={source.status === 'loading' ? 'spin' : ''} size={16} />
          </button>
        </div>
      </section>
      <section className="library-content-section">
        <div className="section-heading">
          <div><h2>Dashboards</h2><p>{dashboards.length} dashboard{dashboards.length === 1 ? '' : 's'} in this project.</p></div>
        </div>
        <div className="project-dashboard-grid">
          {dashboards.map((dashboard) => (
            <button type="button" key={dashboard.id} onClick={() => onOpen(dashboard)}>
              <span className={dashboard.featured ? 'featured' : ''}>{dashboardIcon(dashboard)}</span>
              <div>
                <div><strong>{dashboard.name}</strong>{dashboard.favorite && <Star size={13} fill="currentColor" />}</div>
                <p>{dashboard.description || 'Custom dashboard'}</p>
                <small>{dashboard.kind === 'oacWeekly' ? 'Weekly QA/QC template' : `${dashboard.pages.length} page${dashboard.pages.length === 1 ? '' : 's'}`}</small>
              </div>
              <ChevronRight size={17} />
            </button>
          ))}
          <button className="new-dashboard-tile" type="button" onClick={onCreateDashboard}>
            <Plus size={20} /><strong>New dashboard</strong><small>Start blank or use a template</small>
          </button>
        </div>
      </section>
    </div>
  )
}

export default function KPIntelligenceShell() {
  const [store, setStore] = useState<LibraryStore>(createEmptyLibrary)
  const storeRef = useRef(store)
  storeRef.current = store
  const [loading, setLoading] = useState(true)
  const [libraryLoadError, setLibraryLoadError] = useState<string | null>(null)
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [librarySaveState, setLibrarySaveState] = useState<{
    status: 'saved' | 'saving' | 'error'
    message: string
  }>({ status: 'saved', message: 'Saved locally' })
  const [createRequest, setCreateRequest] = useState<CreateRequest | null>(null)
  const [sourceStates, setSourceStates] = useState<Record<string, SourceState>>({})
  const sourceStatesRef = useRef(sourceStates)
  sourceStatesRef.current = sourceStates
  const [oacSnapshots, setOacSnapshots] = useState<Record<string, WorkspaceSourceSnapshot | null>>({})
  const [oacSourceStates, setOacSourceStates] = useState<Record<string, {
    status: 'idle' | 'loading' | 'ready' | 'error'
    message: string
  }>>({})
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null)
  const [updateOpen, setUpdateOpen] = useState(false)
  const [updateChecking, setUpdateChecking] = useState(false)
  const [updateCheckError, setUpdateCheckError] = useState<string | null>(null)
  const [lastUpdateCheck, setLastUpdateCheck] = useState<Date | null>(null)
  const [exportOpen, setExportOpen] = useState(false)
  const [libraryNotice, setLibraryNotice] = useState<string | null>(null)
  const refreshTimers = useRef<Record<string, number>>({})
  const sourceRefreshGeneration = useRef<Record<string, number>>({})
  const oacRefreshGeneration = useRef<Record<string, number>>({})
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve())
  const latestSaveRevisionRef = useRef(store.revision)
  const noticeTimerRef = useRef<number | null>(null)

  const showLibraryNotice = useCallback((message: string): void => {
    if (noticeTimerRef.current !== null) window.clearTimeout(noticeTimerRef.current)
    setLibraryNotice(message)
    noticeTimerRef.current = window.setTimeout(() => {
      setLibraryNotice(null)
      noticeTimerRef.current = null
    }, 6000)
  }, [])

  useEffect(() => () => {
    if (noticeTimerRef.current !== null) window.clearTimeout(noticeTimerRef.current)
  }, [])

  const queueLibrarySave = useCallback((next: LibraryStore): void => {
    const revision = next.revision
    latestSaveRevisionRef.current = revision
    setLibrarySaveState({ status: 'saving', message: 'Saving locally…' })
    saveQueueRef.current = saveQueueRef.current
      .catch(() => undefined)
      .then(() => saveLibrary(platform, next))
      .then(() => {
        if (latestSaveRevisionRef.current === revision) {
          setLibrarySaveState({ status: 'saved', message: 'Saved locally' })
        }
      })
      .catch((error) => {
        if (latestSaveRevisionRef.current === revision) {
          setLibrarySaveState({
            status: 'error',
            message: error instanceof Error ? error.message : 'Local changes could not be saved.',
          })
        }
      })
  }, [])

  useEffect(() => {
    let active = true
    setLoading(true)
    setLibraryLoadError(null)
    void loadLibrary(platform).then((value) => {
      if (!active) return
      storeRef.current = value
      latestSaveRevisionRef.current = value.revision
      setStore(value)
      setLoading(false)
    }).catch((error) => {
      if (active) {
        setLibraryLoadError(
          error instanceof Error ? error.message : 'The local dashboard library could not be opened.',
        )
        setLoading(false)
      }
    })
    return () => { active = false }
  }, [loadAttempt])

  const commitStore = useCallback((updater: (current: LibraryStore) => LibraryStore): void => {
    const current = storeRef.current
    const updated = updater(current)
    if (updated === current) return
    const next = { ...updated, revision: current.revision + 1 }
    storeRef.current = next
    setStore(next)
    queueLibrarySave(next)
  }, [queueLibrarySave])

  const selectedDashboard = store.selection.kind === 'dashboard'
    ? store.dashboards.find((dashboard) => dashboard.id === store.selection.id) ?? null
    : null
  const selectedProject = useMemo(() => {
    if (store.selection.kind === 'project') {
      return store.projects.find((project) => project.id === store.selection.id) ?? null
    }
    if (selectedDashboard) {
      return store.projects.find((project) => project.id === selectedDashboard.projectId) ?? null
    }
    return null
  }, [store.selection, store.projects, selectedDashboard])
  const selectedFolder = store.selection.kind === 'folder'
    ? store.folders.find((folder) => folder.id === store.selection.id) ?? null
    : null
  const selectedSource = selectedProject
    ? sourceStates[selectedProject.id] ?? {
        status: selectedProject.sourceFolder ? 'idle' : 'idle',
        message: selectedProject.sourceFolder
          ? 'Open or refresh this project to profile its spreadsheets.'
          : 'Choose a synced SharePoint or OneDrive folder.',
        catalog: null,
      }
    : null

  const checkUpdates = useCallback(async (): Promise<void> => {
    if (updateChecking) return
    setUpdateChecking(true)
    setUpdateCheckError(null)
    try {
      setUpdateInfo(await checkForUpdate())
      setLastUpdateCheck(new Date())
    } catch {
      setUpdateCheckError('Check your network or proxy, then try again.')
    } finally {
      setUpdateChecking(false)
    }
  }, [updateChecking])

  useEffect(() => {
    if (import.meta.env.PROD) void checkUpdates()
  }, [])

  const refreshOacProject = useCallback(async (project: ProjectRecord): Promise<void> => {
    if (!project.sourceFolder) return
    const generation = (oacRefreshGeneration.current[project.id] ?? 0) + 1
    oacRefreshGeneration.current[project.id] = generation
    const isCurrent = () => oacRefreshGeneration.current[project.id] === generation
    setOacSourceStates((current) => ({
      ...current,
      [project.id]: { status: 'loading', message: 'Matching the four weekly QA/QC reports…' },
    }))
    try {
      const snapshot = await loadWorkspaceSource(platform, project.sourceFolder)
      if (!isCurrent()) return
      setOacSnapshots((current) => ({ ...current, [project.id]: snapshot }))
      setOacSourceStates((current) => ({
        ...current,
        [project.id]: {
          status: 'ready',
          message: `${snapshot.displayNames.join(', ')} · refreshed ${new Date(snapshot.loadedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`,
        },
      }))
    } catch (error) {
      if (!isCurrent()) return
      setOacSnapshots((current) => ({ ...current, [project.id]: current[project.id] ?? null }))
      setOacSourceStates((current) => ({
        ...current,
        [project.id]: {
          status: 'error',
          message: error instanceof Error
            ? error.message
            : 'The four weekly QA/QC reports could not be matched.',
        },
      }))
    }
  }, [])

  const refreshProject = useCallback(async (
    project: ProjectRecord,
    includeOac = false,
    previousCatalogOverride?: SpreadsheetCatalogProfile | null,
  ): Promise<void> => {
    if (!project.sourceFolder) return
    const generation = (sourceRefreshGeneration.current[project.id] ?? 0) + 1
    sourceRefreshGeneration.current[project.id] = generation
    const isCurrent = () => sourceRefreshGeneration.current[project.id] === generation
    if (includeOac) void refreshOacProject(project)
    setSourceStates((current) => ({
      ...current,
      [project.id]: {
        status: 'loading',
        message: 'Scanning spreadsheets and checking column types…',
        catalog: current[project.id]?.catalog ?? null,
      },
    }))
    try {
      const descriptors = (await platform.listFiles(project.sourceFolder))
        .filter((file) =>
          isUsableSourceFile(file)
          && (isSupportedSpreadsheet(file.name) || isZipArchive(file.name)))
      if (descriptors.length === 0) {
        throw new Error('No XLS, XLSX, CSV, or ZIP spreadsheet files were found in this folder.')
      }
      if (descriptors.length > MAX_PROJECT_SOURCE_FILES) {
        throw new Error(`This folder contains more than ${MAX_PROJECT_SOURCE_FILES} spreadsheet files. Choose a narrower project folder.`)
      }
      const oversized = descriptors.find((file) => file.size > MAX_SOURCE_FILE_BYTES)
      if (oversized) {
        throw new Error(`${oversized.name} is larger than the 250 MB per-file safety limit.`)
      }
      const aggregateBytes = descriptors.reduce((total, file) => total + file.size, 0)
      if (aggregateBytes > MAX_PROJECT_SOURCE_BYTES) {
        throw new Error('The selected spreadsheets exceed the 750 MB project safety limit.')
      }
      const inputs = await mapWithConcurrency(descriptors, 4, async (file) => ({
        name: file.name,
        path: file.path,
        size: file.size,
        lastModified: file.modifiedAt,
        bytes: await platform.readFile(file.path),
      }))
      if (!isCurrent()) return
      const catalog = await profileSpreadsheetInputs(inputs)
      if (!isCurrent()) return
      const previousCatalog = previousCatalogOverride === undefined
        ? sourceStatesRef.current[project.id]?.catalog ?? null
        : previousCatalogOverride
      const refreshedAt = now()
      setSourceStates((current) => ({
        ...current,
        [project.id]: {
          status: catalog.warnings.length > 0 ? 'warning' : 'ready',
          message: `${catalog.datasets.length} worksheet${catalog.datasets.length === 1 ? '' : 's'} ready from ${catalog.workbooks.length} file${catalog.workbooks.length === 1 ? '' : 's'}.`,
          catalog,
        },
      }))
      commitStore((current) => ({
        ...current,
        projects: current.projects.map((candidate) => candidate.id === project.id
          ? {
              ...candidate,
              sourceFileCount: catalog.workbooks.length,
              sourceDatasetCount: catalog.datasets.length,
              sourceRefreshedAt: refreshedAt,
              updatedAt: refreshedAt,
            }
          : candidate),
        dashboards: current.dashboards.map((dashboard) => dashboard.projectId === project.id
          ? rebindDashboardSources(dashboard, catalog, previousCatalog)
          : dashboard),
      }))
    } catch (error) {
      if (!isCurrent()) return
      setSourceStates((current) => ({
        ...current,
        [project.id]: {
          status: current[project.id]?.catalog ? 'warning' : 'error',
          message: error instanceof Error ? error.message : 'The project folder could not be read.',
          catalog: current[project.id]?.catalog ?? null,
        },
      }))
    }
  }, [commitStore, refreshOacProject])

  useEffect(() => {
    if (!selectedProject?.sourceFolder) return
    const includeOac = selectedDashboard?.kind === 'oacWeekly'
    if (
      !sourceStates[selectedProject.id]?.catalog
      && sourceStates[selectedProject.id]?.status !== 'loading'
    ) {
      void refreshProject(selectedProject, includeOac)
    } else if (
      includeOac
      && !oacSnapshots[selectedProject.id]
      && oacSourceStates[selectedProject.id]?.status !== 'loading'
    ) {
      void refreshOacProject(selectedProject)
    }

    let cancelled = false
    let stop: (() => void) | undefined
    if (platform.supportsPersistentFolders) {
      void platform.watchDirectory(selectedProject.sourceFolder, () => {
        window.clearTimeout(refreshTimers.current[selectedProject.id])
        refreshTimers.current[selectedProject.id] = window.setTimeout(
          () => void refreshProject(selectedProject, includeOac),
          1200,
        )
      }).then((cleanup) => {
        if (cancelled) cleanup()
        else stop = cleanup
      }).catch(() => undefined)
    }
    return () => {
      cancelled = true
      stop?.()
      window.clearTimeout(refreshTimers.current[selectedProject.id])
    }
  }, [selectedProject?.id, selectedProject?.sourceFolder, selectedDashboard?.kind])

  function select(selection: LibrarySelection): void {
    commitStore((current) => {
      const recentDashboardIds = selection.kind === 'dashboard'
        ? [selection.id, ...current.recentDashboardIds.filter((id) => id !== selection.id)].slice(0, 12)
        : current.recentDashboardIds
      return { ...current, selection, recentDashboardIds }
    })
  }

  function createEntity(request: CreateRequest, name: string, dashboardKind: DashboardRecord['kind'] = 'custom'): void {
    const createdAt = now()
    if (request.kind === 'folder') {
      const id = createId('folder')
      commitStore((current) => ({
        ...current,
        folders: [...current.folders, {
          id,
          name,
          parentId: request.parentId,
          order: current.folders.filter((folder) => folder.parentId === request.parentId).length,
          createdAt,
          updatedAt: createdAt,
        }],
        expandedFolderIds: request.parentId
          ? [...new Set([...current.expandedFolderIds, request.parentId])]
          : current.expandedFolderIds,
        selection: { kind: 'folder', id },
      }))
    } else if (request.kind === 'project') {
      const id = createId('project')
      commitStore((current) => ({
        ...current,
        projects: [...current.projects, {
          id,
          name,
          description: '',
          folderId: request.folderId,
          sourceFolder: null,
          sourceFileCount: 0,
          sourceDatasetCount: 0,
          sourceRefreshedAt: null,
          createdAt,
          updatedAt: createdAt,
        }],
        expandedProjectIds: [...current.expandedProjectIds, id],
        selection: { kind: 'project', id },
      }))
    } else {
      const id = createId('dashboard')
      const page = dashboardKind === 'custom'
        ? [{
            id: createId('page'),
            name: 'Overview',
            order: 0,
            widgets: [],
            createdAt,
            updatedAt: createdAt,
          }]
        : []
      commitStore((current) => {
        const dashboard: DashboardRecord = {
          id,
          projectId: request.projectId,
          name,
          description: dashboardKind === 'oacWeekly'
            ? 'Weekly OAC-ready quality report with issues, inspections, and welding signoffs.'
            : '',
          kind: dashboardKind,
          featured: false,
          favorite: false,
          pages: page,
          filters: [],
          createdAt,
          updatedAt: createdAt,
        }
        const exportProfile: ExportProfileRecord = {
          id: createId('export'),
          projectId: request.projectId,
          dashboardId: id,
          name: 'Widescreen report',
          format: 'pptx',
          pageSize: 'widescreen',
          orientation: 'landscape',
          margin: 0.35,
          includeTitle: true,
          includeGeneratedAt: true,
          includePageNumbers: true,
          tableOverflow: 'paginate',
          scale: 4,
          headerText: '',
          footerText: '',
          createdAt,
          updatedAt: createdAt,
        }
        return {
          ...current,
          dashboards: [...current.dashboards, dashboard],
          exportProfiles: [...current.exportProfiles, exportProfile],
          expandedProjectIds: [...new Set([...current.expandedProjectIds, request.projectId])],
          recentDashboardIds: [id, ...current.recentDashboardIds].slice(0, 12),
          selection: { kind: 'dashboard', id },
        }
      })
    }
    setCreateRequest(null)
  }

  function rename(kind: 'folder' | 'project' | 'dashboard', id: string, name: string): void {
    const updatedAt = now()
    commitStore((current) => ({
      ...current,
      folders: kind === 'folder' ? current.folders.map((folder) => folder.id === id ? { ...folder, name, updatedAt } : folder) : current.folders,
      projects: kind === 'project' ? current.projects.map((project) => project.id === id ? { ...project, name, updatedAt } : project) : current.projects,
      dashboards: kind === 'dashboard' ? current.dashboards.map((dashboard) => dashboard.id === id ? { ...dashboard, name, updatedAt } : dashboard) : current.dashboards,
    }))
  }

  function deleteEntity(kind: 'folder' | 'project' | 'dashboard', id: string): void {
    const label = kind === 'folder'
      ? store.folders.find((folder) => folder.id === id)?.name
      : kind === 'project'
        ? store.projects.find((project) => project.id === id)?.name
        : store.dashboards.find((dashboard) => dashboard.id === id)?.name
    if (!window.confirm(`Delete “${label ?? kind}”? Source files will not be changed.`)) return
    commitStore((current) => {
      if (kind === 'dashboard') {
        return {
          ...current,
          dashboards: current.dashboards.filter((dashboard) => dashboard.id !== id),
          exportProfiles: current.exportProfiles.filter((profile) => profile.dashboardId !== id),
          selection: { kind: 'home', id: 'home' },
        }
      }
      if (kind === 'project') {
        const dashboardIds = new Set(current.dashboards.filter((dashboard) => dashboard.projectId === id).map((dashboard) => dashboard.id))
        return {
          ...current,
          projects: current.projects.filter((project) => project.id !== id),
          dashboards: current.dashboards.filter((dashboard) => dashboard.projectId !== id),
          exportProfiles: current.exportProfiles.filter((profile) => !dashboardIds.has(profile.dashboardId ?? '')),
          selection: { kind: 'home', id: 'home' },
        }
      }
      const folderIds = new Set<string>([id])
      let changed = true
      while (changed) {
        changed = false
        current.folders.forEach((folder) => {
          if (folder.parentId && folderIds.has(folder.parentId) && !folderIds.has(folder.id)) {
            folderIds.add(folder.id)
            changed = true
          }
        })
      }
      const projectIds = new Set(current.projects.filter((project) => project.folderId && folderIds.has(project.folderId)).map((project) => project.id))
      const dashboardIds = new Set(current.dashboards.filter((dashboard) => projectIds.has(dashboard.projectId)).map((dashboard) => dashboard.id))
      return {
        ...current,
        folders: current.folders.filter((folder) => !folderIds.has(folder.id)),
        projects: current.projects.filter((project) => !projectIds.has(project.id)),
        dashboards: current.dashboards.filter((dashboard) => !dashboardIds.has(dashboard.id)),
        exportProfiles: current.exportProfiles.filter((profile) => !dashboardIds.has(profile.dashboardId ?? '')),
        selection: { kind: 'home', id: 'home' },
      }
    })
  }

  function duplicateDashboard(id: string): void {
    const source = store.dashboards.find((dashboard) => dashboard.id === id)
    if (!source) return
    const sourceExportProfile = store.exportProfiles.find((profile) => profile.dashboardId === id)
    const createdAt = now()
    const pageIds = new Map(source.pages.map((page) => [page.id, createId('page')]))
    const duplicate: DashboardRecord = {
      ...structuredClone(source),
      id: createId('dashboard'),
      name: `${source.name} copy`,
      featured: false,
      favorite: false,
      pages: source.pages.map((page) => ({
        ...structuredClone(page),
        id: pageIds.get(page.id) ?? createId('page'),
        widgets: page.widgets.map((widget) => ({
          ...structuredClone(widget),
          id: createId('widget'),
          query: {
            ...structuredClone(widget.query),
            conditions: widget.query.conditions.map((condition) => ({ ...condition, id: createId('condition') })),
          },
          createdAt,
          updatedAt: createdAt,
        })),
        createdAt,
        updatedAt: createdAt,
      })),
      createdAt,
      updatedAt: createdAt,
    }
    const duplicateExportProfile: ExportProfileRecord = {
      ...(sourceExportProfile ?? {
        id: '',
        projectId: duplicate.projectId,
        dashboardId: duplicate.id,
        name: 'Widescreen report',
        format: 'pptx',
        pageSize: 'widescreen',
        orientation: 'landscape',
        margin: 0.35,
        includeTitle: true,
        includeGeneratedAt: true,
        includePageNumbers: true,
        tableOverflow: 'paginate',
        scale: 4,
        headerText: '',
        footerText: '',
        createdAt,
        updatedAt: createdAt,
      }),
      id: createId('export'),
      projectId: duplicate.projectId,
      dashboardId: duplicate.id,
      name: sourceExportProfile ? `${sourceExportProfile.name} copy` : 'Widescreen report',
      createdAt,
      updatedAt: createdAt,
    }
    commitStore((current) => ({
      ...current,
      dashboards: [...current.dashboards, duplicate],
      exportProfiles: [...current.exportProfiles, duplicateExportProfile],
      selection: { kind: 'dashboard', id: duplicate.id },
      recentDashboardIds: [duplicate.id, ...current.recentDashboardIds].slice(0, 12),
    }))
  }

  function moveItem(
    kind: 'folder' | 'project' | 'dashboard',
    id: string,
    targetKind: 'folder' | 'project' | 'root',
    targetId: string | null,
  ): void {
    if (kind === 'dashboard' && targetKind === 'project' && targetId) {
      const current = storeRef.current
      const dashboard = current.dashboards.find((candidate) => candidate.id === id)
      if (!dashboard || dashboard.projectId === targetId) return
      const targetCatalog = sourceStatesRef.current[targetId]?.catalog ?? null
      if (dashboardHasDataBindings(dashboard) && !targetCatalog) {
        showLibraryNotice('Open the destination project and load its spreadsheet source before moving this dashboard.')
        return
      }
      const moved = { ...dashboard, projectId: targetId, updatedAt: now() }
      const rebound = targetCatalog
        ? rebindDashboardSources(
            moved,
            targetCatalog,
            sourceStatesRef.current[dashboard.projectId]?.catalog ?? null,
          )
        : moved
      if (targetCatalog && !dashboardBindingsResolve(rebound, targetCatalog)) {
        showLibraryNotice('The destination source does not contain an unambiguous match for every visual. The dashboard was not moved.')
        return
      }
      commitStore((latest) => ({
        ...latest,
        dashboards: latest.dashboards.map((candidate) => candidate.id === id ? rebound : candidate),
        exportProfiles: latest.exportProfiles.map((profile) => profile.dashboardId === id
          ? { ...profile, projectId: targetId, updatedAt: now() }
          : profile),
      }))
      return
    }
    commitStore((current) => {
      if (kind === 'project' && (targetKind === 'folder' || targetKind === 'root')) {
        return {
          ...current,
          projects: current.projects.map((project) => project.id === id
            ? { ...project, folderId: targetKind === 'folder' ? targetId : null, updatedAt: now() }
            : project),
        }
      }
      if (kind === 'folder' && (targetKind === 'folder' || targetKind === 'root')) {
        const descendants = new Set<string>([id])
        let changed = true
        while (changed) {
          changed = false
          current.folders.forEach((folder) => {
            if (folder.parentId && descendants.has(folder.parentId) && !descendants.has(folder.id)) {
              descendants.add(folder.id)
              changed = true
            }
          })
        }
        if (targetId && descendants.has(targetId)) return current
        return {
          ...current,
          folders: current.folders.map((folder) => folder.id === id
            ? { ...folder, parentId: targetKind === 'folder' ? targetId : null, updatedAt: now() }
            : folder),
        }
      }
      return current
    })
  }

  async function chooseSource(project: ProjectRecord): Promise<void> {
    const folder = await platform.chooseDirectory()
    if (!folder) return
    const previousCatalog = sourceStatesRef.current[project.id]?.catalog ?? null
    sourceRefreshGeneration.current[project.id] = (sourceRefreshGeneration.current[project.id] ?? 0) + 1
    oacRefreshGeneration.current[project.id] = (oacRefreshGeneration.current[project.id] ?? 0) + 1
    setSourceStates((current) => ({
      ...current,
      [project.id]: {
        status: 'loading',
        message: 'Opening the new source folder…',
        catalog: null,
      },
    }))
    setOacSnapshots((current) => ({ ...current, [project.id]: null }))
    setOacSourceStates((current) => ({
      ...current,
      [project.id]: {
        status: 'idle',
        message: 'Waiting to match the four weekly QA/QC reports.',
      },
    }))
    const updatedProject = { ...project, sourceFolder: folder, updatedAt: now() }
    commitStore((current) => ({
      ...current,
      projects: current.projects.map((candidate) => candidate.id === project.id ? updatedProject : candidate),
    }))
    void refreshProject(
      updatedProject,
      selectedDashboard?.kind === 'oacWeekly',
      previousCatalog,
    )
  }

  async function importSessionFiles(project: ProjectRecord, files: File[]): Promise<void> {
    if (files.length === 0) return
    const generation = (sourceRefreshGeneration.current[project.id] ?? 0) + 1
    sourceRefreshGeneration.current[project.id] = generation
    const isCurrent = () => sourceRefreshGeneration.current[project.id] === generation
    const previousCatalog = sourceStatesRef.current[project.id]?.catalog ?? null
    setSourceStates((current) => ({
      ...current,
      [project.id]: { status: 'loading', message: 'Profiling imported spreadsheets…', catalog: current[project.id]?.catalog ?? null },
    }))
    try {
      if (files.length > MAX_PROJECT_SOURCE_FILES) {
        throw new Error(`Import up to ${MAX_PROJECT_SOURCE_FILES} spreadsheet files at a time.`)
      }
      const oversized = files.find((file) => file.size > MAX_SOURCE_FILE_BYTES)
      if (oversized) {
        throw new Error(`${oversized.name} is larger than the 250 MB per-file safety limit.`)
      }
      const aggregateBytes = files.reduce((total, file) => total + file.size, 0)
      if (aggregateBytes > MAX_PROJECT_SOURCE_BYTES) {
        throw new Error('The imported spreadsheets exceed the 750 MB project safety limit.')
      }
      const catalog = await profileSpreadsheetInputs(files)
      if (!isCurrent()) return
      setSourceStates((current) => ({
        ...current,
        [project.id]: {
          status: catalog.warnings.length > 0 ? 'warning' : 'ready',
          message: `${catalog.datasets.length} worksheet${catalog.datasets.length === 1 ? '' : 's'} ready for this session.`,
          catalog,
        },
      }))
      commitStore((current) => ({
        ...current,
        dashboards: current.dashboards.map((dashboard) => dashboard.projectId === project.id
          ? rebindDashboardSources(dashboard, catalog, previousCatalog)
          : dashboard),
      }))
    } catch (error) {
      if (!isCurrent()) return
      setSourceStates((current) => ({
        ...current,
        [project.id]: {
          status: 'error',
          message: error instanceof Error ? error.message : 'The spreadsheets could not be imported.',
          catalog: current[project.id]?.catalog ?? null,
        },
      }))
    }
  }

  function updateDashboard(dashboard: DashboardRecord): void {
    commitStore((current) => ({
      ...current,
      dashboards: current.dashboards.map((candidate) => candidate.id === dashboard.id ? dashboard : candidate),
    }))
  }

  function updateReportFilters(projectId: string, filters: ReportFilters): void {
    commitStore((current) => {
      const project = current.projects.find((candidate) => candidate.id === projectId)
      if (!project || sameReportFilters(project.reportFilters, filters)) return current
      return {
        ...current,
        projects: current.projects.map((candidate) => candidate.id === projectId
          ? { ...candidate, reportFilters: filters, updatedAt: now() }
          : candidate),
      }
    })
  }

  const exportProfile = selectedDashboard
    ? store.exportProfiles.find((profile) => profile.dashboardId === selectedDashboard.id) ?? null
    : null

  function updateExportProfile(profile: ExportProfileRecord): void {
    commitStore((current) => ({
      ...current,
      exportProfiles: current.exportProfiles.map((candidate) => candidate.id === profile.id ? profile : candidate),
    }))
  }

  async function exportCustomDashboard(profile: ExportProfileRecord): Promise<void> {
    window.dispatchEvent(new CustomEvent('kpintelligence:export-dashboard', { detail: { profileId: profile.id } }))
    setExportOpen(false)
  }

  if (loading) {
    return (
      <div className="kp-loading">
        <span><BarChart3 size={25} /></span>
        <strong>KPIntelligence</strong>
        <RefreshCw className="spin" size={17} />
      </div>
    )
  }

  if (libraryLoadError) {
    return (
      <div className="kp-library-blocked">
        <span><AlertTriangle size={28} /></span>
        <h1>Your dashboard library is protected</h1>
        <p>{libraryLoadError}</p>
        <small>No stored dashboards were changed or replaced.</small>
        <button className="kp-button primary" type="button" onClick={() => setLoadAttempt((attempt) => attempt + 1)}>
          <RefreshCw size={16} /> Try again
        </button>
      </div>
    )
  }

  let content: React.ReactNode
  if (selectedDashboard && selectedProject) {
    if (selectedDashboard.kind === 'oacWeekly') {
      const snapshot = oacSnapshots[selectedProject.id]
      const oacSource = oacSourceStates[selectedProject.id] ?? {
        status: selectedProject.sourceFolder ? 'idle' as const : 'idle' as const,
        message: selectedProject.sourceFolder
          ? 'Open or refresh to match the BIM, Mechanical, Electrical, and Welding reports.'
          : 'Choose a synced SharePoint or OneDrive folder.',
      }
      const autoImport: DashboardAutoImport | null = snapshot
        ? { files: snapshot.files, fingerprint: snapshot.fingerprint }
        : null
      content = (
        <div className="oac-dashboard-host">
          <App
            key={selectedDashboard.id}
            autoImport={autoImport}
            initialFilters={selectedProject.reportFilters}
            onFiltersChange={(filters) => updateReportFilters(selectedProject.id, filters)}
            disableUpdateChecks
            workspaceContext={{
              workspaceName: selectedProject.name,
              sourceStatus: oacSource.status === 'ready'
                ? 'Folder sync active'
                : oacSource.status === 'loading'
                  ? 'Matching reports'
                  : 'OAC source needs attention',
              sourceMessage: oacSource.message,
              backLabel: 'Project',
              onShowWorkspaces: () => select({ kind: 'project', id: selectedProject.id }),
              onRefresh: () => void refreshProject(selectedProject, true),
            }}
          />
        </div>
      )
    } else {
      content = (
        <DashboardStudio
          key={selectedDashboard.id}
          dashboard={selectedDashboard}
          project={selectedProject}
          catalog={selectedSource?.catalog ?? null}
          sourceStatus={selectedSource?.status ?? 'idle'}
          sourceMessage={selectedSource?.message ?? 'Choose a synced SharePoint or OneDrive folder.'}
          exportProfile={exportProfile}
          onChange={updateDashboard}
          onChooseSource={() => void chooseSource(selectedProject)}
          onImportFiles={(files) => void importSessionFiles(selectedProject, files)}
          onRefreshSource={() => void refreshProject(selectedProject)}
          onOpenExport={() => setExportOpen(true)}
          onBack={() => select({ kind: 'project', id: selectedProject.id })}
          persistenceStatus={librarySaveState.status}
          persistenceMessage={librarySaveState.message}
        />
      )
    }
  } else if (selectedProject) {
    content = (
      <ProjectView
        project={selectedProject}
        dashboards={store.dashboards.filter((dashboard) => dashboard.projectId === selectedProject.id)}
        source={selectedSource ?? { status: 'idle', message: 'Choose a source folder.', catalog: null }}
        persistentFolders={platform.supportsPersistentFolders}
        onOpen={(dashboard) => select({ kind: 'dashboard', id: dashboard.id })}
        onCreateDashboard={() => setCreateRequest({ kind: 'dashboard', projectId: selectedProject.id })}
        onChooseSource={() => void chooseSource(selectedProject)}
        onRefresh={() => void refreshProject(selectedProject)}
      />
    )
  } else if (selectedFolder) {
    const projects = store.projects.filter((project) => project.folderId === selectedFolder.id)
    content = (
      <div className="folder-overview">
        <header className="library-page-header">
          <div><span className="page-kicker">Folder</span><h1>{selectedFolder.name}</h1><p>{projects.length} organized project{projects.length === 1 ? '' : 's'}.</p></div>
          <button className="kp-button primary" type="button" onClick={() => setCreateRequest({ kind: 'project', folderId: selectedFolder.id })}><Plus size={16} /> New project</button>
        </header>
        <section className="library-content-section">
          <div className="project-list">
            {projects.map((project) => (
              <button type="button" key={project.id} onClick={() => select({ kind: 'project', id: project.id })}>
                <span><BarChart3 size={18} /></span>
                <div><strong>{project.name}</strong><small>{store.dashboards.filter((dashboard) => dashboard.projectId === project.id).length} dashboards · {folderName(project.sourceFolder)}</small></div>
                <ChevronRight size={16} />
              </button>
            ))}
          </div>
        </section>
      </div>
    )
  } else {
    content = (
      <HomeView
        store={store}
        onOpen={(dashboard) => select({ kind: 'dashboard', id: dashboard.id })}
        onCreateDashboard={() => setCreateRequest({ kind: 'dashboard', projectId: store.projects[0]?.id ?? '' })}
      />
    )
  }

  return (
    <div className="kp-shell">
      <LibrarySidebar
        store={store}
        updateAvailable={Boolean(updateInfo)}
        onSelect={select}
        onCreateFolder={(parentId) => setCreateRequest({ kind: 'folder', parentId })}
        onCreateProject={(folderId) => setCreateRequest({ kind: 'project', folderId })}
        onCreateDashboard={(projectId) => {
          if (projectId) setCreateRequest({ kind: 'dashboard', projectId })
          else setCreateRequest({ kind: 'project', folderId: null })
        }}
        onRename={rename}
        onDelete={deleteEntity}
        onDuplicateDashboard={duplicateDashboard}
        onToggleFavorite={(id) => commitStore((current) => ({
          ...current,
          dashboards: current.dashboards.map((dashboard) => dashboard.id === id
            ? { ...dashboard, favorite: !dashboard.favorite, updatedAt: now() }
            : dashboard),
        }))}
        onToggleFolder={(id) => commitStore((current) => ({
          ...current,
          expandedFolderIds: current.expandedFolderIds.includes(id)
            ? current.expandedFolderIds.filter((folderId) => folderId !== id)
            : [...current.expandedFolderIds, id],
        }))}
        onToggleProject={(id) => commitStore((current) => ({
          ...current,
          expandedProjectIds: current.expandedProjectIds.includes(id)
            ? current.expandedProjectIds.filter((projectId) => projectId !== id)
            : [...current.expandedProjectIds, id],
        }))}
        onMove={moveItem}
        onShowUpdates={() => setUpdateOpen(true)}
      />
      <div className="kp-content">{content}</div>
      {librarySaveState.status === 'error' && (
        <div className="library-save-error" role="alert">
          <AlertTriangle size={16} />
          <span><strong>Local save failed</strong>{librarySaveState.message}</span>
          <button type="button" onClick={() => queueLibrarySave(storeRef.current)}>Retry</button>
        </div>
      )}
      {libraryNotice && (
        <div className="library-action-notice" role="status">
          <AlertTriangle size={16} />
          <span>{libraryNotice}</span>
          <button type="button" onClick={() => setLibraryNotice(null)} aria-label="Dismiss notice"><X size={14} /></button>
        </div>
      )}
      <CreateModal request={createRequest} projects={store.projects} onClose={() => setCreateRequest(null)} onCreate={createEntity} />
      <UpdateModal
        open={updateOpen}
        onClose={() => setUpdateOpen(false)}
        info={updateInfo}
        defaultTab={updateInfo ? 'update' : 'changelog'}
        checking={updateChecking}
        checkError={updateCheckError}
        lastChecked={lastUpdateCheck}
        onCheck={checkUpdates}
      />
      <ExportProfileModal
        open={exportOpen}
        profile={exportProfile}
        dashboard={selectedDashboard}
        canExport={Boolean(
          selectedSource?.catalog
          && (selectedSource.status === 'ready' || selectedSource.status === 'warning'),
        )}
        onClose={() => setExportOpen(false)}
        onChange={updateExportProfile}
        onExport={(profile) => void exportCustomDashboard(profile)}
      />
    </div>
  )
}
