import { getRichPreviewModel } from '../../lib/richPreviewModel'
import { sanitizeSourceImageUrl } from '../../lib/sourceUrl'
import { getYouTubeThumbnailUrl } from '../../lib/sourceWindowContent'
import { getTweetEmbedSrcDoc, TWEET_EMBED_SANDBOX } from '../../lib/tweetEmbed'
import type { ArtifactRecord, SourceBindingRecord } from '../../types/runtime'
import type { SourceWindowDescriptor } from '../../types/sourceWindows'
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
  onPreviewAction?: () => void
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
              <img alt={binding.source_image_alt ?? binding.title} src={sourceImage} />
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
