import { describe, it, expect, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { runFromScratchMode } from '../../scripts/pipeline/run-from-scratch-mode.mjs'
import * as fidelityModule from '../../scripts/lib/source-fidelity-audit.mjs'
import { auditSourceImageFidelity } from '../../scripts/lib/source-fidelity-audit.mjs'
// Synthetic planner/network isolation. Audit normalization and orchestration real.
vi.mock('../../scripts/lib/real-mark-plan.mjs', () => ({ planRealMarks: async ({ payload }) => payload }))
const base = new URL('../fixtures/transformation-contract-nov5/', import.meta.url)
const contract = JSON.parse(await fs.readFile(new URL('source-contract.json', base), 'utf8'))
const oldAudit = JSON.parse(await fs.readFile(new URL('source-fidelity-audit.json', base), 'utf8'))
// Read-only baseline experiment is opt-in, test-only, and never a production bypass.
const auditImplementation = process.env.DFE_TRANSFORMATION_TEST_BASELINE
  ? (await import(process.env.DFE_TRANSFORMATION_TEST_BASELINE)).auditSourceImageFidelity
  : auditSourceImageFidelity
describe('production fidelity stage before mapping/publication (synthetic injected responses)', () => {
  it('allows retained local source bytes through the same production contact-sheet builder', async () => {
    expect(typeof fidelityModule.createSourcePlateContactSheet).toBe('function')
    let args
    const result = await fidelityModule.createSourcePlateContactSheet({ sourceImageUrl: '/retained-source.jpg', platePath: '/retained-plate.png', outputPath: path.join(os.tmpdir(), 'synthetic-sheet.png'), runCommand: async request => { args = request.args } })
    expect(args).toEqual(['/retained-source.jpg', '/retained-plate.png', result])
  })
  it.each(['legacy-pass', 'failed', 'fulfilled'])('gates %s through the actual audit normalizer and stage throw', async scenario => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dfe-transform-stage-'))
    const platePath = path.join(root, 'synthetic-plate.png')
    await sharp({ create: { width: 20, height: 10, channels: 3, background: '#abc' } }).png().toFile(platePath)
    const mapping = vi.fn(async () => { throw new Error('SYNTHETIC STOP AT MAPPING') })
    const assemble = vi.fn()
    const previous = process.env.DFE_SOURCE_FIDELITY_AUTO_RECOVERY
    process.env.DFE_SOURCE_FIDELITY_AUTO_RECOVERY = '0'
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    try {
      const run = runFromScratchMode({ root, fs,
        options: { generationName: 'synthetic', date: '2026-11-06', useSampleSignals: true, inputMode: 'manifest', skipMask: true, imageSize: '1536x1024' },
        requireOpenAiKey: () => ({ loaded: {} }), chooseDiversityDirective: () => '',
        mineSignals: async () => ({ notes_selected: [], source_candidates: [] }), inspectSourceCandidates: async () => ({}),
        composeDailyPayload: async () => ({ artifacts: [], source_image_mode: 'dominant-source-image', source_image_fingerprints: [{ image_url: contract.dominant_source_image_url, composition_moves: contract.must_transform.slice(3), visual_summary: 'Copper-haired figure with blush drapery and cascade.' }] }),
        imageAspectRatioFromSize: () => 'landscape', generateScenePlate: async () => ({ outputPath: platePath }),
        auditSourceImageFidelity: (args, runDir) => auditImplementation(args, runDir, {
          writeJson: (file, value) => fs.writeFile(file, JSON.stringify(value)), createContactSheetImpl: async () => {},
          openAiJsonImpl: async request => {
            if (scenario === 'legacy-pass') return oldAudit
            const prompt = JSON.parse(request.input[0].content[0].text)
            return { ...oldAudit, drift_risks: [], rationale: 'Recognizable source material in a changed arrangement.', transformation_context_id: prompt.transformation_context_id,
              transformation_findings: prompt.required_transformations.map(clause => ({ ...clause, status: scenario, visible_evidence: 'SYNTHETIC: continuous cloth at right, cascade at left.', context: 'SYNTHETIC: a shared scene remains.', reason: 'SYNTHETIC: exact-clause test status.' })) }
          },
        }),
        inspectGeneratedPlate: mapping, assembleEditionPackage: assemble,
        runInternal: async (step, command, run) => { if (step.name !== 'Prepare source audio material') return run() },
      })
      await expect(run).rejects.toThrow(scenario === 'fulfilled' ? /STOP AT MAPPING/ : /mandatory transformation/)
      expect(mapping).toHaveBeenCalledTimes(scenario === 'fulfilled' ? 1 : 0)
      expect(assemble).not.toHaveBeenCalled()
    } finally {
      log.mockRestore()
      if (previous === undefined) delete process.env.DFE_SOURCE_FIDELITY_AUTO_RECOVERY
      else process.env.DFE_SOURCE_FIDELITY_AUTO_RECOVERY = previous
    }
  })
})
