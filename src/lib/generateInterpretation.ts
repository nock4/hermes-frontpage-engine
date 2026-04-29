import type { InteractionBehavior, InterpretationRecord, SceneOntologyClass, SurfaceType } from '../types/interpretation'
import type { ArtifactMapRecord, BriefRecord, EditionRecord, SourceBindingSetRecord } from '../types/runtime'

interface AnalysisRoleRecord {
  label: string
  role: string
}

interface AnalysisRecord {
  analysis_id?: string
  edition_id?: string
  scene_summary?: string
  detected_objects?: AnalysisRoleRecord[]
  usable_surfaces?: string[]
}

interface GeometryKitScoreRecord {
  total?: number
  clickability?: number
  overlap?: number
}

interface GeometryKitArtifactRecord {
  artifact_type?: string
  winner?: string
  fallback?: string
  scores?: Record<string, GeometryKitScoreRecord>
  geometry?: {
    safe_hover_origin_px?: [number, number]
    safe_stage_window_origin_px?: [number, number]
    preferred_expansion_label?: 'left' | 'right' | 'up' | 'down'
  }
}

interface CandidatePackArtifactRecord {
  artifact_type?: string
  winner?: string
  fallback?: string
  candidates?: Array<{
    name: string
    score?: GeometryKitScoreRecord
    area_px?: number
    coverage_px?: number
  }>
}

interface GenerateInterpretationInput {
  edition: EditionRecord
  brief: BriefRecord
  artifactMap: ArtifactMapRecord
  sourceBindings: SourceBindingSetRecord
  motifTags?: string[]
  analysis?: AnalysisRecord | null
  geometryKit?: Record<string, GeometryKitArtifactRecord> | null
  candidatePack?: Record<string, CandidatePackArtifactRecord> | null
  plateReadTimestamp?: string
}

const OBJECT_KEYWORDS = ['cabinet', 'desk', 'table', 'box', 'drawer', 'book', 'note', 'placard', 'ledger', 'bar', 'room', 'device', 'lamp', 'altar-object']
const FIELD_KEYWORDS = ['frontage', 'watershed', 'landscape', 'map', 'orbit', 'observatory', 'switchyard', 'patchboard', 'route', 'field', 'stormwater']
const RITUAL_KEYWORDS = ['altar', 'shrine', 'reliquary', 'idol', 'ritual', 'candle', 'seal']
const OPTICAL_KEYWORDS = ['vitrine', 'glass', 'lens', 'mirror', 'reflection']
const MATERIAL_KEYWORDS = ['paint', 'canvas', 'pigment', 'mural', 'varnish', 'crack']
const GESTURAL_MARK_KEYWORDS = [
  'mark',
  'gesture',
  'interruption',
  'stain',
  'aperture',
  'scar',
  'wash',
  'cut',
  'smear',
  'line break',
  'fleck',
  'knot',
  'scratch',
  'pool',
  'void',
  'edge tear',
  'slit',
  'pinhole',
]

function lower(values: string[]) {
  return values.map((value) => value.toLowerCase())
}

function includesAny(values: string[], keywords: string[]) {
  return values.some((value) => keywords.some((keyword) => value.includes(keyword)))
}

function keywordScore(values: string[], keywords: string[]) {
  return values.reduce((total, value) => (
    total + keywords.reduce((score, keyword) => score + (value.includes(keyword) ? 1 : 0), 0)
  ), 0)
}

function inferPrimaryOntology(tokens: string[]): SceneOntologyClass {
  const ritualScore = keywordScore(tokens, RITUAL_KEYWORDS)
  const objectScore = keywordScore(tokens, OBJECT_KEYWORDS)
  const fieldScore = keywordScore(tokens, FIELD_KEYWORDS)
  const materialScore = keywordScore(tokens, MATERIAL_KEYWORDS)
  const gestureScore = keywordScore(tokens, GESTURAL_MARK_KEYWORDS)

  if (ritualScore > 0 && ritualScore >= objectScore && ritualScore >= fieldScore) return 'ritual-native'
  if (gestureScore > 0 && gestureScore >= objectScore && gestureScore >= ritualScore) return fieldScore > 0 ? 'field-native' : 'material-native'
  if (objectScore > 0 && objectScore >= fieldScore && objectScore >= materialScore) return 'object-native'
  if (fieldScore > 0 && fieldScore >= materialScore) return 'field-native'
  if (materialScore > 0) return 'material-native'
  return 'object-native'
}

function inferSecondaryOntologies(tokens: string[], primary: SceneOntologyClass): SceneOntologyClass[] {
  const secondary: SceneOntologyClass[] = []
  if (primary !== 'optical-native' && includesAny(tokens, OPTICAL_KEYWORDS)) secondary.push('optical-native')
  if (primary !== 'material-native' && includesAny(tokens, MATERIAL_KEYWORDS)) secondary.push('material-native')
  return secondary
}

function topologyBonusFromAnalysis(analysis: AnalysisRecord | null | undefined) {
  const roles = lower((analysis?.detected_objects ?? []).map((entry) => `${entry.label} ${entry.role}`))
  return {
    object: keywordScore(roles, ['archive container', 'label surface', 'card surface', 'hero-anchor', 'placard', 'box', 'cabinet']),
    field: keywordScore(roles, ['map', 'route', 'watershed', 'landscape', 'field', 'topography', 'paper surface']),
    ritual: keywordScore(roles, ['idol', 'ritual', 'altar', 'reliquary', 'candle']),
    optical: keywordScore(roles, ['glass', 'reflection', 'lens', 'vitrine', 'device_surface', 'glass_document_surface']),
    material: keywordScore(roles, ['paint', 'pigment', 'mural', 'canvas', 'scan surface', ...GESTURAL_MARK_KEYWORDS]),
  }
}

function refinePrimaryOntology(primary: SceneOntologyClass, analysis: AnalysisRecord | null | undefined): SceneOntologyClass {
  if (!analysis) return primary
  const bonus = topologyBonusFromAnalysis(analysis)
  const ranked = [
    { kind: 'object-native' as const, score: bonus.object },
    { kind: 'field-native' as const, score: bonus.field },
    { kind: 'ritual-native' as const, score: bonus.ritual },
    { kind: 'optical-native' as const, score: bonus.optical },
    { kind: 'material-native' as const, score: bonus.material },
  ].sort((a, b) => b.score - a.score)
  return ranked[0].score > 0 ? ranked[0].kind : primary
}

function inferSurfaceTypes(tokens: string[], analysis?: AnalysisRecord | null): SurfaceType[] {
  const surfaces = new Set<SurfaceType>()
  if (includesAny(tokens, ['paper', 'note', 'book', 'chart', 'map', 'ledger', 'placard'])) surfaces.add('paper')
  if (includesAny(tokens, ['glass', 'vitrine', 'lens'])) surfaces.add('glass')
  if (includesAny(tokens, ['water', 'watershed', 'stormwater'])) surfaces.add('water')
  if (includesAny(tokens, ['fog', 'mist'])) surfaces.add('fog')
  if (includesAny(tokens, ['wood', 'desk', 'cabinet', 'table'])) surfaces.add('wood')
  if (includesAny(tokens, ['paint', 'pigment', 'canvas', 'mural'])) surfaces.add('paint')
  if (includesAny(tokens, GESTURAL_MARK_KEYWORDS)) surfaces.add('paint')
  if (includesAny(tokens, ['screen', 'device', 'monitor', 'console'])) surfaces.add('screen')
  if (includesAny(tokens, ['altar', 'candle', 'light', 'lamp'])) surfaces.add('light-band')

  const analysisSurfaces = lower(analysis?.usable_surfaces ?? [])
  if (includesAny(analysisSurfaces, ['glass', 'vitrine', 'lens', 'monitor'])) surfaces.add('glass')
  if (includesAny(analysisSurfaces, ['map', 'board', 'paper', 'note', 'card', 'book', 'flyer'])) surfaces.add('paper')
  if (includesAny(analysisSurfaces, ['archive', 'box', 'cabinet'])) surfaces.add('wood')
  if (includesAny(analysisSurfaces, GESTURAL_MARK_KEYWORDS)) surfaces.add('paint')

  if (surfaces.size === 0) surfaces.add('unknown')
  return [...surfaces]
}

function normalizeForMatch(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

function tokensForMatch(value: string) {
  return normalizeForMatch(value).split(/\s+/).filter((token) => token.length > 2)
}

function scoreTokenOverlap(left: string[], right: string[]) {
  const rightSet = new Set(right)
  return left.reduce((score, token) => score + (rightSet.has(token) ? 1 : 0), 0)
}

function matchedAnalysisEntries(
  artifact: ArtifactMapRecord['artifacts'][number],
  analysis?: AnalysisRecord | null,
) {
  if (!analysis) return []
  const artifactTokens = tokensForMatch(`${artifact.label} ${artifact.artifact_type}`)
  return (analysis.detected_objects ?? [])
    .map((entry) => ({
      entry,
      score: scoreTokenOverlap(artifactTokens, tokensForMatch(`${entry.label} ${entry.role}`)),
    }))
    .filter((match) => match.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((match) => match.entry)
}

function matchedSurfaceHints(
  artifact: ArtifactMapRecord['artifacts'][number],
  analysis?: AnalysisRecord | null,
) {
  if (!analysis) return []
  const artifactTokens = tokensForMatch(`${artifact.label} ${artifact.artifact_type}`)
  return (analysis.usable_surfaces ?? [])
    .map((surface) => ({
      surface,
      score: scoreTokenOverlap(artifactTokens, tokensForMatch(surface)),
    }))
    .filter((match) => match.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((match) => match.surface.toLowerCase())
}

function bindingsForArtifact(
  artifact: ArtifactMapRecord['artifacts'][number],
  sourceBindings: SourceBindingSetRecord,
) {
  return sourceBindings.bindings.filter((binding) => binding.artifact_id === artifact.id)
}

function inferArtifactSurfaceType(
  artifact: ArtifactMapRecord['artifacts'][number],
  analysisMatches: AnalysisRoleRecord[],
  surfaceHints: string[],
  bindings: SourceBindingSetRecord['bindings'],
): SurfaceType {
  const tokens = lower([
    artifact.label,
    artifact.artifact_type,
    ...analysisMatches.map((entry) => `${entry.label} ${entry.role}`),
    ...surfaceHints,
    ...bindings.map((binding) => `${binding.source_type} ${binding.window_type}`),
  ])

  if (includesAny(tokens, ['screen', 'device', 'monitor', 'console'])) return 'screen'
  if (includesAny(tokens, ['glass', 'vitrine', 'lens', 'reflection'])) return 'glass'
  if (includesAny(tokens, ['paper', 'note', 'book', 'map', 'card', 'placard', 'ledger', 'scan surface', 'label surface'])) return 'paper'
  if (includesAny(tokens, ['water', 'watershed'])) return 'water'
  if (includesAny(tokens, ['fog', 'mist'])) return 'fog'
  if (includesAny(tokens, GESTURAL_MARK_KEYWORDS)) return 'paint'
  if (includesAny(tokens, ['paint', 'pigment', 'canvas', 'mural'])) return 'paint'
  if (includesAny(tokens, ['wood', 'cabinet', 'desk', 'table', 'box', 'archive'])) return 'wood'
  if (includesAny(tokens, ['altar', 'candle', 'lamp', 'light'])) return 'light-band'
  return 'unknown'
}

function supportedTechniquesForArtifact(
  primary: SceneOntologyClass,
  artifact: ArtifactMapRecord['artifacts'][number],
  analysisMatches: AnalysisRoleRecord[],
  surfaceHints: string[],
  bindings: SourceBindingSetRecord['bindings'],
) {
  const tokens = lower([
    artifact.artifact_type,
    artifact.label,
    ...analysisMatches.map((entry) => `${entry.label} ${entry.role}`),
    ...surfaceHints,
  ])
  const hasBoundMedia = bindings.some((binding) => binding.window_type === 'video' || binding.window_type === 'audio' || binding.source_type === 'youtube' || binding.source_type === 'audio' || binding.source_type === 'video' || binding.source_type === 'nts')
  const readsAsScreenLike = includesAny(tokens, ['screen', 'device', 'monitor', 'console', 'device_surface'])
  const readsAsGlassLike = includesAny(tokens, ['glass', 'vitrine', 'lens', 'glass_document_surface'])
  const readsAsPaperLike = includesAny(tokens, ['map', 'route', 'note', 'book', 'paper', 'placard', 'ledger', 'card surface', 'label surface', 'scan surface'])
  const readsAsGesturalMark = includesAny(tokens, GESTURAL_MARK_KEYWORDS)

  if (hasBoundMedia && (readsAsScreenLike || readsAsGlassLike)) {
    return ['screen-rendered-html', 'threshold-scan-reveal'] as const
  }
  if (readsAsGesturalMark) {
    return primary === 'field-native'
      ? (['light-path-reveal', 'threshold-scan-reveal'] as const)
      : (['threshold-scan-reveal', 'restoration-scan'] as const)
  }
  if (artifact.artifact_type.toLowerCase().includes('map') || artifact.artifact_type.toLowerCase().includes('route')) {
    return primary === 'field-native'
      ? (['light-path-reveal', 'route-overlay'] as const)
      : (['warped-paper-fragment', 'threshold-scan-reveal'] as const)
  }
  if (readsAsPaperLike) {
    return primary === 'material-native'
      ? (['paint-bleed-reveal', 'pigment-crack-annotation'] as const)
      : (['warped-paper-fragment', 'threshold-scan-reveal'] as const)
  }
  if (readsAsGlassLike) {
    return ['ghost-reflection-treatment', 'lens-inspection'] as const
  }
  if (primary === 'field-native') return ['light-path-reveal', 'route-overlay'] as const
  if (primary === 'ritual-native') return ['threshold-scan-reveal', 'seal-break-reveal'] as const
  if (primary === 'material-native') return ['paint-bleed-reveal', 'restoration-scan'] as const
  return ['mechanical-reveal-system', 'threshold-scan-reveal'] as const
}

function behaviorsForOntology(primary: SceneOntologyClass): InteractionBehavior[] {
  switch (primary) {
    case 'field-native':
      return ['light-path-reaction', 'lens-inspection', 'constellation-wake']
    case 'ritual-native':
      return ['activation-bloom', 'object-memory', 'projection-reveal']
    case 'material-native':
      return ['paint-bleed-reveal', 'restoration-scan', 'ghost-reflection']
    case 'optical-native':
      return ['lens-inspection', 'projection-reveal', 'ghost-reflection']
    case 'object-native':
    default:
      return ['cabinet-drawer-behavior', 'object-memory', 'threshold-scan']
  }
}

function rejectedBehaviorsForOntology(primary: SceneOntologyClass): InteractionBehavior[] {
  switch (primary) {
    case 'field-native':
      return ['cabinet-drawer-behavior']
    case 'material-native':
      return ['cabinet-drawer-behavior']
    case 'ritual-native':
      return ['drag-to-tune']
    case 'optical-native':
      return ['cabinet-drawer-behavior']
    case 'object-native':
    default:
      return ['light-path-reaction']
  }
}

function enhancementBundleForOntology(primary: SceneOntologyClass) {
  switch (primary) {
    case 'field-native':
      return {
        primary: ['light-path-reveal'] as const,
        secondary: ['route-overlay', 'lens-inspection'] as const,
        wildcard: ['constellation-wake'] as const,
      }
    case 'ritual-native':
      return {
        primary: ['threshold-scan-reveal'] as const,
        secondary: ['seal-break-reveal', 'ghost-reflection-treatment'] as const,
        wildcard: [] as const,
      }
    case 'material-native':
      return {
        primary: ['paint-bleed-reveal'] as const,
        secondary: ['restoration-scan', 'pigment-crack-annotation'] as const,
        wildcard: [] as const,
      }
    case 'optical-native':
      return {
        primary: ['ghost-reflection-treatment'] as const,
        secondary: ['lens-inspection', 'light-path-reveal'] as const,
        wildcard: [] as const,
      }
    case 'object-native':
    default:
      return {
        primary: ['mechanical-reveal-system'] as const,
        secondary: ['warped-paper-fragment', 'threshold-scan-reveal'] as const,
        wildcard: [] as const,
      }
  }
}

function sceneSummary(primary: SceneOntologyClass, sceneFamily: string, surfaces: SurfaceType[], artifactCount: number, analysis?: AnalysisRecord | null) {
  return analysis?.scene_summary
    ?? `${sceneFamily} reads as a ${primary.replace('-native', '')} scene with ${artifactCount} mapped artifacts and dominant ${surfaces.join(', ')} surfaces.`
}

function scoreArtifactCandidate(
  artifact: ArtifactMapRecord['artifacts'][number],
  index: number,
  geometryKit?: Record<string, GeometryKitArtifactRecord> | null,
  candidatePack?: Record<string, CandidatePackArtifactRecord> | null,
) {
  const base = artifact.kind === 'hero' ? Math.max(0.8, 0.95 - index * 0.03) : Math.max(0.58, 0.78 - index * 0.03)
  const geometryEntry = geometryKit?.[artifact.id]
  const candidateEntry = candidatePack?.[artifact.id]
  const winnerScore = geometryEntry?.winner ? geometryEntry.scores?.[geometryEntry.winner]?.total ?? 0 : 0
  const candidateScore = candidateEntry?.candidates?.[0]?.score?.total ?? 0
  return Math.min(0.99, base + winnerScore * 0.18 + candidateScore * 0.12)
}

export function generateInterpretation(input: GenerateInterpretationInput): InterpretationRecord {
  const { edition, brief, artifactMap, sourceBindings, motifTags = [], analysis, geometryKit, candidatePack } = input
  const artifactTokens = artifactMap.artifacts.flatMap((artifact) => [artifact.label, artifact.artifact_type])
  const tokens = lower([
    edition.scene_family,
    edition.title,
    brief.mood,
    ...brief.material_language,
    ...brief.object_inventory,
    ...artifactTokens,
    ...motifTags,
  ])

  const primary = refinePrimaryOntology(inferPrimaryOntology(tokens), analysis)
  const secondary = inferSecondaryOntologies(tokens, primary)
  const surfaces = inferSurfaceTypes(tokens, analysis)
  const recommended = behaviorsForOntology(primary)
  const rejected = rejectedBehaviorsForOntology(primary)
  const bundle = enhancementBundleForOntology(primary)

  const artifactCandidates = artifactMap.artifacts.slice(0, Math.max(artifactMap.artifacts.length, 1)).map((artifact, index) => {
    const analysisMatches = matchedAnalysisEntries(artifact, analysis)
    const surfaceHints = matchedSurfaceHints(artifact, analysis)
    const artifactBindings = bindingsForArtifact(artifact, sourceBindings)
    return {
      id: artifact.id,
      kind: artifact.kind,
      type: artifact.artifact_type,
      strength: scoreArtifactCandidate(artifact, index, geometryKit, candidatePack),
      bounds: artifact.bounds,
      supports: [...supportedTechniquesForArtifact(primary, artifact, analysisMatches, surfaceHints, artifactBindings)],
    }
  })

  const fieldCandidates = primary === 'field-native'
    ? artifactMap.artifacts
        .filter((artifact) => artifact.artifact_type.toLowerCase().includes('map') || artifact.artifact_type.toLowerCase().includes('route') || artifact.bounds.w * artifact.bounds.h > 0.12)
        .map((artifact, index) => ({
          id: `${artifact.id}-field`,
          type: artifact.artifact_type,
          strength: Math.max(0.62, 0.84 - index * 0.04),
          bounds: artifact.bounds,
          supports: ['light-path-reveal', 'route-overlay'] as InterpretationRecord['field_candidates'][number]['supports'],
        }))
    : []

  const htmlSurfaces = artifactMap.artifacts.map((artifact) => {
    const analysisMatches = matchedAnalysisEntries(artifact, analysis)
    const surfaceHints = matchedSurfaceHints(artifact, analysis)
    const artifactBindings = bindingsForArtifact(artifact, sourceBindings)
    return {
      id: `${artifact.id}-surface`,
      surface_type: inferArtifactSurfaceType(artifact, analysisMatches, surfaceHints, artifactBindings),
      host: primary === 'field-native' && (artifact.artifact_type.toLowerCase().includes('map') || artifact.artifact_type.toLowerCase().includes('route'))
        ? 'field-region' as const
        : 'artifact' as const,
      bounds: artifact.bounds,
      suitability: artifact.kind === 'hero' ? 0.9 : 0.76,
      supported_treatments: [...supportedTechniquesForArtifact(primary, artifact, analysisMatches, surfaceHints, artifactBindings)],
    }
  })

  return {
    interpretation_id: `interp-${edition.edition_id}`,
    edition_id: edition.edition_id,
    plate_read_timestamp: input.plateReadTimestamp ?? new Date().toISOString(),
    scene_ontology: {
      primary,
      secondary,
      confidence: analysis?.detected_objects?.length ? 0.9 : 0.84,
    },
    world_read: {
      summary: sceneSummary(primary, edition.scene_family, surfaces, artifactMap.artifacts.length, analysis),
      dominant_spatial_mode: primary === 'field-native' ? 'panoramic' : primary === 'material-native' ? 'flat-field' : 'contained',
      density: artifactMap.artifacts.length >= 8 ? 'dense' : artifactMap.artifacts.length >= 4 ? 'medium' : 'sparse',
      legibility: artifactMap.artifacts.length >= 6 ? 'selective' : 'high',
      mood: uniqueStrings([brief.mood, analysis?.scene_summary ?? '', ...motifTags]).slice(0, 5),
    },
    visual_ecology: {
      dominant_objects: uniqueStrings([
        ...artifactMap.artifacts.map((artifact) => artifact.label),
        ...(analysis?.detected_objects?.map((entry) => entry.label) ?? []),
      ]).slice(0, 8),
      dominant_surfaces: surfaces,
      dominant_structures: uniqueStrings([edition.scene_family, ...brief.object_inventory, ...(analysis?.usable_surfaces ?? [])]).slice(0, 8),
      negative_space_regions: [],
    },
    interaction_world: {
      class: primary,
      recommended_behaviors: recommended,
      rejected_behaviors: rejected,
      reasoning: [
        `Primary ontology inferred from scene family and artifact types: ${edition.scene_family}.`,
        `Artifact vocabulary suggests ${primary} interaction logic.`,
      ],
    },
    artifact_candidates: artifactCandidates,
    field_candidates: fieldCandidates,
    html_surfaces: htmlSurfaces,
    enhancement_bundle: {
      primary: [...bundle.primary],
      secondary: [...bundle.secondary],
      wildcard: [...bundle.wildcard],
    },
    per_region_assignments: [],
    scene_wide_behavior: {
      selected: recommended[0],
    },
    choreography_rule: {
      selected: primary === 'field-native' ? 'distributed-field-reveal' : 'anchor-and-satellites',
    },
    release_notes: [
      `Generated automatically from ${artifactMap.artifacts.length} artifacts and scene family heuristics.`,
    ],
  }
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.filter(Boolean))]
}
