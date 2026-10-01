import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../scripts/lib/creative-artifact-inspection.mjs', () => ({
  inspectCreativeArtifacts: async (sources, research) => {
    const { inspectedDecision } = await import('../fixtures/creative-inspection.mjs')
    const attempted = new Set((research?.source_decisions || []).filter(row => row.inspection).map(row => row.url))
    const batch = sources.filter(source => !attempted.has(source.url)).slice(0, state.batchSize)
    state.inspections.push(batch.map(source => source.url))
    return { ...research, source_decisions: [...(research?.source_decisions || []), ...batch.map(source => inspectedDecision(source))] }
  },
}))

const state = vi.hoisted(() => ({ materials: [], reference: null, analyzer: vi.fn(), batchSize: Infinity, inspections: [], followAnchor: false }))
vi.mock('../../scripts/lib/source-inspection.mjs', () => ({
  inspectCandidateSource: async (source) => source,
  findVisualReference: async () => state.reference,
}))
vi.mock('../../scripts/lib/anchor-source-research.mjs', async (importOriginal) => ({
  ...await importOriginal(),
  selectAnchorSource: ((original) => (...args) => state.noAnchor ? null : original.selectAnchorSource(...args))(await importOriginal()),
  buildAnchorResearch: async (anchor) => ({ anchor_source: anchor, anchor_research: { summary: 'Painting study', thesis: 'Color and gesture' } }),
  discoverDerivedSourceCandidates: async () => [],
  discoverImageSourceMaterial: async ({ anchor_source: anchor }) => {
    const materials = state.followAnchor ? [{ title: anchor.title, page_url: anchor.url, image_url: anchor.image_url }] : state.materials
    return { image_source_candidates: materials, selected_image_material: materials }
  },
}))
vi.mock('../../scripts/lib/openai-json.mjs', () => ({ openAiJson: (...args) => state.analyzer(...args) }))
vi.mock('../../scripts/lib/source-image-geometry.mjs', async (importOriginal) => ({
  ...await importOriginal(), measureSourceImage: async () => ({ width: 800, height: 600 }),
}))

import { inspectSourceCandidates } from '../../scripts/lib/source-research.mjs'
import { canonicalizeSourceUrl } from '../../scripts/lib/source-url-policy.mjs'

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
  state.batchSize = Infinity
  state.inspections = []
  state.followAnchor = false
  state.noAnchor = false
  state.analyzer.mockReset()
})
afterEach(async () => {
  vi.unstubAllEnvs()
  await fs.rm(runDir, { recursive: true, force: true })
})
const inspect = (options = {}, candidates = sources) => inspectSourceCandidates({ source_candidates: candidates, notes_selected: [], motif_terms: [] }, {
  maxSources: candidates.length, runDir, sourceTool: 'fetch', date: '2026-09-30', ...options,
})

describe('source research vision boundary', () => {
  it('tries a verified field alternate after the first promotion fails fertility and rebuilds a missing anchor', async () => {
    state.noAnchor = true
    state.materials = []
    const seen = []
    state.analyzer.mockImplementation(async ({ instructions, input }) => {
      if (instructions.includes('source-research editor')) return { source_decisions: [], selected_content_urls: [] }
      seen.push(input)
      return seen.length === 1 ? { ...fertile, visual_fertility: 'low' } : fertile
    })
    const result = await inspect()
    expect(seen).toHaveLength(2)
    expect(result.selected_image_material[0].image_url).not.toBe(material.image_url)
    expect(result.source_image_mode).toBe('dominant-source-image')
    expect(result.anchor_research.anchor_source.image_url).toBe(result.selected_image_material[0].image_url)
    expect(result.source_decision_audit.status).toBe('ok')
    expect(result.source_image_fingerprints[0].preserve_cues).toEqual(fertile.preserve_cues)
    const images = JSON.parse(await fs.readFile(path.join(runDir, 'image-source-material.json'), 'utf8'))
    expect(images.rejected_image_fingerprints[0].image_url).toBe(material.image_url)
    expect(images.alternate_visual_anchor_attempts).toHaveLength(1)
    expect(images.alternate_visual_anchor_attempts[0].status).toBe('accepted')
  })

  it('bounds fertility fallback to three distinct alternate images and keeps missing-anchor failure closed', async () => {
    state.noAnchor = true
    state.materials = []
    let visions = 0
    state.analyzer.mockImplementation(async ({ instructions }) => {
      if (instructions.includes('source-research editor')) return { source_decisions: [], selected_content_urls: [] }
      visions++
      return { ...fertile, visual_fertility: 'low' }
    })
    await expect(inspect()).rejects.toThrow('missing_anchor_source')
    expect(visions).toBe(4)
    const images = JSON.parse(await fs.readFile(path.join(runDir, 'image-source-material.json'), 'utf8'))
    expect(images.alternate_visual_anchor_attempts).toHaveLength(3)
    expect(new Set(images.rejected_image_fingerprints.map(row => row.image_url)).size).toBe(4)
    expect(images.selected_image_material).toEqual([])
    expect(images.promoted_visual_anchor).toBeNull()
  })

  it('can nominate verified music material with a needs-review text score without weakening the final gate', async () => {
    state.noAnchor = true
    state.materials = []
    const music = sources.map((source, index) => ({ ...source,
      url: `https://label${index}.bandcamp.com/track/record`, title: `Record ${index}`, note_title: `Record ${index}`,
      image_url: `https://cdn.example/record${index}.jpg`,
    }))
    state.reference = music[0]
    state.analyzer.mockResolvedValueOnce({ ...fertile, visual_fertility: 'low' }).mockResolvedValue(fertile)
    const result = await inspect({}, music)
    expect(result.source_decision_audit.decisions[0].decision).toBe('needs_review')
    expect(result.source_decision_audit.status).toBe('ok')
    expect(result.selected_image_material[0].image_url).toBe(music[1].image_url)
  })

  it('does not replace an exact override with a fertile field alternate', async () => {
    state.analyzer.mockResolvedValue({ ...fertile, visual_fertility: 'low' })
    await expect(inspect({ inspirationOverride: { source_url: sources[0].url, prompt_bias_terms: ['exact-anchor'] } }))
      .rejects.toThrow(/exact_anchor_material_blocked/)
    expect(state.analyzer).toHaveBeenCalledTimes(1)
    const images = JSON.parse(await fs.readFile(path.join(runDir, 'image-source-material.json'), 'utf8'))
    expect(images.alternate_visual_anchor_attempts).toBeUndefined()
  })

  it('does not spend alternate attempts on unverified content', async () => {
    state.batchSize = 0
    state.materials = []
    state.analyzer.mockResolvedValue({ ...fertile, visual_fertility: 'low' })
    await expect(inspect()).rejects.toThrow('insufficient_eligible_source_media')
    const images = JSON.parse(await fs.readFile(path.join(runDir, 'image-source-material.json'), 'utf8'))
    expect(images.alternate_visual_anchor_attempts).toEqual([])
  })

  it('keeps alternate vision failure blocking with the failed fingerprint saved', async () => {
    state.materials = []
    state.analyzer.mockResolvedValueOnce({ ...fertile, visual_fertility: 'low' })
      .mockRejectedValue(new Error('alternate vision unavailable'))
    await expect(inspect()).rejects.toThrow(/vision.*before image generation/)
    expect(state.analyzer).toHaveBeenCalledTimes(2)
    const evidence = JSON.parse(await fs.readFile(path.join(runDir, 'source-image-fingerprints.json'), 'utf8'))
    expect(evidence.fingerprints[0].vision_error).toContain('alternate vision unavailable')
  })

  it('skips spent image aliases, editorial exclusions, and duplicate images before the bounded vision budget', async () => {
    state.materials = []
    state.noAnchor = true
    const extras = Array.from({ length: 6 }, (_, index) => ({
      ...sources[0], url: `https://extra${index}.example/work`, note_id: `extra-${index}`,
      image_url: `https://extra${index}.example/work.jpg`, title: `Painting extra ${index}`,
    }))
    const candidates = [
      sources[0],
      { ...sources[1], image_url: sources[0].image_url },
      sources[2],
      { ...sources[3], title: 'AI agent workflow tutorial' },
      { ...sources[4], autoresearch_role: 'supporting-only' },
      ...extras,
    ]
    let visions = 0
    state.analyzer.mockImplementation(async ({ instructions }) => {
      if (instructions.includes('source-research editor')) return { source_decisions: [{ url: sources[4].url, role: 'reject' }], selected_content_urls: [] }
      visions++
      return { ...fertile, visual_fertility: 'low' }
    })
    await expect(inspect({ recentSourceKeys: new Set([canonicalizeSourceUrl(sources[2].image_url)]) }, candidates)).rejects.toThrow('missing_anchor_source')
    expect(visions).toBe(4)
    const images = JSON.parse(await fs.readFile(path.join(runDir, 'image-source-material.json'), 'utf8'))
    const attempts = images.alternate_visual_anchor_attempts
    expect(attempts).toHaveLength(3)
    expect(attempts.filter(row => !extras.some(source => source.image_url === row.image_url))).toEqual([])
  })

  it('refills already-renderable evidence and rebuilds an excluded automatic anchor before vision', async () => {
    state.batchSize = 2
    state.followAnchor = true
    state.reference = null
    state.analyzer.mockImplementation(async ({ instructions }) => instructions.includes('source-research editor')
      ? { source_decisions: [{ url: sources[0].url, role: 'reject' }], selected_content_urls: [] }
      : fertile)
    const extra = { ...sources[5], url: 'https://artist6.example/work', image_url: 'https://artist6.example/work.jpg', note_id: 'note-6' }
    const candidates = [...sources, extra].map(source => ({ ...source, source_channel: 'twitter-bookmark' }))
    const result = await inspectSourceCandidates({ source_candidates: candidates, notes_selected: [], motif_terms: [] }, {
      maxSources: 7, runDir, sourceTool: 'fetch', date: '2026-09-30',
    })
    expect(result.content_source_count).toBe(6)
    expect(state.inspections.filter(batch => batch.length)).toHaveLength(4)
    const replacement = result.anchor_research.anchor_source
    expect(replacement.url).not.toBe(sources[0].url)
    expect(result.content_sources.map(source => source.url)).toContain(replacement.url)
    for (const filename of ['anchor-research.json', 'image-source-material.json', 'source-image-fingerprints.json']) {
      const artifact = await fs.readFile(path.join(runDir, filename), 'utf8')
      expect(artifact).toContain(replacement.image_url)
      expect(artifact).not.toContain(sources[0].image_url)
    }
    expect(result.selected_image_material[0].page_url).toBe(replacement.url)
    expect(result.source_image_fingerprints[0].image_url).toBe(replacement.image_url)
  })

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
