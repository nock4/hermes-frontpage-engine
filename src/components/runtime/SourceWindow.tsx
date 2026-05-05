import { getArtifactInheritanceProfile } from '../../lib/artifactScene'
import { getRichPreviewModel } from '../../lib/richPreviewModel'
import { getSourceWindowPlacementStyle } from '../../lib/runtimeStyles'
import { getSourceWindowDescriptor } from '../../lib/sourceWindowContent'
import { getSourceWindowSurfaceProfile } from '../../lib/sourceWindowSurface'
import { getStageWindowPlacement } from '../../lib/stageWindowPlacement'
import type { ArtifactRecord, SourceBindingRecord } from '../../types/runtime'
import { SourceWindowBody } from './SourceWindowBody'
import {
  shouldUseLightTableEnhancement,
  shouldUseMechanicalRevealEnhancement,
  shouldUseScannerDecodeEnhancement,
  shouldUseScreenRenderedEnhancement,
  shouldUseWarpedPaperEnhancement,
} from './sourceWindowShared'
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
  const usesMechanicalRevealEnhancement = shouldUseMechanicalRevealEnhancement(surface, mode, descriptor, enhancementTechniques)
  const usesLightTableEnhancement = !usesMechanicalRevealEnhancement && shouldUseLightTableEnhancement(surface, mode, descriptor, binding, artifact, enhancementTechniques)
  const usesScannerDecodeEnhancement = !usesMechanicalRevealEnhancement && !usesLightTableEnhancement && shouldUseScannerDecodeEnhancement(surface, mode, descriptor, enhancementTechniques)
  const isStageTextBloom = surface === 'stage'
    && descriptor.kind === 'rich-preview'
    && mode === 'preview'
    && !usesMechanicalRevealEnhancement
    && !usesLightTableEnhancement
    && !usesScannerDecodeEnhancement
  const isStageTweetEmbed = surface === 'stage' && descriptor.kind === 'tweet-embed'
  const isStageSignalTuning = !usesScreenRenderedEnhancement && surface === 'stage' && descriptor.kind === 'youtube-embed' && mode === 'preview'
  const isStageCabinetPlayer = surface === 'stage' && descriptor.kind === 'youtube-embed' && mode === 'primary' && usesCabinetPlayerShell(artifact)
  const isStageEmbeddedMediaBare = surface === 'stage' && descriptor.kind === 'youtube-embed' && mode === 'primary' && !usesCabinetPlayerShell(artifact)
  const isStageYouTubeLinkout = surface === 'stage' && descriptor.kind === 'youtube-linkout'
  const isStageClickOut = surface === 'stage' && descriptor.kind === 'rich-preview' && mode === 'preview'
  const isStageRichPreviewCard = surface === 'stage' && descriptor.kind === 'rich-preview' && mode !== 'preview' && !usesScreenRenderedEnhancement && !usesWarpedPaperEnhancement && !usesLightTableEnhancement && !usesScannerDecodeEnhancement

  return (
    <div
      className={`source-window source-window--${mode} source-window--frame-${profile.frameStyle} source-window--body-${profile.bodyStyle}${usesScreenRenderedEnhancement ? ' source-window--enhancement-screen-rendered' : ''}${usesWarpedPaperEnhancement ? ' source-window--enhancement-warped-paper' : ''}${usesMechanicalRevealEnhancement ? ' source-window--enhancement-mechanical-reveal' : ''}${usesLightTableEnhancement ? ' source-window--enhancement-light-table' : ''}${usesScannerDecodeEnhancement ? ' source-window--enhancement-scanner-decode' : ''}${isStageTextBloom ? ' source-window--text-bloom' : ''}${isStageTweetEmbed ? ' source-window--tweet-embed-native' : ''}${isStageSignalTuning ? ' source-window--signal-tuning-video' : ''}${isStageCabinetPlayer ? ' source-window--cabinet-player' : ''}${isStageEmbeddedMediaBare ? ' source-window--embedded-media-bare' : ''}${isStageYouTubeLinkout ? ' source-window--youtube-linkout' : ''}${isStageClickOut ? ' source-window--click-out' : ''}${isStageRichPreviewCard ? ' source-window--rich-preview-stage' : ''}${artifact ? ` source-window--artifact-${artifactInheritanceProfile}` : ''}${richPreviewModel ? ` source-window--motion-${richPreviewModel.motionProfile} source-window--spatial-${richPreviewModel.spatialProfile} source-window--projection-${richPreviewModel.projectionProfile}` : ''}${placement ? ` source-window--stage source-window--tone-${placement.tone} source-window--anchor-${placement.anchorSide} source-window--direction-${placement.expansionLabel} source-window--route-${placement.routeProfile} source-window--contact-${placement.contactProfile} source-window--seam-${placement.seamProfile}` : ''}`}
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
      <SourceWindowBody binding={binding} descriptor={descriptor} profile={profile} richPreviewModel={richPreviewModel} mode={mode} surface={surface} artifact={artifact} enhancementTechniques={enhancementTechniques} />
    </div>
  )
}

