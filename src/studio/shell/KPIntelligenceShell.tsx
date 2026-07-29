import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  Cloud,
  Database,
  Download,
  ExternalLink,
  FileBarChart,
  FileSpreadsheet,
  Folder,
  FolderOpen,
  FolderSync,
  LayoutDashboard,
  Link2,
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
  applySourceRepairs,
  isSupportedSpreadsheet,
  isZipArchive,
  profileSpreadsheetInputs,
  rebindDashboardSources,
  type SpreadsheetCatalogProfile,
} from '../data'
import { normalizeMicrosoft365Url } from '../data/microsoft365'
import LibrarySidebar from '../library/LibrarySidebar'
import {
  createId,
  type DashboardRecord,
  type ExportProfileRecord,
  type LibrarySelection,
  type LibraryStore,
  type ProjectRecord,
  type ProjectSourceRepairs,
  type TeamLibraryRecord,
} from '../library/model'
import {
  createEmptyLibrary,
  loadLibrary,
  loadLibraryBackup,
  restoreLibraryBackup,
  saveLibrary,
} from '../library/repository'
import {
  compareSemver,
  createDashboardPackage,
  installDashboardPackage,
  PackageInstallModal,
  readDashboardPackage,
  scanTeamLibrary,
  ShareDashboardModal,
  sourceRepairProposals,
  TeamLibraryView,
  type DashboardPackageDocument,
  type DashboardPackageFile,
  type PackagePublishOptions,
  type TeamLibraryCatalog,
} from '../packages'

type SourceState = {
  status: 'idle' | 'loading' | 'ready' | 'warning' | 'error'
  message: string
  catalog: SpreadsheetCatalogProfile | null
  rawCatalog?: SpreadsheetCatalogProfile | null
}

type TeamLibraryState = {
  status: 'idle' | 'loading' | 'ready' | 'warning' | 'error'
  message: string
  catalog: TeamLibraryCatalog | null
}

type PendingPackage = {
  document: DashboardPackageDocument
  source: 'package' | 'teamLibrary'
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

function packageAwareSourceRepairs(
  store: LibraryStore,
  projectId: string,
  catalog: SpreadsheetCatalogProfile,
): ProjectSourceRepairs {
  const project = store.projects.find((candidate) => candidate.id === projectId)
  const configured = project?.sourceRepairs ?? {
    fieldRepairs: [],
    reviewedDatasetIds: [],
  }
  const requirements = store.dashboards
    .filter((dashboard) => dashboard.projectId === projectId)
    .flatMap((dashboard) => dashboard.template?.sourceRequirements ?? [])
  const proposals = sourceRepairProposals(requirements, catalog, configured)
  return proposals.length > 0
    ? { ...configured, fieldRepairs: [...configured.fieldRepairs, ...proposals] }
    : configured
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
      ...(widget.query.secondaryConditions ?? []).map((condition) => condition.fieldId),
    ].filter((id): id is string => Boolean(id)).every((id) => fieldIds.has(id))
  }))
}

function dashboardIcon(dashboard: DashboardRecord) {
  return dashboard.featured ? <Sparkles size={19} /> : <FileBarChart size={19} />
}

function CreateModal({
  request,
  projects,
  persistentFolders,
  onClose,
  onCreate,
}: {
  request: CreateRequest | null
  projects: ProjectRecord[]
  persistentFolders: boolean
  onClose: () => void
  onCreate: (
    request: CreateRequest,
    name: string,
    dashboardKind?: DashboardRecord['kind'],
    connectDataAfterCreate?: boolean,
  ) => void
}) {
  const [name, setName] = useState('')
  const [dashboardKind, setDashboardKind] = useState<DashboardRecord['kind']>('custom')
  const [projectId, setProjectId] = useState('')
  const [connectDataAfterCreate, setConnectDataAfterCreate] = useState(true)
  const dialogRef = useRef<HTMLDivElement>(null)
  useModalFocus(Boolean(request), dialogRef, onClose)

  useEffect(() => {
    if (!request) return
    setName(request.kind === 'folder' ? 'New folder' : request.kind === 'project' ? 'New project' : 'Untitled dashboard')
    setDashboardKind('custom')
    setProjectId(request.kind === 'dashboard'
      ? request.projectId || (projects.length === 1 ? projects[0].id : '')
      : '')
    setConnectDataAfterCreate(persistentFolders)
  }, [request, persistentFolders, projects])

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
            onCreate(resolved, value, dashboardKind, connectDataAfterCreate)
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
                  {!projectId && <option value="">Choose a project</option>}
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
          {request.kind === 'project' && persistentFolders && (
            <label className="project-connect-option">
              <input
                type="checkbox"
                checked={connectDataAfterCreate}
                onChange={(event) => setConnectDataAfterCreate(event.target.checked)}
              />
              <span><Cloud size={18} /></span>
              <div>
                <strong>Connect Microsoft 365 data next</strong>
                <small>Link a Teams, SharePoint, or OneDrive synced folder.</small>
              </div>
            </label>
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

function SourceConnectionModal({
  project,
  recentFolders,
  onClose,
  onChooseFolder,
  onSaveAndOpenUrl,
}: {
  project: ProjectRecord | null
  recentFolders: string[]
  onClose: () => void
  onChooseFolder: (defaultPath?: string) => Promise<boolean>
  onSaveAndOpenUrl: (url: string) => Promise<void>
}) {
  const [webUrl, setWebUrl] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const dialogRef = useRef<HTMLDivElement>(null)
  useModalFocus(Boolean(project), dialogRef, onClose)

  useEffect(() => {
    if (!project) return
    setWebUrl(project.sourceWebUrl ?? '')
    setError(null)
    setBusy(false)
  }, [project])

  if (!project) return null

  async function chooseFolder(defaultPath?: string): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      if (await onChooseFolder(defaultPath)) onClose()
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'The synced folder could not be opened.')
    } finally {
      setBusy(false)
    }
  }

  async function saveAndOpenUrl(): Promise<void> {
    const normalized = normalizeMicrosoft365Url(webUrl)
    if (!normalized) {
      setError('Enter an HTTPS SharePoint or Microsoft Teams address.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await onSaveAndOpenUrl(normalized)
      setWebUrl(normalized)
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'The Microsoft 365 location could not be opened.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="kp-modal-backdrop source-connect-backdrop" role="presentation" onMouseDown={onClose}>
      <div
        ref={dialogRef}
        className="kp-modal source-connect-modal"
        role="dialog"
        aria-modal="true"
        aria-label={`Connect data for ${project.name}`}
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <span>Microsoft 365 connection</span>
            <h2>Connect {project.name}</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Close"><X size={17} /></button>
        </header>
        <div className="source-connect-body">
          <section className="source-connect-primary">
            <span className="source-connect-icon"><FolderSync size={22} /></span>
            <div>
              <span className="source-connect-label">Live project data</span>
              <h3>Choose the synced folder</h3>
              <p>KPIntelligence watches the local folder created by Teams, SharePoint, or OneDrive Sync.</p>
            </div>
            <button className="kp-button primary" type="button" disabled={busy} onClick={() => void chooseFolder(project.sourceFolder ?? undefined)}>
              <FolderOpen size={16} /> {project.sourceFolder ? 'Change synced folder' : 'Choose synced folder'}
            </button>
          </section>

          {recentFolders.length > 0 && (
            <section className="source-connect-recents">
              <span>Recent synced locations</span>
              <div>
                {recentFolders.map((folder) => (
                  <button type="button" key={folder} disabled={busy} onClick={() => void chooseFolder(folder)}>
                    <FolderOpen size={15} />
                    <span><strong>{folderName(folder)}</strong><small>{folder}</small></span>
                    <ChevronRight size={15} />
                  </button>
                ))}
              </div>
            </section>
          )}

          <section className="source-connect-web">
            <div className="source-connect-web-heading">
              <span><Link2 size={16} /></span>
              <div>
                <strong>SharePoint or Teams web shortcut</strong>
                <small>Open the library, select Sync in Microsoft 365, then choose the synced folder above.</small>
              </div>
            </div>
            <div className="source-connect-url-row">
              <input
                aria-label="SharePoint or Teams URL"
                value={webUrl}
                placeholder="https://company.sharepoint.com/sites/project"
                onChange={(event) => {
                  setWebUrl(event.target.value)
                  setError(null)
                }}
              />
              <button className="kp-button secondary" type="button" disabled={busy || !webUrl.trim()} onClick={() => void saveAndOpenUrl()}>
                <ExternalLink size={15} /> Save and open
              </button>
            </div>
          </section>
          {error && <div className="source-connect-error" role="alert"><AlertTriangle size={15} /> {error}</div>}
        </div>
        <footer>
          <button className="kp-button secondary" type="button" onClick={onClose}>Not now</button>
        </footer>
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
  onCreateProject,
  onCreateDashboard,
}: {
  store: LibraryStore
  onOpen: (dashboard: DashboardRecord) => void
  onCreateProject: () => void
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
        <div className="library-page-actions">
          <button className="kp-button secondary" type="button" onClick={onCreateDashboard}><LayoutDashboard size={16} /> New dashboard</button>
          <button className="kp-button primary" type="button" onClick={onCreateProject}><Plus size={16} /> New project</button>
        </div>
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
  onOpenWebSource,
  onRefresh,
}: {
  project: ProjectRecord
  dashboards: DashboardRecord[]
  source: SourceState
  persistentFolders: boolean
  onOpen: (dashboard: DashboardRecord) => void
  onCreateDashboard: () => void
  onChooseSource: () => void
  onOpenWebSource: () => void
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
          <span>Microsoft 365 data</span>
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
              <FolderSync size={15} /> {project.sourceFolder ? 'Manage connection' : 'Connect data'}
            </button>
          )}
          {project.sourceWebUrl && (
            <button className="kp-icon-button" type="button" onClick={onOpenWebSource} aria-label="Open linked Microsoft 365 location" title="Open linked Microsoft 365 location">
              <ExternalLink size={16} />
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
  const [libraryBackupAvailable, setLibraryBackupAvailable] = useState(false)
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [librarySaveState, setLibrarySaveState] = useState<{
    status: 'saved' | 'saving' | 'error'
    message: string
  }>({ status: 'saved', message: 'Saved locally' })
  const [createRequest, setCreateRequest] = useState<CreateRequest | null>(null)
  const [sourceConnectionProjectId, setSourceConnectionProjectId] = useState<string | null>(null)
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
  const [shareOpen, setShareOpen] = useState(false)
  const [pendingPackage, setPendingPackage] = useState<PendingPackage | null>(null)
  const [teamLibraryStates, setTeamLibraryStates] = useState<Record<string, TeamLibraryState>>({})
  const [libraryNotice, setLibraryNotice] = useState<string | null>(null)
  const refreshTimers = useRef<Record<string, number>>({})
  const teamLibraryRefreshTimers = useRef<Record<string, number>>({})
  const sourceRefreshGeneration = useRef<Record<string, number>>({})
  const oacRefreshGeneration = useRef<Record<string, number>>({})
  const teamLibraryRefreshGeneration = useRef<Record<string, number>>({})
  const packageInputRef = useRef<HTMLInputElement>(null)
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve())
  const latestSaveRevisionRef = useRef(store.revision)
  const noticeTimerRef = useRef<number | null>(null)
  const updateCheckInFlightRef = useRef(false)

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
    setLibraryBackupAvailable(false)
    void loadLibrary(platform).then((value) => {
      if (!active) return
      storeRef.current = value
      latestSaveRevisionRef.current = value.revision
      setStore(value)
      setLoading(false)
    }).catch(async (error) => {
      if (active) {
        const backup = await loadLibraryBackup(platform).catch(() => null)
        if (!active) return
        setLibraryBackupAvailable(Boolean(backup))
        setLibraryLoadError(
          error instanceof Error ? error.message : 'The local dashboard library could not be opened.',
        )
        setLoading(false)
      }
    })
    return () => { active = false }
  }, [loadAttempt])

  async function restoreLastLibraryBackup(): Promise<void> {
    setLoading(true)
    try {
      await restoreLibraryBackup(platform)
      setLibraryLoadError(null)
      setLoadAttempt((attempt) => attempt + 1)
    } catch (error) {
      setLibraryLoadError(
        error instanceof Error ? error.message : 'The last dashboard library backup could not be restored.',
      )
      setLoading(false)
    }
  }

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
  const selectedTeamLibrary = store.selection.kind === 'teamLibrary'
    ? store.teamLibraries.find((library) => library.id === store.selection.id) ?? null
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
  const sourceConnectionProject = sourceConnectionProjectId
    ? store.projects.find((project) => project.id === sourceConnectionProjectId) ?? null
    : null
  const recentSourceFolders = useMemo(() => {
    const folders: string[] = []
    for (const project of [...store.projects].reverse()) {
      if (
        !project.sourceFolder
        || project.id === sourceConnectionProjectId
        || folders.includes(project.sourceFolder)
      ) continue
      folders.push(project.sourceFolder)
      if (folders.length === 4) break
    }
    return folders
  }, [store.projects, sourceConnectionProjectId])

  const checkUpdates = useCallback(async (
    { promptIfAvailable = false }: { promptIfAvailable?: boolean } = {},
  ): Promise<void> => {
    if (updateCheckInFlightRef.current) return
    updateCheckInFlightRef.current = true
    setUpdateChecking(true)
    setUpdateCheckError(null)
    try {
      const info = await checkForUpdate()
      setUpdateInfo(info)
      setLastUpdateCheck(new Date())
      if (info && promptIfAvailable) setUpdateOpen(true)
    } catch {
      setUpdateCheckError('Check your network or proxy, then try again.')
    } finally {
      updateCheckInFlightRef.current = false
      setUpdateChecking(false)
    }
  }, [])

  useEffect(() => {
    if (import.meta.env.PROD) void checkUpdates({ promptIfAvailable: true })
  }, [checkUpdates])

  const showUpdates = useCallback((): void => {
    setUpdateOpen(true)
    void checkUpdates()
  }, [checkUpdates])

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
        rawCatalog: current[project.id]?.rawCatalog ?? null,
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
      const rawCatalog = await profileSpreadsheetInputs(inputs)
      if (!isCurrent()) return
      const sourceRepairs = packageAwareSourceRepairs(storeRef.current, project.id, rawCatalog)
      const catalog = applySourceRepairs(rawCatalog, sourceRepairs)
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
          rawCatalog,
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
              sourceRepairs,
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
          rawCatalog: current[project.id]?.rawCatalog ?? null,
        },
      }))
    }
  }, [commitStore, refreshOacProject])

  const refreshTeamLibrary = useCallback(async (
    library: TeamLibraryRecord,
  ): Promise<void> => {
    const generation = (teamLibraryRefreshGeneration.current[library.id] ?? 0) + 1
    teamLibraryRefreshGeneration.current[library.id] = generation
    const isCurrent = () => teamLibraryRefreshGeneration.current[library.id] === generation
    setTeamLibraryStates((current) => ({
      ...current,
      [library.id]: {
        status: 'loading',
        message: 'Reading shared dashboard packages…',
        catalog: current[library.id]?.catalog ?? null,
      },
    }))
    try {
      const catalog = await scanTeamLibrary(platform, library)
      if (!isCurrent()) return
      const status = catalog.warnings.length > 0 ? 'warning' as const : 'ready' as const
      const message = catalog.packages.length > 0
        ? `${catalog.packages.length} dashboard package${catalog.packages.length === 1 ? '' : 's'} ready.`
        : 'This shared folder does not contain any .kpidashboard packages yet.'
      setTeamLibraryStates((current) => ({
        ...current,
        [library.id]: { status, message, catalog },
      }))
      commitStore((current) => ({
        ...current,
        teamLibraries: current.teamLibraries.map((candidate) => candidate.id === library.id
          ? {
              ...candidate,
              packageCount: catalog.packages.length,
              lastScannedAt: catalog.scannedAt,
              updatedAt: catalog.scannedAt,
            }
          : candidate),
      }))
    } catch (error) {
      if (!isCurrent()) return
      setTeamLibraryStates((current) => ({
        ...current,
        [library.id]: {
          status: 'error',
          message: error instanceof Error ? error.message : 'The Team Library could not be read.',
          catalog: current[library.id]?.catalog ?? null,
        },
      }))
    }
  }, [commitStore])

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

  useEffect(() => {
    if (!selectedTeamLibrary?.enabled) return
    const state = teamLibraryStates[selectedTeamLibrary.id]
    if (!state || (state.status === 'idle' && !state.catalog)) {
      void refreshTeamLibrary(selectedTeamLibrary)
    }

    let cancelled = false
    let stop: (() => void) | undefined
    if (platform.supportsPersistentFolders) {
      void platform.watchDirectory(selectedTeamLibrary.folderPath, () => {
        window.clearTimeout(teamLibraryRefreshTimers.current[selectedTeamLibrary.id])
        teamLibraryRefreshTimers.current[selectedTeamLibrary.id] = window.setTimeout(
          () => void refreshTeamLibrary(selectedTeamLibrary),
          900,
        )
      }).then((cleanup) => {
        if (cancelled) cleanup()
        else stop = cleanup
      }).catch(() => undefined)
    }
    return () => {
      cancelled = true
      stop?.()
      window.clearTimeout(teamLibraryRefreshTimers.current[selectedTeamLibrary.id])
    }
  }, [selectedTeamLibrary?.id, selectedTeamLibrary?.folderPath, selectedTeamLibrary?.enabled])

  function select(selection: LibrarySelection): void {
    commitStore((current) => {
      const recentDashboardIds = selection.kind === 'dashboard'
        ? [selection.id, ...current.recentDashboardIds.filter((id) => id !== selection.id)].slice(0, 12)
        : current.recentDashboardIds
      return { ...current, selection, recentDashboardIds }
    })
  }

  async function addTeamLibrary(): Promise<void> {
    if (!platform.supportsPersistentFolders) {
      showLibraryNotice('Team Libraries are available in the KPIntelligence desktop app.')
      return
    }
    const folderPath = await platform.chooseDirectory({
      title: 'Choose a synced Team Library folder',
      canCreateDirectories: true,
    })
    if (!folderPath) return
    const existing = storeRef.current.teamLibraries.find((library) =>
      library.folderPath.replace(/\\/g, '/').toLowerCase()
      === folderPath.replace(/\\/g, '/').toLowerCase())
    if (existing) {
      select({ kind: 'teamLibrary', id: existing.id })
      void refreshTeamLibrary(existing)
      return
    }
    const timestamp = now()
    const library: TeamLibraryRecord = {
      id: createId('team-library'),
      name: folderName(folderPath),
      folderPath,
      enabled: true,
      packageCount: 0,
      lastScannedAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    commitStore((current) => ({
      ...current,
      teamLibraries: [...current.teamLibraries, library],
      selection: { kind: 'teamLibrary', id: library.id },
    }))
    void refreshTeamLibrary(library)
  }

  function removeTeamLibrary(id: string): void {
    const library = storeRef.current.teamLibraries.find((candidate) => candidate.id === id)
    if (!library) return
    if (!window.confirm(`Remove “${library.name}” from KPIntelligence? Shared package files will not be changed.`)) return
    teamLibraryRefreshGeneration.current[id] = (teamLibraryRefreshGeneration.current[id] ?? 0) + 1
    setTeamLibraryStates((current) => {
      const next = { ...current }
      delete next[id]
      return next
    })
    commitStore((current) => ({
      ...current,
      teamLibraries: current.teamLibraries.filter((candidate) => candidate.id !== id),
      selection: current.selection.kind === 'teamLibrary' && current.selection.id === id
        ? { kind: 'home', id: 'home' }
        : current.selection,
    }))
  }

  async function importDashboardPackage(files: File[]): Promise<void> {
    const file = files[0]
    if (!file) return
    if (!file.name.toLowerCase().endsWith('.kpidashboard')) {
      showLibraryNotice('Choose a .kpidashboard package.')
      return
    }
    try {
      const document = await readDashboardPackage(await file.arrayBuffer())
      setPendingPackage({ document, source: 'package' })
    } catch (error) {
      showLibraryNotice(error instanceof Error ? error.message : 'The dashboard package could not be opened.')
    }
  }

  function installPendingDashboard(projectId: string): void {
    if (!pendingPackage) return
    const sourceState = sourceStatesRef.current[projectId]
    const rawCatalog = sourceState?.rawCatalog ?? sourceState?.catalog ?? null
    const project = storeRef.current.projects.find((candidate) => candidate.id === projectId)
    const configured = project?.sourceRepairs ?? {
      fieldRepairs: [],
      reviewedDatasetIds: [],
    }
    const proposals = rawCatalog
      ? sourceRepairProposals(
          pendingPackage.document.manifest.sourceRequirements,
          rawCatalog,
          configured,
        )
      : []
    const sourceRepairs = proposals.length > 0
      ? { ...configured, fieldRepairs: [...configured.fieldRepairs, ...proposals] }
      : configured
    const targetCatalog = rawCatalog ? applySourceRepairs(rawCatalog, sourceRepairs) : null
    const installed = installDashboardPackage(
      pendingPackage.document,
      projectId,
      pendingPackage.source,
      targetCatalog,
    )
    if (sourceState && rawCatalog && targetCatalog) {
      setSourceStates((current) => ({
        ...current,
        [projectId]: {
          ...current[projectId],
          catalog: targetCatalog,
          rawCatalog,
        },
      }))
    }
    const existing = storeRef.current.dashboards.filter((dashboard) =>
      dashboard.id === pendingPackage.document.manifest.templateId
      || dashboard.template?.id === pendingPackage.document.manifest.templateId)
    if (existing.length > 0) {
      const sameVersionCount = existing.filter((dashboard) =>
        dashboard.template?.version === pendingPackage.document.manifest.templateVersion).length
      installed.dashboard.name = sameVersionCount > 0
        ? `${pendingPackage.document.manifest.name} copy ${sameVersionCount + 1}`
        : `${pendingPackage.document.manifest.name} v${pendingPackage.document.manifest.templateVersion}`
    }
    commitStore((current) => ({
      ...current,
      projects: current.projects.map((candidate) => candidate.id === projectId
        ? { ...candidate, sourceRepairs, updatedAt: now() }
        : candidate),
      dashboards: [...current.dashboards, installed.dashboard],
      exportProfiles: installed.exportProfile
        ? [...current.exportProfiles, installed.exportProfile]
        : current.exportProfiles,
      expandedProjectIds: [...new Set([...current.expandedProjectIds, projectId])],
      recentDashboardIds: [installed.dashboard.id, ...current.recentDashboardIds].slice(0, 12),
      selection: { kind: 'dashboard', id: installed.dashboard.id },
    }))
    const hasRequirements = pendingPackage.document.manifest.sourceRequirements.length > 0
    const unresolvedCount = installed.unresolvedVisualCount
      + installed.unresolvedCalculationCount
      + installed.unresolvedSlicerCount
    setPendingPackage(null)
    showLibraryNotice(
      unresolvedCount > 0
        ? `Dashboard added. ${unresolvedCount} data binding${unresolvedCount === 1 ? '' : 's'} still need matching columns.`
        : !targetCatalog && hasRequirements
        ? 'Dashboard added. Connect the project spreadsheets to finish matching its data.'
        : 'Dashboard added as an editable copy.',
    )
  }

  async function publishDashboardPackage(options: PackagePublishOptions): Promise<void> {
    if (!selectedDashboard) throw new Error('Open a dashboard before sharing it.')
    const packageOutput = await createDashboardPackage({
      dashboard: selectedDashboard,
      exportProfile,
      catalog: selectedSource?.catalog ?? null,
      templateId: selectedDashboard.template?.id ?? selectedDashboard.id,
      templateVersion: options.templateVersion,
      author: options.author,
      category: options.category,
      minAppVersion: __APP_VERSION__,
      sourceRepairs: selectedProject?.sourceRepairs,
      capabilities: [...new Set(selectedDashboard.pages.flatMap((page) =>
        page.widgets.map((widget) => widget.visualType)))],
    })
    if (!options.destinationLibraryId) {
      const destination = await platform.saveFile(
        packageOutput.bytes,
        packageOutput.fileName,
        [{ name: 'KPIntelligence Dashboard', extensions: ['kpidashboard'] }],
      )
      if (!destination) throw new Error('Package save canceled.')
      return
    }
    const library = storeRef.current.teamLibraries.find((candidate) =>
      candidate.id === options.destinationLibraryId)
    if (!library) throw new Error('The selected Team Library is no longer available.')
    if (!platform.writeFileInDirectory) {
      throw new Error('Publishing directly to Team Libraries requires the desktop app.')
    }
    const currentCatalog = await scanTeamLibrary(platform, library)
    const existingTemplate = currentCatalog.packages
      .filter((candidate) =>
        candidate.document.manifest.templateId === packageOutput.document.manifest.templateId)
      .sort((left, right) => compareSemver(
        right.document.manifest.templateVersion,
        left.document.manifest.templateVersion,
      ))[0]
    if (
      existingTemplate
      && compareSemver(
        packageOutput.document.manifest.templateVersion,
        existingTemplate.document.manifest.templateVersion,
      ) <= 0
    ) {
      throw new Error(
        `Version ${existingTemplate.document.manifest.templateVersion} is already published. Increase the package version before publishing again.`,
      )
    }
    const existingFiles = await platform.listFiles(library.folderPath, {
      extensions: ['kpidashboard'],
      maxFiles: 500,
      maxEntries: 5_000,
      fileLabel: 'dashboard packages',
    })
    if (existingFiles.some((file) =>
      file.name.toLowerCase() === packageOutput.fileName.toLowerCase())) {
      throw new Error(`${packageOutput.fileName} already exists. Increase the package version.`)
    }
    await platform.writeFileInDirectory(
      library.folderPath,
      packageOutput.fileName,
      packageOutput.bytes,
    )
    await refreshTeamLibrary(library)
  }

  function createEntity(
    request: CreateRequest,
    name: string,
    dashboardKind: DashboardRecord['kind'] = 'custom',
    connectDataAfterCreate = false,
  ): void {
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
          sourceWebUrl: null,
          sourceFileCount: 0,
          sourceDatasetCount: 0,
          sourceRefreshedAt: null,
          sourceRepairs: { fieldRepairs: [], reviewedDatasetIds: [] },
          createdAt,
          updatedAt: createdAt,
        }],
        expandedProjectIds: [...current.expandedProjectIds, id],
        selection: { kind: 'project', id },
      }))
      if (connectDataAfterCreate) setSourceConnectionProjectId(id)
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
          calculations: [],
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
      filters: source.filters.map((filter) => ({
        ...structuredClone(filter),
        id: createId('filter'),
        pageId: filter.pageId ? pageIds.get(filter.pageId) ?? null : null,
      })),
      calculations: (source.calculations ?? []).map((calculation) => ({
        ...structuredClone(calculation),
        id: createId('calculation'),
        conditions: calculation.conditions.map((condition) => ({
          ...condition,
          id: createId('condition'),
        })),
        secondaryConditions: calculation.secondaryConditions.map((condition) => ({
          ...condition,
          id: createId('condition'),
        })),
        createdAt,
        updatedAt: createdAt,
      })),
      pages: source.pages.map((page) => ({
        ...structuredClone(page),
        id: pageIds.get(page.id) ?? createId('page'),
        widgets: page.widgets.map((widget) => ({
          ...structuredClone(widget),
          id: createId('widget'),
          query: {
            ...structuredClone(widget.query),
            conditions: widget.query.conditions.map((condition) => ({ ...condition, id: createId('condition') })),
            secondaryConditions: (widget.query.secondaryConditions ?? [])
              .map((condition) => ({ ...condition, id: createId('condition') })),
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

  async function chooseSource(project: ProjectRecord, defaultPath?: string): Promise<boolean> {
    const preferredPath = defaultPath ?? project.sourceFolder ?? undefined
    let folder: string | null
    try {
      folder = await platform.chooseDirectory({
        title: `Connect synced data for ${project.name}`,
        defaultPath: preferredPath,
      })
    } catch (error) {
      if (!preferredPath) throw error
      folder = await platform.chooseDirectory({
        title: `Connect synced data for ${project.name}`,
      })
    }
    if (!folder) return false
    const previousCatalog = sourceStatesRef.current[project.id]?.catalog ?? null
    sourceRefreshGeneration.current[project.id] = (sourceRefreshGeneration.current[project.id] ?? 0) + 1
    oacRefreshGeneration.current[project.id] = (oacRefreshGeneration.current[project.id] ?? 0) + 1
    setSourceStates((current) => ({
      ...current,
      [project.id]: {
        status: 'loading',
        message: 'Opening the new source folder…',
        catalog: null,
        rawCatalog: null,
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
    const includeOac = storeRef.current.dashboards.some((dashboard) =>
      dashboard.projectId === project.id && dashboard.kind === 'oacWeekly')
    void refreshProject(
      updatedProject,
      includeOac,
      previousCatalog,
    )
    return true
  }

  async function saveAndOpenProjectWebUrl(projectId: string, url: string): Promise<void> {
    const project = storeRef.current.projects.find((candidate) => candidate.id === projectId)
    if (!project) throw new Error('The selected project is no longer available.')
    if (!platform.openExternalUrl) {
      throw new Error('Opening Microsoft 365 links requires the KPIntelligence desktop app.')
    }
    commitStore((current) => ({
      ...current,
      projects: current.projects.map((candidate) => candidate.id === projectId
        ? { ...candidate, sourceWebUrl: url, updatedAt: now() }
        : candidate),
    }))
    await platform.openExternalUrl(url)
  }

  async function openProjectWebSource(project: ProjectRecord): Promise<void> {
    const url = normalizeMicrosoft365Url(project.sourceWebUrl ?? '')
    if (!url) throw new Error('The saved Microsoft 365 shortcut is not a supported SharePoint or Teams address.')
    if (!platform.openExternalUrl) {
      throw new Error('Opening Microsoft 365 links requires the KPIntelligence desktop app.')
    }
    await platform.openExternalUrl(url)
  }

  async function importSessionFiles(project: ProjectRecord, files: File[]): Promise<void> {
    if (files.length === 0) return
    const generation = (sourceRefreshGeneration.current[project.id] ?? 0) + 1
    sourceRefreshGeneration.current[project.id] = generation
    const isCurrent = () => sourceRefreshGeneration.current[project.id] === generation
    const previousCatalog = sourceStatesRef.current[project.id]?.catalog ?? null
    setSourceStates((current) => ({
      ...current,
      [project.id]: {
        status: 'loading',
        message: 'Profiling imported spreadsheets…',
        catalog: current[project.id]?.catalog ?? null,
        rawCatalog: current[project.id]?.rawCatalog ?? null,
      },
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
      const rawCatalog = await profileSpreadsheetInputs(files)
      if (!isCurrent()) return
      const sourceRepairs = packageAwareSourceRepairs(storeRef.current, project.id, rawCatalog)
      const catalog = applySourceRepairs(rawCatalog, sourceRepairs)
      setSourceStates((current) => ({
        ...current,
        [project.id]: {
          status: catalog.warnings.length > 0 ? 'warning' : 'ready',
          message: `${catalog.datasets.length} worksheet${catalog.datasets.length === 1 ? '' : 's'} ready for this session.`,
          catalog,
          rawCatalog,
        },
      }))
      commitStore((current) => ({
        ...current,
        projects: current.projects.map((candidate) => candidate.id === project.id
          ? { ...candidate, sourceRepairs, updatedAt: now() }
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
          status: 'error',
          message: error instanceof Error ? error.message : 'The spreadsheets could not be imported.',
          catalog: current[project.id]?.catalog ?? null,
          rawCatalog: current[project.id]?.rawCatalog ?? null,
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

  function updateProjectSourceRepairs(
    projectId: string,
    sourceRepairs: ProjectSourceRepairs,
  ): void {
    const source = sourceStatesRef.current[projectId]
    const rawCatalog = source?.rawCatalog ?? source?.catalog ?? null
    if (source && rawCatalog) {
      const catalog = applySourceRepairs(rawCatalog, sourceRepairs)
      setSourceStates((current) => ({
        ...current,
        [projectId]: {
          ...current[projectId],
          catalog,
          rawCatalog,
        },
      }))
    }
    commitStore((current) => ({
      ...current,
      projects: current.projects.map((project) => project.id === projectId
        ? { ...project, sourceRepairs, updatedAt: now() }
        : project),
      dashboards: rawCatalog
        ? current.dashboards.map((dashboard) => dashboard.projectId === projectId
          ? rebindDashboardSources(
              dashboard,
              applySourceRepairs(rawCatalog, sourceRepairs),
              source?.catalog ?? null,
            )
          : dashboard)
        : current.dashboards,
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
        <div className="kp-library-recovery-actions">
          {libraryBackupAvailable && (
            <button className="kp-button primary" type="button" onClick={() => void restoreLastLibraryBackup()}>
              <RefreshCw size={16} /> Restore last backup
            </button>
          )}
          <button className={`kp-button ${libraryBackupAvailable ? 'secondary' : 'primary'}`} type="button" onClick={() => setLoadAttempt((attempt) => attempt + 1)}>
            <RefreshCw size={16} /> Try again
          </button>
        </div>
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
          onChooseSource={() => setSourceConnectionProjectId(selectedProject.id)}
          onImportFiles={(files) => void importSessionFiles(selectedProject, files)}
          onRefreshSource={() => void refreshProject(selectedProject)}
          onOpenExport={() => setExportOpen(true)}
          onShare={() => setShareOpen(true)}
          onSourceRepairsChange={(repairs) =>
            updateProjectSourceRepairs(selectedProject.id, repairs)}
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
        onChooseSource={() => setSourceConnectionProjectId(selectedProject.id)}
        onOpenWebSource={() => {
          void openProjectWebSource(selectedProject).catch((error) => {
            showLibraryNotice(error instanceof Error ? error.message : 'The Microsoft 365 location could not be opened.')
          })
        }}
        onRefresh={() => void refreshProject(selectedProject)}
      />
    )
  } else if (selectedTeamLibrary) {
    const teamState = teamLibraryStates[selectedTeamLibrary.id] ?? {
      status: 'idle' as const,
      message: 'Open this Team Library to scan its shared dashboard packages.',
      catalog: null,
    }
    content = (
      <TeamLibraryView
        library={selectedTeamLibrary}
        status={teamState.status}
        message={teamState.message}
        catalog={teamState.catalog}
        dashboards={store.dashboards}
        onRefresh={() => void refreshTeamLibrary(selectedTeamLibrary)}
        onInstall={(file: DashboardPackageFile) => setPendingPackage({
          document: file.document,
          source: 'teamLibrary',
        })}
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
        onCreateProject={() => setCreateRequest({ kind: 'project', folderId: null })}
        onCreateDashboard={() => setCreateRequest({ kind: 'dashboard', projectId: '' })}
      />
    )
  }

  return (
    <div className="kp-shell">
      <LibrarySidebar
        store={store}
        updateAvailable={Boolean(updateInfo)}
        updateChecking={updateChecking}
        onSelect={select}
        onCreateFolder={(parentId) => setCreateRequest({ kind: 'folder', parentId })}
        onCreateProject={(folderId) => setCreateRequest({ kind: 'project', folderId })}
        onCreateDashboard={(projectId) => setCreateRequest({ kind: 'dashboard', projectId })}
        onAddTeamLibrary={() => void addTeamLibrary()}
        onImportPackage={() => packageInputRef.current?.click()}
        onRefreshTeamLibrary={(id) => {
          const library = storeRef.current.teamLibraries.find((candidate) => candidate.id === id)
          if (library) void refreshTeamLibrary(library)
        }}
        onRemoveTeamLibrary={removeTeamLibrary}
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
        onShowUpdates={showUpdates}
      />
      <div className="kp-content">{content}</div>
      <input
        ref={packageInputRef}
        type="file"
        hidden
        accept=".kpidashboard"
        onChange={(event) => {
          void importDashboardPackage(Array.from(event.target.files ?? []))
          event.currentTarget.value = ''
        }}
      />
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
      <CreateModal
        request={createRequest}
        projects={store.projects}
        persistentFolders={platform.supportsPersistentFolders}
        onClose={() => setCreateRequest(null)}
        onCreate={createEntity}
      />
      <SourceConnectionModal
        project={sourceConnectionProject}
        recentFolders={recentSourceFolders}
        onClose={() => setSourceConnectionProjectId(null)}
        onChooseFolder={(defaultPath) => sourceConnectionProject
          ? chooseSource(sourceConnectionProject, defaultPath)
          : Promise.resolve(false)}
        onSaveAndOpenUrl={(url) => sourceConnectionProject
          ? saveAndOpenProjectWebUrl(sourceConnectionProject.id, url)
          : Promise.resolve()}
      />
      <ShareDashboardModal
        open={shareOpen}
        dashboard={selectedDashboard}
        teamLibraries={store.teamLibraries}
        canPublishToLibrary={Boolean(platform.writeFileInDirectory)}
        onClose={() => setShareOpen(false)}
        onPublish={publishDashboardPackage}
      />
      <PackageInstallModal
        pending={pendingPackage?.document ?? null}
        source={pendingPackage?.source ?? 'package'}
        projects={store.projects}
        defaultProjectId={selectedProject?.id
          ?? store.dashboards
            .find((dashboard) => dashboard.id === store.recentDashboardIds[0])
            ?.projectId
          ?? null}
        onClose={() => setPendingPackage(null)}
        onInstall={installPendingDashboard}
      />
      <UpdateModal
        open={updateOpen}
        onClose={() => setUpdateOpen(false)}
        info={updateInfo}
        defaultTab={updateInfo ? 'update' : 'changelog'}
        checking={updateChecking}
        checkError={updateCheckError}
        lastChecked={lastUpdateCheck}
        onCheck={() => checkUpdates()}
      />
      <ExportProfileModal
        open={exportOpen}
        profile={exportProfile}
        dashboard={selectedDashboard}
        canExport={Boolean(
          selectedDashboard
          && (
            !dashboardHasDataBindings(selectedDashboard)
            || (
              selectedSource?.catalog
              && (selectedSource.status === 'ready' || selectedSource.status === 'warning')
            )
          ),
        )}
        onClose={() => setExportOpen(false)}
        onChange={updateExportProfile}
        onExport={(profile) => void exportCustomDashboard(profile)}
      />
    </div>
  )
}
