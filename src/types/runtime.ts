type Bounds = { x: number; y: number; w: number; h: number }
type Point = [number, number]

export interface ArtifactGeometryRecord {
  safe_stage_window_origin_px?: [number, number]
  safe_hover_origin_px?: [number, number]
  preferred_expansion_direction?: [number, number]
  preferred_expansion_label?: 'left' | 'right' | 'up' | 'down'
}

export interface GeometryKitArtifactRecord {
  artifact_type?: string
  winner?: string
  fallback?: string
  geometry: ArtifactGeometryRecord
}

export type GeometryKitRecord = Record<string, GeometryKitArtifactRecord>

export interface EditionManifestItem {
  edition_id: string
  date: string
  slug: string
  title: string
  path: string
  scene_family: string
  motif_tags: string[]
  preview_asset_path: string
  is_live: boolean
}

export interface EditionManifest {
  current_edition_id: string
  editions: EditionManifestItem[]
}

export interface EditionRecord {
  edition_id: string
  date: string
  status: string
  slug: string
  title: string
  scene_family: string
  brief_id: string
  plate_id: string
  artifact_map_id: string
  source_binding_set_id: string
  ambiance_recipe_id: string
  review_state_id: string
  publish_state: {
    is_live: boolean
    published_at: string | null
    archive_path: string | null
  }
  plate_asset_path: string
}

export interface BriefRecord {
  brief_id: string
  date: string
  signal_cluster_ids: string[]
  research_node_ids: string[]
  mood: string
  material_language: string[]
  lighting: string
  object_inventory: string[]
  interaction_grammar: {
    hero_count: number
    module_count: number
    window_strategy: string
  }
  negative_constraints: string[]
}

export interface ArtifactRecord {
  id: string
  kind: 'hero' | 'module'
  label: string
  artifact_type: string
  cluster_id: string
  bounds: Bounds
  polygon: Point[]
  mask_path?: string
  geometry?: ArtifactGeometryRecord
  z_index: number
  source_binding_ids: string[]
}

export interface ArtifactMapRecord {
  artifact_map_id: string
  viewport: {
    base_width: number
    base_height: number
    aspect_ratio: string
  }
  default_cluster_id: string
  default_artifact_id: string
  artifacts: ArtifactRecord[]
}

export type SourceBindingSourceType =
  | 'article'
  | 'audio'
  | 'concept-note'
  | 'github'
  | 'nts'
  | 'social'
  | 'tweet'
  | 'video'
  | 'web'
  | 'youtube'

export type SourceBindingWindowType = 'audio' | 'social' | 'video' | 'web'
export type SourceBindingHoverBehavior = 'preview'
export type SourceBindingClickBehavior = 'pin-open'
export type SourceBindingFallbackType = 'rich-preview'
export type SourceBindingEmbedStatus = 'processing' | 'unavailable'

export interface SourceBindingRecord {
  id: string
  artifact_id: string
  source_type: SourceBindingSourceType
  source_url: string | null
  window_type: SourceBindingWindowType
  hover_behavior: SourceBindingHoverBehavior
  click_behavior: SourceBindingClickBehavior
  playback_persistence: boolean
  fallback_type: SourceBindingFallbackType
  embed_status?: SourceBindingEmbedStatus
  title: string
  kicker: string
  excerpt: string
  source_title?: string
  source_summary?: string
  source_domain?: string
  source_meta?: string
  source_embed_html?: string
  source_image_url?: string
  source_image_alt?: string
}

export interface SourceBindingSetRecord {
  source_binding_set_id: string
  bindings: SourceBindingRecord[]
}

export interface AmbianceRecord {
  ambiance_recipe_id: string
  motion_system: string
  color_drift: string
  glow_behavior: string
  audio_posture: string
  webgl_mode: string
  research_inputs: string[]
}

export interface ReviewRecord {
  review_state_id: string
  geometry_status: string
  clickability_status: string
  behavior_status: string
  editorial_status: string
  notes: string[]
}

type EnhancementTargetKind = 'artifact' | 'field-region' | 'surface-region' | 'global-scene'

interface EnhancementActivationRecord {
  hover: boolean
  click: boolean
  drag: boolean
  hold: boolean
}

export interface EnhancementRejectedRecord {
  technique: string
  reason: string
}

export interface EnhancementTargetRecord {
  target_id: string
  target_kind: EnhancementTargetKind
  artifact_id?: string
  priority: number
  techniques: string[]
  source_classes: string[]
  activation: EnhancementActivationRecord
  reason: string
}

export interface EnhancementInteractionWorldRecord {
  class: string
  primary_behavior: string
  scene_wide_behavior: string
  choreography_rule: string
}

export interface EnhancementPlanRecord {
  enhancement_plan_id: string
  edition_id: string
  derived_from?: {
    interpretation_id: string
    analysis_id?: string
  }
  interaction_world: EnhancementInteractionWorldRecord
  bundle: {
    primary: string[]
    secondary: string[]
    wildcard: string[]
  }
  runtime_safe_subset: string[]
  future_only_subset: string[]
  rejected: EnhancementRejectedRecord[]
  targets: EnhancementTargetRecord[]
  global_recommendation: string[]
  runtime_note?: string
}

import type { AboutRecord } from './about'
import type { InterpretationRecord } from './interpretation'

export interface LoadedEdition {
  edition: EditionRecord
  brief: BriefRecord
  artifactMap: ArtifactMapRecord
  sourceBindings: SourceBindingSetRecord
  ambiance: AmbianceRecord
  review: ReviewRecord
  geometryKit?: GeometryKitRecord | null
  enhancementPlan?: EnhancementPlanRecord | null
  about?: AboutRecord | null
  interpretation?: InterpretationRecord | null
}

export interface ArchiveRecord extends EditionManifestItem {
  archive_href: string
}

export interface SourceWindowState {
  previewBindingId: string | null
  primaryBindingId: string | null
  focusedBindingId: string | null
  openBindingIds: string[]
  minimizedBindingIds: string[]
  persistentBindingIds: string[]
  bindingWindowTypes: Record<string, SourceBindingWindowType>
}
