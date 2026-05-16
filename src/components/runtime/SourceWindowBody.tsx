import type { SyntheticEvent } from 'react'

import { getRichPreviewModel } from '../../lib/richPreviewModel'
import { getYouTubeThumbnailUrl } from '../../lib/sourceWindowContent'
import { getTweetEmbedSrcDoc, TWEET_EMBED_SANDBOX } from '../../lib/tweetEmbed'
import type { ArtifactRecord, SourceBindingRecord } from '../../types/runtime'
import type { SourceWindowDescriptor } from '../../types/sourceWindows'
import {
  getUsableSourceImageUrl,
  shouldUseLightTableEnhancement,
  shouldUseMechanicalRevealEnhancement,
  shouldUseScannerDecodeEnhancement,
  shouldUseScreenRenderedEnhancement,
  shouldUseWarpedPaperEnhancement,
  usesArchiveImagePreview,
  usesGhostReflectionTreatment,
} from './sourceWindowShared'
import type { RichPreviewModel, SourceWindowMode, SourceWindowSurface, SourceWindowSurfaceProfile } from './sourceWindowShared'

interface SourceWindowBodyProps {
  binding: SourceBindingRecord
  descriptor: SourceWindowDescriptor
  profile: SourceWindowSurfaceProfile
  richPreviewModel: RichPreviewModel | null
  mode: SourceWindowMode
  surface: SourceWindowSurface
  artifact?: ArtifactRecord | null
  enhancementTechniques?: string[]
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

function getSourceHostLabel(sourceUrl: string | null | undefined) {
  if (!sourceUrl) return null

  try {
    return new URL(sourceUrl).hostname.replace(/^www\./, '')
  } catch {
    return null
  }
}

function getScannerDecodeModeLabel(descriptor: SourceWindowDescriptor) {
  if (descriptor.platformLabel.toLowerCase().includes('article')) return 'source trace'
  if (descriptor.platformLabel.toLowerCase().includes('site')) return 'signal extraction'
  if (descriptor.platformLabel.toLowerCase().includes('repo')) return 'structure readout'
  return 'decode threshold'
}

function collapseWhitespace(value: string | null | undefined) {
  return value?.replace(/\s+/g, ' ').trim() || ''
}

function truncateLabel(value: string | null | undefined, limit: number) {
  const normalized = collapseWhitespace(value)
  if (!normalized) return null
  if (normalized.length <= limit) return normalized
  return `${normalized.slice(0, Math.max(0, limit - 1)).trimEnd()}…`
}

function getScannerHandle(binding: SourceBindingRecord, descriptor: SourceWindowDescriptor, sourceHost: string | null) {
  const raw = collapseWhitespace(
    binding.kicker
    || ('sourceLabel' in descriptor ? descriptor.sourceLabel : '')
    || sourceHost
    || descriptor.platformLabel,
  )
  if (!raw) return descriptor.platformLabel.toUpperCase()
  return raw.startsWith('@') ? raw : raw.toUpperCase()
}

function getScannerTitle(binding: SourceBindingRecord, richPreview: RichPreviewModel, descriptor: SourceWindowDescriptor) {
  const rawTitle = collapseWhitespace(binding.source_title || richPreview.richPreviewTitle || binding.title || descriptor.domainLabel)
  if (!rawTitle) return descriptor.platformLabel
  const parts = rawTitle.split(/\s[|—–-]\s/).map((part) => part.trim()).filter(Boolean)
  const candidate = parts[parts.length - 1] || rawTitle
  return truncateLabel(candidate, 46) || descriptor.platformLabel
}

function getScannerExcerpt(copy: string | null | undefined) {
  const normalized = collapseWhitespace(copy)
  if (!normalized) return null
  const sentence = normalized.split(/(?<=[.!?])\s+/)[0] || normalized
  return truncateLabel(sentence, 86)
}

function getScannerClassLabel(panelLabel: string | null | undefined, descriptor: SourceWindowDescriptor) {
  const normalized = collapseWhitespace(panelLabel || descriptor.platformLabel)
  if (!normalized) return 'web source'
  return normalized.toLowerCase()
}

function getScannerTraceCode(sourceHost: string | null, descriptor: SourceWindowDescriptor) {
  const base = (sourceHost || descriptor.domainLabel || descriptor.platformLabel || 'signal').replace(/[^a-z0-9]/gi, '').toUpperCase()
  return base.slice(0, 6) || 'SIGNAL'
}

const SOURCE_IMAGE_FALLBACK_DATA_URL = 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22320%22 height=%22180%22 viewBox=%220 0 320 180%22%3E%3Crect width=%22320%22 height=%22180%22 fill=%22%2313171f%22/%3E%3Cpath d=%22M24 124c36-40 62-48 92-26 24 18 47 15 76-12 30-28 61-30 104-5v75H24z%22 fill=%22%235f7c67%22 opacity=%22.72%22/%3E%3Ccircle cx=%22252%22 cy=%2246%22 r=%2220%22 fill=%22%23d7bd78%22 opacity=%22.88%22/%3E%3Ctext x=%2224%22 y=%2236%22 font-family=%22system-ui,sans-serif%22 font-size=%2214%22 fill=%22%23f2ead6%22%3Esource image unavailable%3C/text%3E%3C/svg%3E'

function applySourceImageFallback(image: HTMLImageElement) {
  if (image.dataset.sourceFallbackApplied === 'true') return
  image.dataset.sourceFallbackApplied = 'true'
  image.src = SOURCE_IMAGE_FALLBACK_DATA_URL
}

function handleSourceImageError(event: SyntheticEvent<HTMLImageElement>) {
  applySourceImageFallback(event.currentTarget)
}

function handleSourceImageLoad(event: SyntheticEvent<HTMLImageElement>) {
  const image = event.currentTarget
  if (image.naturalWidth > 0 && image.naturalHeight > 0 && (image.naturalWidth < 24 || image.naturalHeight < 24)) {
    applySourceImageFallback(image)
  }
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
          <img alt={binding.source_image_alt ?? title} className="visual-source-card__image" onError={handleSourceImageError} onLoad={handleSourceImageLoad} src={imageUrl} />
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

export function SourceWindowBody({
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
  const usesMechanicalRevealEnhancement = shouldUseMechanicalRevealEnhancement(surface, mode, descriptor, enhancementTechniques)
  const usesLightTableEnhancement = !usesMechanicalRevealEnhancement && shouldUseLightTableEnhancement(surface, mode, descriptor, binding, artifact, enhancementTechniques)
  const usesScannerDecodeEnhancement = !usesMechanicalRevealEnhancement && !usesLightTableEnhancement && shouldUseScannerDecodeEnhancement(surface, mode, descriptor, enhancementTechniques)
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
    const statusLabel = binding.embed_status === 'processing'
      ? 'Video still processing'
      : binding.embed_status === 'unavailable'
        ? 'Open on YouTube'
        : null

    return (
      <div className="source-window__body source-window__body--youtube-linkout">
        <a className="youtube-linkout" href={descriptor.sourceUrl} rel="noreferrer" target="_blank">
          {sourceImage ? (
            <figure className="youtube-linkout__poster">
              <img alt={binding.source_image_alt ?? binding.title} onError={handleSourceImageError} onLoad={handleSourceImageLoad} src={sourceImage} />
              <span aria-hidden="true" className="youtube-linkout__play">▶</span>
            </figure>
          ) : null}
          <div className="youtube-linkout__copy">
            {statusLabel ? <span className="youtube-linkout__status">{statusLabel}</span> : null}
            <strong className="youtube-linkout__title">{binding.source_title ?? binding.title}</strong>
            <span className="youtube-linkout__cta">{descriptor.ctaLabel} ↗</span>
          </div>
        </a>
      </div>
    )
  }

  const visualCardImage = getUsableSourceImageUrl(binding)
  const visualCardTitle = binding.source_title || binding.title
  const visualCardHref = 'sourceUrl' in descriptor ? descriptor.sourceUrl : binding.source_url
  const shouldUseVisualCard = Boolean(visualCardImage) || surface === 'stage'

  if (descriptor.kind === 'rich-preview' && usesMechanicalRevealEnhancement) {
    const richPreview = richPreviewModel ?? getRichPreviewModel(binding, descriptor)
    const panelTitle = binding.source_title || richPreview.richPreviewTitle
    const panelImage = getUsableSourceImageUrl(binding)
    const panelMeta = richPreview.sourceMeta || binding.source_meta || descriptor.platformLabel
    const panelLabel = richPreview.platformPillLabel || descriptor.platformLabel

    return (
      <div className="source-window__body source-window__body--mechanical-reveal-preview">
        <article className={`mechanical-reveal-preview mechanical-reveal-preview--font-${richPreview.fontProfile} mechanical-reveal-preview--title-treatment-${richPreview.titleTreatment} mechanical-reveal-preview--copy-${richPreview.copyProfile}${panelImage ? ' mechanical-reveal-preview--with-image' : ''}`}>
          <div aria-hidden="true" className="mechanical-reveal-preview__mount" />
          <div aria-hidden="true" className="mechanical-reveal-preview__guide-slot mechanical-reveal-preview__guide-slot--top" />
          <div aria-hidden="true" className="mechanical-reveal-preview__guide-slot mechanical-reveal-preview__guide-slot--bottom" />
          <div aria-hidden="true" className="mechanical-reveal-preview__rail mechanical-reveal-preview__rail--top" />
          <div aria-hidden="true" className="mechanical-reveal-preview__rail mechanical-reveal-preview__rail--bottom" />
          <div aria-hidden="true" className="mechanical-reveal-preview__hinge" />
          <div aria-hidden="true" className="mechanical-reveal-preview__carriage-shadow" />
          <div className="mechanical-reveal-preview__drawer-shell">
            <div className="mechanical-reveal-preview__drawer-face">
              <span className="mechanical-reveal-preview__handle" />
              <span className="mechanical-reveal-preview__label">source pocket</span>
              <span className="mechanical-reveal-preview__meta-tab">{panelLabel}</span>
            </div>
            <div className="mechanical-reveal-preview__drawer-interior">
              <div className="mechanical-reveal-preview__copy">
                <span className="mechanical-reveal-preview__eyebrow">{panelMeta}</span>
                <strong className="mechanical-reveal-preview__title">{panelTitle}</strong>
                <p className="mechanical-reveal-preview__excerpt">{richPreview.previewCopy}</p>
                <span className="mechanical-reveal-preview__cue">pull open ↗</span>
              </div>
              {panelImage ? (
                <figure className={`mechanical-reveal-preview__image-cutout mechanical-reveal-preview__image-cutout--${richPreview.imageTreatment}`}>
                  <img alt={binding.source_image_alt ?? panelTitle} className="mechanical-reveal-preview__image" onError={handleSourceImageError} onLoad={handleSourceImageLoad} src={panelImage} />
                </figure>
              ) : null}
            </div>
          </div>
        </article>
      </div>
    )
  }

  if (descriptor.kind === 'rich-preview' && usesLightTableEnhancement) {
    const richPreview = richPreviewModel ?? getRichPreviewModel(binding, descriptor)
    const panelTitle = binding.source_title || richPreview.richPreviewTitle
    const panelImage = getUsableSourceImageUrl(binding)
    const panelMeta = richPreview.sourceMeta || binding.source_meta || descriptor.platformLabel
    const panelLabel = richPreview.platformPillLabel || descriptor.platformLabel

    return (
      <div className="source-window__body source-window__body--light-table-preview">
        <article className={`light-table-preview light-table-preview--font-${richPreview.fontProfile} light-table-preview--title-treatment-${richPreview.titleTreatment}${panelImage ? ' light-table-preview--with-image' : ''}`}>
          <div aria-hidden="true" className="light-table-preview__glow" />
          <div aria-hidden="true" className="light-table-preview__grid" />
          <div className="light-table-preview__stack">
            <section className="light-table-preview__sheet light-table-preview__sheet--back">
              <span className="light-table-preview__sheet-label">plate</span>
              <span className="light-table-preview__sheet-meta">{panelLabel}</span>
            </section>
            <section className="light-table-preview__sheet light-table-preview__sheet--middle">
              <span className="light-table-preview__eyebrow">{panelMeta}</span>
              <strong className="light-table-preview__title">{panelTitle}</strong>
              <p className="light-table-preview__excerpt">{richPreview.previewCopy}</p>
            </section>
            <section className="light-table-preview__sheet light-table-preview__sheet--front">
              {panelImage ? (
                <figure className={`light-table-preview__image-frame light-table-preview__image-frame--${richPreview.imageTreatment}`}>
                  <img alt={binding.source_image_alt ?? panelTitle} className="light-table-preview__image" onError={handleSourceImageError} onLoad={handleSourceImageLoad} src={panelImage} />
                </figure>
              ) : (
                <div className="light-table-preview__image-placeholder">signal transfer</div>
              )}
              <span className="light-table-preview__cue">lift layers ↗</span>
            </section>
          </div>
        </article>
      </div>
    )
  }

  if (descriptor.kind === 'rich-preview' && usesScannerDecodeEnhancement) {
    const richPreview = richPreviewModel ?? getRichPreviewModel(binding, descriptor)
    const panelTitle = getScannerTitle(binding, richPreview, descriptor)
    const panelImage = getUsableSourceImageUrl(binding)
    const panelLabel = richPreview.platformPillLabel || descriptor.platformLabel
    const sourceHost = getSourceHostLabel(binding.source_url) || descriptor.domainLabel
    const sourceHandle = getScannerHandle(binding, descriptor, sourceHost)
    const decodeMode = getScannerDecodeModeLabel(descriptor)
    const excerpt = getScannerExcerpt(richPreview.previewCopy)
    const sourceClass = getScannerClassLabel(panelLabel, descriptor)
    const traceCode = getScannerTraceCode(sourceHost, descriptor)

    return (
      <div className="source-window__body source-window__body--scanner-decode-preview">
        <article className={`scanner-decode-preview scanner-decode-preview--font-${richPreview.fontProfile} scanner-decode-preview--title-treatment-${richPreview.titleTreatment}${panelImage ? ' scanner-decode-preview--with-image' : ''}`}>
          <div aria-hidden="true" className="scanner-decode-preview__beam" />
          <div aria-hidden="true" className="scanner-decode-preview__beam scanner-decode-preview__beam--secondary" />
          <div aria-hidden="true" className="scanner-decode-preview__reticle" />
          <div aria-hidden="true" className="scanner-decode-preview__noise" />
          <div aria-hidden="true" className="scanner-decode-preview__grid" />
          <div className="scanner-decode-preview__plate">
            <div className="scanner-decode-preview__corner-cut" />
            <header className="scanner-decode-preview__rail">
              <span className="scanner-decode-preview__mode">{decodeMode}</span>
              <span className="scanner-decode-preview__trace-code">{traceCode}</span>
            </header>
            <div className="scanner-decode-preview__body">
              <div className="scanner-decode-preview__signal-block">
                <span className="scanner-decode-preview__handle">{sourceHandle}</span>
                <span className="scanner-decode-preview__class">{sourceClass}</span>
                <div className="scanner-decode-preview__title-stack">
                  <span aria-hidden="true" className="scanner-decode-preview__title-ghost">{panelTitle}</span>
                  <strong className="scanner-decode-preview__title">{panelTitle}</strong>
                </div>
                {excerpt ? <p className="scanner-decode-preview__excerpt">{excerpt}</p> : null}
              </div>
              <aside className="scanner-decode-preview__sample-column">
                {panelImage ? (
                  <figure className={`scanner-decode-preview__image-frame scanner-decode-preview__image-frame--${richPreview.imageTreatment}`}>
                    <span aria-hidden="true" className="scanner-decode-preview__image-corners" />
                    <img alt={binding.source_image_alt ?? panelTitle} className="scanner-decode-preview__image" onError={handleSourceImageError} onLoad={handleSourceImageLoad} src={panelImage} />
                  </figure>
                ) : (
                  <div className="scanner-decode-preview__image-placeholder">signal fragment</div>
                )}
                <span className="scanner-decode-preview__sample-label">captured patch</span>
              </aside>
            </div>
            <dl className="scanner-decode-preview__telemetry">
              <div>
                <dt>threshold</dt>
                <dd>open</dd>
              </div>
              <div>
                <dt>channel</dt>
                <dd>lock</dd>
              </div>
              <div>
                <dt>class</dt>
                <dd>{sourceClass}</dd>
              </div>
            </dl>
          </div>
        </article>
      </div>
    )
  }

  if (descriptor.kind === 'rich-preview' && surface === 'stage' && mode === 'preview') {
    const richPreview = richPreviewModel ?? getRichPreviewModel(binding, descriptor)
    return (
      <SourceImageTitleCard
        binding={binding}
        imageUrl={visualCardImage}
        title={richPreview.richPreviewTitle || visualCardTitle}
      />
    )
  }

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
