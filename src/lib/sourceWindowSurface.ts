import type { SourceWindowDescriptor } from '../types/sourceWindows'

interface SourceWindowSurfaceProfile {
  showHeader: boolean
  showExcerpt: boolean
  showMeta: boolean
  showBodyEyebrow: boolean
  showBodyPlatformPill: boolean
  frameStyle: 'panel' | 'artifact-card' | 'embedded-media' | 'none'
  bodyStyle: 'standard' | 'compact' | 'immersive' | 'signal-tuning'
  closeStyle: 'inline' | 'floating' | 'none'
}

const panelSurfaceProfile: SourceWindowSurfaceProfile = {
  showHeader: true,
  showExcerpt: true,
  showMeta: true,
  showBodyEyebrow: true,
  showBodyPlatformPill: true,
  frameStyle: 'panel',
  bodyStyle: 'standard',
  closeStyle: 'inline',
}

const stageBaseProfile = {
  showHeader: false,
  showExcerpt: false,
  showMeta: false,
  showBodyEyebrow: false,
  showBodyPlatformPill: true,
  frameStyle: 'artifact-card',
  closeStyle: 'floating',
} as const

const stagePreviewProfile: SourceWindowSurfaceProfile = {
  ...stageBaseProfile,
  bodyStyle: 'compact',
}

const stagePreviewVideoProfile: SourceWindowSurfaceProfile = {
  ...stageBaseProfile,
  showBodyPlatformPill: false,
  frameStyle: 'embedded-media',
  bodyStyle: 'immersive',
  closeStyle: 'none',
}

const immersiveMediaProfile: SourceWindowSurfaceProfile = {
  ...stageBaseProfile,
  showBodyPlatformPill: false,
  frameStyle: 'embedded-media',
  bodyStyle: 'immersive',
}

const stageRichPreviewProfile: SourceWindowSurfaceProfile = {
  ...stageBaseProfile,
  showBodyPlatformPill: false,
  frameStyle: 'none',
  bodyStyle: 'standard',
}

const defaultStageProfile: SourceWindowSurfaceProfile = {
  ...stageBaseProfile,
  bodyStyle: 'standard',
}

export const getSourceWindowSurfaceProfile = (
  descriptor: SourceWindowDescriptor,
  surface: 'panel' | 'stage',
  mode: 'preview' | 'primary' | 'secondary',
) => {
  if (surface === 'panel') return panelSurfaceProfile
  if (mode === 'preview' && descriptor.kind === 'youtube-embed') return stagePreviewVideoProfile
  if (descriptor.kind === 'youtube-linkout') return stageRichPreviewProfile
  if (mode === 'preview') return stagePreviewProfile
  if (descriptor.kind === 'youtube-embed' || descriptor.kind === 'soundcloud-embed' || descriptor.kind === 'bandcamp-embed') return immersiveMediaProfile
  if (descriptor.kind === 'rich-preview') return stageRichPreviewProfile
  return defaultStageProfile
}
