import { openAiJson } from './openai-json.mjs'
import { buildSourceContract, assertSourceContractPromptSafe } from './source-contract.mjs'
import { getResearchContentSources } from './source-research.mjs'
import { hasCreativeArtifactEvidence, sourceContentKey } from './source-selection-policy.mjs'

const sourceKey = (url) => sourceContentKey({ url })
const fail = (message) => { throw new Error(`Real-mark plan: ${message}`) }
// One planning call plus at most one prose-only length repair per plate attempt.
// No image, inspection, eligibility or geometry retries are introduced here.
// The owning sources are fixed; their visual translations may change together
// with the scene when fidelity recovery invalidates an earlier material world.
export async function planRealMarks({ payload, researchField, apiKey, model }, { request = openAiJson, record = async () => {} } = {}) {
  const originals = payload.artifacts || []
  if (originals.length < 6 || originals.length > 10) fail('requires 6–10 source-backed marks before generation')
  const urls = originals.map((artifact) => artifact.source_url)
  if (urls.some((url) => !url) || new Set(urls.map(sourceKey)).size !== urls.length) fail('duplicate or missing owning source')
  const content = getResearchContentSources(researchField)
  const sources = urls.map((url, index) => {
    const found = content.find((source) => [source.url, source.source_url, source.final_url, source.resolved_url].some((candidate) => candidate && sourceKey(candidate) === sourceKey(url)))
    if (!found) fail(`owning source absent from admitted research: ${url}`)
    // Reuse admission's exact owner/media/affirmative-proof checks, including
    // whole-field exclusions, rather than trusting metadata or issuing a stamp.
    if (!hasCreativeArtifactEvidence(found, researchField.autoresearch)) fail(`no attributable affirmative inspection: ${url}`)
    const decisions = (researchField.autoresearch?.source_decisions || []).filter((decision) =>
      hasCreativeArtifactEvidence(found, { source_decisions: [decision] }))
    if (!decisions.length) fail(`no attributable affirmative inspection: ${url}`)
    return {
      source_url: url,
      prior_role: originals[index].role,
      evidence: {
        url: found.url, source_url: found.source_url, final_url: found.final_url, resolved_url: found.resolved_url,
        title: found.title, description: found.description, image_url: found.image_url,
        // Preserve verbatim observations, caveats and capture provenance. Do not
        // send merged crawl metadata: image_candidates can describe other works.
        source_decisions: decisions,
      },
    }
  })
  const requestPayload = {
    model, maxOutputTokens: 4000, timeoutMs: 120000,
    instructions: 'Return JSON only. Plan one coherent artwork and its real source-backed marks together. No geometry, image generation, or eligibility decisions.',
    input: JSON.stringify({
      task: 'Reconcile the scene and every owning source with the dominant source fidelity contract before image generation.',
      rules: [
        'Use every supplied source_url exactly once; do not add, drop, substitute or duplicate sources.',
        'Make at least six distinct visible physical features, not six counted symbols. Keep two larger features and subordinate others within the same composition.',
        'Each visual_description is a complete concrete still-image phrase, at most 80 characters. No labels, URLs, taxonomy, interaction instructions, numbering, target rings, debug marks, pins or pasted cards.',
        'Ground each translation in its own supplied source_decisions inspection observations and preserve their caveats; metadata and prior_role are context, not pixel evidence. Explain the relationship in role. Never attribute one source’s appearance to another.',
        'The prior scene and materials are proposals, not preservation requirements. Recovery may replace them: replan all marks in the recovered source-native world rather than forcing incompatible old materials or a decorated copy.',
        'Honor missing and retained source identity cues but do not illustrate diagnostic failure descriptions. Preserve the source contract, structural transformation, measured aspect and no-debug prohibitions.',
        'No bounds or polygons: these are plans, not proof of visible objects. Only subsequent pixel inspection can establish geometry and the real-mark floor.',
        'If the source relationships cannot coexist honestly, return an error rather than inventing source evidence.',
      ],
      sources,
      source_contract: payload.source_contract,
      dominant_source: payload.source_image_fingerprints?.[0],
      source_audio_material: payload.source_audio_material,
      recovery_diagnostics: payload.source_fidelity_recovery_diagnostics || [],
      prior_scene_proposal: payload.scene_prompt,
      output_shape: {
        scene_prompt: 'complete still-image art direction, at most 420 characters',
        material_language: ['1–4 source-compatible surfaces, each at most 100 characters'],
        lighting: 'at most 160 characters',
        composition_archetype: 'at most 100 characters',
        camera_plate_grammar: 'at most 160 characters',
        visual_compositional_moves: ['1–3 structural transformations, each at most 160 characters'],
        negative_constraints: ['1–6 scene-compatible exclusions, each at most 160 characters'],
        artifacts: [{ source_url: 'exact supplied source_url', visual_description: 'at most 80 characters', role: 'source-evidenced attribution relationship with full source caveats; explanatory prose, not image direction' }],
      },
    }),
  }
  // Keep rejected plans diagnosable; credentials are transport-only.
  await record('request', requestPayload)
  const response = await request({ ...requestPayload, apiKey })
  await record('response', response ?? null)
  const overlength = []
  // Validate ALL non-length gates before deciding whether repair is admissible.
  const next = validateResponse(response, payload, urls, overlength)
  if (!overlength.length) return next
  // The Hermes JSON adapter is prompt-only: it exposes no enforced JSON schema.
  // Keep the same transport and budgets; never truncate provider prose locally.
  const repairPayload = {
    ...requestPayload,
    instructions: `${requestPayload.instructions} Formatting repair only: rewrite overlength fields as compact COMPLETE phrases. Preserve every negation, exclusion and caveat; never truncate. Return the complete JSON object. Copy all other fields, source URLs and full attribution roles verbatim. If meaning cannot fit honestly, return an error.`,
    input: JSON.stringify({
      ...JSON.parse(requestPayload.input),
      task: 'Repair only the listed overlength prose fields. No new research, source admission, geometry or scene redesign.',
      overlength,
      rejected_response: response,
    }),
  }
  await record('repair.request', repairPayload)
  const repaired = await request({ ...repairPayload, apiKey })
  await record('repair.response', repaired ?? null)
  const final = validateResponse(repaired, payload, urls)
  assertOnlyLengthEdits(response, repaired, new Set(overlength.map(({ field }) => field)))
  return final
}

function assertOnlyLengthEdits(before, after, allowed, field = '') {
  if (allowed.has(field)) return
  if (before && typeof before === 'object') {
    if (!after || typeof after !== 'object' || Array.isArray(before) !== Array.isArray(after)
      || Object.keys(before).length !== Object.keys(after).length) fail(`formatting repair changed ${field || 'shape'}`)
    for (const key of Object.keys(before)) {
      if (!Object.hasOwn(after, key)) fail(`formatting repair removed ${field}.${key}`)
      assertOnlyLengthEdits(before[key], after[key], allowed, field ? `${field}.${key}` : key)
    }
  } else if (before !== after) fail(`formatting repair changed protected ${field}`)
}

function validateResponse(response, payload, urls, overlength = null) {
  function text(value, max, field) {
    if (typeof value !== 'string' || !value.trim()) fail(`invalid ${field} (limit ${max})`)
    if (value.length > max) {
      if (!overlength) fail(`invalid ${field} (limit ${max})`)
      overlength.push({ field, length: value.length, limit: max })
    }
    return max === Infinity ? value : value.trim()
  }
  function texts(value, maxItems, maxLength, field) {
    if (!Array.isArray(value) || !value.length || value.length > maxItems) fail(`invalid ${field}`)
    return value.map((entry, index) => text(entry, maxLength, `${field}.${index}`))
  }
  if (!response || typeof response !== 'object' || Array.isArray(response) || response.error) fail(response?.error || 'empty or malformed response')
  const fields = ['scene_prompt', 'material_language', 'lighting', 'composition_archetype', 'camera_plate_grammar', 'visual_compositional_moves', 'negative_constraints', 'artifacts']
  if (Object.keys(response).some((key) => !fields.includes(key))) fail('unexpected plan fields; no geometry or eligibility evidence allowed')
  if (!Array.isArray(response.artifacts) || response.artifacts.length !== urls.length) fail('owning source count changed')
  const byUrl = new Map()
  for (const [index, artifact] of response.artifacts.entries()) {
    if (!artifact || typeof artifact !== 'object' || Array.isArray(artifact)) fail('malformed artifact')
    if (!urls.includes(artifact.source_url) || byUrl.has(artifact.source_url)) fail('owning source changed or duplicated')
    if (Object.keys(artifact).some((key) => !['source_url', 'visual_description', 'role'].includes(key))) fail('planning cannot supply mapping or eligibility evidence')
    const description = text(artifact.visual_description, 80, `artifacts.${index}.visual_description`)
    if (/https?:|\b(?:click|hover|tap|runtime|binding|hotspot|source.window|label|numbered|target|crosshair|reticle|pin|card)\b/i.test(description)) fail('visual_description contains UI or mapping language')
    byUrl.set(artifact.source_url, {
      source_url: artifact.source_url, label: description, artifact_type: 'source-native-mark',
      // Attribution prose is not image direction. Preserve complete caveats;
      // only provider-facing visual descriptions retain the compact budget.
      visual_description: description, role: text(artifact.role, Infinity, 'role'),
    })
  }
  const artifacts = urls.map((url) => byUrl.get(url))
  if (new Set(artifacts.map((artifact) => artifact.visual_description.toLowerCase())).size !== artifacts.length) fail('duplicate visual marks')
  const next = {
    ...payload,
    scene_prompt: text(response.scene_prompt, 420, 'scene_prompt'),
    mood: response.scene_prompt,
    artifacts,
    object_inventory: artifacts.map((artifact) => artifact.visual_description),
    material_language: texts(response.material_language, 4, 100, 'material_language'),
    lighting: text(response.lighting, 160, 'lighting'),
    negative_constraints: texts(response.negative_constraints, 6, 160, 'negative_constraints'),
    // These old scene-dependent directions must not resurrect a failed world.
    plate_posture: null,
    effect_direction: null,
    visual_direction: {
      composition_archetype: text(response.composition_archetype, 100, 'composition_archetype'),
      camera_plate_grammar: text(response.camera_plate_grammar, 160, 'camera_plate_grammar'),
      visual_compositional_moves: texts(response.visual_compositional_moves, 3, 160, 'visual_compositional_moves'),
      palette_profile: (payload.source_image_fingerprints?.[0]?.palette_cues || []).join('; '),
    },
    real_mark_plan: { status: 'planned', source_urls: urls, geometry_status: 'unverified' },
  }
  next.source_contract = buildSourceContract({ sourceImageFingerprints: next.source_image_fingerprints || [], visualDirection: next.visual_direction, scenePrompt: next.scene_prompt, sourceImageMode: next.source_image_mode })
  assertSourceContractPromptSafe(next.source_contract)
  return next
}
