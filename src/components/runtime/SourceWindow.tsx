import { getArtifactInheritanceProfile } from '../../lib/artifactScene'
import { getRichPreviewModel } from '../../lib/richPreviewModel'
import { getSourceWindowPlacementStyle } from '../../lib/runtimeStyles'
import { sanitizeSourceImageUrl } from '../../lib/sourceUrl'
import { getSourceWindowDescriptor } from '../../lib/sourceWindowContent'
import { getSourceWindowSurfaceProfile } from '../../lib/sourceWindowSurface'
import { getStageWindowPlacement } from '../../lib/stageWindowPlacement'
import type { ArtifactRecord, SourceBindingRecord } from '../../types/runtime'
import type { SourceWindowDescriptor } from '../../types/sourceWindows'
import { SourceWindowBody } from './SourceWindowBody'
import type { SourceWindowMode, SourceWindowSurface } from './sourceWindowShared'

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

interface SourceWindowDockProps {
  bindings: SourceBindingRecord[]
  onRestore: (bindingId: string) => void
  stage?: boolean
}


export function SourceWindowDock({ bindings, onRestore, stage = false }: SourceWindowDockProps) {
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

export function SourceWindow({
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

