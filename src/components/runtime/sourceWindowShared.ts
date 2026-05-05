import { getRichPreviewModel } from '../../lib/richPreviewModel'
import { sanitizeSourceImageUrl } from '../../lib/sourceUrl'
import { getSourceWindowSurfaceProfile } from '../../lib/sourceWindowSurface'
import type { ArtifactRecord, SourceBindingRecord } from '../../types/runtime'
import type { SourceWindowDescriptor } from '../../types/sourceWindows'

export type SourceWindowMode = 'preview' | 'primary' | 'secondary'
export type SourceWindowSurface = 'panel' | 'stage'
export type SourceWindowSurfaceProfile = ReturnType<typeof getSourceWindowSurfaceProfile>
export type RichPreviewModel = ReturnType<typeof getRichPreviewModel>

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

export function getUsableSourceImageUrl(binding: SourceBindingRecord) {
  const imageUrl = sanitizeSourceImageUrl(binding.source_image_url)
  if (!imageUrl || isLowValueSourceImage(imageUrl)) return null
  return imageUrl
}

export function usesGhostReflectionTreatment(enhancementTechniques: string[]) {
  return enhancementTechniques.includes('ghost-reflection-treatment')
}

export function usesArchiveImagePreview(artifact: ArtifactRecord | null | undefined, enhancementTechniques: string[]) {
  return artifact?.id === 'module-archive-cabinet' && usesGhostReflectionTreatment(enhancementTechniques)
}

function artifactText(artifact: ArtifactRecord | null | undefined) {
  if (!artifact) return ''
  return `${artifact.id} ${artifact.label} ${artifact.artifact_type}`.toLowerCase()
}

export function shouldUseScreenRenderedEnhancement(
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

export function shouldUseWarpedPaperEnhancement(
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

export function shouldUseMechanicalRevealEnhancement(
  surface: SourceWindowSurface,
  mode: SourceWindowMode,
  descriptor: SourceWindowDescriptor,
  enhancementTechniques: string[],
) {
  if (surface !== 'stage' || mode !== 'preview' || descriptor.kind !== 'rich-preview') return false
  return enhancementTechniques.includes('mechanical-reveal-system')
}

export function shouldUseLightTableEnhancement(
  surface: SourceWindowSurface,
  mode: SourceWindowMode,
  descriptor: SourceWindowDescriptor,
  binding: SourceBindingRecord,
  artifact: ArtifactRecord | null | undefined,
  enhancementTechniques: string[],
) {
  if (surface !== 'stage' || mode !== 'preview' || descriptor.kind !== 'rich-preview') return false
  if (enhancementTechniques.includes('light-path-reveal')) return true
  if (!enhancementTechniques.includes('warped-paper-fragment')) return false

  const richPreview = getRichPreviewModel(binding, descriptor)
  return /(glass|lens|window|light|signal|observatory|slide|plate|enamel|frame)/.test(artifactText(artifact))
    || richPreview.imageTreatment === 'document-fragment'
    || richPreview.spatialProfile === 'airy'
}

export function shouldUseScannerDecodeEnhancement(
  surface: SourceWindowSurface,
  mode: SourceWindowMode,
  descriptor: SourceWindowDescriptor,
  enhancementTechniques: string[],
) {
  if (surface !== 'stage' || mode !== 'preview' || descriptor.kind !== 'rich-preview') return false
  return enhancementTechniques.includes('threshold-scan-reveal') || enhancementTechniques.includes('restoration-scan')
}
