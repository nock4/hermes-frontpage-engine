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

  it('does not treat negated debug-mark language in a pass rationale as a blocker', async () => {
    const runDir = await mkdtemp(path.join(os.tmpdir(), 'dfe-source-fidelity-negated-debug-'))
    const platePath = path.join(runDir, 'plate.png')
    await writeFile(platePath, 'fake plate')

    const audit = await auditSourceImageFidelity(
      {
        payload: {
          source_image_fingerprints: [{
            title: 'Dash grid panel',
            image_url: 'https://assets.example/dash-grid.jpg',
            preserve_cues: ['centered portrait white panel', 'tiny black dash grid'],
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
          retained_critical_elements: ['small isolated black dash marks embedded as source-window seams'],
          missing_critical_elements: [],
          drift_risks: [],
          forbidden_debug_marks: [],
          rationale: 'No visible numbered badges, callouts, pins, rings, or labels appear.',
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
          transformation_score: 0.65,
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
          transformation_score: 0.65,
          retained_critical_elements: ['uninterrupted pale negative space', 'single centered horizontal wordmark'],
          missing_critical_elements: [],
          drift_risks: ['contact sheet panel is landscape, but generated composition itself preserves the square-minimal source logic'],
          rationale: 'The generated plate transforms the typographic island into a new spatial field. It preserves the source identity rather than replaced by a metaphor scene.',
        }),
      },
    )

    expect(audit.pass).toBe(true)
    expect(audit.blockers).toEqual([])
  })

  it('blocks debug-looking numbered callout badges that leak into the generated plate', async () => {
    const runDir = await mkdtemp(path.join(os.tmpdir(), 'dfe-source-fidelity-numbered-badges-'))
    const platePath = path.join(runDir, 'plate.png')
    await writeFile(platePath, 'fake plate')

    await expect(auditSourceImageFidelity(
      {
        payload: {
          source_image_fingerprints: [
            {
              title: 'Game engine equation banner',
              image_url: 'https://assets.example/banner.jpg',
              preserve_cues: ['wide equation layout', 'OpenAI knot', 'pixel money symbols'],
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
          resemblance_score: 0.93,
          framing_score: 0.9,
          object_relationship_score: 0.88,
          context_score: 0.84,
          transformation_score: 0.82,
          retained_critical_elements: ['wide equation layout', 'OpenAI knot', 'pixel money symbols'],
          missing_critical_elements: [],
          drift_risks: ['plate includes blue circular numbered callout badges 4, 5, 7, and 8 that are not present in the source image'],
          forbidden_debug_marks: ['blue circular numbered badges on source-window marks'],
          rationale: 'Source identity remains legible, but numbered annotation markers make the live plate look like debug chrome rather than image-native apertures.',
        }),
      },
    )).rejects.toThrow(/Source-image fidelity QA failed/)

    const audit = JSON.parse(await readFile(path.join(runDir, 'source-fidelity-audit.json'), 'utf8'))
    expect(audit.pass).toBe(false)
    expect(audit.blockers).toContain('debug-looking numbered source-window marks')
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


describe('source-fidelity overcopy prose boundaries', () => {
  // Exact saved production output; independent of ignored tmp artifacts.
  const savedAudit = {
  "audit_id": "source-fidelity-1792148338763",
  "inspection_mode": "vision-source-plate-contact-sheet",
  "source_image_url": "https://pbs.twimg.com/media/HKVrpjNa8AAJxc_.jpg?name=orig",
  "contact_sheet_path": "tmp/recovery-20261016-landscape/source-plate-contact-sheet.png",
  "verdict": "pass",
  "resemblance_score": 0.88,
  "framing_score": 0.9,
  "object_relationship_score": 0.85,
  "context_score": 0.84,
  "transformation_score": 0.94,
  "retained_critical_elements": [
    "Side-swept brown hair and legible eyes above a vertically erased pink lower face.",
    "Sharp pale-blue collar points contrasted with dissolving facial material.",
    "Red-orange patterned clothing fragments interrupted by blue-violet veiling.",
    "Dark purple ground and translucent bands connecting separated portrait and clothing elements.",
    "Detached white graphic fragment punctuating the lower field."
  ],
  "missing_critical_elements": [
    "The source's tiny comma-like punctuation is replaced by a larger angular white scrap rather than retaining its curved silhouette."
  ],
  "drift_risks": [
    "Folded clothing fragments and the patterned cuff introduce harder, more sculptural material than the source's soft photographic dissolution.",
    "The enlarged head remains aligned above one collar fragment, partially preserving a local bust relationship, but the wider composition decisively breaks the continuous portrait."
  ],
  "forbidden_debug_marks": [],
  "rationale": "The plate borrows specific portrait and clothing features rather than palette alone: swept hair, exposed eyes, pink vertical facial erasure, blue collar points and reddish patterned shoulders remain recognizable. It changes arrangement, scale, fragment count and spatial logic, distributing the former bust across a landscape with substantial dark intervals. The violet veil bridges separated elements without reconstructing the original image. Inspection of the full plate and native lower-edge strip shows irregular torn seams, clothing ornament and solid patterned dots, not identifiable registration targets, crosshairs or hollow target rings with ticks. The white fragment has uneven projecting edges rather than target geometry. This reads as a transformed source-inspired edition, not a recreation.",
  "pass": false,
  "blockers": [
    "anchor copied without edition transformation"
  ]
}

  async function auditResponse(raw) {
    const runDir = await mkdtemp(path.join(os.tmpdir(), 'dfe-fidelity-prose-'))
    const result = auditSourceImageFidelity({
      payload: { source_image_fingerprints: [{ image_url: savedAudit.source_image_url }] },
      platePath: path.join(runDir, 'unused-plate.png'),
    }, runDir, {
      writeJson,
      createContactSheetImpl: async ({ outputPath }) => outputPath,
      openAiJsonImpl: async () => raw,
    })
    return { result, runDir }
  }

  it('accepts the exact saved landscape vision pass without changing inspection evidence', async () => {
    const original = structuredClone(savedAudit)
    const { result } = await auditResponse(savedAudit)
    const audit = await result
    expect(audit.pass).toBe(true)
    expect(audit.blockers).toEqual([])
    expect(audit.transformation_score).toBe(0.94)
    for (const key of ['rationale', 'retained_critical_elements', 'missing_critical_elements', 'drift_risks', 'forbidden_debug_marks']) {
      expect(audit[key]).toEqual(savedAudit[key])
    }
    expect(savedAudit).toEqual(original)
  })

  it.each([
    'The veil bridges elements without reconstructing the original image. Irregular torn seams are visible.',
    'The veil bridges elements without reconstructing the original image; irregular torn seams are visible.',
    'The veil bridges elements without reconstructing the original image! Irregular torn seams are visible.',
    'The veil bridges elements without reconstructing the original image, with irregular torn seams visible.',
    'The plate is not a copy with only tiny seams.',
    'The plate is not without edition-native transformation.',
  ])('does not invert negated overcopy or join independent findings: %s', async (rationale) => {
    const { result } = await auditResponse({ ...savedAudit, drift_risks: [], rationale })
    expect((await result).blockers).toEqual([])
  })

  it('does not join unpunctuated array entries into an absent-seam finding', async () => {
    const { result } = await auditResponse({ ...savedAudit,
      drift_risks: ['The veil bridges elements without reconstructing the original image', 'Irregular torn seams are visible'],
      rationale: 'The source identity is transformed.',
    })
    expect((await result).blockers).toEqual([])
  })

  it('does not let contact-sheet prose swallow a separate affirmative same-field finding', async () => {
    const { result } = await auditResponse({ ...savedAudit, missing_critical_elements: [],
      drift_risks: ['contact sheet panel is landscape, but generated composition itself preserves the square-minimal source logic'],
      rationale: 'The generated plate reads as the same typographic island in the same empty field. It preserves the source framing logic, camera distance, centered placement, and dominant negative space rather than replaced by a metaphor scene.',
    })
    await expect(result).rejects.toThrow(/anchor copied without edition transformation/)
  })

  it.each(['pass', 'warn'])('retains coordinated affirmative absence with %s verdict', async (verdict) => {
    for (const rationale of [
      'The plate is not a copy and has no added seams.',
      'The plate is not a copy, and has no added seams.',
      'The plate is not a copy but has no added seams.',
      'The plate is never a reproduction and has only tiny seams.',
    ]) {
      const { result } = await auditResponse({ ...savedAudit, verdict, missing_critical_elements: [], drift_risks: [], rationale })
      await expect(result).rejects.toThrow(/anchor copied without edition transformation/)
    }
  })

  it.each(['pass', 'warn'])('preserves unpunctuated evidence boundaries with %s verdict', async (verdict) => {
    const { result } = await auditResponse({ ...savedAudit, verdict, missing_critical_elements: [],
      drift_risks: ['The plate is not a copy', 'No added seams'], rationale: 'Recognizable source identity.',
    })
    await expect(result).rejects.toThrow(/anchor copied without edition transformation/)
  })

  it.each(['pass', 'warn'])('does not manufacture copy insufficiency across evidence entries with %s verdict', async (verdict) => {
    const { result } = await auditResponse({ ...savedAudit, verdict, missing_critical_elements: [],
      drift_risks: ['A reproduction appears in the source reference', 'Only the violet palette is retained'], rationale: 'A transformed edition.',
    })
    expect((await result).blockers).toEqual([])
  })

  it.each([
    'The plate is without edition-native transformation.',
    'The plate has no added source-window apertures, cuts, seams, or edition-native transformation.',
    'The plate is without visible transformed source-window marks.',
    'The plate has only tiny seams.',
    'The plate has insufficient transformation.',
    'The plate has no meaningful transformation.',
    'Edition-native transformation is absent.',
    'Visible source-window seams are absent.',
    'The plate is a near-copy with only tiny decorative changes.',
    'The plate is not without recognizable identity, but has no added seams.',
  ])('blocks affirmative absent/insufficient transformation despite high scores: %s', async (rationale) => {
    const { result, runDir } = await auditResponse({ ...savedAudit, drift_risks: [], rationale })
    await expect(result).rejects.toThrow(/anchor copied without edition transformation/)
    const audit = JSON.parse(await readFile(path.join(runDir, 'source-fidelity-audit.json'), 'utf8'))
    expect(audit.pass).toBe(false)
    expect(audit.blockers).toContain('anchor copied without edition transformation')
    expect(audit.transformation_score).toBe(0.94)
  })
})
