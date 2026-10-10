import { it, expect, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
vi.mock('../../scripts/lib/openai-json.mjs', () => ({ openAiJson: vi.fn(async () => ({ status: 'ambiguous', confidence: 'low' })) }))
vi.mock('../../scripts/lib/source-image-network-policy.mjs', () => ({ resolveFetchableImageUrl: vi.fn(async u => u), fetchVettedRemoteUrl: vi.fn(async () => new Response(Buffer.from('synthetic scheduling only'), { headers: { 'content-type': 'image/png' } })) }))
import { inspectCreativeArtifacts } from '../../scripts/lib/creative-artifact-inspection.mjs'
import { selectContentSources } from '../../scripts/lib/source-selection-policy.mjs'

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
