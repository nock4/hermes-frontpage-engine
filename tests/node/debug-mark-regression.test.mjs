import { mkdtemp, writeFile, readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, it, expect } from 'vitest'
import { buildSceneImagePrompt } from '../../scripts/lib/scene-generation.mjs'
import { auditSourceImageFidelity } from '../../scripts/lib/source-fidelity-audit.mjs'

const payload = { source_image_fingerprints: [{ title: 'Photographic emulsion', image_url: 'https://example.com/source.png' }] }
const good = { verdict: 'pass', resemblance_score: 0.9, framing_score: 0.9, object_relationship_score: 0.9, context_score: 0.9, transformation_score: 0.9, forbidden_debug_marks: [], rationale: 'Source identity retained with structural transformation.' }
async function probe(raw, inspect = () => {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'debug-mark-regression-'))
  let error
  try {
    await auditSourceImageFidelity({ payload, platePath: path.join(dir, 'plate.png') }, dir, {
      writeJson: (p, v) => writeFile(p, JSON.stringify(v)),
      createContactSheetImpl: async ({ outputPath }) => outputPath,
      openAiJsonImpl: async (request) => { inspect(request); return raw },
    })
  } catch (e) { error = e }
  return { error, audit: JSON.parse(await readFile(path.join(dir, 'source-fidelity-audit.json'), 'utf8')) }
}
describe('unnumbered registration marks', () => {
  it('bans numbered and unnumbered crosshairs in generation, including edge pinholes', () => {
    const prompt = buildSceneImagePrompt(payload)
    expect(prompt).toMatch(/numbered or unnumbered/i)
    expect(prompt).toMatch(/registration targets/i)
    expect(prompt).toMatch(/crosshairs/i)
    expect(prompt).toMatch(/reticles/i)
    expect(prompt).toMatch(/pinhole/i)
  })
  it('requires full-resolution lower-edge inspection and explicit registration rejection', async () => {
    let prompt
    await probe(good, (r) => { prompt = JSON.parse(r.input[0].content[0].text) })
    expect(prompt.rules.join(' ')).toMatch(/full-resolution lower edge/i)
    expect(prompt.rules.join(' ')).toMatch(/registration targets/i)
    expect(prompt.rules.join(' ')).toMatch(/return fail/i)
    expect(prompt.output_shape.forbidden_debug_marks[0]).toMatch(/unnumbered/i)
  })
  it.each(['minor white hollow ring intersected by a vertical tick at the bottom seam', 'unnumbered registration target', 'small reticle', 'crosshair'])('blocks reported forbidden mark despite high scores and pass: %s', async (mark) => {
    const { error, audit } = await probe({ ...good, forbidden_debug_marks: [mark] })
    expect(error).toBeTruthy()
    expect(audit.pass).toBe(false)
    expect(audit.blockers).toContain('forbidden generated debug marks')
  })
  it('allows a clean transformed plate with no reported forbidden marks', async () => {
    const { error, audit } = await probe(good)
    expect(error).toBeUndefined()
    expect(audit.pass).toBe(true)
  })
})
