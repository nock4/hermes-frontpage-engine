export type EffectKind =
  | 'refraction'
  | 'projection'
  | 'camera'
  | 'resonance'
  | 'depth'
  | 'castlight'
  | 'shared'
  | 'rupture'
  | 'sound'
export interface EffectEvidence {
  artifact_id: string
  binding_id: string
  material: string
  observation: string
  modalities: string[]
  video?: { url: string; owner_url: string; verified_native: boolean; cors_safe: boolean }
}
export interface EditionEffect {
  kind: EffectKind
  artifact_id: string
  binding_id: string
  evidence: EffectEvidence
}
export interface EditionEffects {
  schema_version: 1
  edition_id: string
  effects: EditionEffect[]
}
interface EffectContext {
  editionId: string
  artifacts: Array<{
    id: string
    polygon: number[][]
    bounds: { x: number; y: number; w: number; h: number }
    source_binding_ids: string[]
  }>
  bindings: Array<{
    id: string
    artifact_id: string
    source_url: string | null
    source_media_url?: string
    source_media_type?: string
  }>
}
export interface EffectEditorialDecision {
  schema_version: 1
  kind: EffectKind
  decision: 'keep' | 'omit'
  artifact_id: string
  binding_id: string
  source_url: string
  source_observation: string
  capture_sha256: string
  plate_observation: string
  brief_quote: string
  why_behavior: string
  why_input: string
  why_not_none: string
}
export type PlateEffectEditorialDecision = Omit<EffectEditorialDecision, 'artifact_id' | 'binding_id'> & { planned_artifact_index: number }
export interface EffectEditorialSource {
  artifact_id: string
  binding_id: string
  source_url: string
  observation: string
  capture_sha256: string
  brief: string
}
export const effectKinds: readonly EffectKind[]
export function normalizeEffects(value: unknown, context: EffectContext): EditionEffects | null
export function planEffects(
  context: EffectContext & { evidence?: EffectEvidence[]; seed: string; editorial?: EffectEditorialDecision[]; editorialSources?: EffectEditorialSource[]; audit?: Record<string, unknown> },
): EditionEffects
export function normalizeMaterialEvidence(
  value: unknown,
): Omit<EffectEvidence, 'artifact_id' | 'binding_id'> | null
