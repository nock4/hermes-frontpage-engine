import { describe, expect, it } from 'vitest'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { buildSceneImagePrompt } from '../../scripts/lib/scene-generation.mjs'
import { buildSourceContract } from '../../scripts/lib/source-contract.mjs'
import { buildSourceFidelityRecoveryPayload } from '../../scripts/pipeline/run-from-scratch-mode.mjs'
import { openAiJson } from '../../scripts/lib/openai-json.mjs'
import { auditSourceImageFidelity } from '../../scripts/lib/source-fidelity-audit.mjs'

const fingerprint = {
  image_url: 'https://example.com/shore.jpg', title: 'Painted shore', width: 900, height: 1200,
  visual_summary: 'Two landscape artworks stacked across a horizontal seam.',
  preserve_cues: ['Pale birch shafts and dark water reflections.', 'Irregular green banks and cobalt water.'],
  surface_cues: ['Soft woodland silhouettes and threadlike grasses'],
  palette_cues: ['Cobalt water and lavender reflections'],
  composition_moves: ['Replace the stacked pair with one discontinuous shore and planted islands.', 'Bring cobalt and lavender waters into one connected negative-space channel.'],
}
const payload = {
  source_image_fingerprints: [fingerprint],
  scene_prompt: 'Build a torn poster wall with curled print lips.',
  plate_posture: { plate_posture: 'poster wall' },
  visual_direction: { composition_archetype: 'torn poster wall', camera_plate_grammar: 'lifted print edges casting shadows', visual_compositional_moves: ['curl paper edges'] },
  effect_direction: { prompt_sentence: 'Use lifted image lips.', source_window_mark_types: ['curled print lips'], surface_language: ['pasted print'] },
  material_language: ['pasted print'], lighting: 'cast shadows from print lips',
}

describe('connected source-space fidelity regression', () => {
  it('subordinates poster posture and all effect surfaces to the measured source continuity', () => {
    const contract = buildSourceContract({ sourceImageFingerprints: [fingerprint], visualDirection: payload.visual_direction })
    expect(contract.must_transform).toContain(fingerprint.composition_moves[1])
    const prompt = buildSceneImagePrompt({ ...payload, source_contract: contract })
    expect(prompt).toContain(fingerprint.composition_moves[1])
    expect(prompt).not.toMatch(/torn poster wall|curled print lips|lifted image lips|pasted print|repaired tears/i)
    expect(prompt).toMatch(/6–9 source windows/)
    expect(prompt).toContain('900x1200')
  })
  it('retains complete recovery diagnostics and source moves instead of clipping away negation', () => {
    const missing = 'A connected landscape space: overlapping, visibly curled picture edges must not divide the open water into panels.'
    const risk = 'Framed-panel conversion: cream paper edges, curled corners and overlap shadows replace a continuous shoreline.'
    const recovery = buildSourceFidelityRecoveryPayload(payload, { missing_critical_elements: [missing], drift_risks: [risk] })
    const prompt = buildSceneImagePrompt(recovery)
    expect(prompt).toContain(missing)
    expect(prompt).toContain(risk)
    expect(prompt).toContain(fingerprint.composition_moves[1])
  })
})

it('preserves malformed provider output on the real JSON adapter error', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'fidelity-adapter-'))
  const bin = path.join(dir, 'fake-hermes')
  const raw = '{"context_score": sixty,"drift_risks":["Panel conversion."]}'
  await writeFile(bin, `#!/usr/bin/env node\nconsole.log(${JSON.stringify(raw)})\n`, { mode: 0o700 })
  const previous = process.env.HERMES_BIN
  process.env.HERMES_BIN = bin
  try {
    await expect(openAiJson({ input: 'test', timeoutMs: 5000 })).rejects.toMatchObject({ rawResponse: raw })
  } finally {
    if (previous === undefined) delete process.env.HERMES_BIN
    else process.env.HERMES_BIN = previous
  }
})

for (const invalidScore of ['sixty', '0.85', null, undefined, -1, 85]) {
  it(`rejects invalid score ${String(invalidScore)} without coercion or invented defaults`, async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'fidelity-score-'))
    await expect(auditSourceImageFidelity({ payload, platePath: '/unused' }, dir, {
      writeJson: (file, value) => writeFile(file, JSON.stringify(value)),
      createContactSheetImpl: async () => {},
      openAiJsonImpl: async () => ({ verdict: 'pass', resemblance_score: 0.85, framing_score: 0.85, object_relationship_score: 0.85, context_score: 0.85, transformation_score: invalidScore }),
    })).rejects.toThrow(/invalid transformation_score/)
    const audit = JSON.parse(await readFile(path.join(dir, 'source-fidelity-audit.json'), 'utf8'))
    expect(audit.transformation_score).toBe(null)
    expect(audit.pass).toBe(false)
  })
}

for (const malformed of [true, false]) {
  it(`fails closed with usable diagnostics for ${malformed ? 'invalid JSON numeric words' : 'out-of-range scores'}`, async () => {
    const runDir = await mkdtemp(path.join(os.tmpdir(), 'fidelity-contract-'))
    const response = '{"verdict":"pass","resemblance_score":85,"framing_score":85,"object_relationship_score":85,"context_score": sixty,"transformation_score":58,"missing_critical_elements":["Connected water is missing."],"drift_risks":["Torn panels divide the shoreline."],"rationale":"Panel conversion blocks publication."}'
    await expect(auditSourceImageFidelity({ payload, platePath: '/unused' }, runDir, {
      writeJson: (file, value) => writeFile(file, JSON.stringify(value)),
      createContactSheetImpl: async () => {},
      openAiJsonImpl: async () => {
        if (malformed) throw Object.assign(new Error('Expected JSON from hermes'), { rawResponse: response })
        return JSON.parse(response.replace('sixty', '60'))
      },
    })).rejects.toThrow(/Source-image fidelity QA failed/)
    const audit = JSON.parse(await readFile(path.join(runDir, 'source-fidelity-audit.json'), 'utf8'))
    expect(audit.pass).toBe(false)
    expect(audit.missing_critical_elements).toContain('Connected water is missing.')
    expect(audit.drift_risks).toContain('Torn panels divide the shoreline.')
    if (malformed) expect(audit.raw_response).toBe(response)
    expect(audit.resemblance_score ?? null).toBe(null)
  })
}
