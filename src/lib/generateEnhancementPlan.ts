import type {
  EnhancementTechnique,
  InterpretationRecord,
} from '../types/interpretation'
import type {
  ArtifactMapRecord,
  BriefRecord,
  EnhancementInteractionWorldRecord,
  EnhancementPlanRecord,
  EnhancementRejectedRecord,
  EnhancementTargetRecord,
  SourceBindingSetRecord,
} from '../types/runtime'

interface GenerateEnhancementPlanInput {
  editionId: string
  interpretation: InterpretationRecord
  brief: BriefRecord
  artifactMap: ArtifactMapRecord
  sourceBindings: SourceBindingSetRecord
  analysisId?: string
}

const RUNTIME_SAFE_TECHNIQUES = new Set<EnhancementTechnique>([
  'screen-rendered-html',
  'warped-paper-fragment',
  'mechanical-reveal-system',
  'light-path-reveal',
  'threshold-scan-reveal',
  'restoration-scan',
])

const DISABLED_TECHNIQUES = new Set<EnhancementTechnique>([
  'hidden-self-aware-note',
])

function unique<T>(values: T[]): T[] {
  return [...new Set(values)]
}

function activeTechniques(techniques: readonly EnhancementTechnique[]): EnhancementTechnique[] {
  return techniques.filter((technique) => !DISABLED_TECHNIQUES.has(technique))
}

function flattenBundleTechniques(interpretation: InterpretationRecord): EnhancementTechnique[] {
  return unique(activeTechniques([
    ...interpretation.enhancement_bundle.primary,
    ...interpretation.enhancement_bundle.secondary,
    ...interpretation.enhancement_bundle.wildcard,
    ...interpretation.artifact_candidates.flatMap((candidate) => candidate.supports),
    ...interpretation.field_candidates.flatMap((candidate) => candidate.supports),
    ...interpretation.html_surfaces.flatMap((surface) => surface.supported_treatments),
    ...interpretation.per_region_assignments.map((assignment) => assignment.enhancement),
  ]))
}

function buildInteractionWorldRecord(
  interpretation: InterpretationRecord,
): EnhancementInteractionWorldRecord {
  const activePrimaryBundle = activeTechniques(interpretation.enhancement_bundle.primary)
  return {
    class: interpretation.interaction_world.class,
    primary_behavior: activePrimaryBundle[0]
      ?? interpretation.interaction_world.recommended_behaviors[0]
      ?? interpretation.scene_wide_behavior.selected,
    scene_wide_behavior: interpretation.scene_wide_behavior.selected,
    choreography_rule: interpretation.choreography_rule.selected,
  }
}

function buildRejectedEnhancements(
  interpretation: InterpretationRecord,
): EnhancementRejectedRecord[] {
  const rejected = interpretation.interaction_world.rejected_behaviors.map((behavior) => ({
    technique: behavior === 'cabinet-drawer-behavior'
      ? 'mechanical-reveal-system'
      : behavior === 'light-path-reaction'
        ? 'light-path-reveal'
        : behavior,
    reason: `Rejected by interpretation behavior rule: ${behavior}`,
  }))

  if (interpretation.interaction_world.class === 'field-native') {
    rejected.push({
      technique: 'mechanical-reveal-system',
      reason: 'Field-native scenes should not force drawer or cabinet logic.',
    })
  }

  if (interpretation.interaction_world.class === 'material-native') {
    rejected.push({
      technique: 'screen-rendered-html',
      reason: 'Material-native scenes should prefer painterly or restoration treatments over device-screen logic.',
    })
  }

  if (interpretation.interaction_world.class === 'object-native') {
    rejected.push({
      technique: 'light-path-reveal',
      reason: 'Object-native scenes should anchor interaction to discrete artifacts before environmental field effects.',
    })
  }

  return unique(rejected.map((entry) => JSON.stringify(entry))).map((entry) => JSON.parse(entry) as EnhancementRejectedRecord)
}

function buildEnhancementTargets(
  interpretation: InterpretationRecord,
  sourceBindings: SourceBindingSetRecord,
): EnhancementTargetRecord[] {
  const sourceClassesForArtifact = (artifactId: string | undefined): string[] => artifactId
    ? unique<string>(
        sourceBindings.bindings
          .filter((binding) => binding.artifact_id === artifactId)
          .flatMap((binding) => [binding.window_type, binding.source_type]),
      )
    : []

  const explicitTargets: EnhancementTargetRecord[] = interpretation.per_region_assignments.map((assignment, index) => ({
    target_id: assignment.target_id,
    target_kind: 'surface-region',
    priority: index + 1,
    techniques: activeTechniques([assignment.enhancement]),
    source_classes: assignment.source_classes,
    activation: {
      hover: true,
      click: true,
      drag: false,
      hold: false,
    },
    reason: 'Derived from interpretation per-region assignment.',
  }))

  const artifactTargets: EnhancementTargetRecord[] = interpretation.artifact_candidates.map((candidate, index) => ({
    target_id: candidate.id,
    target_kind: 'artifact',
    artifact_id: candidate.id,
    priority: explicitTargets.length + index + 1,
    techniques: activeTechniques(candidate.supports),
    source_classes: sourceClassesForArtifact(candidate.id),
    activation: {
      hover: true,
      click: true,
      drag: false,
      hold: false,
    },
    reason: `Artifact candidate (${candidate.type}) selected from interpretation.`,
  }))

  const fieldTargets: EnhancementTargetRecord[] = interpretation.field_candidates.map((candidate, index) => ({
    target_id: candidate.id,
    target_kind: 'field-region',
    priority: explicitTargets.length + artifactTargets.length + index + 1,
    techniques: activeTechniques(candidate.supports),
    source_classes: [],
    activation: {
      hover: true,
      click: true,
      drag: true,
      hold: false,
    },
    reason: `Field candidate (${candidate.type}) selected from interpretation.`,
  }))

  const surfaceTargets: EnhancementTargetRecord[] = interpretation.html_surfaces
    .filter((surface) => surface.host === 'surface-region' || surface.host === 'field-region')
    .map((surface, index) => ({
      target_id: surface.id,
      target_kind: surface.host,
      priority: explicitTargets.length + artifactTargets.length + fieldTargets.length + index + 1,
      techniques: activeTechniques(surface.supported_treatments),
      source_classes: [],
      activation: {
        hover: true,
        click: true,
        drag: surface.host === 'field-region',
        hold: false,
      },
      reason: `HTML-capable ${surface.host} surface from interpretation.`,
    }))

  return [...explicitTargets, ...artifactTargets, ...fieldTargets, ...surfaceTargets]
    .filter((target) => target.techniques.length > 0)
}

function deriveRuntimeSafeSubset(techniques: EnhancementTechnique[]): EnhancementTechnique[] {
  return techniques.filter((technique) => RUNTIME_SAFE_TECHNIQUES.has(technique))
}

function deriveFutureOnlySubset(
  techniques: EnhancementTechnique[],
  runtimeSafe: EnhancementTechnique[],
): EnhancementTechnique[] {
  const runtimeSafeSet = new Set(runtimeSafe)
  return techniques.filter((technique) => !runtimeSafeSet.has(technique))
}

export function generateEnhancementPlan(
  input: GenerateEnhancementPlanInput,
): EnhancementPlanRecord {
  const { editionId, interpretation, analysisId } = input
  const allTechniques = flattenBundleTechniques(interpretation)
  const runtimeSafeSubset = deriveRuntimeSafeSubset(allTechniques)
  const futureOnlySubset = deriveFutureOnlySubset(allTechniques, runtimeSafeSubset)
  const targets = buildEnhancementTargets(interpretation, input.sourceBindings)

  return {
    enhancement_plan_id: `enhance-${editionId}`,
    edition_id: editionId,
    derived_from: {
      interpretation_id: interpretation.interpretation_id,
      analysis_id: analysisId,
    },
    interaction_world: buildInteractionWorldRecord(interpretation),
    bundle: {
      primary: activeTechniques(interpretation.enhancement_bundle.primary),
      secondary: activeTechniques(interpretation.enhancement_bundle.secondary),
      wildcard: activeTechniques(interpretation.enhancement_bundle.wildcard),
    },
    runtime_safe_subset: runtimeSafeSubset,
    future_only_subset: futureOnlySubset,
    rejected: buildRejectedEnhancements(interpretation),
    targets,
    global_recommendation: unique([
      ...activeTechniques(interpretation.enhancement_bundle.primary),
      ...activeTechniques(interpretation.enhancement_bundle.secondary),
      ...activeTechniques(interpretation.enhancement_bundle.wildcard),
    ]),
    runtime_note: interpretation.release_notes.join(' '),
  }
}
