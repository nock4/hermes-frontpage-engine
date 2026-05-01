import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react'
import { loadEditionPackage, loadManifest, polygonToClipPath } from './lib/editionLoader'
import { buildArchiveHref, getEditionArchiveRecords, parseAppRoute, type AppRoute } from './lib/router'
import { getRuntimeAmbienceClasses } from './lib/runtimeAmbience'
import { getRuntimePresentation } from './lib/runtimePresentation'
import { getRichPreviewModel } from './lib/richPreviewModel'
import { getSourceWindowDescriptor } from './lib/sourceWindowContent'
import { getSourceWindowAccentTone } from './lib/sourceWindowTone'
import { clearPreview, closeWindow, createWindowState, focusWindow, hoverBinding, pinBinding, restoreWindow } from './lib/sourceWindowManager'
import { collectEmbedPreloads } from './lib/embedPreloads'
import { buildRuntimeWarmupPlan, syncRuntimeWarmupLinks } from './lib/runtimeWarmup'
import { getStageWindowPlacement } from './lib/stageWindowPlacement'
import { getReviewMode } from './lib/reviewMode'
import { getArtifactCenter, getArtifactInheritanceProfile, getArtifactSceneReactionMetrics } from './lib/artifactScene'
import { getAboutTypographyStyle } from './lib/runtimeStyles'
import { ArchiveIndexPage, ArchiveMiniList } from './components/runtime/ArchiveNavigation'
import { EmbedPreloadLayer } from './components/runtime/EmbedPreloadLayer'
import { RuntimeSidebar } from './components/runtime/RuntimeSidebar'
import { SourceWindow, SourceWindowDock } from './components/runtime/SourceWindow'
import type { ArchiveRecord, ArtifactRecord, EditionManifest, LoadedEdition, SourceBindingRecord, SourceWindowState } from './types/runtime'

function App() {
  const [manifest, setManifest] = useState<EditionManifest | null>(null)
  const [route, setRoute] = useState<AppRoute | null>(null)
  const [loaded, setLoaded] = useState<LoadedEdition | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeArtifactId, setActiveArtifactId] = useState<string | null>(null)
  const [windowState, setWindowState] = useState<SourceWindowState>(createWindowState())
  const [locationKey, setLocationKey] = useState(() => `${window.location.pathname}${window.location.search}`)
  const [aboutOpen, setAboutOpen] = useState(false)
  const [archiveOpen, setArchiveOpen] = useState(false)

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
        const nextRoute = parseAppRoute(`${window.location.pathname}${window.location.search}`, nextManifest)
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

  useEffect(() => {
    setAboutOpen(false)
    setArchiveOpen(false)
  }, [locationKey])

  useEffect(() => {
    if (!aboutOpen && !archiveOpen) return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setAboutOpen(false)
        setArchiveOpen(false)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [aboutOpen, archiveOpen])

  const bindingsByArtifactId = useMemo(() => {
    if (!loaded) return new Map<string, SourceBindingRecord>()
    return new Map(loaded.sourceBindings.bindings.map((binding) => [binding.artifact_id, binding]))
  }, [loaded])

  const artifactsById = useMemo(() => {
    if (!loaded) return new Map<string, ArtifactRecord>()
    return new Map(loaded.artifactMap.artifacts.map((artifact) => [artifact.id, artifact]))
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
  const runtimeAmbienceClasses = getRuntimeAmbienceClasses(loaded?.ambiance ?? null, primaryBinding ?? previewBinding ?? activeBinding).join(' ')

  const archiveRecords = useMemo<ArchiveRecord[]>(() => (manifest ? getEditionArchiveRecords(manifest) : []), [manifest])
  const reviewMode = getReviewMode(window.location.search)
  const presentation = getRuntimePresentation(reviewMode)
  const hasPrimaryStageWindow = reviewMode === 'live' && !!primaryBinding
  const lockedArtifactId = hasPrimaryStageWindow ? primaryBinding?.artifact_id ?? null : null
  const stageVisualBindings = reviewMode === 'live'
    ? windowState.openBindingIds
      .filter((bindingId) => !windowState.minimizedBindingIds.includes(bindingId))
      .map((bindingId) => bindingsById.get(bindingId) ?? null)
      .filter((binding): binding is SourceBindingRecord => Boolean(binding))
      .filter((binding) => binding.window_type !== 'audio' || binding.id === primaryBinding?.id)
    : []
  const embedPreloads = useMemo(() => collectEmbedPreloads({
    bindings: loaded?.sourceBindings.bindings ?? [],
    reviewMode,
    openBindingIds: windowState.openBindingIds,
  }), [loaded?.sourceBindings.bindings, reviewMode, windowState.openBindingIds])
  const enhancementTechniquesByArtifactId = useMemo(() => {
    if (!loaded?.enhancementPlan) return new Map<string, string[]>()
    return new Map(
      loaded.enhancementPlan.targets
        .filter((target) => target.target_kind === 'artifact' && typeof target.artifact_id === 'string')
        .map((target) => [target.artifact_id as string, target.techniques]),
    )
  }, [loaded?.enhancementPlan])
  const runtimeWarmupPlan = useMemo(() => {
    if (!loaded || !route || route.kind === 'archive-index') return null

    return buildRuntimeWarmupPlan({
      editionPath: route.edition.path,
      plateAssetPath: loaded.edition.plate_asset_path,
      bindings: loaded.sourceBindings.bindings,
    })
  }, [loaded, route])
  const sceneReactionArtifactId = reviewMode === 'live'
    ? primaryBinding?.artifact_id ?? previewBinding?.artifact_id ?? null
    : null
  const sceneReactionArtifact = sceneReactionArtifactId ? artifactsById.get(sceneReactionArtifactId) ?? null : null
  const sceneReactionBinding = reviewMode === 'live' ? primaryBinding ?? previewBinding ?? null : null
  const sceneReactionTone = sceneReactionBinding ? getSourceWindowAccentTone(sceneReactionBinding) : null
  const stageReactionStyle = sceneReactionArtifact
    ? {
        '--scene-react-x': `${getArtifactCenter(sceneReactionArtifact).x * 100}%`,
        '--scene-react-y': `${getArtifactCenter(sceneReactionArtifact).y * 100}%`,
      } as CSSProperties
    : undefined
  const restoreDockBinding = useCallback((bindingId: string) => {
    setWindowState((state) => restoreWindow(state, bindingId))
  }, [])
  const previewArtifactBinding = useCallback((artifactId: string, binding: SourceBindingRecord | null) => {
    if (!lockedArtifactId || lockedArtifactId === artifactId) {
      setActiveArtifactId(artifactId)
    }

    if (binding) {
      setWindowState((state) => hoverBinding(state, binding, { freezeWhenPrimaryWindowOpen: reviewMode === 'live' }))
    }
  }, [lockedArtifactId, reviewMode])
  const activateArtifactBinding = useCallback((artifactId: string, binding: SourceBindingRecord | null) => {
    setActiveArtifactId(artifactId)
    if (!binding) return

    const descriptor = getSourceWindowDescriptor(binding)
    if (reviewMode === 'live' && descriptor.kind === 'rich-preview' && descriptor.sourceUrl) {
      setWindowState((state) => clearPreview(state))
      window.open(descriptor.sourceUrl, '_blank', 'noopener,noreferrer')
      return
    }

    setWindowState((state) => pinBinding(state, binding))
  }, [reviewMode])

  useEffect(() => {
    if (!runtimeWarmupPlan) return
    syncRuntimeWarmupLinks('runtime-route', runtimeWarmupPlan)
  }, [runtimeWarmupPlan])

  if (loading) return <main className="boot-state">Loading daily edition…</main>
  if (error) return <main className="boot-state">{error}</main>
  if (!manifest || !route) return <main className="boot-state">Missing manifest</main>

  if (route.kind === 'archive-index') {
    return <ArchiveIndexPage currentEditionId={manifest.current_edition_id} navigate={navigate} records={archiveRecords} />
  }

  if (!loaded) return <main className="boot-state">Edition not found.</main>

  const heroes = loaded.artifactMap.artifacts.filter((artifact) => artifact.kind === 'hero')
  const modules = loaded.artifactMap.artifacts.filter((artifact) => artifact.kind === 'module')
  const editionTypographyStyle = getAboutTypographyStyle(loaded.about)

  return (
    <main className={`runtime-shell review-mode--${reviewMode} ${runtimeAmbienceClasses}${presentation.showSidebar ? '' : ' runtime-shell--immersive'}${presentation.stageFillViewport ? ' runtime-shell--stage-fill' : ''}`} style={editionTypographyStyle}>
      <section className="runtime-main">
        {embedPreloads.length ? <EmbedPreloadLayer embeds={embedPreloads} /> : null}
        {presentation.showTopbar ? (
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
        ) : null}

        <section
          className={`stage${hasPrimaryStageWindow && presentation.suppressArtifactLabelsWhenPrimaryWindowOpen ? ' stage--primary-window-open' : ''}${sceneReactionArtifact ? ' stage--scene-reacting' : ''}${sceneReactionTone ? ` stage--scene-tone-${sceneReactionTone}` : ''}`}
          style={stageReactionStyle}
          onMouseLeave={(event) => {
            if (reviewMode === 'live') return
            const nextTarget = event.relatedTarget
            if (nextTarget instanceof HTMLElement && nextTarget.closest('.stage-overlay-windows')) return
            setWindowState((state) => clearPreview(state))
          }}
        >
          <img className="plate" src={loaded.edition.plate_asset_path} alt={loaded.edition.title} />

          {(loaded.about || archiveRecords.length) ? (
            <div className={`about-unfurl${aboutOpen || archiveOpen ? ' is-open' : ''}`}>
              <div className="about-unfurl__controls">
                <button
                  aria-controls="archive-panel"
                  aria-expanded={archiveOpen}
                  className="about-unfurl__button"
                  onClick={() => {
                    setArchiveOpen((open) => !open)
                    setAboutOpen(false)
                  }}
                  type="button"
                >
                  Archive
                </button>
                {loaded.about ? (
                  <button
                    aria-controls="about-panel"
                    aria-expanded={aboutOpen}
                    className="about-unfurl__button"
                    onClick={() => {
                      setAboutOpen((open) => !open)
                      setArchiveOpen(false)
                    }}
                    type="button"
                  >
                    {loaded.about.label}
                  </button>
                ) : null}
              </div>
              {archiveRecords.length ? (
                <section className={`about-unfurl__panel about-unfurl__panel--archive${archiveOpen ? ' is-visible' : ''}`} id="archive-panel">
                  <div className="about-unfurl__kicker">Archive</div>
                  <h2>Previous generations</h2>
                  <p className="about-unfurl__blurb">Open any prior edition and explore earlier front-page worlds.</p>
                  <div className="about-unfurl__archive-list">
                    <ArchiveMiniList currentEditionId={loaded.edition.edition_id} navigate={navigate} records={archiveRecords} />
                  </div>
                </section>
              ) : null}
              {loaded.about ? (
                <section className={`about-unfurl__panel${aboutOpen ? ' is-visible' : ''}`} id="about-panel">
                  {loaded.about.kicker ? <div className="about-unfurl__kicker">{loaded.about.kicker}</div> : null}
                  <h2>{loaded.about.title}</h2>
                  <p className="about-unfurl__blurb">{loaded.about.short_blurb}</p>
                  <div className="about-unfurl__body">
                    {loaded.about.body.map((paragraph, index) => (
                      <p key={`${loaded.about?.about_id ?? 'about'}-${index}`}>{paragraph}</p>
                    ))}
                  </div>
                </section>
              ) : null}
            </div>
          ) : null}

          {loaded.artifactMap.artifacts.map((artifact, artifactIndex) => {
            const active = artifact.id === activeArtifactId
            const clipPath = polygonToClipPath(artifact)
            const binding = bindingsByArtifactId.get(artifact.id) ?? null
            const bindingDescriptor = binding ? getSourceWindowDescriptor(binding) : null
            const bindingRichPreview = binding && bindingDescriptor?.kind === 'rich-preview'
              ? getRichPreviewModel(binding, bindingDescriptor)
              : null
            const clickOutClass = bindingDescriptor?.kind === 'rich-preview' ? ' artifact--click-out' : ''
            const previewPlacement = bindingRichPreview
              ? getStageWindowPlacement(artifact, 'preview', { spatialProfile: bindingRichPreview.spatialProfile })
              : null
            const whimsyClasses = bindingRichPreview
              ? ` artifact--projection-${bindingRichPreview.projectionProfile} artifact--motion-${bindingRichPreview.motionProfile} artifact--variant-${bindingRichPreview.sourceVariant}${previewPlacement ? ` artifact--contact-${previewPlacement.contactProfile} artifact--seam-${previewPlacement.seamProfile}` : ''}`
              : ''
            const previewActive = previewBinding?.artifact_id === artifact.id
            const artifactInheritanceProfile = getArtifactInheritanceProfile(artifact)
            const sceneReactionMetrics = sceneReactionArtifact && sceneReactionArtifact.id !== artifact.id
              ? getArtifactSceneReactionMetrics(artifact, sceneReactionArtifact)
              : null
            const sceneReactionClasses = sceneReactionMetrics
              ? ` artifact--scene-reactive artifact--scene-reactive-${sceneReactionMetrics.tier} artifact--scene-phase-${artifactIndex % 3}`
              : sceneReactionArtifact?.id === artifact.id
                ? ' artifact--scene-anchor'
                : ''
            const sceneReactionStyle = sceneReactionMetrics
              ? {
                  '--scene-drift-x': `${(sceneReactionMetrics.unitX * sceneReactionMetrics.strength * 0.26).toFixed(3)}rem`,
                  '--scene-drift-y': `${(sceneReactionMetrics.unitY * sceneReactionMetrics.strength * 0.22).toFixed(3)}rem`,
                  '--scene-react-delay': `${(artifactIndex % 5) * 80}ms`,
                  '--scene-react-strength': `${sceneReactionMetrics.strength.toFixed(3)}`,
                } as CSSProperties
              : undefined

            return (
              <button
                key={artifact.id}
                aria-label={artifact.label}
                className={`artifact artifact--${artifact.kind} artifact--inherit-${artifactInheritanceProfile}${clickOutClass}${active ? ' is-active' : ''}${previewActive ? ' artifact--preview-active' : ''}${presentation.showPersistentRegionLabels ? ' artifact--labels-on' : ''}${whimsyClasses}${sceneReactionClasses}`}
                style={{
                  left: `${artifact.bounds.x * 100}%`,
                  top: `${artifact.bounds.y * 100}%`,
                  width: `${artifact.bounds.w * 100}%`,
                  height: `${artifact.bounds.h * 100}%`,
                  clipPath,
                  WebkitClipPath: clipPath,
                  zIndex: artifact.z_index,
                  ...sceneReactionStyle,
                }}
                onMouseEnter={() => previewArtifactBinding(artifact.id, binding)}
                onFocus={() => previewArtifactBinding(artifact.id, binding)}
                onMouseDown={(event) => {
                  if (event.button !== 0 || (bindingDescriptor?.kind !== 'youtube-embed' && bindingDescriptor?.kind !== 'youtube-linkout')) return
                  activateArtifactBinding(artifact.id, binding)
                }}
                onClick={() => activateArtifactBinding(artifact.id, binding)}
                type="button"
              >
                <span>{artifact.label}</span>
              </button>
            )
          })}

          {presentation.showStageOverlayWindows ? (
            <div className={`stage-overlay-windows${reviewMode === 'live' ? ' stage-overlay-windows--live' : ''}`}>
              {reviewMode === 'live'
                ? stageVisualBindings.map((binding, index) => {
                    const isFrontmost = binding.id === primaryBinding?.id
                    return (
                      <SourceWindow
                        key={binding.id}
                        artifact={artifactsById.get(binding.artifact_id) ?? null}
                        binding={binding}
                        enhancementTechniques={enhancementTechniquesByArtifactId.get(binding.artifact_id) ?? []}
                        mode={isFrontmost ? 'primary' : 'secondary'}
                        onActivate={() => setWindowState((state) => focusWindow(state, binding.id))}
                        onClose={() => setWindowState((state) => closeWindow(state, binding.id))}
                        stackIndex={index}
                        surface="stage"
                      />
                    )
                  })
                : primaryBinding ? (
                    <SourceWindow
                      artifact={artifactsById.get(primaryBinding.artifact_id) ?? null}
                      binding={primaryBinding}
                      enhancementTechniques={enhancementTechniquesByArtifactId.get(primaryBinding.artifact_id) ?? []}
                      mode="primary"
                      onClose={() => setWindowState((state) => closeWindow(state, primaryBinding.id))}
                      surface="panel"
                    />
                  ) : null}
              {previewBinding && (!primaryBinding || previewBinding.id !== primaryBinding.id) ? (
                <SourceWindow
                  artifact={artifactsById.get(previewBinding.artifact_id) ?? null}
                  binding={previewBinding}
                  enhancementTechniques={enhancementTechniquesByArtifactId.get(previewBinding.artifact_id) ?? []}
                  mode="preview"
                  onClose={() => setWindowState((state) => clearPreview(state))}
                  onPreviewAction={() => {
                    const descriptor = getSourceWindowDescriptor(previewBinding)
                    if (descriptor.kind === 'rich-preview' && descriptor.sourceUrl) {
                      setWindowState((state) => clearPreview(state))
                      window.open(descriptor.sourceUrl, '_blank', 'noopener,noreferrer')
                      return
                    }
                    setActiveArtifactId(previewBinding.artifact_id)
                    setWindowState((state) => pinBinding(state, previewBinding))
                  }}
                  surface={reviewMode === 'live' ? 'stage' : 'panel'}
                />
              ) : null}
              {dockBindings.length ? <SourceWindowDock bindings={dockBindings} onRestore={restoreDockBinding} stage={reviewMode === 'live'} /> : null}
            </div>
          ) : null}
        </section>

        {presentation.showArtifactLists ? (
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
        ) : null}
      </section>

      {presentation.showSidebar ? (
        <RuntimeSidebar
          activeBinding={activeBinding}
          archiveRecords={archiveRecords}
          dockBindings={dockBindings}
          loaded={loaded}
          navigate={navigate}
          onClosePreviewBinding={() => setWindowState((state) => clearPreview(state))}
          onClosePrimaryBinding={(bindingId) => setWindowState((state) => closeWindow(state, bindingId))}
          onRestoreDockBinding={restoreDockBinding}
          presentation={presentation}
          previewBinding={previewBinding}
          primaryBinding={primaryBinding}
          route={route}
        />
      ) : null}
    </main>
  )
}


export default App
