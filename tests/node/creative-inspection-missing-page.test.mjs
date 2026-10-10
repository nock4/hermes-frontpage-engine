import { it, expect, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
vi.mock('../../scripts/lib/openai-json.mjs', () => ({ openAiJson: vi.fn(async () => ({ status: 'ambiguous', confidence: 'low' })) }))
vi.mock('../../scripts/lib/source-image-network-policy.mjs', () => ({ resolveFetchableImageUrl: vi.fn(async u => u), fetchVettedRemoteUrl: vi.fn(async () => new Response(Buffer.from('synthetic scheduling only'), { headers: { 'content-type': 'image/png' } })) }))
import { inspectCreativeArtifacts } from '../../scripts/lib/creative-artifact-inspection.mjs'
import { selectContentSources } from '../../scripts/lib/source-selection-policy.mjs'

const page = (host, fields = {}) => ({ url: `https://${host}.example/item`, title: 'A quiet evening', image_url: `https://${host}.example/image.jpg`, note_score: 1, ...fields })
it.each(['museum', 'garden', 'publisher'])('demotes corroborated current missing pages without host-specific rules: %s', async host => {
  const sources = [page(host, { title: 'Page not found - Collection', description: 'OOPS! We have moved the page you are looking for. Back to Home. Site Map.', note_score: 1800, note_title: 'An original painting' }), page('fresh')]
  const before = JSON.stringify(sources)
  const runDir = await fs.mkdtemp(path.join(os.tmpdir(), 'missing-page-'))
  try {
    const research = await inspectCreativeArtifacts(sources, { source_decisions: [{ url: sources[0].url, role: 'content', confidence: 'high' }] }, { runDir, maxInspections: 1 })
    expect(research.source_decisions.filter(d => d.inspection).map(d => d.url)).toEqual([sources[1].url])
    expect(selectContentSources(sources, { autoresearch: research })).toEqual([])
    expect(JSON.stringify(sources)).toBe(before)
  } finally { await fs.rm(runDir, { recursive: true, force: true }) }
})

it.each([
  { title: 'Page Not Found', description: 'An original painting about the disappearing web.' },
  { title: 'Collected essays', description: 'An essay discussing the message Page not found and the Back to Home link.' },
  { title: 'A quiet evening', description: 'Welcome back to home.', fetch_status: 'fetch-ok', editorial_evidence: [{ title: 'Page not found', description: 'Oops! Back to Home.', fetch_status: 'fetch-http-404' }] },
])('does not demote uncorroborated artwork, quoted errors or stale failures: $title', async fields => {
  const sources = [page('rich', { ...fields, note_score: 1800 }), page('fresh')]
  const runDir = await fs.mkdtemp(path.join(os.tmpdir(), 'missing-controls-'))
  try {
    const research = await inspectCreativeArtifacts(sources, {}, { runDir, maxInspections: 1 })
    expect(research.source_decisions.map(d => d.url)).toEqual([sources[0].url])
    expect(selectContentSources(sources, { autoresearch: research })).toEqual([])
  } finally { await fs.rm(runDir, { recursive: true, force: true }) }
})
