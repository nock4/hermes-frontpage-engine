import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ attempts: [], captures: [], rejectAnchor: false, verifiedFrom: 18 }))
vi.mock('../../scripts/lib/source-inspection.mjs', () => ({
  inspectCandidateSource: async (source, options) => {
    state.captures.push({ url: source.url, source, tool: options.sourceTool, attempts: state.attempts.length, researchCalls: state.researchAttempts.length, observedSources: options.observedSources })
    if (options.sourceTool === 'fetch' && state.fetchChanges?.[source.url]) return { ...source, ...state.fetchChanges[source.url] }
    if (options.sourceTool === 'browser-harness' && state.browserChanges?.[source.url]) return { ...source, ...state.browserChanges[source.url] }
    return options.sourceTool === 'browser-harness' && source.browser_image
      ? { ...source, image_url: source.browser_image, fetch_status: 'browser-harness' } : source
  },
  findVisualReference: async () => state.visualReference || null,
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
  openAiJson: async ({ instructions, input, timeoutMs }) => {
    if (instructions.startsWith('Inspect the attached actual source pixels')) {
      const source = JSON.parse(input[0].content[0].text)
      state.attempts.push(source.url)
      return state.inspectionVerdicts?.[source.url] || { status: Number(source.title.split(' ').at(-1)) >= state.verifiedFrom ? 'verified' : 'ambiguous', artifact_kind: 'artwork', confidence: 'high', observation: 'Synthetic fixture: red painted figures' }
    }
    if (instructions.includes('source-research editor')) {
      state.researchAttempts.push(state.attempts.length)
      state.researchTimeouts.push(timeoutMs)
      return { source_decisions: state.editorialDecisions || (state.rejectAnchor ? [{ url: sources[0].url, role: 'reject' }] : []), selected_content_urls: [] }
    }
    state.fingerprintCalls.push(input)
    return { visual_summary: 'Red figure and blue room in an oil painting', preserve_cues: ['red figure', 'blue room'], visual_fertility: 'high' }
  },
}))
import { inspectSourceCandidates, buildSourceFloorDiagnostics, collectFetchEvidenceForAutoresearch, discoverObservedOwnerProjectLinks } from '../../scripts/lib/source-research.mjs'
import { sourceContentKey, sourceContentScore, visualReferenceScore, isAiToolingContentSource, hasCreativeArtifactEvidence, isAutoresearchExcluded } from '../../scripts/lib/source-selection-policy.mjs'
const sources = Array.from({ length: 24 }, (_, i) => ({
  url: `https://artist${i}.gallery.example/work`, image_url: `https://artist${i}.gallery.example/work.png`,
  title: `Painting ${i}`, note_title: `Painting ${i}`, note_id: `note-${i}`, note_score: 100 - i,
  source_channel: 'chrome-bookmark', fetch_status: 'fetch-ok',
}))
let runDir
beforeEach(async () => {
  runDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bounded-repair-'))
  state.attempts = []; state.captures = []; state.rejectAnchor = false; state.verifiedFrom = 18; state.browserChanges = {}; state.fetchChanges = {}
  state.researchAttempts = []; state.researchTimeouts = []; state.editorialDecisions = null; state.derivedCandidates = []
  state.visualReference = null; state.inspectionVerdicts = {}; state.fingerprintCalls = []
  vi.stubEnv('DFE_SINGLE_ANCHOR_RESEARCH', '1'); vi.stubEnv('DFE_DECISION_MODEL', 'openai')
})
afterEach(async () => { vi.unstubAllEnvs(); await fs.rm(runDir, { recursive: true, force: true }) })
const inspect = (extra = {}) => inspectSourceCandidates({ source_candidates: sources, notes_selected: [], motif_terms: [] }, {
  maxSources: 6, runDir, sourceTool: 'fetch', date: '2026-09-30', ...extra,
})
it.each(['verified', 'ambiguous', 'supporting', 'spent'])('bounded bookmark production orchestration preserves admission gates: %s', async mode => {
  vi.stubEnv('DFE_BOOKMARK_CACHE_DIR', path.join(runDir, 'cache'))
  state.verifiedFrom = mode === 'ambiguous' ? 100 : 0
  const ledger = mode === 'spent' ? new Set(sources.slice(0, 6).map(sourceContentKey)) : new Set()
  if (mode === 'supporting') state.editorialDecisions = sources.map(s => ({ url: s.url, role: 'supporting', confidence: 'high' }))
  const run = inspectSourceCandidates({ selection_policy: { bookmark_first: true }, source_candidates: sources, notes_selected: [], motif_terms: [] }, {
    maxSources: 240, runDir, sourceTool: 'fetch', date: '2026-10-17', recentSourceKeys: ledger,
  })
  if (['ambiguous', 'supporting'].includes(mode)) await expect(run).rejects.toThrow(/blocked/)
  else expect((await run).content_sources).toHaveLength(6)
  const audit = JSON.parse(await fs.readFile(path.join(runDir, 'bookmark-acquisition.json'), 'utf8'))
  expect(audit.acquired).toBe(['verified', 'spent'].includes(mode) ? 6 : 24)
  expect(state.captures).toHaveLength(audit.acquired)
  expect(state.researchAttempts[0]).toBe(0)
  expect(state.researchTimeouts.every(ms => ms === 60000)).toBe(true)
  if (mode === 'spent') expect(state.captures.some(s => sources.slice(0, 6).some(old => old.url === s.url))).toBe(false)
  if (mode === 'supporting') expect(state.attempts).toHaveLength(0)
  if (mode === 'ambiguous') expect(audit.admitted).toBe(0)
})

it('passes observed fetch evidence into browser reduction and preserves candidates across the real research merge', async () => {
  state.verifiedFrom = 0
  const source = sources[0]
  const metadata = { image_url: source.image_url, kind: 'metadata', page_url: source.url }
  const dom = { image_url: 'https://artist0.gallery.example/article.png', kind: 'dom', context: 'main', page_url: source.url }
  state.fetchChanges[source.url] = { image_candidates: [metadata] }
  state.browserChanges[source.url] = {
    image_url: dom.image_url, source_image_url: dom.image_url, source_image_aliases: [dom.image_url],
    image_candidates: [dom], image_selection: { reason: 'observed-shared-homepage-preview' }, fetch_status: 'browser-harness',
  }
  state.derivedCandidates = sources.slice(1, 7)
  const result = await inspect({ sourceTool: 'browser-harness' })
  const capture = state.captures.find(row => row.url === source.url && row.tool === 'browser-harness')
  expect(capture.observedSources).toContainEqual(expect.objectContaining({ url: source.url, image_candidates: [metadata] }))
  const merged = result.sources.find(row => row.url === source.url)
  expect(merged.image_url).toBe(dom.image_url)
  expect(merged.image_candidates).toEqual(expect.arrayContaining([metadata, dom]))
  expect(merged.image_selection.reason).toBe('observed-shared-homepage-preview')
  expect(merged.editorial_evidence).toContainEqual(expect.objectContaining({ image_candidates: [metadata] }))
  expect(state.attempts.length).toBeLessThanOrEqual(24)
})

it.each(['replacement', 'same-image-redirect', 'owner-rejected'])('keeps only selected-image aliases through the real research merge: %s', async scenario => {
  vi.stubEnv('DFE_SINGLE_ANCHOR_RESEARCH', '0')
  state.verifiedFrom = 0
  const source = sources[0]
  const og = source.image_url
  const original = 'https://artist0.gallery.example/shared-og-original.png'
  const work = scenario === 'same-image-redirect' ? og : 'https://artist0.gallery.example/selected-work.png'
  state.fetchChanges[source.url] = {
    source_image_url: original, source_image_aliases: [original, og],
  }
  state.browserChanges[source.url] = {
    image_url: work, source_image_url: work, source_image_aliases: [work], fetch_status: 'browser-harness',
    ...(scenario === 'owner-rejected' ? { editorial_evidence: [{ url: source.url, autoresearch_role: 'reject' }] } : {}),
  }
  const result = await inspect({ sourceTool: 'browser-harness' })
  const merged = result.sources.find(row => row.url === source.url)
  const ledger = new Set([sourceContentKey({ url: original })])
  if (scenario === 'same-image-redirect') {
    expect(merged.source_image_aliases).toContain(original)
    expect(sourceContentScore(merged, ledger)).toBe(-Infinity)
  } else {
    // The old shared OG in the ledger must not poison a different selected work.
    expect(sourceContentScore(merged, ledger)).not.toBe(-Infinity)
    expect(merged.source_image_aliases).toEqual([work])
    expect(merged.source_image_url).toBe(work)
  }
  expect(merged.editorial_evidence).toContainEqual(expect.objectContaining({
    source_image_url: original, source_image_aliases: [original, og],
  }))
  expect(sourceContentScore(merged, new Set([sourceContentKey(source)]))).toBe(-Infinity)
  if (scenario === 'owner-rejected') expect(isAutoresearchExcluded(merged)).toBe(true)
  const oldProof = { source_decisions: [{ url: source.url, role: 'content', confidence: 'high', inspection: {
    version: 1, inspector: 'creative-artifact-vision', status: 'verified', confidence: 'high',
    artifact_kind: 'artwork', source_url: source.url, media_url: og,
    observation: 'Old OG pixels', capture_sha256: 'a'.repeat(64), capture_path: '/fixture/old-og.png',
  } }] }
  if (scenario === 'replacement') {
    expect(hasCreativeArtifactEvidence({ ...source, image_url: og }, oldProof)).toBe(true)
    expect(hasCreativeArtifactEvidence(merged, oldProof)).toBe(false)
  }
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
it.each(['automatic', 'exact', 'unverified', 'spent'])('keeps anchor recovery independent of an undersized content floor: %s', async mode => {
  state.verifiedFrom = mode === 'unverified' ? 30 : 0
  state.editorialDecisions = sources.slice(0, 3).map(source => ({ url: source.url, role: 'supporting', confidence: 'high' }))
  const inspirationOverride = mode === 'exact'
    ? { source_url: sources[0].url, image_url: sources[0].image_url, title: sources[0].title, prompt_bias_terms: ['exact-anchor'] }
    : null
  const recentSourceKeys = mode === 'spent' ? new Set(sources.slice(3, 8).map(sourceContentKey)) : new Set()
  await expect(inspectSourceCandidates({ source_candidates: sources.slice(0, 8), notes_selected: [], motif_terms: [] }, {
    maxSources: 6, runDir, sourceTool: 'fetch', date: '2026-10-10', inspirationOverride, recentSourceKeys,
  })).rejects.toThrow(/blocked/)
  const saved = JSON.parse(await fs.readFile(path.join(runDir, 'source-research.json'), 'utf8'))
  const blockers = saved.source_decision_audit.hard_blockers.map(row => row.reason_code)
  expect(blockers).toContain('insufficient_eligible_source_media')
  expect(saved.content_source_count).toBe(['unverified', 'spent'].includes(mode) ? 0 : 5)
  expect(state.attempts.length).toBeLessThanOrEqual(24)
  if (mode === 'automatic') {
    expect(saved.anchor_research?.anchor_source.url).toBe(sources[3].url)
    expect(blockers).toEqual(['insufficient_eligible_source_media'])
    expect(saved.selected_image_material[0].page_url).toBe(sources[3].url)
    const retained = JSON.parse(await fs.readFile(path.join(runDir, 'anchor-research.json'), 'utf8'))
    expect(retained.anchor_source.url).toBe(sources[3].url)
  } else if (mode === 'exact') {
    expect(saved.anchor_research.anchor_source.url).toBe(sources[0].url)
    expect(blockers).toContain('autoresearch_excluded_anchor')
  } else {
    expect(saved.anchor_research).toBeNull()
    expect(blockers).toContain('missing_anchor_source')
    await expect(fs.access(path.join(runDir, 'anchor-research.json'))).rejects.toThrow()
  }
})
it.each(['automatic', 'exact', 'supporting', 'rejected', 'ambiguous', 'medium', 'spent', 'unknown-owner', 'wrong-image', 'shared-image-other-owner'])('recovers an absent general-lane anchor only from the exact eligible fertile owner: %s', async mode => {
  state.verifiedFrom = 0
  const field = sources.slice(1, 7).map((source, i) => ({ ...source,
    url: `https://collection${i}.example/objects/work`, image_url: `https://collection${i}.example/work.png`,
    source_channel: 'manual-curation',
  }))
  const owner = field[0]
  state.editorialDecisions = [{ url: sources[0].url, role: 'supporting', confidence: 'high' }]
  if (mode === 'supporting') state.editorialDecisions.push({ url: owner.url, role: 'supporting', confidence: 'high' })
  if (['rejected', 'ambiguous', 'medium'].includes(mode)) state.inspectionVerdicts[owner.url] = {
    status: mode === 'medium' ? 'verified' : mode, artifact_kind: 'artwork',
    confidence: mode === 'medium' ? 'medium' : 'high', observation: 'Synthetic fixture: painted figures',
  }
  state.visualReference = { ...owner }
  if (mode === 'unknown-owner' || mode === 'shared-image-other-owner') state.visualReference.url = 'https://uninspected.example/work'
  if (mode === 'unknown-owner') state.visualReference.image_url = 'https://uninspected.example/work.png'
  if (mode === 'wrong-image') state.visualReference.image_url = 'https://collection0.example/uninspected.png'
  const inspirationOverride = mode === 'exact'
    ? { source_url: sources[0].url, image_url: sources[0].image_url, title: sources[0].title, prompt_bias_terms: ['exact-anchor'] } : null
  const recentSourceKeys = mode === 'spent' ? new Set([sourceContentKey(owner)]) : new Set()
  let error
  try {
    await inspectSourceCandidates({ source_candidates: [sources[0], ...field], notes_selected: [], motif_terms: [] }, {
      maxSources: 6, runDir, sourceTool: 'fetch', date: '2026-10-11', inspirationOverride, recentSourceKeys,
    })
  } catch (caught) { error = caught }
  const saved = JSON.parse(await fs.readFile(path.join(runDir, 'source-research.json'), 'utf8'))
  expect(state.researchAttempts).toEqual([0])
  expect(state.attempts.length).toBeLessThanOrEqual(24)
  expect(saved.source_floor_diagnostics.min_required_content_sources).toBe(6)
  if (mode === 'automatic') {
    expect(error).toBeUndefined()
    expect(saved.content_source_count).toBe(6)
    expect(saved.anchor_research?.anchor_source.url).toBe(owner.url)
    expect(saved.anchor_research.anchor_source.anchor_selection_lane).toBe('verified-fertile-source-field')
    expect(saved.selected_image_material[0]).toMatchObject({ page_url: owner.url, image_url: owner.image_url })
    expect(saved.source_decision_audit.hard_blockers).toEqual([])
    const retained = JSON.parse(await fs.readFile(path.join(runDir, 'anchor-research.json'), 'utf8'))
    expect(retained).toEqual(saved.anchor_research)
  } else if (['unknown-owner', 'wrong-image', 'shared-image-other-owner', 'ambiguous', 'medium'].includes(mode)) {
    // An ineligible nomination must not become the root; a different verified
    // field tuple may now recover it, without repairing a deficient floor.
    const replacement = saved.selected_image_material[0]
    expect(replacement).toBeDefined()
    expect(replacement.page_url === (state.visualReference.page_url || state.visualReference.url)
      && replacement.image_url === state.visualReference.image_url).toBe(false)
    expect(saved.anchor_research.anchor_source.url).toBe(replacement.page_url)
    expect(saved.content_sources.some(source => source.url === replacement.page_url && source.image_url === replacement.image_url)).toBe(true)
    if (['ambiguous', 'medium'].includes(mode)) {
      expect(error?.message).toMatch(/blocked/)
      expect(saved.content_source_count).toBe(5)
      expect(saved.source_decision_audit.hard_blockers.map(row => row.reason_code)).toEqual(['insufficient_eligible_source_media'])
    } else {
      expect(error).toBeUndefined()
      expect(saved.content_source_count).toBe(6)
      expect(saved.source_decision_audit.hard_blockers).toEqual([])
    }
    const images = JSON.parse(await fs.readFile(path.join(runDir, 'image-source-material.json'), 'utf8'))
    expect(images.alternate_visual_anchor_attempts).toHaveLength(1)
  } else {
    expect(error?.message).toMatch(/blocked/)
    if (mode === 'exact') expect(saved.anchor_research.anchor_source.url).toBe(sources[0].url)
    else {
      expect(saved.anchor_research).toBeNull()
      expect(saved.source_decision_audit.hard_blockers.map(row => row.reason_code)).toContain('missing_anchor_source')
      await expect(fs.access(path.join(runDir, 'anchor-research.json'))).rejects.toThrow()
    }
  }
})
it.each(['unowned', 'owned', 'exact'])('routes the frozen run9 six-owner rootless field without borrowing seed fertility: %s', async mode => {
  const fixture = JSON.parse(await fs.readFile(new URL('../fixtures/run9-rootless-unowned-seed.json', import.meta.url), 'utf8'))
  const field = fixture.owners
  const owner = field[0]
  // The broad visual-reference adapter can nominate captured but uninspected
  // material outside the admitted field. No Blood Pool fingerprint is imported.
  expect(visualReferenceScore(fixture.unowned_seed)).toBeGreaterThan(Math.max(...field.map(source => visualReferenceScore(source))))
  state.visualReference = mode === 'owned' ? owner : fixture.unowned_seed
  state.editorialDecisions = [{ url: sources[0].url, role: 'supporting', confidence: 'high' }]
  for (const source of field) state.inspectionVerdicts[source.url] = {
    status: 'verified', artifact_kind: 'artwork', confidence: 'high', observation: 'Synthetic adapter fixture, not production pixel proof',
  }
  const inspirationOverride = mode === 'exact'
    ? { source_url: sources[0].url, image_url: sources[0].image_url, title: sources[0].title, prompt_bias_terms: ['exact-anchor'] } : null
  let error
  try {
    await inspectSourceCandidates({ source_candidates: [sources[0], ...field], notes_selected: [], motif_terms: [] }, {
      maxSources: 6, runDir, sourceTool: 'fetch', date: '2026-10-12', inspirationOverride,
    })
  } catch (caught) { error = caught }
  const saved = JSON.parse(await fs.readFile(path.join(runDir, 'source-research.json'), 'utf8'))
  expect(saved.content_source_count).toBe(6)
  expect(saved.autoresearch.source_decisions.some(row => row.url === fixture.unowned_seed.url)).toBe(false)
  expect(state.attempts).not.toContain(fixture.unowned_seed.url)
  expect(saved.source_image_fingerprints.some(row => row.image_url === fixture.unowned_seed.image_url)).toBe(false)
  const images = JSON.parse(await fs.readFile(path.join(runDir, 'image-source-material.json'), 'utf8'))
  if (mode === 'exact') {
    expect(error?.message).toMatch(/blocked/)
    expect(saved.anchor_research.anchor_source.url).toBe(sources[0].url)
    expect(images.alternate_visual_anchor_attempts).toBeUndefined()
    return
  }
  expect(error).toBeUndefined()
  expect(state.fingerprintCalls).toHaveLength(1)
  const material = saved.selected_image_material[0]
  expect(field.some(source => source.url === material.page_url && source.image_url === material.image_url)).toBe(true)
  expect(saved.anchor_research.anchor_source.url).toBe(material.page_url)
  expect(saved.source_decision_audit.hard_blockers).toEqual([])
  if (mode === 'owned') {
    expect(material.page_url).toBe(owner.url)
    expect(images.alternate_visual_anchor_attempts).toBeUndefined()
  } else {
    expect(images.alternate_visual_anchor_attempts).toEqual([
      { page_url: material.page_url, image_url: material.image_url, status: 'accepted' },
    ])
    expect(images.rejected_image_fingerprints).toEqual([])
  }
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
it.each(['late-refill', 'pre-pixel-researched'])('discovers one observed same-owner project page from a %s owner capture', async lifecycle => {
  vi.stubEnv('DFE_SINGLE_ANCHOR_RESEARCH', '0')
  state.verifiedFrom = Infinity // Discovery is not a positive inspection stamp.
  const root = {
    url: 'https://designcore.org/', note_id: 'detroit-design', note_title: 'Detroit design organizations',
    note_path: '01 - Active/themes/Design & Visual Systems/detroit.md', note_score: 1,
    source_channel: 'chrome-bookmark', image_url: null,
    ...(lifecycle === 'pre-pixel-researched' ? {
      image_url: 'https://cdn.prod.website-files.com/site/fetch-preview.jpg',
      fetch_status: 'fetch-ok', note_score: 99999,
    } : {}),
  }
  const childUrl = 'https://designcore.org/news/drinks-by-design-light-sound'
  const linkedImage = 'https://cdn.prod.website-files.com/site/event-card.jpg'
  const articleImage = 'https://cdn.prod.website-files.com/site/installation.jpg'
  state.browserChanges[root.url] = {
    fetch_status: 'browser-harness', final_url: root.url,
    image_url: 'https://cdn.prod.website-files.com/site/shared-preview.jpg',
    image_candidates: [{
      image_url: linkedImage, kind: 'dom', context: 'main', ancillary: false,
      page_url: root.url, linked_url: childUrl, alt: 'Drinks by Design: Light & Sound',
    }],
  }
  // Duplicate observations and a second project must not widen the crawl.
  const firstLink = state.browserChanges[root.url].image_candidates[0]
  state.browserChanges[root.url].image_candidates.push({ ...firstLink }, {
    ...firstLink, linked_url: 'https://designcore.org/news/another-project',
  })
  state.browserChanges[childUrl] = {
    fetch_status: 'browser-harness', final_url: childUrl, title: 'Drinks by Design: Light & Sound',
    image_url: articleImage, source_image_url: articleImage, source_image_aliases: [articleImage],
  }

  await expect(inspectSourceCandidates({
    source_candidates: [...sources.slice(0, 18), root], notes_selected: [], motif_terms: [],
  }, { maxSources: 6, runDir, sourceTool: 'browser-harness', date: '2026-10-11' })).rejects.toThrow(/blocked|expected at least 6/)

  const rootCaptures = state.captures.filter(row => row.url === root.url && row.tool === 'browser-harness')
  expect(rootCaptures).toHaveLength(1)
  expect(rootCaptures[0].researchCalls).toBe(1)
  expect(rootCaptures[0].attempts).toBe(lifecycle === 'pre-pixel-researched' ? 0 : 18)
  expect(state.captures.some(row => row.url === 'https://designcore.org/news/another-project')).toBe(false)
  const childCaptures = state.captures.filter(row => row.url === childUrl && row.tool === 'browser-harness')
  expect(childCaptures).toHaveLength(1)
  const childCapture = childCaptures[0]
  expect(childCapture?.source).toMatchObject({
    url: childUrl,
    parent_source_url: root.url,
    parent_observed_image_url: linkedImage,
    source_lineage: 'observed_same_owner_project_link',
    note_id: root.note_id,
    note_path: root.note_path,
  })
  expect(childCapture.source.editorial_evidence).toContainEqual(expect.objectContaining({ url: root.url }))
  expect(state.attempts).toContain(childUrl)
  expect(state.attempts).toHaveLength(20)
  const saved = JSON.parse(await fs.readFile(path.join(runDir, 'source-research.json'), 'utf8'))
  expect(saved.sources.find(source => source.url === childUrl)).toMatchObject({
    parent_source_url: root.url,
    source_lineage: 'observed_same_owner_project_link',
  })
  expect(saved.autoresearch.source_decisions.find(row => row.url === childUrl)?.inspection.status).toBe('ambiguous')
})
it.each(['late-refill', 'pre-pixel-researched'].flatMap(lifecycle =>
  ['archived', 'excluded', 'already-acquired', 'first-eligible'].map(scenario => [lifecycle, scenario]),
))('charges the one observed-child allowance only after acquisition admission: %s / %s', async (lifecycle, scenario) => {
  vi.stubEnv('DFE_SINGLE_ANCHOR_RESEARCH', '0')
  state.verifiedFrom = Infinity // Acquisition never supplies affirmative pixel evidence.
  const root = {
    url: 'https://designcore.org/', note_id: 'detroit-design', note_title: 'Detroit design organizations',
    note_score: lifecycle === 'pre-pixel-researched' ? 99999 : 1,
    source_channel: 'chrome-bookmark', fetch_status: 'fetch-ok',
    image_url: lifecycle === 'pre-pixel-researched' ? 'https://designcore.org/root-preview.jpg' : null,
  }
  const firstUrl = 'https://designcore.org/news/drinks-by-design-light-sound'
  const secondUrl = 'https://designcore.org/news/fresh-installation'
  const thirdUrl = 'https://designcore.org/news/another-installation'
  const links = [firstUrl, secondUrl, thirdUrl].map((url, i) => ({
    image_url: `https://designcore.org/work-${i}.jpg`, kind: 'dom', context: 'main',
    page_url: root.url, linked_url: url, alt: `Installation ${i}`,
  }))
  state.browserChanges[root.url] = {
    fetch_status: 'browser-harness', final_url: root.url,
    image_url: 'https://designcore.org/root-preview.jpg', image_candidates: links,
  }
  for (const row of links) state.browserChanges[row.linked_url] = {
    fetch_status: 'browser-harness', final_url: row.linked_url,
    title: row.alt, image_url: row.image_url,
  }
  const recentSourceKeys = scenario === 'archived' ? new Set([sourceContentKey({ url: firstUrl })]) : new Set()
  if (scenario === 'excluded') state.editorialDecisions = [{ url: firstUrl, role: 'reject', confidence: 'high' }]
  const alreadyAcquired = scenario === 'already-acquired' ? [{
    ...sources[0], url: firstUrl, image_url: links[0].image_url, fetch_status: 'browser-harness',
  }] : []
  await expect(inspectSourceCandidates({
    source_candidates: [...sources.slice(0, 18), root, ...alreadyAcquired], notes_selected: [], motif_terms: [],
  }, {
    maxSources: 6, runDir, sourceTool: 'browser-harness', date: '2026-10-13', recentSourceKeys,
  })).rejects.toThrow(/blocked|expected at least 6/)

  const expectedUrl = scenario === 'first-eligible' ? firstUrl : secondUrl
  const children = state.captures.filter(row => row.tool === 'browser-harness'
    && row.source.source_lineage === 'observed_same_owner_project_link')
  expect(children.map(row => row.url)).toEqual([expectedUrl])
  expect(children[0].source.parent_source_url).toBe(root.url)
  expect(state.captures.some(row => row.url === thirdUrl)).toBe(false)
  if (['archived', 'excluded'].includes(scenario)) expect(state.captures.some(row => row.url === firstUrl)).toBe(false)
  expect(state.attempts.filter(url => url === expectedUrl)).toHaveLength(1)
  expect(state.attempts.length).toBeLessThanOrEqual(24)
  expect(state.captures.filter(row => row.tool === 'browser-harness' && row.attempts > 0).length).toBeLessThanOrEqual(24)
  const saved = JSON.parse(await fs.readFile(path.join(runDir, 'source-research.json'), 'utf8'))
  expect(saved.autoresearch.source_decisions.find(row => row.url === expectedUrl)?.inspection.status).toBe('ambiguous')
  expect(saved.content_sources).toEqual([])
  expect(saved.source_decision_audit.status).toBe('blocked')
})
it('bounds owner-link discovery and rejects non-root, cross-owner, ancillary and unsafe links', () => {
  const root = {
    url: 'https://gallery.example/', final_url: 'https://gallery.example/', fetch_status: 'browser-harness',
    source_channel: 'chrome-bookmark', note_id: 'gallery-note',
    image_candidates: [
      { image_url: 'https://gallery.example/one.jpg', kind: 'dom', context: 'main', page_url: 'https://gallery.example/', linked_url: 'https://gallery.example/work/one' },
      { image_url: 'https://gallery.example/two.jpg', kind: 'dom', context: 'article', page_url: 'https://gallery.example/', linked_url: 'https://gallery.example/work/two' },
      { image_url: 'https://gallery.example/other.jpg', kind: 'dom', context: 'main', page_url: 'https://gallery.example/', linked_url: 'https://other.example/work' },
      { image_url: 'https://gallery.example/ad.jpg', kind: 'dom', context: 'main', ancillary: true, page_url: 'https://gallery.example/', linked_url: 'https://gallery.example/ad' },
      { image_url: 'https://gallery.example/data.jpg', kind: 'dom', context: 'main', page_url: 'https://gallery.example/', linked_url: 'data:text/html,unsafe' },
      { image_url: 'https://gallery.example/fragment.jpg', kind: 'dom', context: 'main', page_url: 'https://gallery.example/', linked_url: 'https://gallery.example/work/fragment#details' },
      { image_url: 'https://gallery.example/about.jpg', kind: 'dom', context: 'main', page_url: 'https://gallery.example/', linked_url: 'https://gallery.example/about' },
      { image_url: 'https://gallery.example/contact.jpg', kind: 'dom', context: 'article', page_url: 'https://gallery.example/', linked_url: 'https://gallery.example/contact/' },
      { image_url: 'https://gallery.example/news.jpg', kind: 'dom', context: 'main', page_url: 'https://gallery.example/', linked_url: 'https://gallery.example/news' },
    ],
  }
  expect(discoverObservedOwnerProjectLinks(root)).toEqual([
    expect.objectContaining({ url: 'https://gallery.example/work/one', parent_source_url: root.url }),
  ])
  expect(discoverObservedOwnerProjectLinks(root, { maxLinks: 10 }).map(row => row.url)).toEqual([
    'https://gallery.example/work/one', 'https://gallery.example/work/two',
  ])
  expect(discoverObservedOwnerProjectLinks({ ...root, url: 'https://gallery.example/news', final_url: 'https://gallery.example/news' })).toEqual([])
  expect(discoverObservedOwnerProjectLinks({ ...root, fetch_status: 'fetch-ok' })).toEqual([])
})
it('keeps specific descendants of generic listing routes discoverable', () => {
  const root = {
    url: 'https://gallery.example/', final_url: 'https://gallery.example/', fetch_status: 'browser-harness',
    source_channel: 'chrome-bookmark', note_id: 'gallery-note',
    image_candidates: [{
      image_url: 'https://gallery.example/event.jpg', kind: 'dom', context: 'main', page_url: 'https://gallery.example/',
      linked_url: 'https://gallery.example/news/drinks-by-design-light-sound',
    }],
  }
  expect(discoverObservedOwnerProjectLinks(root)).toEqual([
    expect.objectContaining({ url: 'https://gallery.example/news/drinks-by-design-light-sound' }),
  ])
})
it('does not reacquire an archive-spent observed owner project link', async () => {
  vi.stubEnv('DFE_SINGLE_ANCHOR_RESEARCH', '0')
  state.verifiedFrom = Infinity
  const root = {
    url: 'https://gallery.example/', note_id: 'gallery-note', note_title: 'Gallery', note_score: 1,
    source_channel: 'chrome-bookmark', image_url: null,
  }
  const childUrl = 'https://gallery.example/work/already-used'
  state.browserChanges[root.url] = {
    fetch_status: 'browser-harness', final_url: root.url,
    image_url: 'https://gallery.example/shared.jpg',
    image_candidates: [{ image_url: 'https://gallery.example/card.jpg', kind: 'dom', context: 'main', page_url: root.url, linked_url: childUrl }],
  }
  await expect(inspectSourceCandidates({
    source_candidates: [...sources.slice(0, 18), root], notes_selected: [], motif_terms: [],
  }, {
    maxSources: 6, runDir, sourceTool: 'browser-harness', date: '2026-10-11',
    recentSourceKeys: new Set([sourceContentKey({ url: childUrl })]),
  })).rejects.toThrow(/blocked|expected at least 6/)
  expect(state.captures.some(row => row.url === childUrl)).toBe(false)
  expect(state.attempts).toHaveLength(19)
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
it('keeps an excluded exact override blocking even on a bookmark-marked harvest', async () => {
  state.rejectAnchor = true
  await expect(inspectSourceCandidates({ selection_policy: { bookmark_first: true }, source_candidates: sources, notes_selected: [], motif_terms: [] }, {
    maxSources: 6, runDir, sourceTool: 'fetch', date: '2026-10-17',
    inspirationOverride: { source_url: sources[0].url, image_url: sources[0].image_url, title: sources[0].title, prompt_bias_terms: ['exact-anchor'] },
  })).rejects.toThrow(/blocked/)
  const saved = JSON.parse(await fs.readFile(path.join(runDir, 'source-research.json'), 'utf8'))
  expect(saved.anchor_research.anchor_source.url).toBe(sources[0].url)
  await expect(fs.access(path.join(runDir, 'bookmark-acquisition.json'))).rejects.toThrow()
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
