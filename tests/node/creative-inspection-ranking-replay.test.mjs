import { it, expect, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
vi.mock('../../scripts/lib/openai-json.mjs', () => ({ openAiJson: vi.fn() }))
vi.mock('../../scripts/lib/source-image-network-policy.mjs', () => ({ resolveFetchableImageUrl: vi.fn(async u => u), fetchVettedRemoteUrl: vi.fn() }))
import { openAiJson } from '../../scripts/lib/openai-json.mjs'
import { fetchVettedRemoteUrl } from '../../scripts/lib/source-image-network-policy.mjs'
import { inspectCreativeArtifacts } from '../../scripts/lib/creative-artifact-inspection.mjs'
import { hasCreativeArtifactEvidence } from '../../scripts/lib/source-selection-policy.mjs'

it('replays the saved 60-family field without starving inspected artwork or promoting product workflows', async () => {
  const fixture = JSON.parse(await fs.readFile(new URL('../fixtures/sept30-inspection-ranking.json', import.meta.url), 'utf8'))
  const original = JSON.stringify(fixture)
  const runDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ranking-replay-'))
  try {
    expect(fixture.sources).toHaveLength(60)
    // Scheduling only: deliberately no pixel attestation or real network/model calls.
    fetchVettedRemoteUrl.mockImplementation(async () => new Response(Buffer.from('test raster'), { headers: { 'content-type': 'image/png' } }))
    openAiJson.mockReset().mockResolvedValue({ status: 'ambiguous' })
    let research = {}
    for (const count of [10, 20, 24, 24]) {
      research = await inspectCreativeArtifacts(fixture.sources, research, { runDir, signalHarvest: fixture.signalHarvest, maxInspections: 100 })
      expect(openAiJson).toHaveBeenCalledTimes(count)
    }
    const urls = research.source_decisions.map(row => row.url)
    for (const id of ['2030414755014328526', '1999962390574793046']) {
      const source = fixture.sources.find(s => s.url.endsWith('/' + id))
      expect(urls, `creative source ${id} must fit the unchanged 24-attempt cap`).toContain(source.url)
      expect(hasCreativeArtifactEvidence(source, research, fixture.signalHarvest)).toBe(false)
      const index = urls.indexOf(source.url)
      expect(openAiJson.mock.calls[index][0].input[0].content[0].text).toContain('### Related')
    }
    for (const id of ['2031592859258990632', '2049430279517810969']) {
      expect(urls.some(url => url.endsWith('/' + id)), `product workflow ${id} stays below the cap`).toBe(false)
    }
    expect(JSON.stringify(fixture)).toBe(original)
  } finally {
    await fs.rm(runDir, { recursive: true, force: true })
    vi.clearAllMocks()
  }
})

it('schedules the exhausted cycle2 provider tracks and published artwork before generic candidates', async () => {
  const fixture = JSON.parse(await fs.readFile(new URL('../fixtures/batch4-cycle2-inspection-ranking.json', import.meta.url), 'utf8'))
  const original = JSON.stringify(fixture)
  const runDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cycle2-ranking-'))
  try {
    expect(fixture.sources).toHaveLength(75)
    expect(fixture.actualAttemptUrls).toHaveLength(24)
    fetchVettedRemoteUrl.mockImplementation(async () => new Response(Buffer.from('mock raster'), { headers: { 'content-type': 'image/png' } }))
    openAiJson.mockReset().mockResolvedValue({ status: 'ambiguous', confidence: 'low' })
    let research = { source_decisions: [] }
    for (const count of [10, 20, 24, 24]) {
      // Production's first pixel batch precedes fallback text research. Preserve
      // its later exclusions without importing any prior pixel verdicts.
      if (count === 20) research.source_decisions.push(...fixture.research.source_decisions)
      research = await inspectCreativeArtifacts(fixture.sources, research, {
        runDir, signalHarvest: fixture.signalHarvest, recentSourceKeys: new Set(fixture.recentSourceKeys), maxInspections: 100,
      })
      expect(openAiJson).toHaveBeenCalledTimes(count)
    }
    const urls = research.source_decisions.filter(row => row.inspection).map(row => row.url)
    const generic = 'https://x.com/unicodeveloper/status/2015802752396394721'
    for (const url of ['https://lynn1.bandcamp.com/track/underlies', 'https://memotone.bandcamp.com/track/following']) {
      expect(fixture.actualAttemptUrls).not.toContain(url)
      expect(urls, `fresh creative candidate ${url} must fit the existing cap`).toContain(url)
      if (urls.includes(generic)) expect(urls.indexOf(url)).toBeLessThan(urls.indexOf(generic))
      expect(hasCreativeArtifactEvidence(fixture.sources.find(s => s.url === url), research, fixture.signalHarvest)).toBe(false)
    }
    expect(new Set(urls).size).toBe(24)
    expect(JSON.stringify(fixture)).toBe(original)
  } finally {
    await fs.rm(runDir, { recursive: true, force: true })
    vi.clearAllMocks()
  }
})

it.each([
  { url: 'https://artist.bandcamp.com/track/tool-demo', description: 'Our new software platform' },
  { url: 'https://x.com/demo/status/1', description: 'Our workflow tool released on @objktcom' },
  { url: 'https://artist.bandcamp.com.evil.example/track/not-a-provider', description: 'A quiet evening' },
])('does not give creative-provider priority to products or lookalike hosts: $url', async candidate => {
  const runDir = await fs.mkdtemp(path.join(os.tmpdir(), 'provider-negative-'))
  try {
    const promo = { ...candidate, image_url: 'https://example.com/demo.png', note_score: 1 }
    const neutral = { url: 'https://x.com/work/status/2', image_url: 'https://example.com/work.png', title: 'A quiet evening', note_score: 99999 }
    fetchVettedRemoteUrl.mockImplementation(async () => new Response(Buffer.from('mock raster'), { headers: { 'content-type': 'image/png' } }))
    openAiJson.mockReset().mockResolvedValue({ status: 'ambiguous' })
    const result = await inspectCreativeArtifacts([promo, neutral], {}, { runDir, maxInspections: 1 })
    expect(result.source_decisions.map(row => row.url)).toEqual([neutral.url])
  } finally {
    await fs.rm(runDir, { recursive: true, force: true })
    vi.clearAllMocks()
  }
})

it.each([
  'Prompt: improve your response format and structure',
  'Our workflow tool: Create an isometric 3D cozy room with ambient animations',
  'Create an isometric 3D cozy room with ambient animations ### Related - [[other-note]] ### Offer Try our software platform',
])('keeps generic prompts and real product pitches penalized: %s', async description => {
  const runDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ranking-negative-'))
  try {
    const promo = { url: 'https://x.com/demo/status/1', image_url: 'https://example.com/demo.png', description, note_score: 99999 }
    const neutral = { url: 'https://x.com/work/status/2', image_url: 'https://example.com/work.png', title: 'A quiet evening', note_score: 1 }
    fetchVettedRemoteUrl.mockImplementation(async () => new Response(Buffer.from('test raster'), { headers: { 'content-type': 'image/png' } }))
    openAiJson.mockReset().mockResolvedValue({ status: 'ambiguous' })
    const result = await inspectCreativeArtifacts([promo, neutral], {}, { runDir, maxInspections: 1 })
    expect(result.source_decisions.map(row => row.url)).toEqual([neutral.url])
  } finally {
    await fs.rm(runDir, { recursive: true, force: true })
    vi.clearAllMocks()
  }
})
