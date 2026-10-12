import { it, expect, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
vi.mock('../../scripts/lib/openai-json.mjs', () => ({ openAiJson: vi.fn(async () => ({ status: 'ambiguous', confidence: 'low' })) }))
vi.mock('../../scripts/lib/source-image-network-policy.mjs', () => ({ resolveFetchableImageUrl: vi.fn(async u => u), fetchVettedRemoteUrl: vi.fn(async () => new Response(Buffer.from('synthetic scheduling only'), { headers: { 'content-type': 'image/png' } })) }))
import { openAiJson } from '../../scripts/lib/openai-json.mjs'
import { selectAnchorSource } from '../../scripts/lib/anchor-source-research.mjs'
import { inspectCreativeArtifacts } from '../../scripts/lib/creative-artifact-inspection.mjs'
import { selectContentSources } from '../../scripts/lib/source-selection-policy.mjs'

const { source } = JSON.parse(await fs.readFile(new URL('../fixtures/run10-assistant-curator.json', import.meta.url), 'utf8'))
const nomination = candidate => ({ url: candidate.url, role: 'content', confidence: 'high' })
const neutral = i => ({ url: `https://publisher${i}.example/item`, title: 'A quiet evening', image_url: `https://publisher${i}.example/image.png`, note_score: 99999 })

it('does not penalize the captured human Assistant Curator title', () => {
  expect(selectAnchorSource([source]).anchor_selection_lane).toBe('general')
})

it('gives the nominated Buren work a bounded inspection opportunity, not admission', async () => {
  const sources = [...Array.from({ length: 25 }, (_, i) => neutral(i)), source]
  const before = JSON.stringify(sources)
  const runDir = await fs.mkdtemp(path.join(os.tmpdir(), 'assistant-curator-'))
  openAiJson.mockClear()
  try {
    let research = { source_decisions: [nomination(source)] }
    for (const count of [10, 20, 24, 24]) {
      research = await inspectCreativeArtifacts(sources, research, { runDir, maxInspections: 100 })
      expect(openAiJson).toHaveBeenCalledTimes(count)
    }
    const attempts = research.source_decisions.filter(row => row.inspection)
    expect(attempts[0].url).toBe(source.url)
    expect(new Set(attempts.map(row => row.inspection.attempt_key)).size).toBe(24)
    expect(openAiJson.mock.calls[0][0].input[0].content[0].text).toContain('Assistant Curator of contemporary art, Jordan Carter')
    expect(selectContentSources(sources, { autoresearch: research })).toEqual([])
    expect(JSON.stringify(sources)).toBe(before)
  } finally { await fs.rm(runDir, { recursive: true, force: true }) }
})

it.each([
  'An AI assistant for the museum.',
  'An AI assistant curator for the museum.',
  'An assistant for the museum.',
  'An assistant curatorship service.',
  'Agent workflow automation.',
  'A prompt guide for Claude.',
])('preserves tooling penalties alongside the human title: %s', async pitch => {
  const product = { ...source, description: `${source.description}. ${pitch}` }
  // Existing quarantine may reject before ranking; neither outcome may be promoted.
  expect([undefined, 'ai-tooling-penalized']).toContain(selectAnchorSource([product])?.anchor_selection_lane)
  const runDir = await fs.mkdtemp(path.join(os.tmpdir(), 'curator-tooling-'))
  try {
    const ordinary = neutral(0)
    const research = await inspectCreativeArtifacts([product, ordinary], { source_decisions: [nomination(product)] }, { runDir, maxInspections: 1 })
    expect(research.source_decisions.filter(row => row.inspection).map(row => row.url)).toEqual([ordinary.url])
    expect(selectContentSources([product, ordinary], { autoresearch: research })).toEqual([])
  } finally { await fs.rm(runDir, { recursive: true, force: true }) }
})

it.each([
  'An AI\nassistant curator for the museum.',
  'An AI-powered assistant curator for the museum.',
  'An artificial intelligence assistant curator for the museum.',
  'An artificial-intelligence assistant curator for the museum.',
  'An AI\t assistant curator for the museum.',
])('retains the old penalty and scheduling demotion for explicit AI: %s', async description => {
  const product = { ...source, description }
  expect(selectAnchorSource([product]).anchor_selection_lane).toBe('ai-tooling-penalized')
  const runDir = await fs.mkdtemp(path.join(os.tmpdir(), 'curator-explicit-ai-'))
  try {
    const ordinary = neutral(0)
    const research = await inspectCreativeArtifacts([product, ordinary], { source_decisions: [nomination(product)] }, { runDir, maxInspections: 1 })
    expect(research.source_decisions.filter(row => row.inspection).map(row => row.url)).toEqual([ordinary.url])
    expect(selectContentSources([product, ordinary], { autoresearch: research })).toEqual([])
  } finally { await fs.rm(runDir, { recursive: true, force: true }) }
})

it('does not exempt museum-hosted tooling URLs when the human title is present', () => {
  expect(selectAnchorSource([{ ...source, url: 'https://www.artic.edu/mcp' }])).toBeNull()
})
