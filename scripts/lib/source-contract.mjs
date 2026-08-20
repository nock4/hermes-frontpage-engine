import { isLowFertilitySourceFingerprint } from './source-image-fingerprints.mjs'

function strings(values, limit = 8) {
  const result = []
  const seen = new Set()
  for (const value of values || []) {
    const text = String(value || '').replace(/\s+/g, ' ').trim()
    const key = text.toLowerCase()
    if (!text || seen.has(key)) continue
    seen.add(key)
    result.push(text)
    if (result.length >= limit) break
  }
  return result
}

export function buildSourceContract({
  sourceImageFingerprints = [],
  visualDirection = {},
  platePosture = null,
  scenePrompt = '',
  sourceImageMode = null,
} = {}) {
  const dominant = (sourceImageFingerprints || []).find((fingerprint) => fingerprint?.image_url) || null
  const lowFertility = dominant ? isLowFertilitySourceFingerprint(dominant) : false
  const mode = sourceImageMode || (!dominant || lowFertility ? 'skipped-no-valid-dominant-source-image' : 'source-image')
  if (mode !== 'source-image') {
    return {
      schema_version: 1,
      mode: 'skipped-no-valid-dominant-source-image',
      dominant_source_image_url: dominant?.image_url || null,
      dominant_source_title: dominant?.title || null,
      skip_reason: lowFertility
        ? `dominant image is low-fertility: ${dominant.low_fertility_reason || dominant.visual_summary || dominant.title || dominant.image_url}`
        : 'no valid dominant source image',
      must_preserve: [],
      must_transform: [],
      forbidden_drift: [],
      forbidden_overcopy: [],
      prompt_conflicts: [],
    }
  }

  const preserve = strings([
    ...(dominant.preserve_cues || []),
    dominant.visual_summary,
    ...(dominant.composition_moves || []),
  ], 8)
  const transform = strings([
    'change at least two of arrangement, scale, object count, crop, surface state, or spatial logic',
    'make source-window seams/apertures/marks edition-native rather than pasted annotations',
    platePosture?.plate_posture ? `subordinate ${platePosture.plate_posture} posture to source identity` : '',
  ], 5)
  const forbiddenDrift = strings([
    'same palette but not the same source',
    'lost crop/framing or source aspect when that destroys identity',
    'lost major object, gesture, light, or spatial relationships',
    'source turned into unrelated macro texture, landscape, room, city, skyline, horizon, or metaphor scene',
    'framed panel/object conversion that destroys source identity',
  ], 8)
  const forbiddenOvercopy = strings([
    'near-identical source recreation with tiny seams or apertures added',
    'pasted source photo, screenshot, logo, wordmark, UI button, or page chrome as the plate',
    'same still-life arrangement, object count, camera distance, and object positions without edition-native transformation',
  ], 6)

  const promptText = [
    scenePrompt,
    visualDirection.composition_archetype,
    visualDirection.camera_plate_grammar,
    ...(visualDirection.visual_compositional_moves || []),
  ].filter(Boolean).join(' ').toLowerCase()
  const preserveText = preserve.join(' ').toLowerCase()
  const promptConflicts = []
  const explicitReplacement = /(?:unrelated|replace(?:ment)?\s+(?:image|scene|source|subject|plate)|replace\s+with|instead of the source|rather than the source)/.test(promptText)
  const replacementScene = /(macro|landscape|horizon|skyline|city|metaphor|texture field)/.test(promptText)
  if (explicitReplacement && replacementScene
    && /(room|interior|figure|object|square|crop|framing|doorway|window|still[- ]?life|source|chair|painting)/.test(preserveText)) {
    promptConflicts.push('source-preserve contract conflicts with macro/landscape replacement language')
  }
  if (/no literal depiction|do not depict|avoid depicting the source|not depict the source/.test(promptText)) {
    promptConflicts.push('source-preserve contract conflicts with no-literal-depiction language')
  }

  return {
    schema_version: 1,
    mode: 'source-image',
    dominant_source_image_url: dominant.image_url,
    dominant_source_title: dominant.title || null,
    source_role: dominant.source_role || 'dominant plate seed',
    must_preserve: preserve,
    must_transform: transform,
    forbidden_drift: forbiddenDrift,
    forbidden_overcopy: forbiddenOvercopy,
    prompt_conflicts: promptConflicts,
  }
}

export function assertSourceContractPromptSafe(contract = {}) {
  const conflicts = Array.isArray(contract.prompt_conflicts) ? contract.prompt_conflicts : []
  if (conflicts.length) {
    throw new Error(`source contract prompt conflicts: ${conflicts.join('; ')}`)
  }
  return true
}
