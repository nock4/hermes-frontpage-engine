import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { platePng } from '../fixtures/plate-png.mjs'
import { inspectedDecision } from '../fixtures/creative-inspection.mjs'
import { openAiJson } from '../../scripts/lib/openai-json.mjs'
import { inspectGeneratedPlate } from '../../scripts/lib/plate-analysis.mjs'
import { createMapArtifactsStep } from '../../scripts/pipeline/map-artifacts.mjs'
import { assembleEditionPackage } from '../../scripts/lib/edition-package-assembly.mjs'
import { loadEditionPackage } from '../../src/lib/editionLoader'
import { planEffects, effectKinds } from '../../src/lib/editionEffects.mjs'
vi.mock('../../scripts/lib/openai-json.mjs', () => ({ openAiJson: vi.fn() }))
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks() })
const sourceUrl = 'https://artist.example/collective-drawing'
const sourceObservation = 'Synthetic fixture: two participants draw overlapping rings on a common sheet.'
const brief = 'Overlapping rings remain as traces of successive hands across a shared sheet.'
const plateObservation = 'Visible paper grain below two overlapping ink rings.'
const rawDecision = (kind = 'shared') => ({
  schema_version: 1, kind, decision: 'keep', planned_artifact_index: 0, source_url: sourceUrl,
  source_observation: sourceObservation, capture_sha256: 'a'.repeat(64),
  plate_observation: plateObservation, brief_quote: brief,
  why_behavior: 'Transient disturbances let the overlapping rings meet without replacing the source drawing.',
  why_input: 'Remote co-presence echoes the inspected two-person drawing process; a local pointer alone would not express encounter.',
  why_not_none: 'The undisturbed plate preserves traces but cannot enact the encounter of separate hands; optional shared marks can.',
})
async function candidate(decisions, { title = 'Collective drawing', modalities = ['touch'], observation = sourceObservation, analysisResearch = true } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dfe-editorial-gate-'))
  const runDir = path.join(root, 'run'); await fs.mkdir(runDir)
  await fs.mkdir(path.join(root, 'public/editions'), { recursive: true })
  await fs.writeFile(path.join(root, 'public/editions/index.json'), JSON.stringify({ current_edition_id: null, editions: [] }))
  const platePath = path.join(runDir, 'plate.png'); await fs.writeFile(platePath, platePng(1536, 1024))
  const source = { url: sourceUrl, title, description: title, image_url: 'https://artist.example/work.jpg' }
  const inspection = inspectedDecision(source); inspection.inspection.observation = observation
  const researchField = { sources: [source], autoresearch: { aesthetic_thesis: 'Separate hands meet in a common drawing.', source_decisions: [inspection] } }
  const payload = { slug_base: 'editorial-gate', edition_title: 'Editorial gate', scene_family: 'paper', scene_prompt: brief, mood: 'quiet', lighting: 'flat', material_language: ['paper'], object_inventory: ['rings'], motif_tags: [], negative_constraints: [], ambiance: { motion_system: 'still', color_drift: 'none', glow_behavior: 'none', audio_posture: 'silent', webgl_mode: 'none' }, artifacts: [{ label: 'Ring sheet', role: 'source-pocket', source_url: sourceUrl }] }
  openAiJson.mockResolvedValueOnce({ detected_objects: [{ label: 'Ring sheet', role: 'source-pocket', artifact_type: 'paper', confidence: .96, bounds: { x: .2, y: .2, w: .4, h: .4 }, polygon: [[.2,.2],[.6,.2],[.6,.6],[.2,.6]], visual_evidence: plateObservation, effect_material: { material: 'paper', observation: plateObservation, modalities }, effect_editorial: decisions }] })
  const context = { payload, researchField: analysisResearch ? researchField : undefined, plate: { outputPath: platePath } }
  await createMapArtifactsStep({ context, root, runDir, options: {}, inspectGeneratedPlate: (args, dir) => inspectGeneratedPlate(args, dir, { writeJson: async (p, v) => fs.writeFile(p, JSON.stringify(v)), minContentItems: 1, maxContentItems: 10 }) }).run()
  const analysis = context.analysis
  const prompt = JSON.parse(openAiJson.mock.calls.at(-1)[0].input[0].content[0].text)
  const result = await assembleEditionPackage({ root, options: { date: '2026-11-05', publish: true }, payload, researchField, signalHarvest: { notes_selected: [] }, plate: { outputPath: platePath }, analysis, runDir })
  const base = `/editions/${result.editionId}`
  vi.stubGlobal('fetch', async url => { try { return new Response(await fs.readFile(path.join(root, 'public', String(url))), { headers: { 'Content-Type': 'application/json' } }) } catch { return new Response('', { status: 404 }) } })
  const loaded = await loadEditionPackage(base)
  const effects = JSON.parse(await fs.readFile(path.join(result.editionDir, 'effects.json'), 'utf8'))
  expect(await fs.readFile(path.join(result.editionDir, 'assets/plate.png'))).toEqual(await fs.readFile(platePath))
  expect(loaded.sourceBindings.bindings[0].source_url).toBe(sourceUrl)
  const audit = JSON.parse(await fs.readFile(path.join(runDir, 'effects-selection-audit.json'), 'utf8').catch(() => 'null'))
  // Retain complete saved candidates, never publish them into the real archive.
  const retained = path.resolve('tmp/effects-editorial-gate/candidates', path.basename(root))
  await fs.mkdir(path.dirname(retained), { recursive: true }); await fs.cp(root, retained, { recursive: true })
  await fs.rm(root, { recursive: true, force: true })
  return { effects, loaded, audit, prompt, analysis }
}
describe('future editorial gate: actual analysis → assembly → planner → public loader', () => {
  it.each([undefined, [], [{ ...rawDecision(), decision: 'omit' }], [{ kind: 'shared', decision: 'keep' }], 'keep'])('publishes the original plate without an effect for absent/omit/malformed decision %j', async decisions => {
    const c = await candidate(decisions)
    expect(c.effects.effects).toEqual([])
    expect(c.loaded.effects.effects).toEqual([])
    expect(c.loaded.artifactMap.artifacts).toHaveLength(1)
    expect(c.audit).toMatchObject({ schema_version: 1, selected: [] })
    expect(c.audit.decisions.length).toBeGreaterThan(0)
  })
  it.each([
    { source_url: 'https://unrelated.example/work' }, { planned_artifact_index: 1 },
    { capture_sha256: 'b'.repeat(64) }, { source_observation: 'An unobserved social event' },
    { brief_quote: 'unrelated brief' }, { plate_observation: 'unseen glass' },
    { kind: 'not-an-effect' }, { artifact_id: 'forged' }, { binding_id: 'forged' },
  ])('rejects mismatched references %j without blocking publication', async patch => {
    const c = await candidate([{ ...rawDecision(), ...patch }])
    expect(c.effects.effects).toEqual([])
    expect(c.audit.decisions.some(d => d.status === 'rejected')).toBe(true)
  })
  it.each(['Musical portrait at a social event', 'Paper grain receptive touch surface'])('source claims alone cannot confer sensor/shared: %s', async title => {
    const c = await candidate(effectKinds.map(kind => ({ ...rawDecision(kind), source_observation: title })), { title })
    expect(c.effects.effects).toEqual([])
  })
  it('passes real source/brief context into the existing model call; only a specific approval selects', async () => {
    const c = await candidate([rawDecision()])
    expect(c.effects.effects.map(e => e.kind)).toEqual(['shared'])
    expect(c.loaded.effects).toEqual(c.effects)
    expect(c.prompt.editorial_context.sources[0]).toMatchObject({ source_url: sourceUrl, observation: sourceObservation, capture_sha256: 'a'.repeat(64) })
    expect(c.prompt.editorial_context.brief).toBe(brief)
    expect(c.audit.decisions).toEqual(expect.arrayContaining([expect.objectContaining({ status: 'selected', decision: expect.objectContaining({ why_input: rawDecision().why_input }) })]))
  })
  it('omit does not trigger an alternative, and incompatible approval cannot bypass technical evidence', async () => {
    const c = await candidate([{ ...rawDecision(), decision: 'omit' }, rawDecision('camera')])
    expect(c.effects.effects).toEqual([])
  })
})

it('a quoted response cannot approve when the actual analysis call lacked source context', async () => {
  const c = await candidate([rawDecision()], { analysisResearch: false })
  expect(c.effects.effects).toEqual([])
})
it('overlong decision arrays cannot hide a conflicting omit beyond the accepted prefix', async () => {
  const c = await candidate([rawDecision(), ...Array(90).fill({ kind: 'unused' }), { ...rawDecision(), decision: 'omit' }])
  expect(c.effects.effects).toEqual([])
})
it.each(['why_input', 'why_behavior', 'why_not_none'])('missing independent %s rationale selects none', async key => {
  const c = await candidate([{ ...rawDecision(), [key]: '' }])
  expect(c.effects.effects).toEqual([])
})
it('duplicate keep and omit fail closed, without a replacement', async () => {
  const c = await candidate([rawDecision(), { ...rawDecision(), decision: 'omit' }])
  expect(c.effects.effects).toEqual([])
})
it.each([
  ['unexpected final artifact ID', { ...rawDecision(), decision: 'omit', artifact_id: 'forged' }],
  ['wrong-type planned index', { ...rawDecision(), decision: 'omit', planned_artifact_index: '0' }],
])('malformed conflicting omit fails the whole detected object closed: %s', async (_label, omitted) => {
  const c = await candidate([rawDecision(), omitted])
  expect(c.effects.effects).toEqual([])
  expect(c.loaded.effects.effects).toEqual([])
  expect(c.loaded.artifactMap.artifacts).toHaveLength(1)
  expect(c.audit.decisions.some(d => d.status === 'rejected' && JSON.stringify(d.decision.rejected_record) === JSON.stringify(omitted))).toBe(true)
})
it('mixed valid/invalid kind ownership with missing references rejects the object without inventing rationale', async () => {
  const malformed = { kind: 'not-an-effect', decision: 'omit', artifact_id: 'forged' }
  const c = await candidate([rawDecision(), rawDecision('sound'), malformed])
  expect(c.effects.effects).toEqual([])
  expect(c.loaded.effects.effects).toEqual([])
  expect(c.loaded.artifactMap.artifacts).toHaveLength(1)
  expect(c.audit.decisions.some(d => d.status === 'rejected' && JSON.stringify(d.decision.rejected_record) === JSON.stringify(malformed))).toBe(true)
})
const artifact = { id: 'a', polygon: [[.1,.1],[.8,.1],[.8,.8]], bounds: { x:.1,y:.1,w:.7,h:.7 }, source_binding_ids:['b'] }
const binding = { id:'b', artifact_id:'a', source_url:sourceUrl }
const evidence = [{ artifact_id:'a',binding_id:'b',material:'paper',observation:plateObservation,modalities:['touch','reflective','resonant','depth','fracture'] }]
const editorialSources = [{ artifact_id:'a',binding_id:'b',source_url:sourceUrl,observation:sourceObservation,capture_sha256:'a'.repeat(64),brief }]
const decision = kind => { const { planned_artifact_index, ...d } = rawDecision(kind); return { ...d, artifact_id:'a',binding_id:'b' } }
const context = { editionId:'future',artifacts:[artifact],bindings:[binding],evidence,editorialSources }
it('paper/touch compatibility alone selects zero for every replay seed', () => {
  for (let i=0;i<20;i++) expect(planEffects({ ...context,seed:String(i) }).effects).toEqual([])
})
it('three is a cap, not a seeded minimum or quota; seeds only tie explicitly approved kinds', () => {
  for (let i=0;i<20;i++) {
    const seed = String(i)
    expect(planEffects({ ...context,seed,editorial:[decision('shared')] }).effects.map(e=>e.kind)).toEqual(['shared'])
    const args = { ...context,seed,editorial:['shared','refraction','resonance','depth','rupture'].map(decision) }
    const plan = planEffects(args)
    expect(plan.effects).toHaveLength(3)
    expect(planEffects(args)).toEqual(plan)
    expect(plan.effects.every(e=>args.editorial.some(d=>d.kind===e.kind))).toBe(true)
  }
})
