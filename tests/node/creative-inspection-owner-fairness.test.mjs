import { it, expect, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
vi.mock('../../scripts/lib/openai-json.mjs', () => ({ openAiJson: vi.fn(async () => ({ status: 'ambiguous', confidence: 'low' })) }))
vi.mock('../../scripts/lib/source-image-network-policy.mjs', () => ({ resolveFetchableImageUrl: vi.fn(async u => u), fetchVettedRemoteUrl: vi.fn(async () => new Response(Buffer.from('synthetic scheduling only'), { headers: { 'content-type': 'image/png' } })) }))
import { inspectCreativeArtifacts } from '../../scripts/lib/creative-artifact-inspection.mjs'
import { selectContentSources } from '../../scripts/lib/source-selection-policy.mjs'

it('charges validated provider authors separately, not titles or untrusted author URLs', async () => {
  const runDir = await fs.mkdtemp(path.join(os.tmpdir(), 'provider-fairness-'))
  const page = (id, score, author = null) => ({ url: `https://www.youtube.com/watch?v=${id}`, title: 'A quiet evening', image_url: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`, note_score: score,
    ...(author ? { creator_attribution: { provider: 'youtube', source_url: `https://www.youtube.com/watch?v=${id}`, author_url: `https://www.youtube.com/@${author}`, evidence: 'oembed' } } : {}) })
  const sources = [page('first', 1000, 'ownerA'), page('repeat', 900, 'ownerA'), page('other', 1, 'ownerB')]
  try {
    let research = await inspectCreativeArtifacts(sources, {}, { runDir, maxInspections: 1 })
    research = await inspectCreativeArtifacts(sources, research, { runDir, maxInspections: 1 })
    expect(research.source_decisions.map(d => d.url)).toEqual([sources[0].url, sources[2].url])
    expect(research.source_decisions[0].inspection.scheduling_owner).not.toBe(research.source_decisions[1].inspection.scheduling_owner)
    expect(selectContentSources(sources, { autoresearch: research })).toEqual([])
    const invalid = [page('untrusted1', 2), page('untrusted2', 1)]
    invalid[0].author_url = 'https://www.youtube.com/@invented'
    invalid[1].creator_attribution = { ...sources[0].creator_attribution, source_url: invalid[1].url, author_url: 'https://evil.example/@owner' }
    const fallback = await inspectCreativeArtifacts(invalid, {}, { runDir, maxInspections: 2 })
    expect(fallback.source_decisions.map(d => d.inspection.scheduling_owner)).toEqual(['youtube.com', 'youtube.com'])
  } finally { await fs.rm(runDir, { recursive: true, force: true }) }
})

it.each(['content', 'anchor'])('does not let a generic %s nomination starve a fresh independent owner', async role => {
  const runDir = await fs.mkdtemp(path.join(os.tmpdir(), 'generic-nomination-'))
  const sources = [
    { url: 'https://crowded.example/first', title: 'A quiet evening', image_url: 'https://images.example/first.jpg', note_score: 1000 },
    { url: 'https://short.example/next', final_url: 'https://crowded.example/next', title: 'A quiet evening', image_url: 'https://images.example/next.jpg', note_score: 900 },
    { url: 'https://independent.example/page', title: 'A quiet evening', image_url: 'https://images.example/fresh.jpg', note_score: 1 },
  ]
  const original = JSON.stringify(sources)
  try {
    let research = await inspectCreativeArtifacts(sources, {}, { runDir, maxInspections: 1 })
    research.source_decisions.push({ url: sources[1].final_url, role, confidence: 'high', why: 'An extraordinary specific creative artwork nomination' })
    research = await inspectCreativeArtifacts(sources, research, { runDir, maxInspections: 1 })
    expect(research.source_decisions.filter(d => d.inspection).map(d => d.url)).toEqual([sources[0].url, sources[2].url])
    research = await inspectCreativeArtifacts(sources, research, { runDir, maxInspections: 1 })
    expect(research.source_decisions.filter(d => d.inspection).at(-1).url).toBe(sources[1].url)
    expect(selectContentSources(sources, { autoresearch: research })).toEqual([])
    expect(JSON.stringify(sources)).toBe(original)
  } finally { await fs.rm(runDir, { recursive: true, force: true }) }
})

it('keeps generic nominations ahead of richer peers at equal owner exposure', async () => {
  const runDir = await fs.mkdtemp(path.join(os.tmpdir(), 'generic-tie-'))
  const sources = [
    { url: 'https://rich.example/page', title: 'A quiet evening', image_url: 'https://images.example/rich.jpg', note_score: 1000 },
    { url: 'https://nominated.example/page', title: 'A quiet evening', image_url: 'https://images.example/nominated.jpg', note_score: 1 },
  ]
  try {
    const research = await inspectCreativeArtifacts(sources, { source_decisions: [{ url: sources[1].url, role: 'content', confidence: 'medium' }] }, { runDir, maxInspections: 1 })
    expect(research.source_decisions.filter(d => d.inspection).map(d => d.url)).toEqual([sources[1].url])
  } finally { await fs.rm(runDir, { recursive: true, force: true }) }
})

it.each(['An original finger painting', 'A short animation', 'A live music performance'])('keeps specific creative nominations protected across owner exposure: %s', async description => {
  const runDir = await fs.mkdtemp(path.join(os.tmpdir(), 'specific-nomination-'))
  const sources = [
    { url: 'https://crowded.example/first', title: 'A quiet evening', image_url: 'https://images.example/first.jpg', note_score: 1000 },
    { url: 'https://crowded.example/work', title: 'A quiet evening', description, image_url: 'https://images.example/work.jpg', note_score: 900 },
    { url: 'https://independent.example/page', title: 'A quiet evening', image_url: 'https://images.example/fresh.jpg', note_score: 1 },
  ]
  try {
    let research = await inspectCreativeArtifacts([sources[0]], {}, { runDir, maxInspections: 1 })
    research.source_decisions.push({ url: sources[1].url, role: 'content', confidence: 'medium' })
    research = await inspectCreativeArtifacts(sources, research, { runDir, maxInspections: 1 })
    expect(research.source_decisions.filter(d => d.inspection).map(d => d.url)).toEqual([sources[0].url, sources[1].url])
    expect(selectContentSources(sources, { autoresearch: research })).toEqual([])
  } finally { await fs.rm(runDir, { recursive: true, force: true }) }
})

it('shares a priority lane across resolved owners, retaining fairness across batches and the 24 cap', async () => {
  const runDir = await fs.mkdtemp(path.join(os.tmpdir(), 'owner-fairness-'))
  const page = (url, score) => ({ url, title: 'A quiet evening', image_url: `${url}/image.jpg`, note_score: score })
  const crowded = Array.from({ length: 30 }, (_, i) => page(`https://crowded.example/work-${i}`, 1000 - i))
  // Redirects must not buy a second owner lane.
  crowded[1] = { ...crowded[1], url: 'https://short.example/link', final_url: 'https://crowded.example/work-1' }
  const independent = Array.from({ length: 6 }, (_, i) => page(`https://independent-${i}.example/work`, 1))
  try {
    let research = await inspectCreativeArtifacts([...crowded, ...independent], {}, { runDir, maxInspections: 1 })
    expect(research.source_decisions[0].url).toBe(crowded[0].url)
    research = await inspectCreativeArtifacts([...crowded, ...independent], research, { runDir, maxInspections: 6 })
    expect(research.source_decisions.slice(1).map(d => d.url)).toEqual(independent.map(s => s.url))
    for (let i = 0; i < 3; i++) research = await inspectCreativeArtifacts([...crowded, ...independent], research, { runDir })
    expect(research.source_decisions.filter(d => d.inspection)).toHaveLength(24)
    expect(selectContentSources([...crowded, ...independent], { autoresearch: research })).toEqual([])
  } finally { await fs.rm(runDir, { recursive: true, force: true }) }
})
