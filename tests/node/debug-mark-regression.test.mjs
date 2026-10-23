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
describe('debug prose boundaries', () => {
  it('does not interpret colored erasure and overlapping figures as a pin', async () => {
    const { error, audit } = await probe({ ...good, rationale: 'The plate retains specific facial anatomy, hair silhouettes, sleeve geometry and colored erasure edges—not merely the palette. It replaces stacked overlapping figures with unequal separated fragments across a wide coral field, dramatically changes their relative scale, and relocates the erasure into a single dominant band with a lateral cream extension. These are substantial compositional changes without loss of recognizable source identity. Inspection of the complete overview and a separate native-pixel lower-edge crop shows irregular paint scratches and grain, with no visible target rings, crosshairs, calibration ticks or hotspot outlines.' })
    expect(error).toBeUndefined()
    expect(audit.pass).toBe(true)
    expect(audit.blockers).toEqual([])
  })
  it.each([
    'Inspection shows overlapping paint and pinhole seams.',
    'Blue paint fills the field. Numbered fragments describe the source.',
    'No blue numbered badges are visible.',
    'Without colored callout pins, the plate retains source identity.',
  ])('allows non-findings: %s', async (rationale) => {
    const { error, audit } = await probe({ ...good, rationale })
    expect(error).toBeUndefined()
    expect(audit.pass).toBe(true)
  })
  it.each([
    'Blue circular numbered badges 4 and 5 remain visible.',
    'Colored callout pins remain visible.',
    'No target rings are visible, but blue numbered badges remain.',
    'No blue badges are visible; colored callout pins remain.',
    'No target rings are visible and blue numbered badges remain.',
    'No target rings are visible, blue numbered badges remain.',
    'Minor blue numbered badges remain visible.',
    'No loss of source identity occurs with blue numbered badges visible.',
    'Blue numbered badges remain visible despite absent grain.',
    'Blue numbered badges are not present in the source image.',
  ])('preserves affirmative findings: %s', async (rationale) => {
    const { error, audit } = await probe({ ...good, rationale })
    expect(error).toBeTruthy()
    expect(audit.blockers).toContain('debug-looking numbered source-window marks')
  })
  it('does not join independent fields into a debug finding', async () => {
    const { error, audit } = await probe({ ...good, drift_risks: ['Blue paint is brighter'], rationale: 'Numbered fragments describe the source.' })
    expect(error).toBeUndefined()
    expect(audit.pass).toBe(true)
  })
})

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
