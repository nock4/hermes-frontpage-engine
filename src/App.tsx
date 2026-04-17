import { useCallback, useEffect, useMemo, useState } from 'react'
import { loadEditionPackage, loadManifest, polygonToClipPath } from './lib/editionLoader'
import { buildArchiveHref, buildEditionHref, getEditionArchiveRecords, parseAppRoute, type AppRoute } from './lib/router'
import { getSourceWindowDescriptor } from './lib/sourceWindowContent'
import { clearPreview, closeWindow, createWindowState, hoverBinding, pinBinding, restoreWindow } from './lib/sourceWindowManager'
import type { ArchiveRecord, EditionManifest, LoadedEdition, SourceBindingRecord, SourceWindowState } from './types/runtime'

function App() {
  const [manifest, setManifest] = useState<EditionManifest | null>(null)
  const [route, setRoute] = useState<AppRoute | null>(null)
  const [loaded, setLoaded] = useState<LoadedEdition | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeArtifactId, setActiveArtifactId] = useState<string | null>(null)
  const [windowState, setWindowState] = useState<SourceWindowState>(createWindowState())
  const [locationKey, setLocationKey] = useState(() => `${window.location.pathname}${window.location.search}`)

  const syncLocation = useCallback(() => {
    setLocationKey(`${window.location.pathname}${window.location.search}`)
  }, [])

  const navigate = useCallback((href: string) => {
    window.history.pushState({}, '', href)
    syncLocation()
  }, [syncLocation])

  useEffect(() => {
    window.addEventListener('popstate', syncLocation)
    return () => window.removeEventListener('popstate', syncLocation)
  }, [syncLocation])

  useEffect(() => {
    const run = async () => {
      try {
        setLoading(true)
        setError(null)
        const nextManifest = manifest ?? (await loadManifest())
        const nextRoute = parseAppRoute(window.location.pathname, window.location.search, nextManifest)
        setManifest(nextManifest)
        setRoute(nextRoute)

        if (nextRoute.kind === 'archive-index') {
          setLoaded(null)
          setActiveArtifactId(null)
          setWindowState(createWindowState())
          return
        }

        const pkg = await loadEditionPackage(nextRoute.edition.path)
        setLoaded(pkg)
        setActiveArtifactId(pkg.artifactMap.default_artifact_id)
        setWindowState(createWindowState())
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load edition')
      } finally {
        setLoading(false)
      }
    }

    void run()
  }, [locationKey, manifest])

  const bindingsByArtifactId = useMemo(() => {
    if (!loaded) return new Map<string, SourceBindingRecord>()
    return new Map(loaded.sourceBindings.bindings.map((binding) => [binding.artifact_id, binding]))
  }, [loaded])

  const bindingsById = useMemo(() => {
    if (!loaded) return new Map<string, SourceBindingRecord>()
    return new Map(loaded.sourceBindings.bindings.map((binding) => [binding.id, binding]))
  }, [loaded])

  const activeBinding = activeArtifactId ? bindingsByArtifactId.get(activeArtifactId) ?? null : null
  const previewBinding = windowState.previewBindingId ? bindingsById.get(windowState.previewBindingId) ?? null : null
  const primaryBinding = windowState.primaryBindingId ? bindingsById.get(windowState.primaryBindingId) ?? null : null
  const dockBindings = windowState.minimizedBindingIds
    .map((bindingId) => bindingsById.get(bindingId) ?? null)
    .filter((binding): binding is SourceBindingRecord => Boolean(binding))

  const archiveRecords = useMemo<ArchiveRecord[]>(() => (manifest ? getEditionArchiveRecords(manifest) : []), [manifest])
  const reviewMode = new URLSearchParams(window.location.search).get('debug') === 'masks'
    ? 'debug'
    : new URLSearchParams(window.location.search).get('qa') === 'clickable'
      ? 'clickable'
      : new URLSearchParams(window.location.search).get('qa') === 'solo'
        ? 'solo'
        : 'live'

  if (loading) return <main className="boot-state">Loading daily edition…</main>
  if (error) return <main className="boot-state">{error}</main>
  if (!manifest || !route) return <main className="boot-state">Missing manifest</main>

  if (route.kind === 'archive-index') {
    return <ArchiveIndexPage currentEditionId={manifest.current_edition_id} navigate={navigate} records={archiveRecords} />
  }

  if (!loaded) return <main className="boot-state">Edition not found.</main>

  const heroes = loaded.artifactMap.artifacts.filter((artifact) => artifact.kind === 'hero')
  const modules = loaded.artifactMap.artifacts.filter((artifact) => artifact.kind === 'module')

  return (
    <main className={`runtime-shell review-mode--${reviewMode}`}>
      <section className="runtime-main">
        <header className="runtime-topbar">
          <div>
            <div className="eyebrow">Daily frontpage engine</div>
            <h1>{loaded.edition.title}</h1>
            <p>{loaded.brief.mood}</p>
          </div>
          <div className="topbar-actions">
            <button onClick={() => navigate('/')} type="button">Current</button>
            <button onClick={() => navigate('/archive')} type="button">Archive</button>
            {route.kind === 'archive-edition' ? <button onClick={() => navigate(buildArchiveHref(route.edition.slug))} type="button">Edition entry</button> : null}
          </div>
          <div className="topbar-meta">
            <span>{loaded.edition.date}</span>
            <span>{loaded.edition.scene_family}</span>
          </div>
        </header>

        <section className="stage" onMouseLeave={() => setWindowState((state) => clearPreview(state))}>
          <img className="plate" src={loaded.edition.plate_asset_path} alt={loaded.edition.title} />

          {loaded.artifactMap.artifacts.map((artifact) => {
            const active = artifact.id === activeArtifactId
            const clipPath = polygonToClipPath(artifact)
            const binding = bindingsByArtifactId.get(artifact.id) ?? null

            return (
              <button
                key={artifact.id}
                className={`artifact artifact--${artifact.kind}${active ? ' is-active' : ''}`}
                style={{
                  left: `${artifact.bounds.x * 100}%`,
                  top: `${artifact.bounds.y * 100}%`,
                  width: `${artifact.bounds.w * 100}%`,
                  height: `${artifact.bounds.h * 100}%`,
                  clipPath,
                  WebkitClipPath: clipPath,
                  zIndex: artifact.z_index,
                }}
                onMouseEnter={() => {
                  setActiveArtifactId(artifact.id)
                  if (binding) setWindowState((state) => hoverBinding(state, binding))
                }}
                onFocus={() => {
                  setActiveArtifactId(artifact.id)
                  if (binding) setWindowState((state) => hoverBinding(state, binding))
                }}
                onClick={() => {
                  setActiveArtifactId(artifact.id)
                  if (binding) setWindowState((state) => pinBinding(state, binding))
                }}
                type="button"
              >
                <span>{artifact.label}</span>
              </button>
            )
          })}
        </section>

        <section className="artifact-lists">
          <div>
            <h2>Heroes</h2>
            <ul>
              {heroes.map((artifact) => (
                <li key={artifact.id}>{artifact.label}</li>
              ))}
            </ul>
          </div>
          <div>
            <h2>Modules</h2>
            <ul>
              {modules.map((artifact) => (
                <li key={artifact.id}>{artifact.label}</li>
              ))}
            </ul>
          </div>
        </section>
      </section>

      <aside className="side-rail">
        <section className="panel">
          <div className="eyebrow">Brief</div>
          <h2>{loaded.edition.title}</h2>
          <p>{loaded.brief.mood}</p>
          <p>Lighting: {loaded.brief.lighting}</p>
          <p>Motion: {loaded.ambiance.motion_system}</p>
          {route.kind === 'archive-edition' ? <p>Archive route: {buildEditionHref(route.edition)}</p> : null}
        </section>

        <section className="panel">
          <div className="eyebrow">Source windows</div>
          {primaryBinding ? (
            <SourceWindow binding={primaryBinding} mode="primary" onClose={() => setWindowState((state) => closeWindow(state, primaryBinding.id))} />
          ) : (
            <p>No pinned window yet. Hover for preview, click to pin.</p>
          )}

          {previewBinding && (!primaryBinding || previewBinding.id !== primaryBinding.id) ? (
            <SourceWindow binding={previewBinding} mode="preview" onClose={() => setWindowState((state) => clearPreview(state))} />
          ) : null}

          {dockBindings.length ? (
            <div className="window-dock">
              <div className="eyebrow">Dock</div>
              <div className="window-dock__items">
                {dockBindings.map((binding) => (
                  <button key={binding.id} onClick={() => setWindowState((state) => restoreWindow(state, binding.id))} type="button">
                    Restore {binding.kicker}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </section>

        <section className="panel">
          <div className="eyebrow">Selection</div>
          {activeBinding ? (
            <>
              <p>{activeBinding.title}</p>
              <p>{activeBinding.excerpt}</p>
            </>
          ) : (
            <p>No binding selected.</p>
          )}
        </section>

        <section className="panel">
          <div className="eyebrow">Archive</div>
          <ArchiveMiniList currentEditionId={loaded.edition.edition_id} navigate={navigate} records={archiveRecords} />
        </section>

        <section className="panel">
          <div className="eyebrow">Review</div>
          <p>Geometry: {loaded.review.geometry_status}</p>
          <p>Clickability: {loaded.review.clickability_status}</p>
          <p>Behavior: {loaded.review.behavior_status}</p>
        </section>
      </aside>
    </main>
  )
}

function ArchiveIndexPage({ records, navigate, currentEditionId }: { records: ArchiveRecord[]; navigate: (href: string) => void; currentEditionId: string }) {
  return (
    <main className="archive-shell">
      <header className="runtime-topbar">
        <div>
          <div className="eyebrow">Archive</div>
          <h1>Daily edition archive</h1>
          <p>Browse previous front-page worlds by date and family.</p>
        </div>
        <div className="topbar-actions">
          <button onClick={() => navigate('/')} type="button">Back to current</button>
        </div>
      </header>

      <section className="archive-grid">
        {records.map((record) => (
          <button className="archive-card" key={record.edition_id} onClick={() => navigate(record.archive_href)} type="button">
            <img alt={record.title} src={record.preview_asset_path} />
            <div className="archive-card__body">
              <div className="archive-card__meta">
                <span>{record.date}</span>
                <span>{record.scene_family}</span>
              </div>
              <strong>{record.title}</strong>
              <p>{record.motif_tags.join(' · ')}</p>
              {record.edition_id === currentEditionId ? <span className="badge">current</span> : null}
            </div>
          </button>
        ))}
      </section>
    </main>
  )
}

function ArchiveMiniList({ records, navigate, currentEditionId }: { records: ArchiveRecord[]; navigate: (href: string) => void; currentEditionId: string }) {
  return (
    <ul className="archive-mini-list">
      {records.map((record) => (
        <li key={record.edition_id}>
          <button onClick={() => navigate(record.is_live ? '/' : record.archive_href)} type="button">
            <span>{record.title}</span>
            <span>{record.date}</span>
            {record.edition_id === currentEditionId ? <span className="badge">here</span> : null}
          </button>
        </li>
      ))}
    </ul>
  )
}

function SourceWindow({ binding, mode, onClose }: { binding: SourceBindingRecord; mode: 'preview' | 'primary'; onClose: () => void }) {
  const descriptor = getSourceWindowDescriptor(binding)

  return (
    <div className={`source-window source-window--${mode}`}>
      <div className="source-window__top">
        <div>
          <div className="eyebrow">{mode === 'preview' ? `Preview · ${binding.kicker}` : binding.kicker}</div>
          <strong>{binding.title}</strong>
        </div>
        <div className="source-window__actions">
          <button onClick={onClose} type="button">{mode === 'preview' ? 'Dismiss' : 'Close'}</button>
        </div>
      </div>
      <p>{binding.excerpt}</p>
      <div className="source-window__meta">
        <span>{binding.window_type}</span>
        <span>{binding.source_type}</span>
        <span>{descriptor.allowsPlaybackPersistence ? 'persistent' : 'replaceable'}</span>
      </div>
      <SourceWindowBody binding={binding} />
    </div>
  )
}

function SourceWindowBody({ binding }: { binding: SourceBindingRecord }) {
  const descriptor = getSourceWindowDescriptor(binding)

  if (descriptor.kind === 'youtube-embed') {
    return (
      <div className="source-window__body source-window__body--video">
        <iframe
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          loading="lazy"
          src={descriptor.embedUrl}
          title={binding.title}
        />
        {binding.source_url ? <a href={binding.source_url} rel="noreferrer" target="_blank">{descriptor.ctaLabel} ↗</a> : null}
      </div>
    )
  }

  if (descriptor.kind === 'audio-dock') {
    return (
      <div className="source-window__body source-window__body--audio">
        <div className="audio-dock-card">
          <strong>Persistent audio pocket</strong>
          <p>This window is treated like the minimized audio dock path. Keep listening while exploring other pockets.</p>
        </div>
        {descriptor.streamUrl ? <a href={descriptor.streamUrl} rel="noreferrer" target="_blank">{descriptor.ctaLabel} ↗</a> : <span className="fallback">No live audio source URL bound yet</span>}
      </div>
    )
  }

  if (descriptor.kind === 'social-card') {
    return (
      <div className="source-window__body source-window__body--social">
        <div className="social-card">
          <div className="eyebrow">Social source</div>
          <strong>{descriptor.domainLabel}</strong>
          <p>Placeholder for the native social embed path. This still preserves the real outbound source instead of rewriting it into a summary card.</p>
        </div>
        {descriptor.sourceUrl ? <a href={descriptor.sourceUrl} rel="noreferrer" target="_blank">{descriptor.ctaLabel} ↗</a> : <span className="fallback">No live post URL bound yet</span>}
      </div>
    )
  }

  return (
    <div className="source-window__body source-window__body--web">
      <div className="rich-preview-card">
        <div className="eyebrow">Rich preview</div>
        <strong>{descriptor.domainLabel}</strong>
        <p>Source-framed fallback for article, note, and linked web content.</p>
      </div>
      {descriptor.sourceUrl ? <a href={descriptor.sourceUrl} rel="noreferrer" target="_blank">{descriptor.ctaLabel} ↗</a> : <span className="fallback">No live source URL bound yet</span>}
    </div>
  )
}

export default App
