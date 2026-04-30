import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react'
import { loadEditionPackage, loadManifest, polygonToClipPath } from './lib/editionLoader'
import { buildArchiveHref, getEditionArchiveRecords, parseAppRoute, type AppRoute } from './lib/router'
import { getSourceWindowDescriptor, getYouTubeThumbnailUrl } from './lib/sourceWindowContent'
import { getRuntimeAmbienceClasses } from './lib/runtimeAmbience'
import { getRuntimePresentation } from './lib/runtimePresentation'
import { getRichPreviewModel } from './lib/richPreviewModel'
import { getStageWindowPlacement } from './lib/stageWindowPlacement'
import { getSourceWindowSurfaceProfile } from './lib/sourceWindowSurface'
import { getSourceWindowAccentTone } from './lib/sourceWindowTone'
import { getTweetEmbedSrcDoc, TWEET_EMBED_SANDBOX } from './lib/tweetEmbed'
import { clearPreview, closeWindow, createWindowState, focusWindow, hoverBinding, pinBinding, restoreWindow } from './lib/sourceWindowManager'
import { collectEmbedPreloads, type EmbedPreload } from './lib/embedPreloads'
import { buildRuntimeWarmupPlan, syncRuntimeWarmupLinks } from './lib/runtimeWarmup'
import { sanitizeSourceImageUrl } from './lib/sourceUrl'
import type { ArchiveRecord, ArtifactRecord, EditionManifest, LoadedEdition, SourceBindingRecord, SourceWindowState } from './types/runtime'
import type { SourceWindowDescriptor } from './types/sourceWindows'

type SourceWindowMode = 'preview' | 'primary' | 'secondary'
type SourceWindowSurface = 'panel' | 'stage'
type SourceWindowSurfaceProfile = ReturnType<typeof getSourceWindowSurfaceProfile>
type RichPreviewModel = ReturnType<typeof getRichPreviewModel>
type SourceWindowPlacementStyle = CSSProperties & {
  '--emission-x': string
  '--emission-y': string
  '--source-window-bloom-origin': string
  '--source-window-bloom-x': string
  '--source-window-bloom-y': string
}

type AboutTypographyStyle = CSSProperties & {
  '--about-heading-font'?: string
  '--about-body-font'?: string
  '--about-accent-font'?: string
  '--about-heading-weight'?: number
  '--about-body-weight'?: number
  '--about-accent-weight'?: number
  '--source-card-title-font'?: string
  '--source-card-body-font'?: string
  '--source-card-accent-font'?: string
  '--source-card-title-weight'?: number
  '--source-card-body-weight'?: number
  '--source-card-accent-weight'?: number
}

const clampPercent = (value: number) => Math.min(100, Math.max(0, value))

const getSourceWindowPlacementStyle = (placement: NonNullable<ReturnType<typeof getStageWindowPlacement>>, stackIndex: number): SourceWindowPlacementStyle => {
  const bloomX = clampPercent(((placement.emissionX - placement.x) / placement.width) * 100)
  const bloomY = clampPercent(((placement.emissionY - placement.y) / placement.maxHeight) * 100)

  return {
    left: `${placement.x * 100}%`,
    top: `${placement.y * 100}%`,
    width: `${placement.width * 100}%`,
    maxWidth: 'calc(100% - 1.5rem)',
    maxHeight: `min(${placement.maxHeight * 100}%, calc(100% - 1.5rem))`,
    zIndex: 40 + stackIndex,
    '--emission-x': `${placement.emissionX * 100}%`,
    '--emission-y': `${placement.emissionY * 100}%`,
    '--source-window-bloom-origin': `${bloomX}% ${bloomY}%`,
    '--source-window-bloom-x': `${bloomX}%`,
    '--source-window-bloom-y': `${bloomY}%`,
  }
}

const getAboutTypographyStyle = (about: LoadedEdition['about']): AboutTypographyStyle | undefined => {
  const typography = about?.typography
  if (!typography) return undefined

  return {
    '--about-heading-font': typography.heading_family,
    '--about-body-font': typography.body_family,
    '--about-accent-font': typography.accent_family,
    '--about-heading-weight': typography.heading_weight,
    '--about-body-weight': typography.body_weight,
    '--about-accent-weight': typography.accent_weight,
    '--source-card-title-font': typography.heading_family,
    '--source-card-body-font': typography.body_family,
    '--source-card-accent-font': typography.accent_family,
    '--source-card-title-weight': typography.heading_weight,
    '--source-card-body-weight': typography.body_weight,
    '--source-card-accent-weight': typography.accent_weight,
  }
}

interface ArchiveNavigationProps {
  records: ArchiveRecord[]
  navigate: (href: string) => void
  currentEditionId: string
}

interface SourceWindowProps {
  binding: SourceBindingRecord
  mode: SourceWindowMode
  onClose: () => void
  onActivate?: () => void
  onPreviewAction?: () => void
  artifact?: ArtifactRecord | null
  enhancementTechniques?: string[]
  stackIndex?: number
  surface?: SourceWindowSurface
}

interface SourceWindowBodyProps {
  binding: SourceBindingRecord
  descriptor: SourceWindowDescriptor
  profile: SourceWindowSurfaceProfile
  richPreviewModel: RichPreviewModel | null
  mode: SourceWindowMode
  surface: SourceWindowSurface
  artifact?: ArtifactRecord | null
  enhancementTechniques?: string[]
  onPreviewAction?: () => void
}

interface SourceWindowDockProps {
  bindings: SourceBindingRecord[]
  onRestore: (bindingId: string) => void
  stage?: boolean
}

const getReviewMode = (search: string) => {
  const params = new URLSearchParams(search)
  if (params.get('debug') === 'masks') return 'debug' as const

  const qaMode = params.get('qa')
  if (qaMode === 'clickable') return 'clickable' as const
  if (qaMode === 'solo') return 'solo' as const

  return 'live' as const
}

const getArtifactCenter = (artifact: ArtifactRecord) => ({
  x: artifact.bounds.x + artifact.bounds.w / 2,
  y: artifact.bounds.y + artifact.bounds.h / 2,
})

const getArtifactSceneReactionMetrics = (artifact: ArtifactRecord, anchorArtifact: ArtifactRecord) => {
  const artifactCenter = getArtifactCenter(artifact)
  const anchorCenter = getArtifactCenter(anchorArtifact)
  const dx = artifactCenter.x - anchorCenter.x
  const dy = artifactCenter.y - anchorCenter.y
  const distance = Math.sqrt(dx * dx + dy * dy)

  let tier = 3
  if (distance < 0.18) tier = 1
  else if (distance < 0.36) tier = 2

  const safeDistance = distance || 0.0001
  const unitX = dx / safeDistance
  const unitY = dy / safeDistance
  const strength = Math.max(0.2, 1 - Math.min(distance / 0.56, 0.82))

  return {
    tier,
    unitX,
    unitY,
    strength,
  }
}

type ArtifactInheritanceProfile = 'paper' | 'glass' | 'light' | 'living' | 'container' | 'device' | 'neutral'

const getArtifactInheritanceProfile = (artifact: ArtifactRecord | null | undefined): ArtifactInheritanceProfile => {
  if (!artifact) return 'neutral'
  const type = artifact.artifact_type.toLowerCase()

  if (/(paper|sheet|note|chart|scroll|map|document|label|tab|book|board)/.test(type)) return 'paper'
  if (/(glass|lens|jar|vial|mirror)/.test(type)) return 'glass'
  if (/(lamp|candle|light|bulb)/.test(type)) return 'light'
  if (/(plant|specimen|leaf|flower|moss)/.test(type)) return 'living'
  if (/(tray|cabinet|case|box|container|cup|bowl|teapot|dish|vessel|shelf)/.test(type)) return 'container'
  if (/(device|display|cassette|headphones|listening|media|monitor|screen|tool|equipment|handset|cable|disk)/.test(type)) return 'device'
  return 'neutral'
}

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
        const nextRoute = parseAppRoute(window.location.pathname, nextManifest)
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
  }, [locationKey])

  useEffect(() => {
    if (!aboutOpen) return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setAboutOpen(false)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [aboutOpen])

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

          {loaded.about ? (
            <div className={`about-unfurl${aboutOpen ? ' is-open' : ''}`}>
              <button
                aria-controls="about-panel"
                aria-expanded={aboutOpen}
                className="about-unfurl__button"
                onClick={() => setAboutOpen((open) => !open)}
                type="button"
              >
                {loaded.about.label}
              </button>
              <section className="about-unfurl__panel" id="about-panel">
                {loaded.about.kicker ? <div className="about-unfurl__kicker">{loaded.about.kicker}</div> : null}
                <h2>{loaded.about.title}</h2>
                <p className="about-unfurl__blurb">{loaded.about.short_blurb}</p>
                <div className="about-unfurl__body">
                  {loaded.about.body.map((paragraph, index) => (
                    <p key={`${loaded.about?.about_id ?? 'about'}-${index}`}>{paragraph}</p>
                  ))}
                </div>
              </section>
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
        <aside className="side-rail">
          <section className="panel">
            <div className="eyebrow">{presentation.briefEyebrow}</div>
            <h2>{loaded.edition.title}</h2>
            <p>{loaded.brief.mood}</p>
            <p>Lighting: {loaded.brief.lighting}</p>
            <p>Motion: {loaded.ambiance.motion_system}</p>
            {route.kind === 'archive-edition' ? <p>{loaded.edition.date} · {loaded.edition.scene_family}</p> : null}
          </section>

          <section className="panel">
            <div className="eyebrow">Source windows</div>
            {primaryBinding ? (
              <SourceWindow binding={primaryBinding} mode="primary" onClose={() => setWindowState((state) => closeWindow(state, primaryBinding.id))} surface="panel" />
            ) : (
              <p>{presentation.sourceWindowsEmptyState}</p>
            )}

            {previewBinding && (!primaryBinding || previewBinding.id !== primaryBinding.id) ? (
              <SourceWindow binding={previewBinding} mode="preview" onClose={() => setWindowState((state) => clearPreview(state))} surface="panel" />
            ) : null}

            {dockBindings.length ? <SourceWindowDock bindings={dockBindings} onRestore={restoreDockBinding} /> : null}
          </section>

          <section className="panel">
            <div className="eyebrow">{presentation.selectionEyebrow}</div>
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

          {presentation.showReviewPanel ? (
            <section className="panel">
              <div className="eyebrow">Review</div>
              <p>Geometry: {loaded.review.geometry_status}</p>
              <p>Clickability: {loaded.review.clickability_status}</p>
              <p>Behavior: {loaded.review.behavior_status}</p>
            </section>
          ) : null}
        </aside>
      ) : null}
    </main>
  )
}

function ArchiveIndexPage({ records, navigate, currentEditionId }: ArchiveNavigationProps) {
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

function ArchiveMiniList({ records, navigate, currentEditionId }: ArchiveNavigationProps) {
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

function SourceWindowDock({ bindings, onRestore, stage = false }: SourceWindowDockProps) {
  return (
    <div className={`window-dock${stage ? ' window-dock--stage' : ''}`}>
      <div className="eyebrow">Dock</div>
      <div className="window-dock__items">
        {bindings.map((binding) => (
          <button key={binding.id} onClick={() => onRestore(binding.id)} type="button">
            Restore {binding.kicker}
          </button>
        ))}
      </div>
    </div>
  )
}

function SourceWindow({
  binding,
  mode,
  onClose,
  onActivate,
  onPreviewAction,
  artifact = null,
  enhancementTechniques = [],
  stackIndex = 0,
  surface = 'panel',
}: SourceWindowProps) {
  const descriptor = getSourceWindowDescriptor(binding)
  const richPreviewModel = descriptor.kind === 'rich-preview' ? getRichPreviewModel(binding, descriptor) : null
  const profile = getSourceWindowSurfaceProfile(descriptor, surface, mode)
  const placement = surface === 'stage' && artifact ? getStageWindowPlacement(artifact, mode, { spatialProfile: richPreviewModel?.spatialProfile }) : null
  const artifactInheritanceProfile = getArtifactInheritanceProfile(artifact)
  const usesScreenRenderedEnhancement = shouldUseScreenRenderedEnhancement(surface, mode, descriptor, binding, artifact, enhancementTechniques)
  const usesWarpedPaperEnhancement = shouldUseWarpedPaperEnhancement(surface, mode, descriptor, binding, artifact, enhancementTechniques)
  const isStageTextBloom = !usesScreenRenderedEnhancement && !usesWarpedPaperEnhancement && surface === 'stage' && descriptor.kind === 'rich-preview' && mode === 'preview'
  const isStageTweetEmbed = surface === 'stage' && descriptor.kind === 'tweet-embed'
  const isStageSignalTuning = !usesScreenRenderedEnhancement && surface === 'stage' && descriptor.kind === 'youtube-embed' && mode === 'preview'
  const isStageCabinetPlayer = surface === 'stage' && descriptor.kind === 'youtube-embed' && mode === 'primary' && usesCabinetPlayerShell(artifact)
  const isStageEmbeddedMediaBare = surface === 'stage' && descriptor.kind === 'youtube-embed' && mode === 'primary' && !usesCabinetPlayerShell(artifact)
  const isStageYouTubeLinkout = surface === 'stage' && descriptor.kind === 'youtube-linkout'
  const isStageClickOut = surface === 'stage' && descriptor.kind === 'rich-preview' && mode === 'preview'
  const isStageRichPreviewCard = surface === 'stage' && descriptor.kind === 'rich-preview' && mode !== 'preview' && !usesScreenRenderedEnhancement && !usesWarpedPaperEnhancement

  return (
    <div
      className={`source-window source-window--${mode} source-window--frame-${profile.frameStyle} source-window--body-${profile.bodyStyle}${usesScreenRenderedEnhancement ? ' source-window--enhancement-screen-rendered' : ''}${usesWarpedPaperEnhancement ? ' source-window--enhancement-warped-paper' : ''}${isStageTextBloom ? ' source-window--text-bloom' : ''}${isStageTweetEmbed ? ' source-window--tweet-embed-native' : ''}${isStageSignalTuning ? ' source-window--signal-tuning-video' : ''}${isStageCabinetPlayer ? ' source-window--cabinet-player' : ''}${isStageEmbeddedMediaBare ? ' source-window--embedded-media-bare' : ''}${isStageYouTubeLinkout ? ' source-window--youtube-linkout' : ''}${isStageClickOut ? ' source-window--click-out' : ''}${isStageRichPreviewCard ? ' source-window--rich-preview-stage' : ''}${artifact ? ` source-window--artifact-${artifactInheritanceProfile}` : ''}${richPreviewModel ? ` source-window--motion-${richPreviewModel.motionProfile} source-window--spatial-${richPreviewModel.spatialProfile} source-window--projection-${richPreviewModel.projectionProfile}` : ''}${placement ? ` source-window--stage source-window--tone-${placement.tone} source-window--anchor-${placement.anchorSide} source-window--direction-${placement.expansionLabel} source-window--route-${placement.routeProfile} source-window--contact-${placement.contactProfile} source-window--seam-${placement.seamProfile}` : ''}`}
      data-artifact-id={binding.artifact_id}
      data-binding-id={binding.id}
      data-source-window-kind={descriptor.kind}
      data-source-window-mode={mode}
      onMouseDown={mode === 'preview' && onPreviewAction ? (event) => {
        event.preventDefault()
        event.stopPropagation()
        onPreviewAction()
      } : onActivate}
      onFocus={onActivate}
      onClick={mode === 'preview' && onPreviewAction ? (event) => {
        event.preventDefault()
        event.stopPropagation()
      } : undefined}
      style={placement ? getSourceWindowPlacementStyle(placement, stackIndex) : undefined}
      tabIndex={0}
    >
      {profile.showHeader ? (
        <div className="source-window__top">
          <div>
            <div className="eyebrow">{mode === 'preview' ? `Preview · ${binding.kicker}` : binding.kicker}</div>
            <strong>{binding.title}</strong>
          </div>
          <div className="source-window__actions">
            <button className={`source-window__close source-window__close--${profile.closeStyle}`} onClick={onClose} type="button">{mode === 'preview' ? 'Dismiss' : 'Close'}</button>
          </div>
        </div>
      ) : !isStageTextBloom && !isStageSignalTuning || mode !== 'preview' ? (
        <div className="source-window__floating-actions">
          <button aria-label={mode === 'preview' ? 'Dismiss preview' : 'Close source window'} className={`source-window__close source-window__close--${profile.closeStyle}`} onClick={onClose} type="button">×</button>
        </div>
      ) : null}
      {profile.showExcerpt ? <p>{binding.excerpt}</p> : null}
      {profile.showMeta ? (
        <div className="source-window__meta">
          <span>{binding.window_type}</span>
          <span>{binding.source_type}</span>
          <span>{descriptor.platformLabel}</span>
          <span>{descriptor.allowsPlaybackPersistence ? 'persistent' : 'replaceable'}</span>
        </div>
      ) : null}
      <SourceWindowBody binding={binding} descriptor={descriptor} profile={profile} richPreviewModel={richPreviewModel} mode={mode} surface={surface} artifact={artifact} enhancementTechniques={enhancementTechniques} onPreviewAction={onPreviewAction} />
    </div>
  )
}

function isRootSourceUrl(sourceUrl: string | null | undefined) {
  if (!sourceUrl) return false
  try {
    const parsed = new URL(sourceUrl)
    return parsed.pathname === '/' || parsed.pathname === ''
  } catch {
    return false
  }
}

function getSocialBodyCopy(binding: SourceBindingRecord, descriptor: SourceWindowDescriptor) {
  const excerpt = binding.excerpt?.trim()

  if (excerpt) return excerpt
  if ('sourceLabel' in descriptor && descriptor.sourceLabel) return `Open the original post from ${descriptor.sourceLabel} on ${descriptor.platformLabel}.`
  return `Open the original post on ${descriptor.platformLabel}.`
}

function isLowValueSourceImage(imageUrl: string | null | undefined) {
  if (!imageUrl) return true

  try {
    const parsed = new URL(imageUrl)
    const path = `${parsed.hostname}${parsed.pathname}`.toLowerCase()
    return parsed.hostname === 'abs.twimg.com'
      || path.includes('profile_images')
      || path.includes('profile_pic')
      || path.includes('profile-picture')
      || path.includes('/profile/')
      || path.includes('s100x100')
      || path.includes('favicon')
      || path.includes('apple-touch-icon')
      || path.includes('site-icon')
      || path.includes('wordmark')
      || path.includes('templatethumbnail')
      || path.includes('/logo')
      || /(?:^|[/_\-.])icon(?:[/_\-.]|$)/.test(path)
      || /\.ico(?:$|[?#])/.test(path)
      || /\.svg(?:$|[?#])/.test(path)
  } catch {
    const lower = imageUrl.toLowerCase()
    return lower.includes('abs.twimg.com')
      || lower.includes('profile_images')
      || lower.includes('profile_pic')
      || lower.includes('profile-picture')
      || lower.includes('/profile/')
      || lower.includes('s100x100')
      || lower.includes('favicon')
      || lower.includes('apple-touch-icon')
      || lower.includes('site-icon')
      || lower.includes('wordmark')
      || lower.includes('templatethumbnail')
      || lower.includes('/logo')
      || /(?:^|[/_\-.])icon(?:[/_\-.]|$)/.test(lower)
      || /\.ico(?:$|[?#])/.test(lower)
      || /\.svg(?:$|[?#])/.test(lower)
  }
}

function getUsableSourceImageUrl(binding: SourceBindingRecord) {
  const imageUrl = sanitizeSourceImageUrl(binding.source_image_url)
  if (!imageUrl || isLowValueSourceImage(imageUrl)) return null
  return imageUrl
}

function usesGhostReflectionTreatment(enhancementTechniques: string[]) {
  return enhancementTechniques.includes('ghost-reflection-treatment')
}

function usesArchiveImagePreview(artifact: ArtifactRecord | null | undefined, enhancementTechniques: string[]) {
  return artifact?.id === 'module-archive-cabinet' && enhancementTechniques.includes('ghost-reflection-treatment')
}

function artifactText(artifact: ArtifactRecord | null | undefined) {
  if (!artifact) return ''
  return `${artifact.id} ${artifact.label} ${artifact.artifact_type}`.toLowerCase()
}

function shouldUseScreenRenderedEnhancement(
  surface: SourceWindowSurface,
  mode: SourceWindowMode,
  descriptor: SourceWindowDescriptor,
  binding: SourceBindingRecord,
  artifact: ArtifactRecord | null | undefined,
  enhancementTechniques: string[],
) {
  if (surface !== 'stage' || mode !== 'preview') return false
  if (descriptor.kind !== 'rich-preview') return false
  if (enhancementTechniques.includes('screen-rendered-html')) return true

  return Boolean(getUsableSourceImageUrl(binding))
    && /(screen|monitor|cctv|display|television|video)/.test(artifactText(artifact))
}

function shouldUseWarpedPaperEnhancement(
  surface: SourceWindowSurface,
  mode: SourceWindowMode,
  descriptor: SourceWindowDescriptor,
  binding: SourceBindingRecord,
  artifact: ArtifactRecord | null | undefined,
  enhancementTechniques: string[],
) {
  if (surface !== 'stage' || mode !== 'preview' || descriptor.kind !== 'rich-preview') return false
  if (usesArchiveImagePreview(artifact, enhancementTechniques)) return true
  if (!enhancementTechniques.includes('warped-paper-fragment')) return false

  const richPreview = getRichPreviewModel(binding, descriptor)
  if (richPreview.sourceVariant === 'repo-slip') return false
  if (richPreview.sourceVariant === 'editorial-note' && !/(map|ranking|archive|cabinet|board|placard|spread)/.test(artifactText(artifact))) return false
  return true
}

function usesCabinetPlayerShell(artifact: ArtifactRecord | null | undefined) {
  return artifact?.id === 'module-listening-placard' || artifact?.id === 'module-field-recordings-box'
}

function EmbedPreloadLayer({
  embeds,
}: {
  embeds: EmbedPreload[]
}) {
  return (
    <div aria-hidden="true" className="embed-preload-layer">
      {embeds.map((embed) => (
        embed.kind === 'tweet' ? (
          <iframe
            key={embed.id}
            className="embed-preload-frame"
            data-embed-preload-kind="tweet"
            loading="eager"
            sandbox={TWEET_EMBED_SANDBOX}
            srcDoc={embed.srcDoc}
            tabIndex={-1}
            title={`Preload ${embed.title}`}
          />
        ) : embed.kind === 'image' ? (
          <img
            key={embed.id}
            alt=""
            aria-hidden="true"
            className="embed-preload-image"
            data-embed-preload-kind="image"
            decoding="async"
            fetchPriority="high"
            loading="eager"
            src={embed.src}
          />
        ) : (
          <iframe
            key={embed.id}
            allow={embed.kind === 'youtube' ? 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture' : 'autoplay'}
            className="embed-preload-frame"
            data-embed-preload-kind={embed.kind}
            loading="eager"
            src={embed.src}
            tabIndex={-1}
            title={`Preload ${embed.title}`}
          />
        )
      ))}
    </div>
  )
}

function SourceImageTitleCard({
  binding,
  imageUrl,
  title,
  href,
}: {
  binding: SourceBindingRecord
  imageUrl: string | null
  title: string
  href?: string | null
}) {
  const cardBody = (
    <>
      {imageUrl ? (
        <figure className="visual-source-card__figure">
          <img alt={binding.source_image_alt ?? title} className="visual-source-card__image" src={imageUrl} />
        </figure>
      ) : null}
      <strong className="visual-source-card__title">{title}</strong>
    </>
  )

  return (
    <div className="source-window__body source-window__body--visual-card">
      {href ? (
        <a className="visual-source-card" href={href} rel="noreferrer" target="_blank">
          {cardBody}
        </a>
      ) : (
        <article className="visual-source-card">
          {cardBody}
        </article>
      )}
    </div>
  )
}

function SourceWindowBody({
  binding,
  descriptor,
  profile,
  richPreviewModel,
  mode,
  surface,
  artifact = null,
  enhancementTechniques = [],
}: SourceWindowBodyProps) {
  const usesScreenRenderedEnhancement = shouldUseScreenRenderedEnhancement(surface, mode, descriptor, binding, artifact, enhancementTechniques)
  const usesWarpedPaperEnhancement = shouldUseWarpedPaperEnhancement(surface, mode, descriptor, binding, artifact, enhancementTechniques)
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
      </div>
    )
  }

  if (descriptor.kind === 'youtube-linkout') {
    const sourceImage = getUsableSourceImageUrl(binding) || getYouTubeThumbnailUrl(binding.source_url)

    return (
      <div className="source-window__body source-window__body--youtube-linkout">
        <a className="youtube-linkout youtube-linkout--poster-only" href={descriptor.sourceUrl} rel="noreferrer" target="_blank">
          {sourceImage ? (
            <figure className="youtube-linkout__poster">
              <img alt={binding.source_image_alt ?? binding.title} src={sourceImage} />
              <span aria-hidden="true" className="youtube-linkout__play">▶</span>
            </figure>
          ) : null}
        </a>
      </div>
    )
  }

  const visualCardImage = getUsableSourceImageUrl(binding)
  const visualCardTitle = binding.source_title || binding.title
  const visualCardHref = 'sourceUrl' in descriptor ? descriptor.sourceUrl : binding.source_url
  const shouldUseVisualCard = Boolean(visualCardImage) || surface === 'stage'
  if (shouldUseVisualCard) {
    return (
      <SourceImageTitleCard
        binding={binding}
        href={visualCardHref}
        imageUrl={visualCardImage}
        title={visualCardTitle}
      />
    )
  }

  if (descriptor.kind === 'soundcloud-embed') {
    return (
      <div className="source-window__body source-window__body--audio-embed">
        {profile.showBodyPlatformPill ? <span className="source-window__platform-pill">{descriptor.platformLabel}</span> : null}
        <iframe
          allow="autoplay"
          loading="lazy"
          src={descriptor.embedUrl}
          title={binding.title}
        />
        <a href={descriptor.sourceUrl} rel="noreferrer" target="_blank">{descriptor.ctaLabel} ↗</a>
      </div>
    )
  }

  if (descriptor.kind === 'bandcamp-card') {
    return (
      <div className="source-window__body source-window__body--audio">
        <div className="audio-dock-card audio-dock-card--bandcamp">
          {profile.showBodyEyebrow ? <div className="eyebrow">{descriptor.platformLabel}</div> : null}
          {profile.showBodyPlatformPill ? <span className="source-window__platform-pill">{descriptor.platformLabel}</span> : null}
          <strong>{descriptor.artistLabel}</strong>
          <span className="source-pill">{descriptor.releasePath}</span>
          <p>Provider-aware fallback for resolved Bandcamp sources when there is no stable embed path available from the stored URL alone.</p>
        </div>
        <a href={descriptor.sourceUrl} rel="noreferrer" target="_blank">{descriptor.ctaLabel} ↗</a>
      </div>
    )
  }

  if (descriptor.kind === 'audio-dock') {
    return (
      <div className="source-window__body source-window__body--audio">
        <div className={`audio-dock-card${descriptor.ctaLabel === 'Resolved track source required' ? ' audio-dock-card--warning' : ''}`}>
          {profile.showBodyEyebrow ? <div className="eyebrow">{descriptor.platformLabel}</div> : null}
          {profile.showBodyPlatformPill ? <span className="source-window__platform-pill">{descriptor.platformLabel}</span> : null}
          <strong>Persistent track pocket</strong>
          <p>
            {descriptor.ctaLabel === 'Resolved track source required'
              ? 'This signal still points at NTS discovery context. Swap in the resolved track source before treating it like a playable front-page pocket.'
              : 'This pocket is ready to hand off to the resolved track source while keeping the dock-style listening posture.'}
          </p>
        </div>
        {descriptor.streamUrl ? <a href={descriptor.streamUrl} rel="noreferrer" target="_blank">{descriptor.ctaLabel} ↗</a> : <span className="fallback">No live audio source URL bound yet</span>}
      </div>
    )
  }

  if (descriptor.kind === 'tweet-embed') {
    return (
      <div className="source-window__body source-window__body--tweet-embed">
        <iframe
          className="tweet-embed-frame"
          loading="lazy"
          sandbox={TWEET_EMBED_SANDBOX}
          srcDoc={getTweetEmbedSrcDoc(descriptor.sourceUrl)}
          title={binding.title}
        />
      </div>
    )
  }

  if (descriptor.kind === 'social-card') {
    const socialBodyCopy = getSocialBodyCopy(binding, descriptor)

    return (
      <div className="source-window__body source-window__body--social">
        <div className="social-card social-card--post">
          <div className="social-card__header-row">
            <div className="social-card__author">
              <strong>{descriptor.sourceLabel ?? descriptor.domainLabel}</strong>
              {descriptor.byline ? <span>{descriptor.byline}</span> : null}
            </div>
            {profile.showBodyPlatformPill ? <span className="source-window__platform-pill">{descriptor.platformLabel}</span> : null}
          </div>
          {descriptor.postLabel ? <span className="source-pill">{descriptor.postLabel}</span> : null}
          <p>{socialBodyCopy}</p>
        </div>
        {descriptor.sourceUrl ? <a href={descriptor.sourceUrl} rel="noreferrer" target="_blank">{descriptor.ctaLabel} ↗</a> : <span className="fallback">No live post URL bound yet</span>}
      </div>
    )
  }

  if (descriptor.kind === 'rich-preview' && usesScreenRenderedEnhancement) {
    const richPreview = richPreviewModel ?? getRichPreviewModel(binding, descriptor)
    const screenTitle = binding.source_title || richPreview.richPreviewTitle
    const screenImage = getUsableSourceImageUrl(binding)

    return (
      <div className="source-window__body source-window__body--screen-preview">
        <div className="source-window__screen-preview-shell">
          <div className="source-window__screen-preview-aura" />
          <div className="source-window__screen-preview-frame">
            {screenImage ? <img alt={binding.source_image_alt ?? screenTitle} className="source-window__screen-preview-image" src={screenImage} /> : null}
          </div>
          <div className="source-window__screen-preview-copy">
            <strong className="source-window__screen-preview-title">{screenTitle}</strong>
          </div>
        </div>
      </div>
    )
  }

  if (descriptor.kind === 'rich-preview' && usesWarpedPaperEnhancement) {
    const richPreview = richPreviewModel ?? getRichPreviewModel(binding, descriptor)
    const paperTitle = binding.source_title || richPreview.richPreviewTitle
    const paperImage = getUsableSourceImageUrl(binding)
    const usesGhostReflection = usesGhostReflectionTreatment(enhancementTechniques)
    const isArchiveImagePreview = usesArchiveImagePreview(artifact, enhancementTechniques)

    if (isArchiveImagePreview) {
      return (
        <div className="source-window__body source-window__body--archive-image-preview">
          <div className="archive-image-preview">
            {paperImage ? <img alt={binding.source_image_alt ?? paperTitle} className="archive-image-preview__image" src={paperImage} /> : null}
            <div aria-hidden="true" className="archive-image-preview__ghost-reflection" />
            <div className="archive-image-preview__copy">
              <strong className="archive-image-preview__title">{paperTitle}</strong>
              <span className="archive-image-preview__cue">open ↗</span>
            </div>
          </div>
        </div>
      )
    }

    return (
      <div className="source-window__body source-window__body--warped-paper-preview">
        <div className={`paper-preview paper-preview--image-${richPreview.imageTreatment} paper-preview--font-${richPreview.fontProfile} paper-preview--title-treatment-${richPreview.titleTreatment}${usesGhostReflection ? ' paper-preview--ghost-reflection' : ''}`}>
          <div aria-hidden="true" className="paper-preview__grain" />
          <div aria-hidden="true" className="paper-preview__fold paper-preview__fold--top" />
          <div aria-hidden="true" className="paper-preview__fold paper-preview__fold--side" />
          {usesGhostReflection ? <div aria-hidden="true" className="paper-preview__ghost-reflection" /> : null}
          {paperImage ? (
            <figure className={`paper-preview__image-cutout paper-preview__image-cutout--${richPreview.imageTreatment}`}>
              <img alt={binding.source_image_alt ?? paperTitle} className="paper-preview__image" src={paperImage} />
            </figure>
          ) : null}
          <div className="paper-preview__copy">
            <strong className="paper-preview__title source-window__paper-preview-title">{paperTitle}</strong>
            <span className="paper-preview__cue">open ↗</span>
          </div>
        </div>
      </div>
    )
  }

  const internalKickerLabels = new Set(['Mapped pocket', 'Hero artifact', 'Artifact pocket'])
  const richPreview = richPreviewModel ?? getRichPreviewModel(binding, descriptor)
  const sourceDomainLabel = richPreview.sourceDomainLabel
  const usableSourceImageUrl = getUsableSourceImageUrl(binding)
  const showImageCutout = Boolean(usableSourceImageUrl) && !(richPreview.sourceVariant === 'field-note' && isRootSourceUrl(binding.source_url))
  const richPreviewLabel = internalKickerLabels.has(binding.kicker)
    ? sourceDomainLabel.toUpperCase()
    : binding.kicker || sourceDomainLabel

  return (
    <div className="source-window__body source-window__body--web">
      <div className={`rich-preview-card rich-preview-card--${richPreview.sourceVariant} rich-preview-card--image-${richPreview.imageTreatment} rich-preview-card--copy-${richPreview.copyProfile} rich-preview-card--motion-${richPreview.motionProfile} rich-preview-card--font-${richPreview.fontProfile} rich-preview-card--title-treatment-${richPreview.titleTreatment}${showImageCutout ? ' rich-preview-card--with-cutout' : ''}`}>
        {profile.showBodyEyebrow ? <div className="eyebrow">{richPreviewLabel}</div> : null}
        <div className="rich-preview-card__header-row">
          <div className="rich-preview-card__source-stack">
            {richPreview.sourceName ? <span className="rich-preview-card__source-name">{richPreview.sourceName}</span> : null}
            {richPreview.sourceMeta ? <span className="rich-preview-card__meta-line">{richPreview.sourceMeta}</span> : null}
          </div>
          {profile.showBodyPlatformPill ? <span className="source-window__platform-pill">{richPreview.platformPillLabel}</span> : null}
        </div>
        {showImageCutout ? (
          <figure className={`rich-preview-card__image-cutout rich-preview-card__image-cutout--${richPreview.imageTreatment}`}>
            <img alt={binding.source_image_alt ?? richPreview.richPreviewTitle} src={usableSourceImageUrl ?? ''} />
          </figure>
        ) : null}
        <strong className="rich-preview-card__title">{richPreview.richPreviewTitle}</strong>
        <div className="rich-preview-card__footer-row">
          <span className="source-pill">{sourceDomainLabel}</span>
        </div>
        <p className="rich-preview-card__excerpt">{richPreview.bodyCopy}</p>
      </div>
      {descriptor.sourceUrl ? <a className="source-window__web-cta" href={descriptor.sourceUrl} rel="noreferrer" target="_blank">{richPreview.actionLabel} ↗</a> : <span className="fallback">No live source URL bound yet</span>}
    </div>
  )
}

export default App
