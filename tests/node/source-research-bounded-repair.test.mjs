import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ attempts: [], captures: [], rejectAnchor: false, verifiedFrom: 18 }))
vi.mock('../../scripts/lib/source-inspection.mjs', () => ({
  inspectCandidateSource: async (source, options) => { state.captures.push({ url: source.url, tool: options.sourceTool }); return source },
  findVisualReference: async () => null,
}))
vi.mock('../../scripts/lib/anchor-source-research.mjs', async (original) => ({
  ...await original(),
  buildAnchorResearch: async (anchor) => ({ anchor_source: anchor, anchor_research: { summary: anchor.title, thesis: anchor.title } }),
  discoverDerivedSourceCandidates: async () => [],
  discoverImageSourceMaterial: async (research) => {
    const anchor = research.anchor_source
    const materials = [{ title: anchor.title, page_url: anchor.url, image_url: anchor.image_url, lineage: 'primary_anchor_image' }]
    return { image_source_candidates: materials, selected_image_material: materials }
  },
}))
vi.mock('../../scripts/lib/source-image-network-policy.mjs', async (original) => ({
  ...await original(),
  resolveFetchableImageUrl: async url => url,
  fetchVettedRemoteUrl: async () => new Response(Buffer.from('synthetic test pixels'), { headers: { 'content-type': 'image/png' } }),
}))
vi.mock('../../scripts/lib/source-image-geometry.mjs', async (original) => ({
  ...await original(), measureSourceImage: async () => ({ width: 800, height: 600 }),
}))
vi.mock('../../scripts/lib/openai-json.mjs', () => ({
  openAiJson: async ({ instructions, input }) => {
    if (instructions.startsWith('Inspect the attached actual source pixels')) {
      const source = JSON.parse(input[0].content[0].text)
      state.attempts.push(source.url)
      return { status: Number(source.title.split(' ').at(-1)) >= state.verifiedFrom ? 'verified' : 'ambiguous', artifact_kind: 'artwork', confidence: 'high', observation: 'Synthetic fixture: red painted figures' }
    }
    if (instructions.includes('source-research editor')) return { source_decisions: state.rejectAnchor ? [{ url: sources[0].url, role: 'reject' }] : [], selected_content_urls: [] }
    return { visual_summary: 'Red figure and blue room in an oil painting', preserve_cues: ['red figure', 'blue room'], visual_fertility: 'high' }
  },
}))
import { inspectSourceCandidates } from '../../scripts/lib/source-research.mjs'
import { sourceContentKey } from '../../scripts/lib/source-selection-policy.mjs'
const sources = Array.from({ length: 24 }, (_, i) => ({
  url: `https://artist${i}.gallery.example/work`, image_url: `https://artist${i}.gallery.example/work.png`,
  title: `Painting ${i}`, note_title: `Painting ${i}`, note_id: `note-${i}`, note_score: 100 - i,
  source_channel: 'chrome-bookmark', fetch_status: 'fetch-ok',
}))
let runDir
beforeEach(async () => {
  runDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bounded-repair-'))
  state.attempts = []; state.captures = []; state.rejectAnchor = false; state.verifiedFrom = 18
  vi.stubEnv('DFE_SINGLE_ANCHOR_RESEARCH', '1'); vi.stubEnv('DFE_DECISION_MODEL', 'openai')
})
afterEach(async () => { vi.unstubAllEnvs(); await fs.rm(runDir, { recursive: true, force: true }) })
const inspect = (extra = {}) => inspectSourceCandidates({ source_candidates: sources, notes_selected: [], motif_terms: [] }, {
  maxSources: 6, runDir, sourceTool: 'fetch', date: '2026-09-30', ...extra,
})
it.each(['0', '1'])('passes archive keys through source research with single-anchor mode %s', async mode => {
  vi.stubEnv('DFE_SINGLE_ANCHOR_RESEARCH', mode)
  const recentSourceKeys = new Set(sources.slice(0, 18).map(sourceContentKey))
  const result = await inspect({ recentSourceKeys })
  expect(result.content_source_count).toBe(6)
  expect(state.attempts).toHaveLength(6)
  expect(state.attempts.every(url => !recentSourceKeys.has(sourceContentKey({ url })))).toBe(true)
})
it.each(['0', '1'])('fetches the existing supplemental bed before spending pixel attempts in anchor mode %s', async mode => {
  // Reproduce the production 320 initial cutoff with a smaller supplemental bed
  // (480 here; the actual maxSources=240 run permits 960). Late artwork starved.
  vi.stubEnv('DFE_SINGLE_ANCHOR_RESEARCH', mode)
  const promos = Array.from({ length: 320 }, (_, i) => ({
    ...sources[0], url: `https://promo${i}.example/work`, image_url: `https://promo${i}.example/work.png`,
    note_id: `promo-${i}`, title: 'New photo tool platform', note_title: 'New photo tool platform', note_score: 99999,
  }))
  const artwork = sources.slice(18).map(source => ({ ...source, note_score: 1 }))
  await inspectSourceCandidates({ source_candidates: [...promos, ...artwork], notes_selected: [], motif_terms: [] }, {
    maxSources: 120, runDir, sourceTool: 'fetch', date: '2026-09-30',
  }).catch(() => {}) // The assertion is scheduling, not a fabricated publish proof.
  expect(state.attempts.slice(0, 6)).toEqual(artwork.map(source => source.url))
  expect(state.attempts.length).toBeLessThanOrEqual(24)
})
it('inspects the existing renderable bed through the final bounded batch without browser refill', async () => {
  const result = await inspect()
  expect(result.content_source_count).toBe(6)
  expect(state.attempts).toHaveLength(24)
  expect(new Set(state.attempts).size).toBe(24)
  expect(result.content_sources.every(source => Number(source.title.split(' ').at(-1)) >= 18)).toBe(true)
  expect(state.captures.every(capture => capture.tool === 'fetch')).toBe(true)
})
it('replaces an excluded automatic anchor with verified eligible material and aligned artifacts', async () => {
  state.rejectAnchor = true
  const result = await inspect()
  const anchor = result.anchor_research.anchor_source
  expect(anchor.url).not.toBe(sources[0].url)
  expect(result.content_sources.map(source => source.url)).toContain(anchor.url)
  expect(result.source_decision_audit.status).not.toBe('blocked')
  for (const filename of ['anchor-research.json', 'image-source-material.json', 'source-image-fingerprints.json']) {
    const artifact = JSON.parse(await fs.readFile(path.join(runDir, filename), 'utf8'))
    expect(JSON.stringify(artifact)).toContain(anchor.image_url)
    expect(JSON.stringify(artifact)).not.toContain(sources[0].image_url)
  }
  expect(result.selected_image_material[0].page_url).toBe(anchor.url)
  expect(result.visual_reference.image_url).toBe(anchor.image_url)
})
it('does not reselect an excluded exact override', async () => {
  state.rejectAnchor = true
  await expect(inspect({ inspirationOverride: { source_url: sources[0].url, image_url: sources[0].image_url, title: sources[0].title, prompt_bias_terms: ['exact-anchor'] } })).rejects.toThrow(/blocked/)
  const saved = JSON.parse(await fs.readFile(path.join(runDir, 'source-research.json'), 'utf8'))
  expect(saved.anchor_research.anchor_source.url).toBe(sources[0].url)
  expect(saved.source_decision_audit.status).toBe('blocked')
})
it('keeps the strict floor and clears excluded anchor artifacts when no verified replacement exists', async () => {
  state.verifiedFrom = 30
  state.rejectAnchor = true
  await expect(inspect()).rejects.toThrow(/blocked|expected at least 6/)
  expect(state.attempts).toHaveLength(24)
  const saved = JSON.parse(await fs.readFile(path.join(runDir, 'source-research.json'), 'utf8'))
  expect(saved.anchor_research).toBeNull()
  expect(saved.selected_image_material).toEqual([])
  expect(saved.content_source_count).toBe(0)
  await expect(fs.access(path.join(runDir, 'anchor-research.json'))).rejects.toThrow()
})
