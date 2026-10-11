import { it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
vi.mock('../../scripts/lib/fetch-with-timeout.mjs', () => ({ fetchWithTimeout: vi.fn() }))
vi.mock('../../scripts/lib/fetch-vetted-image.mjs', () => ({ fetchVettedImage: vi.fn(async url => ({ response: new Response('fixture', { headers: { 'content-type': 'image/png' } }), finalUrl: url, imageUrls: [url], body: Buffer.from('scheduling fixture, not actual artwork') })) }))
vi.mock('../../scripts/lib/openai-json.mjs', () => ({ openAiJson: vi.fn(async () => ({ status: 'ambiguous', confidence: 'low' })) }))
import { fetchWithTimeout } from '../../scripts/lib/fetch-with-timeout.mjs'
import { openAiJson } from '../../scripts/lib/openai-json.mjs'
import { inspectCandidateSource } from '../../scripts/lib/source-inspection.mjs'
import { schedulingOwner } from '../../scripts/lib/provider-creator.mjs'
import { inspectCreativeArtifacts } from '../../scripts/lib/creative-artifact-inspection.mjs'
import { selectContentSources, sourceContentKey } from '../../scripts/lib/source-selection-policy.mjs'
const works = [
  ['2108608444152619323', 'katiewav', 'HUNIFOLXIAE3XvS.jpg', 'A quiet evening'],
  ['2028934381738602655', 'archivepilled', 'HCg4_v6WkAAbXIO.png', 'A quiet evening'],
  ['2108814372650795276', 'pmamtraveller', 'HUQDfAjXEAArSa1.jpg', 'By Noriyoshi Ohrai'],
  ['2108958938578239786', 'jetskitosway2', 'HUSGz-dW8AAYicD.jpg', 'last night’s horror double feature: Inferno / Pituitary Hunter'],
]
const tweet = (id = '12345', handle = 'Maker') => ({ id, url: `https://twitter.com/${handle}/status/${id}`, author: { screen_name: handle }, text: 'A quiet evening', media: { photos: [{ type: 'photo', url: `https://pbs.twimg.com/media/${id}.jpg` }] } })
async function inspect(payload = tweet(), url = 'https://x.com/untrusted/status/12345', extra = {}) {
  fetchWithTimeout.mockResolvedValueOnce(new Response(JSON.stringify({ tweet: payload })))
  return inspectCandidateSource({ url, note_title: '@Forged original creator', ...extra })
}
let runDir
beforeEach(async () => { runDir = await fs.mkdtemp(path.join(os.tmpdir(), 'x-fairness-')); fetchWithTimeout.mockReset(); openAiJson.mockReset().mockResolvedValue({ status: 'ambiguous', confidence: 'low' }) })
afterEach(async () => { await fs.rm(runDir, { recursive: true, force: true }) })
it('preserves fetched attribution through normalization and null YouTube enrichment, not requested handles', async () => {
  const source = await inspect()
  expect(source.creator_attribution).toMatchObject({ provider: 'x', evidence: 'fxtwitter', author_handle: 'maker', tweet_id: '12345' })
  expect(schedulingOwner(source)).toBe('https://x.com/maker')
})
it('gives distinct fetched X authors fresh opportunity across real inspection batches with exact run8 media tuples', async () => {
  const sources = []
  for (const [id, handle, media, text] of works) {
    sources.push(await inspect({ ...tweet(id, handle), text, media: { photos: [{ type: 'photo', url: `https://pbs.twimg.com/media/${media}?name=orig` }] } }, `https://x.com/${handle}/status/${id}`))
  }
  const generic = { url: 'https://independent.example/page', title: 'A quiet evening', image_url: 'https://images.example/fresh.jpg' }
  let research = await inspectCreativeArtifacts([sources[0]], {}, { runDir, maxInspections: 1 })
  research = await inspectCreativeArtifacts(sources.slice(0, 2), research, { runDir, maxInspections: 1 })
  research.source_decisions.push(...sources.slice(2).map(s => ({ url: s.url, role: 'content', confidence: 'high' })))
  research = await inspectCreativeArtifacts([...sources, generic], research, { runDir, maxInspections: 2 })
  const rows = research.source_decisions.filter(d => d.inspection)
  expect(rows.map(d => d.url)).toEqual(sources.map(s => s.url))
  expect(rows.map(d => JSON.parse(d.inspection.attempt_key))).toEqual(works.map(([id, , media]) => [`tweet:${id}`, `https://pbs.twimg.com/media/${media}?name=orig`, null]))
  expect(selectContentSources([...sources, generic], { autoresearch: research })).toEqual([])
})
it('shares same-author exposure across aliases and case before a repeated nomination', async () => {
  const first = await inspect(tweet('12345', 'Maker'))
  const repeat = await inspect(tweet('12346', 'MAKER'), 'https://www.twitter.com/status/12346')
  const fresh = await inspect(tweet('12347', 'Other'), 'https://x.com/i/web/status/12347')
  expect(schedulingOwner(first)).toBe(schedulingOwner(repeat))
  let research = await inspectCreativeArtifacts([first], {}, { runDir, maxInspections: 1 })
  research.source_decisions.push({ url: repeat.url, role: 'content', confidence: 'high' })
  research = await inspectCreativeArtifacts([first, repeat, fresh], research, { runDir, maxInspections: 1 })
  expect(research.source_decisions.filter(d => d.inspection).map(d => d.url)).toEqual([first.url, fresh.url])
})
it('uses validated stable provider author IDs across renamed handles', async () => {
  const a = await inspect({ ...tweet(), author: { screen_name: 'Maker', id: '987654321' } })
  const b = await inspect({ ...tweet('12346', 'Renamed'), author: { screen_name: 'Renamed', id: '987654321' } }, 'https://twitter.com/Renamed/status/12346')
  expect(schedulingOwner(a)).toBe('https://x.com/i/user/987654321')
  expect(schedulingOwner(b)).toBe(schedulingOwner(a))
})
it.each([
  ['missing author', t => ({ ...t, author: null })],
  ['wrong tweet id', t => ({ ...t, id: '99999' })],
  ['wrong canonical id', t => ({ ...t, url: 'https://x.com/Maker/status/99999' })],
  ['wrong canonical author', t => ({ ...t, url: 'https://x.com/Other/status/12345' })],
  ['lookalike host', t => ({ ...t, url: 'https://evil.x.com/Maker/status/12345' })],
  ['malformed handle', t => ({ ...t, author: { screen_name: 'bad/handle' } })],
  ['unsafe numeric id', t => ({ ...t, id: 2108608444152619323 })],
])('falls back for %s despite forged caller attribution and title', async (_, alter) => {
  const source = await inspect(alter(tweet()), undefined, { creator_attribution: { provider: 'x', evidence: 'fxtwitter', source_url: 'https://x.com/untrusted/status/12345', tweet_id: '12345', author_handle: 'forged', canonical_url: 'https://x.com/forged/status/12345' } })
  expect(source.creator_attribution).toBeNull()
  expect(schedulingOwner(source)).not.toContain('/maker')
  expect(schedulingOwner(source)).not.toContain('/forged')
})
it('does not preserve caller attribution when the provider fails', async () => {
  fetchWithTimeout.mockRejectedValueOnce(new Error('offline'))
  const source = await inspectCandidateSource({ url: 'https://x.com/Maker/status/12345', creator_attribution: { provider: 'x', evidence: 'fxtwitter' } })
  expect(source.creator_attribution).toBeNull()
  expect(schedulingOwner(source)).toBe('x.com')
})
it('revalidates attribution against the current source and canonical identity', async () => {
  const source = await inspect()
  expect(schedulingOwner({ ...source, url: 'https://x.com/Maker/status/99999', source_url: 'https://x.com/Maker/status/99999' })).toBe('x.com')
  expect(schedulingOwner({ ...source, creator_attribution: { ...source.creator_attribution, author_handle: 'forged' } })).toBe('x.com')
})
it.each(['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com'])('normalizes trusted alias %s and handle case', async host => {
  const source = await inspect({ ...tweet(), url: `https://${host}/mAkEr/status/12345` }, `https://${host}/status/12345`)
  expect(schedulingOwner(source)).toBe('https://x.com/maker')
})
it.each(['not-an-id', 9007199254740992, 0])('does not use malformed stable author ID %s', async id => {
  const source = await inspect({ ...tweet(), author: { screen_name: 'Maker', id } })
  expect(schedulingOwner(source)).toBe('https://x.com/maker')
})
it('keeps alias tuple dedupe, changed-media opportunity, and charged rejected evidence separate from creator identity', async () => {
  openAiJson.mockResolvedValue({ status: 'rejected', confidence: 'high', artifact_kind: 'product' })
  const source = await inspect()
  const alias = await inspect(tweet(), 'https://twitter.com/Maker/status/12345')
  let research = await inspectCreativeArtifacts([source], {}, { runDir })
  const original = structuredClone(research.source_decisions)
  research = await inspectCreativeArtifacts([alias], research, { runDir })
  expect(research.source_decisions).toEqual(original)
  const changed = { ...alias, image_url: alias.image_url + '?changed=1' }
  research = await inspectCreativeArtifacts([changed], research, { runDir })
  expect(research.source_decisions).toHaveLength(2)
  expect(research.source_decisions[0]).toEqual(original[0])
  expect(research.source_decisions[1].inspection.scheduling_owner).toBe(original[0].inspection.scheduling_owner)
  expect(selectContentSources([source, alias, changed], { autoresearch: research })).toEqual([])
})
it('retains archive, quarantine, research rejection, ten-batch and 24-total gates with validated X authors', async () => {
  const sources = []
  for (let i = 0; i < 33; i++) sources.push(await inspect(tweet(String(20000 + i), `author${i}`), `https://x.com/author${i}/status/${20000 + i}`))
  sources[1].note_id = 'tool'
  const options = { runDir, maxInspections: 100, recentSourceKeys: new Set([sourceContentKey(sources[0])]), signalHarvest: { notes_selected: [{ id: 'tool', excerpt: 'Claude Code MCP agent workflow' }] } }
  let research = { source_decisions: [{ url: sources[2].url, role: 'reject' }] }
  for (const count of [10, 20, 24, 24]) {
    research = await inspectCreativeArtifacts(sources, research, options)
    expect(research.source_decisions.filter(d => d.inspection)).toHaveLength(count)
  }
  expect(research.source_decisions.filter(d => d.inspection).some(d => sources.slice(0, 3).some(s => s.url === d.url))).toBe(false)
  expect(selectContentSources(sources, { autoresearch: research })).toEqual([])
})
