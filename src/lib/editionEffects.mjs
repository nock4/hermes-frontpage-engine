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
const editorialText = (value) => typeof value === 'string' && value.trim().length > 0 && value.length <= 1600
function editorialAdmission(d, sources, ev, binding) {
  if (!d || d.schema_version !== 1 || !effectKinds.includes(d.kind)
    || !['keep', 'omit'].includes(d.decision)
    || !['why_behavior', 'why_input', 'why_not_none', 'source_observation', 'plate_observation', 'brief_quote'].every(k => editorialText(d[k]))) return false
  const source = sources.find(s => s.artifact_id === d.artifact_id && s.binding_id === d.binding_id && s.source_url === d.source_url)
  return !!source && binding?.source_url === d.source_url
    && /^[a-f0-9]{64}$/.test(d.capture_sha256 || '') && d.capture_sha256 === source.capture_sha256
    && d.source_observation === source.observation
    && typeof source.brief === 'string' && source.brief.includes(d.brief_quote)
    && ev?.observation === d.plate_observation
}

// Future authoring only. Published v1 contracts deliberately retain their old
// physical/media validator above; never retroactively disable accepted archives.
export function planEffects({ evidence = [], editorial = [], editorialSources = [], audit, seed, ...context }) {
  const candidates = []
  const decisions = []
  const records = Array.isArray(editorial) ? editorial : []
  for (const d of records) {
    const ev = evidence.find(e => e.artifact_id === d?.artifact_id && e.binding_id === d?.binding_id)
    const binding = context.bindings.find(b => b.id === d?.binding_id)
    const entry = { decision: d, status: 'rejected', reason: 'Malformed or mismatched editorial evidence/owner/source/brief reference.' }
    decisions.push(entry)
    if (!editorialAdmission(d, editorialSources, ev, binding)) continue
    // Conflicting/duplicate decisions are not a tie. Fail this exact kind/owner
    // closed rather than allowing keep to overrule omit or malformed duplicates.
    if (records.filter(r => r?.kind === d.kind && r?.artifact_id === d.artifact_id && r?.binding_id === d.binding_id).length !== 1) {
      entry.reason = 'Duplicate or conflicting editorial decisions.'; continue
    }
    if (d.decision === 'omit') {
      entry.status = 'omitted'; entry.reason = 'Explicit model editorial omit; no replacement nominated.'; continue
    }
    const e = { kind: d.kind, artifact_id: d.artifact_id, binding_id: d.binding_id, evidence: ev }
    if (!admitted(e, context)) { entry.reason = 'Editorial keep lacks unchanged technical material/geometry/media admission.'; continue }
    candidates.push({ effect: e, entry })
    entry.status = 'approved'; entry.reason = 'Explicit source/plate/brief-grounded editorial keep and technical admission.'
  }
  candidates.sort((a, b) => hash(`${seed}:${a.effect.kind}:${a.effect.artifact_id}`) - hash(`${seed}:${b.effect.kind}:${b.effect.artifact_id}`)
    || a.effect.kind.localeCompare(b.effect.kind) || a.effect.artifact_id.localeCompare(b.effect.artifact_id))
  const effects = []
  const seen = new Set()
  for (const { effect, entry } of candidates) {
    if (seen.has(effect.kind) || effects.length >= 3) {
      entry.status = 'omitted'; entry.reason = 'Approved but not selected: maximum three effects, one per kind.'; continue
    }
    effects.push(effect); seen.add(effect.kind); entry.status = 'selected'
  }
  // Missing decisions are visible as omissions, separate from material diagnostics.
  for (const a of context.artifacts) for (const kind of effectKinds) {
    if (!records.some(d => d?.kind === kind && d?.artifact_id === a.id)) decisions.push({ artifact_id: a.id, kind, status: 'omitted', reason: 'No explicit editorial decision; technical compatibility is not approval.' })
  }
  if (audit && typeof audit === 'object') Object.assign(audit, { schema_version: 1, edition_id: context.editionId, seed, selected: effects.map(e => ({ kind: e.kind, artifact_id: e.artifact_id, binding_id: e.binding_id })), decisions, material_diagnostics: evidence, source_context: editorialSources })
  return normalizeEffects({ schema_version: 1, edition_id: context.editionId, effects }, context)
}
