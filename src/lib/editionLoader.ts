import type {
  AmbianceRecord,
  ArtifactGeometryRecord,
  ArtifactMapRecord,
  ArtifactRecord,
  BriefRecord,
  EditionManifest,
  EditionManifestItem,
  EditionRecord,
  GeometryKitArtifactRecord,
  GeometryKitRecord,
  LoadedEdition,
  ReviewRecord,
  EnhancementPlanRecord,
  SourceBindingClickBehavior,
  SourceBindingEmbedStatus,
  SourceBindingFallbackType,
  SourceBindingHoverBehavior,
  SourceBindingRecord,
  SourceBindingSetRecord,
  SourceBindingSourceType,
  SourceBindingWindowType,
} from '../types/runtime'
import type { AboutRecord } from '../types/about'
import type {
  ChoreographyRule,
  EnhancementTechnique,
  InteractionBehavior,
  InterpretationRecord,
  SceneOntologyClass,
  SurfaceType,
} from '../types/interpretation'
import { sanitizeSourceImageUrl, sanitizeSourceUrl } from './sourceUrl'
import { sanitizeSourceText } from './sourceText'

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }
type JsonObject = { [key: string]: JsonValue }

const SOURCE_BINDING_SOURCE_TYPES = ['article', 'audio', 'concept-note', 'github', 'nts', 'social', 'tweet', 'video', 'web', 'youtube'] as const satisfies readonly SourceBindingSourceType[]
const SOURCE_BINDING_WINDOW_TYPES = ['audio', 'social', 'video', 'web'] as const satisfies readonly SourceBindingWindowType[]
const SOURCE_BINDING_HOVER_BEHAVIORS = ['preview'] as const satisfies readonly SourceBindingHoverBehavior[]
const SOURCE_BINDING_CLICK_BEHAVIORS = ['pin-open'] as const satisfies readonly SourceBindingClickBehavior[]
const SOURCE_BINDING_FALLBACK_TYPES = ['rich-preview'] as const satisfies readonly SourceBindingFallbackType[]
const SOURCE_BINDING_EMBED_STATUSES = ['unavailable'] as const satisfies readonly SourceBindingEmbedStatus[]
const EXPANSION_LABELS = ['left', 'right', 'up', 'down'] as const satisfies readonly NonNullable<ArtifactGeometryRecord['preferred_expansion_label']>[]
const SCENE_ONTOLOGY_CLASSES = ['object-native', 'field-native', 'material-native', 'optical-native', 'ritual-native'] as const satisfies readonly SceneOntologyClass[]
const SURFACE_TYPES = ['paper', 'glass', 'water', 'fog', 'rock', 'metal', 'screen', 'paint', 'varnish', 'wood', 'soil', 'light-band', 'reflection', 'sky', 'fabric', 'unknown'] as const satisfies readonly SurfaceType[]
const INTERACTION_BEHAVIORS = ['threshold-scan', 'activation-bloom', 'projection-reveal', 'cabinet-drawer-behavior', 'lens-inspection', 'drag-to-tune', 'light-path-reaction', 'constellation-wake', 'object-memory', 'signal-lock', 'paint-bleed-reveal', 'restoration-scan', 'weather-band-text', 'ghost-reflection'] as const satisfies readonly InteractionBehavior[]
const CHOREOGRAPHY_RULES = ['anchor-and-satellites', 'signal-family-clustering', 'narrative-reveal-order', 'distributed-field-reveal', 'ritual-escalation'] as const satisfies readonly ChoreographyRule[]
const ENHANCEMENT_TECHNIQUES = ['screen-rendered-html', 'warped-paper-fragment', 'threshold-scan-reveal', 'hidden-self-aware-note', 'ghost-reflection-treatment', 'mechanical-reveal-system', 'card-drawer-metadata', 'light-path-reveal', 'route-overlay', 'lens-inspection', 'paint-bleed-reveal', 'restoration-scan', 'pigment-crack-annotation', 'weather-band-text', 'seal-break-reveal', 'constellation-wake'] as const satisfies readonly EnhancementTechnique[]
const ENHANCEMENT_TARGET_KINDS = ['artifact', 'field-region', 'surface-region', 'global-scene'] as const

const isJsonObject = (value: JsonValue): value is JsonObject => typeof value === 'object' && value !== null && !Array.isArray(value)

const parseJsonObject = async (response: Response, path: string): Promise<JsonObject> => {
  const payload: JsonValue = await response.json()
  if (!isJsonObject(payload)) {
    throw new Error(`Expected ${path} to contain a JSON object`)
  }

  return payload
}

const requireString = (value: JsonValue | undefined, path: string) => {
  if (typeof value !== 'string') throw new Error(`Expected ${path} to be a string`)
  return value
}

const requireBoolean = (value: JsonValue | undefined, path: string) => {
  if (typeof value !== 'boolean') throw new Error(`Expected ${path} to be a boolean`)
  return value
}

const requireNumber = (value: JsonValue | undefined, path: string) => {
  if (typeof value !== 'number' || Number.isNaN(value)) throw new Error(`Expected ${path} to be a number`)
  return value
}

const requireObject = (value: JsonValue | undefined, path: string): JsonObject => {
  const objectCandidate = value ?? null
  if (isJsonObject(objectCandidate)) return objectCandidate
  throw new Error(`Expected ${path} to be an object`)
}

const requireArray = (value: JsonValue | undefined, path: string): JsonValue[] => {
  if (!Array.isArray(value)) throw new Error(`Expected ${path} to be an array`)
  return value
}

const requireStringArray = (value: JsonValue | undefined, path: string) => {
  const array = requireArray(value, path)
  return array.map((entry, index) => requireString(entry, `${path}[${index}]`))
}

const requireLiteral = <T extends string>(value: JsonValue | undefined, allowed: readonly T[], path: string): T => {
  if (typeof value !== 'string') {
    throw new Error(`Expected ${path} to be one of: ${allowed.join(', ')}`)
  }

  for (const candidate of allowed) {
    if (candidate === value) return candidate
  }

  throw new Error(`Expected ${path} to be one of: ${allowed.join(', ')}`)
}

const optionalLiteral = <T extends string>(value: JsonValue | undefined, allowed: readonly T[], path: string): T | undefined => {
  if (value === undefined || value === null) return undefined
  return requireLiteral(value, allowed, path)
}

const optionalString = (value: JsonValue | undefined, path: string) => {
  if (value === undefined) return undefined
  if (typeof value !== 'string') throw new Error(`Expected ${path} to be a string when present`)
  return value
}

const optionalNumber = (value: JsonValue | undefined, path: string) => {
  if (value === undefined) return undefined
  return requireNumber(value, path)
}

const optionalStringOrNull = (value: JsonValue | undefined, path: string) => {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') throw new Error(`Expected ${path} to be a string or null`)
  return value
}

const optionalPoint = (value: JsonValue | undefined, path: string): [number, number] | undefined => {
  if (value === undefined) return undefined

  const point = requireArray(value, path)
  if (point.length !== 2) throw new Error(`Expected ${path} to contain exactly two numbers`)

  return [requireNumber(point[0], `${path}[0]`), requireNumber(point[1], `${path}[1]`)]
}

const requirePoint = (value: JsonValue | undefined, path: string): [number, number] => {
  const point = optionalPoint(value, path)
  if (!point) throw new Error(`Expected ${path} to be a point`)
  return point
}

const parseGeometryRecord = (value: JsonValue | undefined, path: string): ArtifactGeometryRecord => {
  const geometry = requireObject(value, path)
  const preferredExpansionDirectionValue = geometry.preferred_expansion_direction

  let preferred_expansion_direction: [number, number] | undefined
  if (preferredExpansionDirectionValue !== undefined) {
    const direction = requireArray(preferredExpansionDirectionValue, `${path}.preferred_expansion_direction`)
    if (direction.length !== 2) {
      throw new Error(`Expected ${path}.preferred_expansion_direction to contain exactly two numbers`)
    }

    preferred_expansion_direction = [
      requireNumber(direction[0], `${path}.preferred_expansion_direction[0]`),
      requireNumber(direction[1], `${path}.preferred_expansion_direction[1]`),
    ]
  }

  return {
    safe_stage_window_origin_px: optionalPoint(geometry.safe_stage_window_origin_px, `${path}.safe_stage_window_origin_px`),
    safe_hover_origin_px: optionalPoint(geometry.safe_hover_origin_px, `${path}.safe_hover_origin_px`),
    preferred_expansion_direction,
    preferred_expansion_label: geometry.preferred_expansion_label === undefined
      ? undefined
      : requireLiteral(geometry.preferred_expansion_label, EXPANSION_LABELS, `${path}.preferred_expansion_label`),
  }
}

const parseEditionManifestItem = (value: JsonValue, path: string): EditionManifestItem => {
  const item = requireObject(value, path)
  return {
    edition_id: requireString(item.edition_id, `${path}.edition_id`),
    date: requireString(item.date, `${path}.date`),
    slug: requireString(item.slug, `${path}.slug`),
    title: requireString(item.title, `${path}.title`),
    path: requireString(item.path, `${path}.path`),
    scene_family: requireString(item.scene_family, `${path}.scene_family`),
    motif_tags: requireStringArray(item.motif_tags, `${path}.motif_tags`),
    preview_asset_path: requireString(item.preview_asset_path, `${path}.preview_asset_path`),
    is_live: requireBoolean(item.is_live, `${path}.is_live`),
  }
}

const parseEditionManifest = (value: JsonObject, path: string): EditionManifest => ({
  current_edition_id: requireString(value.current_edition_id, `${path}.current_edition_id`),
  editions: requireArray(value.editions, `${path}.editions`).map((item, index) => parseEditionManifestItem(item, `${path}.editions[${index}]`)),
})

const parseEditionRecord = (value: JsonObject, path: string): EditionRecord => {
  const publishState = requireObject(value.publish_state, `${path}.publish_state`)

  return {
    edition_id: requireString(value.edition_id, `${path}.edition_id`),
    date: requireString(value.date, `${path}.date`),
    status: requireString(value.status, `${path}.status`),
    slug: requireString(value.slug, `${path}.slug`),
    title: requireString(value.title, `${path}.title`),
    scene_family: requireString(value.scene_family, `${path}.scene_family`),
    brief_id: requireString(value.brief_id, `${path}.brief_id`),
    plate_id: requireString(value.plate_id, `${path}.plate_id`),
    artifact_map_id: requireString(value.artifact_map_id, `${path}.artifact_map_id`),
    source_binding_set_id: requireString(value.source_binding_set_id, `${path}.source_binding_set_id`),
    ambiance_recipe_id: requireString(value.ambiance_recipe_id, `${path}.ambiance_recipe_id`),
    review_state_id: requireString(value.review_state_id, `${path}.review_state_id`),
    publish_state: {
      is_live: requireBoolean(publishState.is_live, `${path}.publish_state.is_live`),
      published_at: optionalStringOrNull(publishState.published_at, `${path}.publish_state.published_at`),
      archive_path: optionalStringOrNull(publishState.archive_path, `${path}.publish_state.archive_path`),
    },
    plate_asset_path: requireString(value.plate_asset_path, `${path}.plate_asset_path`),
  }
}

const parseBriefRecord = (value: JsonObject, path: string): BriefRecord => {
  const interactionGrammar = requireObject(value.interaction_grammar, `${path}.interaction_grammar`)

  return {
    brief_id: requireString(value.brief_id, `${path}.brief_id`),
    date: requireString(value.date, `${path}.date`),
    signal_cluster_ids: requireStringArray(value.signal_cluster_ids, `${path}.signal_cluster_ids`),
    research_node_ids: requireStringArray(value.research_node_ids, `${path}.research_node_ids`),
    mood: requireString(value.mood, `${path}.mood`),
    material_language: requireStringArray(value.material_language, `${path}.material_language`),
    lighting: requireString(value.lighting, `${path}.lighting`),
    object_inventory: requireStringArray(value.object_inventory, `${path}.object_inventory`),
    interaction_grammar: {
      hero_count: requireNumber(interactionGrammar.hero_count, `${path}.interaction_grammar.hero_count`),
      module_count: requireNumber(interactionGrammar.module_count, `${path}.interaction_grammar.module_count`),
      window_strategy: requireString(interactionGrammar.window_strategy, `${path}.interaction_grammar.window_strategy`),
    },
    negative_constraints: requireStringArray(value.negative_constraints, `${path}.negative_constraints`),
  }
}

const parseArtifactRecord = (value: JsonValue, path: string): ArtifactRecord => {
  const artifact = requireObject(value, path)
  const bounds = requireObject(artifact.bounds, `${path}.bounds`)
  const polygon = requireArray(artifact.polygon, `${path}.polygon`)

  return {
    id: requireString(artifact.id, `${path}.id`),
    kind: requireLiteral(artifact.kind, ['hero', 'module'], `${path}.kind`),
    label: requireString(artifact.label, `${path}.label`),
    artifact_type: requireString(artifact.artifact_type, `${path}.artifact_type`),
    cluster_id: requireString(artifact.cluster_id, `${path}.cluster_id`),
    bounds: {
      x: requireNumber(bounds.x, `${path}.bounds.x`),
      y: requireNumber(bounds.y, `${path}.bounds.y`),
      w: requireNumber(bounds.w, `${path}.bounds.w`),
      h: requireNumber(bounds.h, `${path}.bounds.h`),
    },
    polygon: polygon.map((point, index) => requirePoint(point, `${path}.polygon[${index}]`)),
    mask_path: optionalString(artifact.mask_path, `${path}.mask_path`),
    geometry: artifact.geometry === undefined ? undefined : parseGeometryRecord(artifact.geometry, `${path}.geometry`),
    z_index: requireNumber(artifact.z_index, `${path}.z_index`),
    source_binding_ids: requireStringArray(artifact.source_binding_ids, `${path}.source_binding_ids`),
  }
}

const parseArtifactMapRecord = (value: JsonObject, path: string): ArtifactMapRecord => {
  const viewport = requireObject(value.viewport, `${path}.viewport`)

  return {
    artifact_map_id: requireString(value.artifact_map_id, `${path}.artifact_map_id`),
    viewport: {
      base_width: requireNumber(viewport.base_width, `${path}.viewport.base_width`),
      base_height: requireNumber(viewport.base_height, `${path}.viewport.base_height`),
      aspect_ratio: requireString(viewport.aspect_ratio, `${path}.viewport.aspect_ratio`),
    },
    default_cluster_id: requireString(value.default_cluster_id, `${path}.default_cluster_id`),
    default_artifact_id: requireString(value.default_artifact_id, `${path}.default_artifact_id`),
    artifacts: requireArray(value.artifacts, `${path}.artifacts`).map((artifact, index) => parseArtifactRecord(artifact, `${path}.artifacts[${index}]`)),
  }
}

const parseSourceBindingRecord = (value: JsonValue, path: string): SourceBindingRecord => {
  const binding = requireObject(value, path)
  const sourceUrl = optionalStringOrNull(binding.source_url, `${path}.source_url`)
  const sanitizedSourceUrl = sanitizeSourceUrl(sourceUrl)
  const sourceImageUrl = optionalString(binding.source_image_url, `${path}.source_image_url`)
  const sanitizedSourceImageUrl = sanitizeSourceImageUrl(sourceImageUrl)
  const title = requireString(binding.title, `${path}.title`)
  const rawExcerpt = requireString(binding.excerpt, `${path}.excerpt`)
  const rawSourceSummary = optionalString(binding.source_summary, `${path}.source_summary`)

  if (sourceUrl && !sanitizedSourceUrl) {
    throw new Error(`Expected ${path}.source_url to be an http(s) URL`)
  }

  if (sourceImageUrl && !sanitizedSourceImageUrl) {
    throw new Error(`Expected ${path}.source_image_url to be a public http(s) or same-origin URL`)
  }

  return {
    id: requireString(binding.id, `${path}.id`),
    artifact_id: requireString(binding.artifact_id, `${path}.artifact_id`),
    source_type: requireLiteral(binding.source_type, SOURCE_BINDING_SOURCE_TYPES, `${path}.source_type`),
    source_url: sanitizedSourceUrl,
    window_type: requireLiteral(binding.window_type, SOURCE_BINDING_WINDOW_TYPES, `${path}.window_type`),
    hover_behavior: requireLiteral(binding.hover_behavior, SOURCE_BINDING_HOVER_BEHAVIORS, `${path}.hover_behavior`),
    click_behavior: requireLiteral(binding.click_behavior, SOURCE_BINDING_CLICK_BEHAVIORS, `${path}.click_behavior`),
    playback_persistence: requireBoolean(binding.playback_persistence, `${path}.playback_persistence`),
    fallback_type: requireLiteral(binding.fallback_type, SOURCE_BINDING_FALLBACK_TYPES, `${path}.fallback_type`),
    embed_status: optionalLiteral(binding.embed_status, SOURCE_BINDING_EMBED_STATUSES, `${path}.embed_status`),
    title,
    kicker: requireString(binding.kicker, `${path}.kicker`),
    excerpt: sanitizeSourceText(rawExcerpt, title, 360),
    source_title: optionalString(binding.source_title, `${path}.source_title`),
    source_summary: rawSourceSummary ? sanitizeSourceText(rawSourceSummary, '', 520) : undefined,
    source_domain: optionalString(binding.source_domain, `${path}.source_domain`),
    source_meta: optionalString(binding.source_meta, `${path}.source_meta`),
    source_embed_html: undefined,
    source_image_url: sanitizedSourceImageUrl ?? undefined,
    source_image_alt: optionalString(binding.source_image_alt, `${path}.source_image_alt`),
  }
}

const parseSourceBindingSetRecord = (value: JsonObject, path: string): SourceBindingSetRecord => ({
  source_binding_set_id: requireString(value.source_binding_set_id, `${path}.source_binding_set_id`),
  bindings: requireArray(value.bindings, `${path}.bindings`).map((binding, index) => parseSourceBindingRecord(binding, `${path}.bindings[${index}]`)),
})

const parseAmbianceRecord = (value: JsonObject, path: string): AmbianceRecord => ({
  ambiance_recipe_id: requireString(value.ambiance_recipe_id, `${path}.ambiance_recipe_id`),
  motion_system: requireString(value.motion_system, `${path}.motion_system`),
  color_drift: requireString(value.color_drift, `${path}.color_drift`),
  glow_behavior: requireString(value.glow_behavior, `${path}.glow_behavior`),
  audio_posture: requireString(value.audio_posture, `${path}.audio_posture`),
  webgl_mode: requireString(value.webgl_mode, `${path}.webgl_mode`),
  research_inputs: requireStringArray(value.research_inputs, `${path}.research_inputs`),
})

const parseReviewRecord = (value: JsonObject, path: string): ReviewRecord => ({
  review_state_id: requireString(value.review_state_id, `${path}.review_state_id`),
  geometry_status: requireString(value.geometry_status, `${path}.geometry_status`),
  clickability_status: requireString(value.clickability_status, `${path}.clickability_status`),
  behavior_status: requireString(value.behavior_status, `${path}.behavior_status`),
  editorial_status: requireString(value.editorial_status, `${path}.editorial_status`),
  notes: requireStringArray(value.notes, `${path}.notes`),
})

const parseBoundsRecord = (value: JsonValue | undefined, path: string) => {
  const bounds = requireObject(value, path)
  return {
    x: requireNumber(bounds.x, `${path}.x`),
    y: requireNumber(bounds.y, `${path}.y`),
    w: requireNumber(bounds.w, `${path}.w`),
    h: requireNumber(bounds.h, `${path}.h`),
  }
}

const parseInterpretationRecord = (value: JsonObject, path: string): InterpretationRecord => {
  const sceneOntology = requireObject(value.scene_ontology, `${path}.scene_ontology`)
  const worldRead = requireObject(value.world_read, `${path}.world_read`)
  const visualEcology = requireObject(value.visual_ecology, `${path}.visual_ecology`)
  const interactionWorld = requireObject(value.interaction_world, `${path}.interaction_world`)
  const enhancementBundle = requireObject(value.enhancement_bundle, `${path}.enhancement_bundle`)
  const sceneWideBehavior = requireObject(value.scene_wide_behavior, `${path}.scene_wide_behavior`)
  const choreographyRule = requireObject(value.choreography_rule, `${path}.choreography_rule`)

  return {
    interpretation_id: requireString(value.interpretation_id, `${path}.interpretation_id`),
    edition_id: requireString(value.edition_id, `${path}.edition_id`),
    plate_read_timestamp: requireString(value.plate_read_timestamp, `${path}.plate_read_timestamp`),
    scene_ontology: {
      primary: requireLiteral(sceneOntology.primary, SCENE_ONTOLOGY_CLASSES, `${path}.scene_ontology.primary`),
      secondary: requireArray(sceneOntology.secondary, `${path}.scene_ontology.secondary`).map((entry, index) =>
        requireLiteral(entry, SCENE_ONTOLOGY_CLASSES, `${path}.scene_ontology.secondary[${index}]`),
      ),
      confidence: requireNumber(sceneOntology.confidence, `${path}.scene_ontology.confidence`),
    },
    world_read: {
      summary: requireString(worldRead.summary, `${path}.world_read.summary`),
      dominant_spatial_mode: requireLiteral(
        worldRead.dominant_spatial_mode,
        ['contained', 'panoramic', 'stacked', 'distributed', 'flat-field', 'depth-led'],
        `${path}.world_read.dominant_spatial_mode`,
      ),
      density: requireLiteral(worldRead.density, ['sparse', 'medium', 'dense'], `${path}.world_read.density`),
      legibility: requireLiteral(worldRead.legibility, ['low', 'selective', 'high'], `${path}.world_read.legibility`),
      mood: requireStringArray(worldRead.mood, `${path}.world_read.mood`),
    },
    visual_ecology: {
      dominant_objects: requireStringArray(visualEcology.dominant_objects, `${path}.visual_ecology.dominant_objects`),
      dominant_surfaces: requireArray(visualEcology.dominant_surfaces, `${path}.visual_ecology.dominant_surfaces`).map((entry, index) =>
        requireLiteral(entry, SURFACE_TYPES, `${path}.visual_ecology.dominant_surfaces[${index}]`),
      ),
      dominant_structures: requireStringArray(visualEcology.dominant_structures, `${path}.visual_ecology.dominant_structures`),
      negative_space_regions: requireArray(visualEcology.negative_space_regions, `${path}.visual_ecology.negative_space_regions`).map((entry, index) => {
        const region = requireObject(entry, `${path}.visual_ecology.negative_space_regions[${index}]`)
        return {
          id: requireString(region.id, `${path}.visual_ecology.negative_space_regions[${index}].id`),
          kind: requireString(region.kind, `${path}.visual_ecology.negative_space_regions[${index}].kind`),
          bounds: parseBoundsRecord(region.bounds, `${path}.visual_ecology.negative_space_regions[${index}].bounds`),
        }
      }),
    },
    interaction_world: {
      class: requireLiteral(interactionWorld.class, SCENE_ONTOLOGY_CLASSES, `${path}.interaction_world.class`),
      recommended_behaviors: requireArray(interactionWorld.recommended_behaviors, `${path}.interaction_world.recommended_behaviors`).map((entry, index) =>
        requireLiteral(entry, INTERACTION_BEHAVIORS, `${path}.interaction_world.recommended_behaviors[${index}]`),
      ),
      rejected_behaviors: requireArray(interactionWorld.rejected_behaviors, `${path}.interaction_world.rejected_behaviors`).map((entry, index) =>
        requireLiteral(entry, INTERACTION_BEHAVIORS, `${path}.interaction_world.rejected_behaviors[${index}]`),
      ),
      reasoning: requireStringArray(interactionWorld.reasoning, `${path}.interaction_world.reasoning`),
    },
    artifact_candidates: requireArray(value.artifact_candidates, `${path}.artifact_candidates`).map((entry, index) => {
      const candidate = requireObject(entry, `${path}.artifact_candidates[${index}]`)
      return {
        id: requireString(candidate.id, `${path}.artifact_candidates[${index}].id`),
        kind: requireLiteral(candidate.kind, ['hero', 'module'], `${path}.artifact_candidates[${index}].kind`),
        type: requireString(candidate.type, `${path}.artifact_candidates[${index}].type`),
        strength: requireNumber(candidate.strength, `${path}.artifact_candidates[${index}].strength`),
        bounds: parseBoundsRecord(candidate.bounds, `${path}.artifact_candidates[${index}].bounds`),
        supports: requireArray(candidate.supports, `${path}.artifact_candidates[${index}].supports`).map((technique, supportIndex) =>
          requireLiteral(technique, ENHANCEMENT_TECHNIQUES, `${path}.artifact_candidates[${index}].supports[${supportIndex}]`),
        ),
      }
    }),
    field_candidates: requireArray(value.field_candidates, `${path}.field_candidates`).map((entry, index) => {
      const candidate = requireObject(entry, `${path}.field_candidates[${index}]`)
      return {
        id: requireString(candidate.id, `${path}.field_candidates[${index}].id`),
        type: requireString(candidate.type, `${path}.field_candidates[${index}].type`),
        strength: requireNumber(candidate.strength, `${path}.field_candidates[${index}].strength`),
        bounds: parseBoundsRecord(candidate.bounds, `${path}.field_candidates[${index}].bounds`),
        supports: requireArray(candidate.supports, `${path}.field_candidates[${index}].supports`).map((technique, supportIndex) =>
          requireLiteral(technique, ENHANCEMENT_TECHNIQUES, `${path}.field_candidates[${index}].supports[${supportIndex}]`),
        ),
      }
    }),
    html_surfaces: requireArray(value.html_surfaces, `${path}.html_surfaces`).map((entry, index) => {
      const surface = requireObject(entry, `${path}.html_surfaces[${index}]`)
      return {
        id: requireString(surface.id, `${path}.html_surfaces[${index}].id`),
        surface_type: requireLiteral(surface.surface_type, SURFACE_TYPES, `${path}.html_surfaces[${index}].surface_type`),
        host: requireLiteral(surface.host, ['artifact', 'field-region', 'surface-region', 'global-scene'], `${path}.html_surfaces[${index}].host`),
        bounds: parseBoundsRecord(surface.bounds, `${path}.html_surfaces[${index}].bounds`),
        suitability: requireNumber(surface.suitability, `${path}.html_surfaces[${index}].suitability`),
        supported_treatments: requireArray(surface.supported_treatments, `${path}.html_surfaces[${index}].supported_treatments`).map((technique, treatmentIndex) =>
          requireLiteral(technique, ENHANCEMENT_TECHNIQUES, `${path}.html_surfaces[${index}].supported_treatments[${treatmentIndex}]`),
        ),
      }
    }),
    enhancement_bundle: {
      primary: requireArray(enhancementBundle.primary, `${path}.enhancement_bundle.primary`).map((entry, index) =>
        requireLiteral(entry, ENHANCEMENT_TECHNIQUES, `${path}.enhancement_bundle.primary[${index}]`),
      ),
      secondary: requireArray(enhancementBundle.secondary, `${path}.enhancement_bundle.secondary`).map((entry, index) =>
        requireLiteral(entry, ENHANCEMENT_TECHNIQUES, `${path}.enhancement_bundle.secondary[${index}]`),
      ),
      wildcard: requireArray(enhancementBundle.wildcard, `${path}.enhancement_bundle.wildcard`).map((entry, index) =>
        requireLiteral(entry, ENHANCEMENT_TECHNIQUES, `${path}.enhancement_bundle.wildcard[${index}]`),
      ),
    },
    per_region_assignments: requireArray(value.per_region_assignments, `${path}.per_region_assignments`).map((entry, index) => {
      const assignment = requireObject(entry, `${path}.per_region_assignments[${index}]`)
      return {
        target_id: requireString(assignment.target_id, `${path}.per_region_assignments[${index}].target_id`),
        enhancement: requireLiteral(assignment.enhancement, ENHANCEMENT_TECHNIQUES, `${path}.per_region_assignments[${index}].enhancement`),
        source_classes: requireStringArray(assignment.source_classes, `${path}.per_region_assignments[${index}].source_classes`),
      }
    }),
    scene_wide_behavior: {
      selected: requireLiteral(sceneWideBehavior.selected, INTERACTION_BEHAVIORS, `${path}.scene_wide_behavior.selected`),
    },
    choreography_rule: {
      selected: requireLiteral(choreographyRule.selected, CHOREOGRAPHY_RULES, `${path}.choreography_rule.selected`),
    },
    release_notes: requireStringArray(value.release_notes, `${path}.release_notes`),
  }
}

const parseEnhancementPlanRecord = (value: JsonObject, path: string): EnhancementPlanRecord => {
  if (value.bundle === undefined && value.html_in_canvas_candidates !== undefined) {
    return {
      enhancement_plan_id: requireString(value.enhancement_plan_id, `${path}.enhancement_plan_id`),
      edition_id: requireString(value.edition_id, `${path}.edition_id`),
      interaction_world: {
        class: 'object-native',
        primary_behavior: 'threshold-scan-reveal',
        scene_wide_behavior: 'activation-bloom',
        choreography_rule: 'anchor-and-satellites',
      },
      bundle: {
        primary: [],
        secondary: requireStringArray(value.global_recommendation, `${path}.global_recommendation`),
        wildcard: [],
      },
      runtime_safe_subset: [],
      future_only_subset: [],
      rejected: [],
      targets: requireArray(value.html_in_canvas_candidates, `${path}.html_in_canvas_candidates`).map((candidate, index) => {
        const record = requireObject(candidate, `${path}.html_in_canvas_candidates[${index}]`)
        return {
          target_id: requireString(record.artifact_id, `${path}.html_in_canvas_candidates[${index}].artifact_id`),
          target_kind: 'artifact' as const,
          artifact_id: requireString(record.artifact_id, `${path}.html_in_canvas_candidates[${index}].artifact_id`),
          priority: index + 1,
          techniques: requireStringArray(record.techniques, `${path}.html_in_canvas_candidates[${index}].techniques`),
          source_classes: [],
          activation: {
            hover: true,
            click: true,
            drag: false,
            hold: false,
          },
          reason: optionalString(record.reason, `${path}.html_in_canvas_candidates[${index}].reason`) ?? 'Legacy enhancement candidate',
        }
      }),
      global_recommendation: requireStringArray(value.global_recommendation, `${path}.global_recommendation`),
      runtime_note: optionalString(value.runtime_note, `${path}.runtime_note`),
    }
  }

  const interactionWorld = requireObject(value.interaction_world, `${path}.interaction_world`)
  const bundle = requireObject(value.bundle, `${path}.bundle`)
  const derivedFromValue = value.derived_from
  const derived_from = derivedFromValue === undefined
    ? undefined
    : (() => {
        const derived = requireObject(derivedFromValue, `${path}.derived_from`)
        return {
          interpretation_id: requireString(derived.interpretation_id, `${path}.derived_from.interpretation_id`),
          analysis_id: optionalString(derived.analysis_id, `${path}.derived_from.analysis_id`),
        }
      })()

  return {
    enhancement_plan_id: requireString(value.enhancement_plan_id, `${path}.enhancement_plan_id`),
    edition_id: requireString(value.edition_id, `${path}.edition_id`),
    derived_from,
    interaction_world: {
      class: requireString(interactionWorld.class, `${path}.interaction_world.class`),
      primary_behavior: requireString(interactionWorld.primary_behavior, `${path}.interaction_world.primary_behavior`),
      scene_wide_behavior: requireString(interactionWorld.scene_wide_behavior, `${path}.interaction_world.scene_wide_behavior`),
      choreography_rule: requireString(interactionWorld.choreography_rule, `${path}.interaction_world.choreography_rule`),
    },
    bundle: {
      primary: requireStringArray(bundle.primary, `${path}.bundle.primary`),
      secondary: requireStringArray(bundle.secondary, `${path}.bundle.secondary`),
      wildcard: requireStringArray(bundle.wildcard, `${path}.bundle.wildcard`),
    },
    runtime_safe_subset: requireStringArray(value.runtime_safe_subset, `${path}.runtime_safe_subset`),
    future_only_subset: requireStringArray(value.future_only_subset, `${path}.future_only_subset`),
    rejected: requireArray(value.rejected, `${path}.rejected`).map((entry, index) => {
      const rejected = requireObject(entry, `${path}.rejected[${index}]`)
      return {
        technique: requireString(rejected.technique, `${path}.rejected[${index}].technique`),
        reason: requireString(rejected.reason, `${path}.rejected[${index}].reason`),
      }
    }),
    targets: requireArray(value.targets, `${path}.targets`).map((entry, index) => {
      const target = requireObject(entry, `${path}.targets[${index}]`)
      const activation = requireObject(target.activation, `${path}.targets[${index}].activation`)
      return {
        target_id: requireString(target.target_id, `${path}.targets[${index}].target_id`),
        target_kind: requireLiteral(target.target_kind, ENHANCEMENT_TARGET_KINDS, `${path}.targets[${index}].target_kind`),
        artifact_id: optionalString(target.artifact_id, `${path}.targets[${index}].artifact_id`),
        priority: requireNumber(target.priority, `${path}.targets[${index}].priority`),
        techniques: requireStringArray(target.techniques, `${path}.targets[${index}].techniques`),
        source_classes: requireStringArray(target.source_classes, `${path}.targets[${index}].source_classes`),
        activation: {
          hover: requireBoolean(activation.hover, `${path}.targets[${index}].activation.hover`),
          click: requireBoolean(activation.click, `${path}.targets[${index}].activation.click`),
          drag: requireBoolean(activation.drag, `${path}.targets[${index}].activation.drag`),
          hold: requireBoolean(activation.hold, `${path}.targets[${index}].activation.hold`),
        },
        reason: requireString(target.reason, `${path}.targets[${index}].reason`),
      }
    }),
    global_recommendation: requireStringArray(value.global_recommendation, `${path}.global_recommendation`),
    runtime_note: optionalString(value.runtime_note, `${path}.runtime_note`),
  }
}

const parseAboutRecord = (value: JsonObject, path: string): AboutRecord => ({
  about_id: requireString(value.about_id, `${path}.about_id`),
  label: requireString(value.label, `${path}.label`),
  kicker: optionalString(value.kicker, `${path}.kicker`),
  title: requireString(value.title, `${path}.title`),
  short_blurb: requireString(value.short_blurb, `${path}.short_blurb`),
  body: requireStringArray(value.body, `${path}.body`),
  typography: value.typography === undefined ? undefined : (() => {
    const typography = requireObject(value.typography, `${path}.typography`)
    return {
      profile_id: requireString(typography.profile_id, `${path}.typography.profile_id`),
      heading_family: requireString(typography.heading_family, `${path}.typography.heading_family`),
      body_family: requireString(typography.body_family, `${path}.typography.body_family`),
      accent_family: requireString(typography.accent_family, `${path}.typography.accent_family`),
      heading_weight: optionalNumber(typography.heading_weight, `${path}.typography.heading_weight`),
      body_weight: optionalNumber(typography.body_weight, `${path}.typography.body_weight`),
      accent_weight: optionalNumber(typography.accent_weight, `${path}.typography.accent_weight`),
      rationale: requireString(typography.rationale, `${path}.typography.rationale`),
    }
  })(),
})

const parseGeometryKitArtifactRecord = (value: JsonValue, path: string): GeometryKitArtifactRecord => {
  const artifact = requireObject(value, path)

  return {
    artifact_type: optionalString(artifact.artifact_type, `${path}.artifact_type`),
    winner: optionalString(artifact.winner, `${path}.winner`),
    fallback: optionalString(artifact.fallback, `${path}.fallback`),
    geometry: parseGeometryRecord(artifact.geometry, `${path}.geometry`),
  }
}

const parseGeometryKitRecord = (value: JsonObject, path: string): GeometryKitRecord => Object.fromEntries(
  Object.entries(value).map(([artifactId, artifact]) => [artifactId, parseGeometryKitArtifactRecord(artifact, `${path}.${artifactId}`)]),
)

const fetchJson = async <T,>(path: string, parse: (value: JsonObject, path: string) => T): Promise<T> => {
  const response = await fetch(path)
  if (!response.ok) throw new Error(`Failed to load ${path}`)
  return parse(await parseJsonObject(response, path), path)
}

const fetchOptionalJson = async <T,>(path: string, parse: (value: JsonObject, path: string) => T): Promise<T | null> => {
  const response = await fetch(path)
  if (!response.ok) return null

  const contentType = response.headers?.get?.('content-type') ?? ''
  if (!contentType.includes('application/json')) return null

  return parse(await parseJsonObject(response, path), path)
}

export const loadManifest = () => fetchJson('/editions/index.json', parseEditionManifest)

export const selectEdition = (manifest: EditionManifest): EditionManifestItem =>
  manifest.editions.find((item) => item.edition_id === manifest.current_edition_id) ?? manifest.editions[0]

export const loadEditionPackage = async (basePath: string): Promise<LoadedEdition> => {
  const [edition, brief, artifactMap, sourceBindings, ambiance, review, geometryKit, enhancementPlan, about, interpretation] = await Promise.all([
    fetchJson(`${basePath}/edition.json`, parseEditionRecord),
    fetchJson(`${basePath}/brief.json`, parseBriefRecord),
    fetchJson(`${basePath}/artifact-map.json`, parseArtifactMapRecord),
    fetchJson(`${basePath}/source-bindings.json`, parseSourceBindingSetRecord),
    fetchJson(`${basePath}/ambiance.json`, parseAmbianceRecord),
    fetchJson(`${basePath}/review.json`, parseReviewRecord),
    fetchOptionalJson(`${basePath}/geometry-kit.json`, parseGeometryKitRecord),
    fetchOptionalJson(`${basePath}/enhancement-plan.json`, parseEnhancementPlanRecord),
    fetchOptionalJson(`${basePath}/about.json`, parseAboutRecord),
    fetchOptionalJson(`${basePath}/interpretation.json`, parseInterpretationRecord),
  ])

  const mergedArtifactMap = geometryKit
    ? {
        ...artifactMap,
        artifacts: artifactMap.artifacts.map((artifact) => ({
          ...artifact,
          geometry: geometryKit[artifact.id]?.geometry,
        })),
      }
    : artifactMap

  return { edition, brief, artifactMap: mergedArtifactMap, sourceBindings, ambiance, review, geometryKit, enhancementPlan, about, interpretation }
}

export const polygonToClipPath = (artifact: ArtifactRecord) => {
  if (!artifact.polygon || artifact.polygon.length < 3) return undefined
  const { x, y, w, h } = artifact.bounds
  return `polygon(${artifact.polygon
    .map(([px, py]) => `${((px - x) / w) * 100}% ${((py - y) / h) * 100}%`)
    .join(', ')})`
}
