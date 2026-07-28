import {
  AlertTriangle,
  ArrowDownToLine,
  BadgeAlert,
  Check,
  ChevronRight,
  Cloud,
  Database,
  Download,
  FileArchive,
  FolderSync,
  PackageCheck,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  UploadCloud,
  X,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useModalFocus } from '@/hooks/useModalFocus'
import type {
  DashboardRecord,
  ProjectRecord,
  TeamLibraryRecord,
} from '../library/model'
import { compareSemver, configuredLiteralCount } from './package'
import type {
  DashboardPackageDocument,
  DashboardPackageFile,
} from './types'
import type { TeamLibraryCatalog } from './teamLibrary'

export interface PackagePublishOptions {
  templateVersion: string
  author: string
  category: string
  destinationLibraryId: string | null
}

export function ShareDashboardModal({
  open,
  dashboard,
  teamLibraries,
  canPublishToLibrary,
  onClose,
  onPublish,
}: {
  open: boolean
  dashboard: DashboardRecord | null
  teamLibraries: TeamLibraryRecord[]
  canPublishToLibrary: boolean
  onClose: () => void
  onPublish: (options: PackagePublishOptions) => Promise<void>
}) {
  const [version, setVersion] = useState('1.0.0')
  const [author, setAuthor] = useState('Noah Garrett')
  const [category, setCategory] = useState('General')
  const [destination, setDestination] = useState('download')
  const [status, setStatus] = useState<'idle' | 'publishing' | 'success' | 'error'>('idle')
  const [message, setMessage] = useState('')
  const dialogRef = useRef<HTMLDivElement>(null)
  useModalFocus(open, dialogRef, onClose)

  useEffect(() => {
    if (!open || !dashboard) return
    setVersion(dashboard.template?.version ?? '1.0.0')
    setAuthor(dashboard.template?.author ?? 'Noah Garrett')
    setCategory('General')
    setDestination('download')
    setStatus('idle')
    setMessage('')
  }, [dashboard, open])

  const datasetCount = useMemo(() => {
    if (!dashboard) return 0
    return new Set([
      ...dashboard.pages.flatMap((page) =>
        page.widgets.flatMap((widget) => widget.query.datasetId ? [widget.query.datasetId] : [])),
      ...(dashboard.calculations ?? []).map((calculation) => calculation.datasetId),
    ]).size
  }, [dashboard])
  const configuredValueCount = useMemo(
    () => dashboard ? configuredLiteralCount(dashboard) : 0,
    [dashboard],
  )
  const versionValid = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)
  const authorValid = Boolean(author.trim())
  const valid = versionValid && authorValid

  if (!open || !dashboard) return null
  return (
    <div className="kp-modal-backdrop" role="presentation" onMouseDown={onClose}>
      <div
        ref={dialogRef}
        className="kp-modal package-share-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Share dashboard"
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <span>Portable dashboard package</span>
            <h2>Share {dashboard.name}</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Close"><X size={17} /></button>
        </header>
        <div className="package-modal-body">
          <div className="package-privacy-banner">
            <ShieldCheck size={21} />
            <div>
              <strong>Source rows stay out</strong>
              <p>The package includes dashboard text, rule values, source and column names, and export settings. Review those details before sharing.</p>
            </div>
          </div>
          <div className="package-trust-note">
            <BadgeAlert size={17} />
            <span>This package will be unsigned. The author label is descriptive and does not verify identity.</span>
          </div>

          <div className="package-summary-strip">
            <div><strong>{dashboard.pages.length}</strong><span>Pages</span></div>
            <div><strong>{dashboard.pages.reduce((total, page) => total + page.widgets.length, 0)}</strong><span>Visuals</span></div>
            <div><strong>{datasetCount}</strong><span>Source roles</span></div>
            <div><strong>{configuredValueCount}</strong><span>Configured values</span></div>
          </div>

          <div className="package-form-grid">
            <label className="kp-field">
              <span>Version</span>
              <input
                value={version}
                required
                aria-invalid={!versionValid}
                aria-describedby={!versionValid ? 'package-version-error' : undefined}
                onChange={(event) => setVersion(event.target.value)}
                placeholder="1.0.0"
              />
              {!versionValid && (
                <small id="package-version-error" role="alert">Use a version such as 1.0.0.</small>
              )}
            </label>
            <label className="kp-field">
              <span>Author label</span>
              <input
                value={author}
                required
                aria-invalid={!authorValid}
                aria-describedby={!authorValid ? 'package-author-error' : undefined}
                onChange={(event) => setAuthor(event.target.value)}
              />
              {!authorValid && (
                <small id="package-author-error" role="alert">Enter the dashboard author label.</small>
              )}
            </label>
            <label className="kp-field package-category-field">
              <span>Category</span>
              <input value={category} onChange={(event) => setCategory(event.target.value)} placeholder="Quality" />
            </label>
          </div>

          <fieldset className="package-destination">
            <legend>Publish to</legend>
            <label className={destination === 'download' ? 'active' : ''}>
              <input
                type="radio"
                name="package-destination"
                checked={destination === 'download'}
                onChange={() => setDestination('download')}
              />
              <span><Download size={18} /></span>
              <div><strong>Dashboard package</strong><small>Save one shareable .kpidashboard file</small></div>
              {destination === 'download' && <Check size={16} />}
            </label>
            {teamLibraries.map((library) => (
              <label className={destination === library.id ? 'active' : ''} key={library.id}>
                <input
                  type="radio"
                  name="package-destination"
                  checked={destination === library.id}
                  disabled={!canPublishToLibrary}
                  onChange={() => setDestination(library.id)}
                />
                <span><FolderSync size={18} /></span>
                <div><strong>{library.name}</strong><small>Publish for everyone using this Team Library</small></div>
                {destination === library.id && <Check size={16} />}
              </label>
            ))}
          </fieldset>

          {status !== 'idle' && (
            <div className={`package-publish-status ${status}`} role="status">
              {status === 'publishing'
                ? <RefreshCw className="spin" size={16} />
                : status === 'success'
                  ? <PackageCheck size={16} />
                  : <X size={16} />}
              {message}
            </div>
          )}
        </div>
        <footer>
          <button className="kp-button secondary" type="button" onClick={onClose}>Cancel</button>
          <button
            className="kp-button primary"
            type="button"
            disabled={!valid || status === 'publishing'}
            onClick={() => {
              setStatus('publishing')
              setMessage(destination === 'download' ? 'Building package…' : 'Publishing to Team Library…')
              void onPublish({
                templateVersion: version,
                author,
                category,
                destinationLibraryId: destination === 'download' ? null : destination,
              }).then(() => {
                setStatus('success')
                setMessage(destination === 'download' ? 'Dashboard package saved.' : 'Team Library package published.')
              }).catch((error) => {
                setStatus('error')
                setMessage(error instanceof Error ? error.message : 'The package could not be published.')
              })
            }}
          >
            {destination === 'download' ? <ArrowDownToLine size={16} /> : <UploadCloud size={16} />}
            {destination === 'download' ? 'Save package' : 'Publish package'}
          </button>
        </footer>
      </div>
    </div>
  )
}

export function PackageInstallModal({
  pending,
  source,
  projects,
  defaultProjectId,
  onClose,
  onInstall,
}: {
  pending: DashboardPackageDocument | null
  source: 'package' | 'teamLibrary'
  projects: ProjectRecord[]
  defaultProjectId?: string | null
  onClose: () => void
  onInstall: (projectId: string) => void
}) {
  const [projectId, setProjectId] = useState('')
  const dialogRef = useRef<HTMLDivElement>(null)
  useModalFocus(Boolean(pending), dialogRef, onClose)

  useEffect(() => {
    if (!pending) return
    setProjectId(
      projects.some((project) => project.id === defaultProjectId)
        ? defaultProjectId ?? ''
        : projects[0]?.id ?? '',
    )
  }, [defaultProjectId, pending, projects])

  if (!pending) return null
  const manifest = pending.manifest
  return (
    <div className="kp-modal-backdrop" role="presentation" onMouseDown={onClose}>
      <div
        ref={dialogRef}
        className="kp-modal package-install-modal"
        role="dialog"
        aria-modal="true"
        aria-label={`Add ${manifest.name}`}
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <span>{source === 'teamLibrary' ? 'Team Library' : 'Dashboard package'}</span>
            <h2>Add {manifest.name}</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Close"><X size={17} /></button>
        </header>
        <div className="package-modal-body">
          <div className="package-install-hero">
            <span><FileArchive size={24} /></span>
            <div>
              <strong>{manifest.name}</strong>
              <p>{manifest.description || 'A reusable KPIntelligence dashboard.'}</p>
              <small>v{manifest.templateVersion} · Author label: {manifest.author} · {manifest.category}</small>
            </div>
          </div>
          {pending.authenticity.status === 'unsigned' && (
            <div className="package-trust-note warning" role="note">
              <BadgeAlert size={17} />
              <span>Unsigned package. Add it only when you trust the folder or person who provided it.</span>
            </div>
          )}
          <label className="kp-field">
            <span>Add to project</span>
            <select value={projectId} onChange={(event) => setProjectId(event.target.value)}>
              {projects.map((project) => (
                <option value={project.id} key={project.id}>{project.name}</option>
              ))}
            </select>
          </label>
          <section className="package-requirements">
            <h3><Database size={15} /> Data requirements</h3>
            {manifest.sourceRequirements.length === 0 ? (
              <p>This dashboard does not require spreadsheet bindings.</p>
            ) : manifest.sourceRequirements.map((dataset) => (
              <div key={dataset.sourceDatasetId}>
                <strong>{dataset.datasetName}</strong>
                <span>{dataset.fields.map((field) => field.name).join(', ') || 'Row count only'}</span>
              </div>
            ))}
          </section>
          <div className="package-copy-note">
            <Sparkles size={17} />
            <span>KPIntelligence installs an editable copy. Published packages are never modified in place.</span>
          </div>
        </div>
        <footer>
          <button className="kp-button secondary" type="button" onClick={onClose}>Cancel</button>
          <button className="kp-button primary" type="button" disabled={!projectId} onClick={() => onInstall(projectId)}>
            <ArrowDownToLine size={16} /> Add dashboard
          </button>
        </footer>
      </div>
    </div>
  )
}

export function TeamLibraryView({
  library,
  status,
  message,
  catalog,
  dashboards,
  onRefresh,
  onInstall,
}: {
  library: TeamLibraryRecord
  status: 'idle' | 'loading' | 'ready' | 'warning' | 'error'
  message: string
  catalog: TeamLibraryCatalog | null
  dashboards: DashboardRecord[]
  onRefresh: () => void
  onInstall: (file: DashboardPackageFile) => void
}) {
  const installedVersions = useMemo(() => dashboards.reduce((versions, dashboard) => {
    if (!dashboard.template) return versions
    const current = versions.get(dashboard.template.id)
    if (!current || compareSemver(dashboard.template.version, current) > 0) {
      versions.set(dashboard.template.id, dashboard.template.version)
    }
    return versions
  }, new Map<string, string>()), [dashboards])

  return (
    <div className="team-library-view">
      <header className="library-page-header team-library-header">
        <div>
          <span className="page-kicker"><Cloud size={14} /> Team Library</span>
          <h1>{library.name}</h1>
          <p role="status" aria-live="polite">{message}</p>
        </div>
        <button className="kp-button secondary" type="button" onClick={onRefresh} disabled={status === 'loading'}>
          <RefreshCw className={status === 'loading' ? 'spin' : ''} size={16} /> Refresh
        </button>
      </header>

      {catalog?.warnings.length ? (
        <div className="team-library-warning">
          <strong>{catalog.warnings.length} package{catalog.warnings.length === 1 ? '' : 's'} need attention</strong>
          <span>{catalog.warnings[0]}</span>
        </div>
      ) : null}

      <section className="team-library-catalog">
        <div className="team-library-section-title">
          <div><h2>Available dashboards</h2><p>Install an editable copy into any project.</p></div>
          <span>{catalog?.packages.length ?? 0} package{catalog?.packages.length === 1 ? '' : 's'}</span>
        </div>
        {status === 'error' && !catalog ? (
          <div className="team-library-error" role="alert">
            <AlertTriangle size={24} />
            <strong>Team Library unavailable</strong>
            <span>{message}</span>
            <button className="kp-button secondary" type="button" onClick={onRefresh}>
              <RefreshCw size={15} /> Try again
            </button>
          </div>
        ) : status === 'loading' && !catalog ? (
          <div className="team-library-empty"><RefreshCw className="spin" size={22} /><strong>Reading dashboard packages…</strong></div>
        ) : catalog?.packages.length ? (
          <div className="team-package-grid">
            {catalog.packages.map((file) => {
              const manifest = file.document.manifest
              const installedVersion = installedVersions.get(manifest.templateId)
              const updateAvailable = file.document.authenticity.status === 'verified' && installedVersion
                ? compareSemver(manifest.templateVersion, installedVersion) > 0
                : false
              return (
                <article className="team-package-card" key={`${manifest.templateId}:${manifest.templateVersion}`}>
                  <div className="team-package-card-top">
                    <span><FileArchive size={21} /></span>
                    <div>
                      <small>{manifest.category}</small>
                      <h3>{manifest.name}</h3>
                    </div>
                    <div className="team-package-badges">
                      {file.document.authenticity.status === 'unsigned' && (
                        <em className="package-unverified-badge"><BadgeAlert size={11} /> Unsigned</em>
                      )}
                      {updateAvailable
                        ? <em className="package-update-badge">Update</em>
                        : installedVersion === manifest.templateVersion
                          ? <em className="package-installed-badge"><Check size={12} /> Added</em>
                          : null}
                    </div>
                  </div>
                  <p>{manifest.description || 'A reusable KPIntelligence dashboard.'}</p>
                  <div className="team-package-meta">
                    <span>v{manifest.templateVersion}</span>
                    <span>Author label: {manifest.author}</span>
                    <span>{manifest.sourceRequirements.length} source role{manifest.sourceRequirements.length === 1 ? '' : 's'}</span>
                  </div>
                  <button type="button" onClick={() => onInstall(file)}>
                    {updateAvailable
                      ? 'Add verified update'
                      : installedVersion === manifest.templateVersion
                        ? 'Add another copy'
                        : file.document.authenticity.status === 'unsigned'
                          ? 'Review and add'
                          : 'Add to project'}
                    <ChevronRight size={15} />
                  </button>
                </article>
              )
            })}
          </div>
        ) : (
          <div className="team-library-empty">
            <FileArchive size={25} />
            <strong>No dashboard packages yet</strong>
            <span>Publish a .kpidashboard file into this synced folder and refresh.</span>
          </div>
        )}
      </section>
    </div>
  )
}
