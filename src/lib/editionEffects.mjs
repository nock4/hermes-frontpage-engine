export const effectKinds = Object.freeze([
  'refraction',
  'projection',
  'camera',
  'resonance',
  'depth',
  'castlight',
  'shared',
  'rupture',
  'sound',
])
const modality = {
  refraction: 'reflective',
  projection: 'video',
  camera: 'reflective',
  resonance: 'resonant',
  depth: 'depth',
  castlight: 'video',
  shared: 'touch',
  rupture: 'fracture',
  sound: 'resonant',
}
const materials = new Set([
  'metal',
  'glass',
  'water',
  'stone',
  'ceramic',
  'fabric',
  'paper',
  'wood',
  'screen',
  'pigment',
])
// Still-image vision cannot grant native-video or CORS provenance.
export function normalizeMaterialEvidence(value) {
  if (
    !value ||
    !materials.has(value.material) ||
    typeof value.observation !== 'string' ||
    !value.observation.trim() ||
    value.observation.length > 800 ||
    !Array.isArray(value.modalities)
  )
    return null
  const allowed = ['reflective', 'resonant', 'depth', 'fracture', 'touch']
  return {
    material: value.material,
    observation: value.observation,
    modalities: [...new Set(value.modalities.filter((m) => allowed.includes(m)))],
  }
}
const fail = () => {
  throw new Error('Invalid edition effects: unsupported material, geometry, owner or media admission')
}
const finiteUnit = (n) => Number.isFinite(n) && n >= 0 && n <= 1
const sameMedia = (source, binding) => {
  if (source === binding) return true
  try {
    return (
      source.startsWith('/') &&
      !source.startsWith('//') &&
      !!globalThis.location?.origin &&
      new URL(source, globalThis.location.origin).href === binding
    )
  } catch {
    return false
  }
}
function admitted(effect, context) {
  const a = context.artifacts.find((a) => a.id === effect.artifact_id),
    b = context.bindings.find((b) => b.id === effect.binding_id),
    ev = effect.evidence
  if (
    !effectKinds.includes(effect.kind) ||
    !a ||
    !b ||
    b.artifact_id !== a.id ||
    !a.source_binding_ids.includes(b.id)
  )
    return false
  if (
    !Array.isArray(a.polygon) ||
    a.polygon.length < 3 ||
    a.polygon.some((p) => p.length !== 2 || !p.every(finiteUnit))
  )
    return false
  if (
    !a.bounds ||
    ![a.bounds.x, a.bounds.y, a.bounds.w, a.bounds.h].every(finiteUnit) ||
    a.bounds.w === 0 ||
    a.bounds.h === 0 ||
    a.bounds.x + a.bounds.w > 1.000001 ||
    a.bounds.y + a.bounds.h > 1.000001
  )
    return false
  const area = a.polygon.reduce((sum, [x, y], i) => {
    const next = a.polygon[(i + 1) % a.polygon.length]
    return sum + x * next[1] - next[0] * y
  }, 0)
  if (Math.abs(area) < 0.00000001) return false
  if (
    !ev ||
    ev.artifact_id !== a.id ||
    ev.binding_id !== b.id ||
    !materials.has(ev.material) ||
    typeof ev.observation !== 'string' ||
    !ev.observation.trim() ||
    ev.observation.length > 800 ||
    !ev.modalities?.includes(modality[effect.kind])
  )
    return false
  if (['projection', 'castlight'].includes(effect.kind)) {
    const v = ev.video
    if (
      !v ||
      v.verified_native !== true ||
      v.cors_safe !== true ||
      v.owner_url !== b.source_url ||
      !sameMedia(v.url, b.source_media_url) ||
      b.source_media_type !== 'video'
    )
      return false
    if (typeof v.url !== 'string' || !/^(\/[^/]|https:\/\/)/.test(v.url) || v.url.includes('/review/'))
      return false
  }
  return true
}
export function normalizeEffects(value, context) {
  if (value === undefined || value === null) return null
  if (
    value.schema_version !== 1 ||
    value.edition_id !== context.editionId ||
    !Array.isArray(value.effects) ||
    value.effects.length > 3
  )
    fail()
  const seen = new Set()
  const effects = value.effects.map((e) => {
    if (!admitted(e, context) || seen.has(e.kind)) fail()
    seen.add(e.kind)
    const ev = e.evidence
    return {
      kind: e.kind,
      artifact_id: e.artifact_id,
      binding_id: e.binding_id,
      evidence: {
        artifact_id: ev.artifact_id,
        binding_id: ev.binding_id,
        material: ev.material,
        observation: ev.observation,
        modalities: [...ev.modalities],
        ...(ev.video
          ? {
              video: {
                url: ev.video.url,
                owner_url: ev.video.owner_url,
                verified_native: ev.video.verified_native,
                cors_safe: ev.video.cors_safe,
              },
            }
          : {}),
      },
    }
  })
  return { schema_version: 1, edition_id: context.editionId, effects }
}
function hash(s) {
  let h = 2166136261
  for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619)
  return h >>> 0
}
export function planEffects({ evidence = [], seed, ...context }) {
  const candidates = []
  for (const ev of evidence)
    for (const kind of effectKinds) {
      const e = { kind, artifact_id: ev.artifact_id, binding_id: ev.binding_id, evidence: ev }
      if (admitted(e, context)) candidates.push(e)
    }
  candidates.sort(
    (a, b) => hash(`${seed}:${a.kind}:${a.artifact_id}`) - hash(`${seed}:${b.kind}:${b.artifact_id}`),
  )
  const effects = []
  const seen = new Set()
  for (const c of candidates) {
    if (!seen.has(c.kind)) {
      effects.push(c)
      seen.add(c.kind)
    }
    if (effects.length >= 1 + (hash(String(seed)) % 3)) break
  }
  return normalizeEffects({ schema_version: 1, edition_id: context.editionId, effects }, context)
}
