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

  it('skips when no source image fingerprint is attached', async () => {
    const runDir = await mkdtemp(path.join(os.tmpdir(), 'dfe-source-fidelity-skip-'))
    const audit = await auditSourceImageFidelity(
      { payload: {}, platePath: path.join(runDir, 'plate.png') },
      runDir,
      { writeJson },
    )

    expect(audit.pass).toBe(true)
    expect(audit.inspection_mode).toBe('skipped-no-source-image')
  })
})
