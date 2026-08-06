import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { auditSourceImageFidelity } from '../../scripts/lib/source-fidelity-audit.mjs'

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

describe('source image fidelity audit', () => {
  it('fails source-image plates that lose framing and object relationships', async () => {
    const runDir = await mkdtemp(path.join(os.tmpdir(), 'dfe-source-fidelity-fail-'))
    const platePath = path.join(runDir, 'plate.png')
    await writeFile(platePath, 'fake plate')

    await expect(auditSourceImageFidelity(
      {
        payload: {
          source_image_fingerprints: [
            {
              title: 'Billiard room with aircraft',
              image_url: 'https://assets.example/source.jpg',
              preserve_cues: ['full room framing', 'billiard table below green aircraft', 'figures and wall context'],
            },
          ],
        },
        platePath,
      },
      runDir,
      {
        writeJson,
        createContactSheetImpl: async ({ outputPath }) => {
          await writeFile(outputPath, 'fake contact sheet')
          return outputPath
        },
        openAiJsonImpl: async () => ({
          verdict: 'fail',
          resemblance_score: 0.31,
          framing_score: 0.22,
          object_relationship_score: 0.4,
          context_score: 0.1,
          retained_critical_elements: ['green color', 'teal surface'],
          missing_critical_elements: ['room framing', 'figures', 'full billiard table relationship'],
          drift_risks: ['macro texture replacement'],
          rationale: 'The plate shares colors but loses the source composition.',
        }),
      },
    )).rejects.toThrow(/Source-image fidelity QA failed/)

    const audit = JSON.parse(await readFile(path.join(runDir, 'source-fidelity-audit.json'), 'utf8'))
    expect(audit.pass).toBe(false)
    expect(audit.blockers).toContain('vision verdict failed')
    expect(audit.blockers.some((blocker) => blocker.includes('resemblance_score'))).toBe(true)
  })

  it('blocks warning-level light-structure drift without blocking deliberate crop changes alone', async () => {
    const runDir = await mkdtemp(path.join(os.tmpdir(), 'dfe-source-fidelity-warn-block-'))
    const platePath = path.join(runDir, 'plate.png')
    await writeFile(platePath, 'fake plate')

    await expect(auditSourceImageFidelity(
      {
        payload: {
          source_image_fingerprints: [
            {
              title: 'Sky Box',
              image_url: 'https://assets.example/sky-box.jpg',
              preserve_cues: ['square source crop', 'vertical light shafts', 'lower flare nodes', 'horizontal beam'],
            },
          ],
        },
        platePath,
      },
      runDir,
      {
        writeJson,
        createContactSheetImpl: async ({ outputPath }) => {
          await writeFile(outputPath, 'fake contact sheet')
          return outputPath
        },
        openAiJsonImpl: async () => ({
          verdict: 'warn',
          resemblance_score: 0.82,
          framing_score: 0.86,
          object_relationship_score: 0.91,
          context_score: 0.78,
          retained_critical_elements: ['deep blue sky field', 'pale cloud mass'],
          missing_critical_elements: ['vertical light shafts are weakened'],
          drift_risks: ['source becomes a wider landscape atmosphere rather than the same source transformed'],
          rationale: 'It changes the square source framing but keeps source identity; the publication blocker is the lost light structure.',
        }),
      },
    )).rejects.toThrow(/Source-image fidelity QA failed/)

    const audit = JSON.parse(await readFile(path.join(runDir, 'source-fidelity-audit.json'), 'utf8'))
    expect(audit.pass).toBe(false)
    expect(audit.blockers).not.toContain('square source composition drift')
    expect(audit.blockers).toContain('defining light structure lost')
  })

  it('allows recomposed source-inspired plates when borrowed identity remains legible', async () => {
    const runDir = await mkdtemp(path.join(os.tmpdir(), 'dfe-source-fidelity-borrow-pass-'))
    const platePath = path.join(runDir, 'plate.png')
    await writeFile(platePath, 'fake plate')

    const audit = await auditSourceImageFidelity(
      {
        payload: {
          source_image_fingerprints: [{
            title: 'Birthday card on patterned cloth',
            image_url: 'https://assets.example/card.jpg',
            preserve_cues: ['angel outline', 'yellow halo', 'birthday cake', 'teal patterned cloth'],
          }],
        },
        platePath,
      },
      runDir,
      {
        writeJson,
        createContactSheetImpl: async ({ outputPath }) => {
          await writeFile(outputPath, 'fake contact sheet')
          return outputPath
        },
        openAiJsonImpl: async () => ({
          verdict: 'pass',
          resemblance_score: 0.88,
          framing_score: 0.62,
          object_relationship_score: 0.78,
          context_score: 0.72,
          transformation_score: 0.86,
          retained_critical_elements: ['angel silhouette', 'yellow halo', 'cake candles', 'teal looping cloth pattern'],
          missing_critical_elements: ['exact centered card crop'],
          drift_risks: ['crop and scale changed deliberately but source identity remains legible'],
          rationale: 'The plate borrows the source identity while changing crop, scale, surface state, and spatial logic enough to avoid copying.',
        }),
      },
    )

    expect(audit.pass).toBe(true)
    expect(audit.blockers).toEqual([])
  })

  it('does not promote pass-verdict missing-detail notes into source-fidelity blockers', async () => {
    const runDir = await mkdtemp(path.join(os.tmpdir(), 'dfe-source-fidelity-pass-missing-detail-'))
    const platePath = path.join(runDir, 'plate.png')
    await writeFile(platePath, 'fake plate')

    const audit = await auditSourceImageFidelity(
      {
        payload: {
          source_image_fingerprints: [{
            title: 'Interior pool threshold painting',
            image_url: 'https://assets.example/pool-threshold.jpg',
            preserve_cues: ['panoramic left pool/right gray room split', 'three figure masses', 'black perforated foreground mass'],
          }],
        },
        platePath,
      },
      runDir,
      {
        writeJson,
        createContactSheetImpl: async ({ outputPath }) => {
          await writeFile(outputPath, 'fake contact sheet')
          return outputPath
        },
        openAiJsonImpl: async () => ({
          verdict: 'pass',
          resemblance_score: 1,
          framing_score: 1,
          object_relationship_score: 1,
          context_score: 1,
          transformation_score: 1,
          retained_critical_elements: [
            'very wide panoramic crop',
            'left outdoor pool opening against right gray interior wall',
            'two upright back-facing figure masses near doorway',
            'seated side-profile figure cropped at far right',
            'black foreground mass with repeated white oval holes',
          ],
          missing_critical_elements: [
            'small framed picture high on right wall is replaced by a small blue slit, not a nested scene',
            'orange cup and pale plate/disc floor objects are absent',
            'standing figures are ghosted and moved inside the doorway rather than clearly outside',
          ],
          drift_risks: ['floor-object anchors lost near seated figure'],
          rationale: 'The right plate clearly borrows the source panoramic split, pool doorway, gray interior wall, two central upright figures, cropped seated figure, and perforated black foreground mass. The lost floor objects are fidelity wounds, but the source identity remains legible, the transformation is substantial rather than overcopying, and the result is not an unrelated ambience scene.',
        }),
      },
    )

    expect(audit.pass).toBe(true)
    expect(audit.blockers).toEqual([])
  })

  it('does not treat negated overcopy language in a pass rationale as a blocker', async () => {
    const runDir = await mkdtemp(path.join(os.tmpdir(), 'dfe-source-fidelity-negated-overcopy-'))
    const platePath = path.join(runDir, 'plate.png')
    await writeFile(platePath, 'fake plate')

    const audit = await auditSourceImageFidelity(
      {
        payload: {
          source_image_fingerprints: [{
            title: 'Mall poster portrait',
            image_url: 'https://assets.example/mall-poster.jpg',
            preserve_cues: ['white poster border', 'central mall photograph', 'bottom smiley emblem'],
          }],
        },
        platePath,
      },
      runDir,
      {
        writeJson,
        createContactSheetImpl: async ({ outputPath }) => {
          await writeFile(outputPath, 'fake contact sheet')
          return outputPath
        },
        openAiJsonImpl: async () => ({
          verdict: 'pass',
          resemblance_score: 1,
          framing_score: 1,
          object_relationship_score: 1,
          context_score: 1,
          transformation_score: 1,
          retained_critical_elements: ['white poster border', 'central mall photograph', 'bottom smiley emblem'],
          missing_critical_elements: ['tote pattern changes'],
          drift_risks: ['aggressive crop changes the fashion-poster pressure'],
          rationale: 'The plate transforms the source through scale, crop, surface tearing, figure truncation, and graphic abstraction, so it reads as a recomposed Daily Frontpage plate rather than the same still-life photograph with minor edits.',
        }),
      },
    )

    expect(audit.pass).toBe(true)
    expect(audit.blockers).toEqual([])
  })

  it('blocks warnings that admit the plate only shares palette/style', async () => {
    const runDir = await mkdtemp(path.join(os.tmpdir(), 'dfe-source-fidelity-palette-block-'))
    const platePath = path.join(runDir, 'plate.png')
    await writeFile(platePath, 'fake plate')

    await expect(auditSourceImageFidelity(
      {
        payload: {
          source_image_fingerprints: [
            {
              title: 'Abstract source field',
              image_url: 'https://assets.example/abstract.jpg',
              preserve_cues: ['flat source layout', 'central angular swarm', 'lower object vocabulary'],
            },
          ],
        },
        platePath,
      },
      runDir,
      {
        writeJson,
        createContactSheetImpl: async ({ outputPath }) => {
          await writeFile(outputPath, 'fake contact sheet')
          return outputPath
        },
        openAiJsonImpl: async () => ({
          verdict: 'warn',
          resemblance_score: 0.9,
          framing_score: 0.88,
          object_relationship_score: 0.87,
          context_score: 0.84,
          retained_critical_elements: ['peach palette', 'diagonal motion'],
          missing_critical_elements: ['lower object vocabulary reduced'],
          drift_risks: ['reads as related palette rather than the same source transformed'],
          rationale: 'The plate has a similar color field but loses source structure.',
        }),
      },
    )).rejects.toThrow(/Source-image fidelity QA failed/)

    const audit = JSON.parse(await readFile(path.join(runDir, 'source-fidelity-audit.json'), 'utf8'))
    expect(audit.pass).toBe(false)
    expect(audit.blockers).toContain('source generalized into ambience')
  })

  it('passes source-image plates that retain full-frame source structure', async () => {
    const runDir = await mkdtemp(path.join(os.tmpdir(), 'dfe-source-fidelity-pass-'))
    const platePath = path.join(runDir, 'plate.png')
    await writeFile(platePath, 'fake plate')

    const audit = await auditSourceImageFidelity(
      {
        payload: {
          source_image_fingerprints: [
            {
              title: 'Billiard room with aircraft',
              image_url: 'https://assets.example/source.jpg',
              composition_moves: ['wide room framing', 'green aircraft above table'],
            },
          ],
        },
        platePath,
      },
      runDir,
      {
        writeJson,
        createContactSheetImpl: async ({ outputPath }) => {
          await writeFile(outputPath, 'fake contact sheet')
          return outputPath
        },
        openAiJsonImpl: async () => ({
          verdict: 'pass',
          resemblance_score: 0.76,
          framing_score: 0.71,
          object_relationship_score: 0.72,
          context_score: 0.63,
          retained_critical_elements: ['green aircraft over table', 'room walls', 'table perspective'],
          missing_critical_elements: [],
          drift_risks: [],
          rationale: 'The plate is transformed but still reads as the source composition.',
        }),
      },
    )

    expect(audit.pass).toBe(true)
    expect(audit.verdict).toBe('pass')
  })

  it('blocks faithful but literal copies without edition transformation', async () => {
    const runDir = await mkdtemp(path.join(os.tmpdir(), 'dfe-source-fidelity-overcopy-'))
    const platePath = path.join(runDir, 'plate.png')
    await writeFile(platePath, 'fake plate')

    await expect(auditSourceImageFidelity(
      {
        payload: {
          source_image_fingerprints: [{
            title: 'Minimal wordmark cover',
            image_url: 'https://assets.example/wordmark.jpg',
            preserve_cues: ['blank field', 'single centered wordmark'],
          }],
        },
        platePath,
      },
      runDir,
      {
        writeJson,
        createContactSheetImpl: async ({ outputPath }) => {
          await writeFile(outputPath, 'fake contact sheet')
          return outputPath
        },
        openAiJsonImpl: async () => ({
          verdict: 'pass',
          resemblance_score: 1,
          framing_score: 1,
          object_relationship_score: 1,
          context_score: 1,
          transformation_score: 0.1,
          retained_critical_elements: ['same quiet blank field', 'same centered wordmark'],
          missing_critical_elements: [],
          drift_risks: ['no added source-window apertures, cuts, seams, or edition-native transformation'],
          rationale: 'The plate is a near-copy reproduction of the source: same quiet blank field and same wordmark, without visible transformed source-window marks.',
        }),
      },
    )).rejects.toThrow(/Source-image fidelity QA failed/)

    const audit = JSON.parse(await readFile(path.join(runDir, 'source-fidelity-audit.json'), 'utf8'))
    expect(audit.pass).toBe(false)
    expect(audit.blockers).toContain('transformation_score 0.1 < 0.35')
    expect(audit.blockers).toContain('anchor copied without edition transformation')
  })

  it('blocks source-image plates that recreate the same product still life with small edits', async () => {
    const runDir = await mkdtemp(path.join(os.tmpdir(), 'dfe-source-fidelity-still-life-copy-'))
    const platePath = path.join(runDir, 'plate.png')
    await writeFile(platePath, 'fake plate')

    await expect(auditSourceImageFidelity(
      {
        payload: {
          source_image_fingerprints: [{
            title: 'Cloud ceramics',
            image_url: 'https://assets.example/ceramics.jpg',
            preserve_cues: ['three-vase arrangement', 'white plinth', 'cloud motifs and gold lightning'],
          }],
        },
        platePath,
      },
      runDir,
      {
        writeJson,
        createContactSheetImpl: async ({ outputPath }) => {
          await writeFile(outputPath, 'fake contact sheet')
          return outputPath
        },
        openAiJsonImpl: async () => ({
          verdict: 'pass',
          resemblance_score: 1,
          framing_score: 1,
          object_relationship_score: 1,
          context_score: 1,
          transformation_score: 0.62,
          retained_critical_elements: ['same three-vase arrangement', 'same plinth', 'same object positions'],
          missing_critical_elements: [],
          drift_risks: [
            'generated plate is almost identical: same still life, same object positions, same camera distance and plinth, with only a small aperture and subtle seam added',
            'borrowed elements are not enough because the plate remains the same image',
          ],
          rationale: 'The plate recreates the source product photo too literally. It uses the same three-vase arrangement and plinth; the small edits do not change arrangement, scale, object count, crop, surface state, or spatial logic enough.',
        }),
      },
    )).rejects.toThrow(/Source-image fidelity QA failed/)

    const audit = JSON.parse(await readFile(path.join(runDir, 'source-fidelity-audit.json'), 'utf8'))
    expect(audit.pass).toBe(false)
    expect(audit.blockers).toContain('source image recreated instead of borrowed')
  })

  it('does not block a pass verdict for negated replacement language', async () => {
    const runDir = await mkdtemp(path.join(os.tmpdir(), 'dfe-source-fidelity-negated-pass-'))
    const platePath = path.join(runDir, 'plate.png')
    await writeFile(platePath, 'fake plate')

    const audit = await auditSourceImageFidelity(
      {
        payload: {
          source_image_fingerprints: [
            {
              title: 'Verse talks wordmark',
              image_url: 'https://assets.example/wordmark.jpg',
              preserve_cues: ['square minimal source transformation', 'centered wordmark', 'huge blank margins'],
            },
          ],
        },
        platePath,
      },
      runDir,
      {
        writeJson,
        createContactSheetImpl: async ({ outputPath }) => {
          await writeFile(outputPath, 'fake contact sheet')
          return outputPath
        },
        openAiJsonImpl: async () => ({
          verdict: 'pass',
          resemblance_score: 1,
          framing_score: 1,
          object_relationship_score: 1,
          context_score: 1,
          retained_critical_elements: ['uninterrupted pale negative space', 'single centered horizontal wordmark'],
          missing_critical_elements: [],
          drift_risks: ['contact sheet panel is landscape, but generated composition itself preserves the square-minimal source logic'],
          rationale: 'The generated plate reads as the same typographic island in the same empty field. It preserves the source framing logic, camera distance, centered placement, and dominant negative space rather than replaced by a metaphor scene.',
        }),
      },
    )

    expect(audit.pass).toBe(true)
    expect(audit.blockers).toEqual([])
  })

  it('reports skipped source-field mode as not a source-image fidelity pass', async () => {
    const runDir = await mkdtemp(path.join(os.tmpdir(), 'dfe-source-fidelity-skip-'))
    const audit = await auditSourceImageFidelity(
      { payload: {}, platePath: path.join(runDir, 'plate.png') },
      runDir,
      { writeJson },
    )

    expect(audit.pass).toBe(true)
    expect(audit.editorial_pass).toBe(false)
    expect(audit.gate_applicable).toBe(false)
    expect(audit.verdict).toBe('skipped')
    expect(audit.inspection_mode).toBe('skipped-no-valid-dominant-source-image')
    expect(audit.rationale).toContain('not passed')
  })
})
