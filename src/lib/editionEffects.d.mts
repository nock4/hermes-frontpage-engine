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
export const effectKinds: readonly EffectKind[]
export function normalizeEffects(value: unknown, context: EffectContext): EditionEffects | null
export function planEffects(
  context: EffectContext & { evidence?: EffectEvidence[]; seed: string },
): EditionEffects
export function normalizeMaterialEvidence(
  value: unknown,
): Omit<EffectEvidence, 'artifact_id' | 'binding_id'> | null
