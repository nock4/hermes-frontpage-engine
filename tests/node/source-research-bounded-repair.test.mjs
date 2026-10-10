import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ attempts: [], captures: [], rejectAnchor: false, verifiedFrom: 18 }))
vi.mock('../../scripts/lib/source-inspection.mjs', () => ({
  inspectCandidateSource: async (source, options) => {
    state.captures.push({ url: source.url, tool: options.sourceTool, attempts: state.attempts.length, researchCalls: state.researchAttempts.length })
    if (options.sourceTool === 'fetch' && state.fetchChanges?.[source.url]) return { ...source, ...state.fetchChanges[source.url] }
    if (options.sourceTool === 'browser-harness' && state.browserChanges?.[source.url]) return { ...source, ...state.browserChanges[source.url] }
    return options.sourceTool === 'browser-harness' && source.browser_image
      ? { ...source, image_url: source.browser_image, fetch_status: 'browser-harness' } : source
  },
  findVisualReference: async () => null,
}))
vi.mock('../../scripts/lib/anchor-source-research.mjs', async (original) => ({
  ...await original(),
  buildAnchorResearch: async (anchor) => ({ anchor_source: anchor, anchor_research: { summary: anchor.title, thesis: anchor.title } }),
  discoverDerivedSourceCandidates: async () => state.derivedCandidates || [],
  discoverImageSourceMaterial: async (research) => {
    const anchor = research.anchor_source
    const materials = [{ title: anchor.title, page_url: anchor.url, image_url: anchor.image_url, source_image_aliases: anchor.source_image_aliases, lineage: 'primary_anchor_image' }]
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
    if (instructions.includes('source-research editor')) {
      state.researchAttempts.push(state.attempts.length)
      return { source_decisions: state.editorialDecisions || (state.rejectAnchor ? [{ url: sources[0].url, role: 'reject' }] : []), selected_content_urls: [] }
    }
    return { visual_summary: 'Red figure and blue room in an oil painting', preserve_cues: ['red figure', 'blue room'], visual_fertility: 'high' }
  },
}))
import { inspectSourceCandidates, buildSourceFloorDiagnostics, collectFetchEvidenceForAutoresearch } from '../../scripts/lib/source-research.mjs'
import { sourceContentKey, sourceContentScore, isAiToolingContentSource } from '../../scripts/lib/source-selection-policy.mjs'
const sources = Array.from({ length: 24 }, (_, i) => ({
  url: `https://artist${i}.gallery.example/work`, image_url: `https://artist${i}.gallery.example/work.png`,
  title: `Painting ${i}`, note_title: `Painting ${i}`, note_id: `note-${i}`, note_score: 100 - i,
  source_channel: 'chrome-bookmark', fetch_status: 'fetch-ok',
}))
let runDir
beforeEach(async () => {
  runDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bounded-repair-'))
  state.attempts = []; state.captures = []; state.rejectAnchor = false; state.verifiedFrom = 18; state.browserChanges = {}; state.fetchChanges = {}
  state.researchAttempts = []; state.editorialDecisions = null; state.derivedCandidates = []
  vi.stubEnv('DFE_SINGLE_ANCHOR_RESEARCH', '1'); vi.stubEnv('DFE_DECISION_MODEL', 'openai')
})
afterEach(async () => { vi.unstubAllEnvs(); await fs.rm(runDir, { recursive: true, force: true }) })
const inspect = (extra = {}) => inspectSourceCandidates({ source_candidates: sources, notes_selected: [], motif_terms: [] }, {
  maxSources: 6, runDir, sourceTool: 'fetch', date: '2026-09-30', ...extra,
})
it.each(['automatic', 'exact'])('researches an undersized %s anchor bed before spending on supporting-only sources', async mode => {
  // The anchor has no derived works, so it cannot supply the six-source floor.
  // Text editorial roles must arrive before the first real inspector invocation.
  state.verifiedFrom = 18
  state.editorialDecisions = sources.slice(0, 3).map(source => ({ url: source.url, role: 'supporting', confidence: 'high' }))
  const inspirationOverride = mode === 'exact'
    ? { source_url: sources[0].url, image_url: sources[0].image_url, title: sources[0].title, prompt_bias_terms: ['exact-anchor'] }
    : null
  if (mode === 'exact') await expect(inspect({ inspirationOverride })).rejects.toThrow(/blocked/)
  else await inspect()
  expect(state.researchAttempts).toEqual([0])
  expect(state.attempts.length).toBeGreaterThan(0)
  expect(state.attempts.length).toBeLessThanOrEqual(24)
  expect(state.attempts.some(url => sources.slice(0, 3).some(source => source.url === url))).toBe(false)
  const saved = JSON.parse(await fs.readFile(path.join(runDir, 'source-research.json'), 'utf8'))
  expect(saved.content_sources.some(source => sources.slice(0, 3).some(excluded => excluded.url === source.url))).toBe(false)
  if (mode === 'exact') {
    expect(saved.anchor_research.anchor_source.url).toBe(sources[0].url)
    expect(saved.source_decision_audit.status).toBe('blocked')
  }
})
it('does not manufacture a sixth source when early editorial exclusions leave only five', async () => {
  state.verifiedFrom = 0
  state.editorialDecisions = sources.slice(0, 3).map(source => ({ url: source.url, role: 'supporting', confidence: 'high' }))
  await expect(inspectSourceCandidates({ source_candidates: sources.slice(0, 8), notes_selected: [], motif_terms: [] }, {
    maxSources: 6, runDir, sourceTool: 'fetch', date: '2026-10-10',
  })).rejects.toThrow(/blocked|expected at least 6/)
  expect(state.researchAttempts).toEqual([0])
  expect(state.attempts).toEqual(sources.slice(3, 8).map(source => source.url))
  const saved = JSON.parse(await fs.readFile(path.join(runDir, 'source-research.json'), 'utf8'))
  expect(saved.content_source_count).toBe(5)
  expect(saved.source_floor_diagnostics.min_required_content_sources).toBe(6)
})
it.each(['automatic', 'exact'])('retains %s single-anchor provenance with a sufficient derived field after text-first research', async mode => {
  state.verifiedFrom = 0
  state.derivedCandidates = sources.slice(1, 7)
  const inspirationOverride = mode === 'exact'
    ? { source_url: sources[0].url, image_url: sources[0].image_url, title: sources[0].title, prompt_bias_terms: ['exact-anchor'] }
    : null
  const result = await inspect({ inspirationOverride })
  expect(state.researchAttempts).toEqual([0])
  expect(result.anchor_research.anchor_source.url).toBe(sources[0].url)
  expect(result.selected_image_material[0].page_url).toBe(sources[0].url)
  expect(result.content_source_count).toBeGreaterThanOrEqual(6)
  expect(result.autoresearch.source_decisions).toEqual(expect.arrayContaining([
    expect.objectContaining({ url: sources[1].url, why: 'Derived from the selected anchor source.' }),
  ]))
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
it('snapshots the lossless fetch boundary without doing creative inspection or refilling a healthy bed', async () => {
  const harvest = { source_candidates: sources, notes_selected: [{ id: 'note-0', excerpt: 'Untouched saved context' }] }
  const fetched = await collectFetchEvidenceForAutoresearch(sources.slice(0, 6), { signalHarvest: harvest, runDir })
  expect(fetched).toEqual(sources.slice(0, 6))
  expect(state.attempts).toEqual([])
  expect(state.captures).toHaveLength(6)
  const snapshot = JSON.parse(await fs.readFile(path.join(runDir, 'source-intake-snapshot.json'), 'utf8'))
  expect(snapshot.initial_fetch_sources).toEqual(fetched)
  expect(snapshot.refill_candidates).toEqual([])
  expect(snapshot.autoresearch).toBeNull()
})
it.each(['0', '1'])('refills a saturated normal intake before pixel scheduling in anchor mode %s', async mode => {
  vi.stubEnv('DFE_SINGLE_ANCHOR_RESEARCH', mode)
  state.verifiedFrom = Infinity // Scheduling cannot manufacture creative admission.
  const noise = Array.from({ length: 960 }, (_, i) => ({
    url: `https://noise-${i}.example/work`, note_id: `noise-${i}`, note_title: 'Saved pages', note_score: 99999,
  }))
  const owners = Array.from({ length: 6 }, (_, i) => ({
    url: `https://owner-${i}.example/work`, note_id: 'collection', note_title: 'Saved pages', note_score: 1,
  }))
  for (const [i, source] of owners.entries()) state.fetchChanges[source.url] = {
    title: `Painting ${100 + i}`, image_url: `https://owner-${i}.example/exact.jpg`, fetch_status: 'fetch-ok',
    source_image_aliases: [`https://owner-${i}.example/original.jpg`], description: 'Oil painting on canvas',
  }
  const harvest = { source_candidates: [...noise, ...owners], notes_selected: [{ id: 'collection', excerpt: 'Full saved provenance' }], motif_terms: [] }
  await expect(inspectSourceCandidates(harvest, {
    maxSources: 240, runDir, sourceTool: 'fetch', date: '2026-10-10',
  })).rejects.toThrow(/blocked|expected at least 6/)
  expect(state.attempts).toEqual(owners.map(source => source.url))
  expect(state.attempts.length).toBeLessThanOrEqual(24)
  const snapshot = JSON.parse(await fs.readFile(path.join(runDir, 'source-intake-snapshot.json'), 'utf8'))
  expect(snapshot.initial_candidates).toEqual(noise)
  expect(snapshot.refill_candidates).toEqual(owners)
  expect(snapshot.signal_harvest).toEqual(harvest)
  expect(snapshot.fetch_sources.slice(-6)).toEqual(owners.map(source => ({ ...source, ...state.fetchChanges[source.url] })))
  expect(snapshot.autoresearch).toBeNull()
  // Intake is bounded before research; research-selected recaptures now also
  // precede pixels and must not be miscounted as intake-refill fetches.
  expect(state.captures.filter(row => row.tool === 'fetch' && row.researchCalls === 0).length).toBeLessThanOrEqual(984)
  const saved = JSON.parse(await fs.readFile(path.join(runDir, 'source-research.json'), 'utf8'))
  expect(saved.content_source_count).toBe(0)
  expect(saved.autoresearch.source_decisions.filter(row => row.inspection)).toHaveLength(6)
})

const browserOnlySources = Array.from({ length: 40 }, (_, i) => ({
  ...sources[0], url: `https://late${i}.gallery.example/work`, image_url: null,
  browser_image: `https://late${i}.gallery.example/work.png`,
  title: `Painting ${100 + i}`, note_title: `Painting ${100 + i}`, note_id: `late-${i}`, note_score: 1,
}))
const inspectBrowserBed = (late = browserOnlySources) => inspectSourceCandidates({
  source_candidates: [...sources, ...late], notes_selected: [], motif_terms: [],
}, { maxSources: 12, runDir, sourceTool: 'browser-harness', date: '2026-10-10' })
it.each(['0', '1'])('reserves actual-media attempts for browser-only sources in anchor mode %s', async mode => {
  vi.stubEnv('DFE_SINGLE_ANCHOR_RESEARCH', mode)
  state.verifiedFrom = 100
  await expect(inspectBrowserBed()).resolves.toMatchObject({ content_source_count: 6 })
  const lateCaptures = state.captures.filter(row => row.tool === 'browser-harness' && row.url.includes('late'))
  expect(lateCaptures).toHaveLength(6)
  expect(lateCaptures[0].attempts).toBeLessThanOrEqual(18)
  expect(state.attempts).toHaveLength(24)
  expect(state.attempts.slice(-6)).toEqual(browserOnlySources.slice(0, 6).map(source => source.url))
  const saved = JSON.parse(await fs.readFile(path.join(runDir, 'source-autoresearch.json'), 'utf8'))
  expect(saved.source_decisions.filter(row => row.inspection)).toHaveLength(24)
})
it('retains run6 fetched media when a successful browser capture has no image', async () => {
  const fixture = JSON.parse(await fs.readFile(new URL('../fixtures/run6-empty-browser-capture.json', import.meta.url), 'utf8'))
  vi.stubEnv('DFE_SINGLE_ANCHOR_RESEARCH', '0')
  state.verifiedFrom = Infinity // Recovery is not permission to invent a positive verdict.
  state.browserChanges[fixture.source.url] = fixture.browser_changes
  await expect(inspectSourceCandidates({ source_candidates: [fixture.source], notes_selected: [], motif_terms: [] }, {
    maxSources: 6, runDir, sourceTool: 'browser-harness', date: '2026-10-10',
  })).rejects.toThrow(/blocked|expected at least 6/)
  expect(state.captures.some(row => row.tool === 'browser-harness' && row.url === fixture.source.url)).toBe(true)
  const saved = JSON.parse(await fs.readFile(path.join(runDir, 'source-research.json'), 'utf8'))
  const retained = saved.sources.find(source => source.url === fixture.source.url)
  expect(retained.image_url).toBe(fixture.source.image_url)
  expect(retained.final_url).toBe(fixture.source.final_url)
  expect(retained).toMatchObject({ ...fixture.browser_changes, image_url: fixture.source.image_url })
  expect(retained.editorial_evidence).toEqual(expect.arrayContaining([expect.objectContaining(fixture.source)]))
  expect(saved.content_source_count).toBe(0)
  expect(state.attempts).toEqual([fixture.source.url])
})

it.each(['fresh-browser-image', 'browser-tooling-context', 'archived-image'])('preserves %s constraints when merging fetch and browser evidence', async scenario => {
  const source = sources[0]
  vi.stubEnv('DFE_SINGLE_ANCHOR_RESEARCH', '0')
  state.verifiedFrom = Infinity
  const recentSourceKeys = scenario === 'archived-image' ? new Set([sourceContentKey({ url: source.image_url })]) : new Set()
  const browserImage = 'https://artist0.gallery.example/new-work.png'
  state.browserChanges[source.url] = {
    fetch_status: 'browser-harness', image_url: scenario === 'fresh-browser-image' ? browserImage : null,
    ...(scenario === 'browser-tooling-context' ? { description: 'AI agent workflow tutorial and SDK setup guide' } : {}),
  }
  await expect(inspectSourceCandidates({ source_candidates: [source], notes_selected: [], motif_terms: [] }, {
    maxSources: 6, runDir, sourceTool: 'browser-harness', date: '2026-10-10', recentSourceKeys,
  })).rejects.toThrow(/blocked|expected at least 6/)
  const saved = JSON.parse(await fs.readFile(path.join(runDir, 'source-research.json'), 'utf8'))
  const retained = saved.sources.find(row => row.url === source.url)
  expect(saved.content_source_count).toBe(0)
  if (scenario === 'fresh-browser-image') expect(retained.image_url).toBe(browserImage)
  if (scenario === 'browser-tooling-context') {
    expect(retained.image_url).toBe(source.image_url)
    expect(isAiToolingContentSource(retained)).toBe(true)
  }
  if (scenario === 'archived-image') {
    expect(sourceContentScore(retained, recentSourceKeys)).toBe(-Infinity)
    expect(state.attempts).toEqual([])
  }
})

it('retains primary material aliases when creating derived content sources', async () => {
  const alias = 'https://original.example/painting.jpg'
  const source = { ...sources[18], source_image_aliases: [alias] }
  const result = await inspectSourceCandidates({ source_candidates: [source, ...sources.slice(19)], notes_selected: [], motif_terms: [] }, {
    maxSources: 6, runDir, sourceTool: 'fetch', date: '2026-10-10',
  })
  const derived = result.sources.find(row => row.url === source.image_url)
  expect(derived).toBeDefined()
  expect(derived.source_image_aliases).toContain(alias)
  expect(sourceContentScore(derived, new Set([sourceContentKey({ url: alias })]))).toBe(-Infinity)
})

it('keeps fetch redirect aliases through preferred browser merging and archive screening', () => {
  const alias = 'https://original-images.example/spent.jpg'
  const source = { ...sources[0], source_image_aliases: [alias] }
  const inspected = [{ ...source, fetch_status: 'browser-harness', image_url: null, source_image_aliases: [] }]
  const options = { inspected, fetchEvidence: [source] }
  expect(buildSourceFloorDiagnostics(options).buckets.non_duplicate_renderable_surfaces).toBe(1)
  const recentSourceKeys = new Set([sourceContentKey({ url: alias })])
  expect(buildSourceFloorDiagnostics({ ...options, recentSourceKeys }).buckets.non_duplicate_renderable_surfaces).toBe(0)
})

it('stops browser refill when negative actual-media attempts exhaust the unchanged cap', async () => {
  state.verifiedFrom = Infinity
  await expect(inspectBrowserBed()).rejects.toThrow(/blocked|expected at least 6/)
  const lateCaptures = state.captures.filter(row => row.tool === 'browser-harness' && row.url.includes('late'))
  expect(lateCaptures).toHaveLength(6)
  expect(lateCaptures.every(row => row.attempts < 24)).toBe(true)
  expect(state.attempts).toHaveLength(24)
})
it('bounds empty browser refill and returns unused reserve to the existing media bed', async () => {
  const late = browserOnlySources.map(source => ({ ...source, browser_image: null }))
  const result = await inspectBrowserBed(late)
  expect(result.content_source_count).toBe(6)
  const lateCaptures = state.captures.filter(row => row.tool === 'browser-harness' && row.url.includes('late'))
  expect(lateCaptures).toHaveLength(24)
  expect(lateCaptures.every(row => row.attempts === 18)).toBe(true)
  expect(state.attempts).toHaveLength(24)
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
  expect(state.attempts).toHaveLength(23) // The excluded anchor never spends an attempt.
  expect(state.attempts).not.toContain(sources[0].url)
  const saved = JSON.parse(await fs.readFile(path.join(runDir, 'source-research.json'), 'utf8'))
  expect(saved.anchor_research).toBeNull()
  expect(saved.selected_image_material).toEqual([])
  expect(saved.content_source_count).toBe(0)
  await expect(fs.access(path.join(runDir, 'anchor-research.json'))).rejects.toThrow()
})
