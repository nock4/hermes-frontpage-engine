import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../scripts/lib/creative-artifact-inspection.mjs', () => ({
  inspectCreativeArtifacts: async (sources, research) => {
    const { inspectedDecision } = await import('../fixtures/creative-inspection.mjs')
    return { ...research, source_decisions: [...(research?.source_decisions || []), ...sources.map(source => inspectedDecision(source))] }
  },
}))

const state = vi.hoisted(() => ({ materials: [], reference: null, analyzer: vi.fn() }))
vi.mock('../../scripts/lib/source-inspection.mjs', () => ({
  inspectCandidateSource: async (source) => source,
  findVisualReference: async () => state.reference,
}))
vi.mock('../../scripts/lib/anchor-source-research.mjs', async (importOriginal) => ({
  ...await importOriginal(),
  buildAnchorResearch: async (anchor) => ({ anchor_source: anchor, anchor_research: { summary: 'Painting study', thesis: 'Color and gesture' } }),
  discoverDerivedSourceCandidates: async () => [],
  discoverImageSourceMaterial: async () => ({ image_source_candidates: state.materials, selected_image_material: state.materials }),
}))
vi.mock('../../scripts/lib/openai-json.mjs', () => ({ openAiJson: (...args) => state.analyzer(...args) }))
vi.mock('../../scripts/lib/source-image-geometry.mjs', async (importOriginal) => ({
  ...await importOriginal(), measureSourceImage: async () => ({ width: 800, height: 600 }),
}))

import { inspectSourceCandidates } from '../../scripts/lib/source-research.mjs'

const sources = Array.from({ length: 6 }, (_, index) => ({
  url: `https://artist${index}.example/work`, title: `Painting ${index}`,
  note_id: `note-${index}`, note_title: `Painting ${index}`, note_score: 50,
  image_url: `https://artist${index}.example/work.jpg`, source_channel: 'web', fetch_status: 'fetch-ok',
}))
const material = { title: 'Painting study', page_url: sources[0].url, image_url: sources[0].image_url }
const fertile = { visual_summary: 'Red figure and blue room in an oil painting', preserve_cues: ['red figure', 'blue room'], visual_fertility: 'high' }
let runDir
beforeEach(async () => {
  runDir = await fs.mkdtemp(path.join(os.tmpdir(), 'frontpage-vision-gate-'))
  vi.stubEnv('DFE_SINGLE_ANCHOR_RESEARCH', '1')
  vi.stubEnv('DFE_DECISION_MODEL', 'openai')
  state.materials = [material]
  state.reference = { ...sources[0], page_url: material.page_url }
  state.analyzer.mockReset()
})
afterEach(async () => {
  vi.unstubAllEnvs()
  await fs.rm(runDir, { recursive: true, force: true })
})
const inspect = () => inspectSourceCandidates({ source_candidates: sources, notes_selected: [] }, {
  maxSources: 6, runDir, sourceTool: 'fetch', date: '2026-09-30',
})

describe('source research vision boundary', () => {
  it('stops before returning generation input and preserves malformed-vision evidence', async () => {
    state.analyzer.mockRejectedValue(new Error('Malformed JSON from vision'))
    await expect(inspect()).rejects.toThrow(/vision.*before image generation/)
    const evidence = JSON.parse(await fs.readFile(path.join(runDir, 'source-image-fingerprints.json'), 'utf8'))
    expect(evidence.fingerprints[0].vision_error).toContain('Malformed JSON')
    await expect(fs.access(path.join(runDir, 'source-research.json'))).rejects.toThrow()
  })

  it('uses a verified alternate, writes aligned artifacts, and never fingerprints the promotion twice', async () => {
    state.materials = [material, { title: 'Second painting', page_url: sources[1].url, image_url: sources[1].image_url }]
    state.analyzer.mockRejectedValueOnce(new Error('Malformed JSON')).mockResolvedValueOnce(fertile)
    const result = await inspect()
    expect(result.source_image_mode).toBe('dominant-source-image')
    expect(result.selected_image_material.map((entry) => entry.image_url)).toEqual([sources[1].image_url])
    expect(result.source_image_fingerprints.map((entry) => entry.image_url)).toEqual([sources[1].image_url])
    expect(result.visual_reference.image_url).toBe(sources[1].image_url)
    expect(state.analyzer).toHaveBeenCalledTimes(2)
    const saved = JSON.parse(await fs.readFile(path.join(runDir, 'source-research.json'), 'utf8'))
    expect(saved.source_image_fingerprints[0].preserve_cues).toEqual(fertile.preserve_cues)
    const images = JSON.parse(await fs.readFile(path.join(runDir, 'image-source-material.json'), 'utf8'))
    expect(images.rejected_image_fingerprints[0].vision_error).toContain('Malformed JSON')
  })

  it('clears a proposed promotion rejected by vision from both verdict and visual-reference fallback', async () => {
    state.materials = []
    state.analyzer.mockResolvedValue({ visual_summary: 'Developer-documentation page', preserve_cues: ['flat text column'], visual_fertility: 'low' })
    const result = await inspect()
    expect(result.source_image_mode).toBe('skipped-no-valid-dominant-source-image')
    expect(result.source_material_relationship).toBeNull()
    expect(result.source_material_verdict.promoted_visual_anchor).toBeNull()
    expect(result.visual_reference).toBeNull()
    expect(result.selected_image_material).toEqual([])
    expect(result.source_image_fingerprints).toEqual([])
  })
})
