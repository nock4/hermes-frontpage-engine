import { it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
vi.mock('../../scripts/lib/openai-json.mjs', () => ({ openAiJson: vi.fn() }))
vi.mock('../../scripts/lib/source-image-network-policy.mjs', () => ({ resolveFetchableImageUrl: vi.fn(async u => u), fetchVettedRemoteUrl: vi.fn() }))
import { openAiJson } from '../../scripts/lib/openai-json.mjs'
import { fetchVettedRemoteUrl } from '../../scripts/lib/source-image-network-policy.mjs'
import { inspectCreativeArtifacts } from '../../scripts/lib/creative-artifact-inspection.mjs'
import { hasCreativeArtifactEvidence } from '../../scripts/lib/source-selection-policy.mjs'
import { canonicalizeSourceUrl } from '../../scripts/lib/source-url-policy.mjs'
const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64')
const original = { url: 'https://huggingface.co/0xSero/gemma-4-21b-a4b-it-REAP', final_url: 'https://huggingface.co/0xSero/Gemma-4-21B', image_url: 'https://cdn.example/preview.png' }
const alias = { ...original, url: 'https://t.co/5x4qCDuZ5b' }
let runDir
beforeEach(async () => {
  runDir = await fs.mkdtemp(path.join(os.tmpdir(), 'inspection-resolved-alias-'))
  fetchVettedRemoteUrl.mockReset().mockImplementation(async () => new Response(bytes, { headers: { 'content-type': 'image/png' } }))
  openAiJson.mockReset().mockResolvedValue({ status: 'rejected', artifact_kind: 'product', confidence: 'high' })
})
afterEach(async () => { await fs.rm(runDir, { recursive: true, force: true }) })
it.each(['rejected', 'ambiguous', 'unknown', 'verified'])('dedupes resolved aliases within and across batches without transferring %s evidence', async status => {
  openAiJson.mockResolvedValue({ status, artifact_kind: 'artwork', confidence: 'high' })
  let research = await inspectCreativeArtifacts([original, alias], {}, { runDir })
  expect(openAiJson).toHaveBeenCalledTimes(1)
  expect(fetchVettedRemoteUrl).toHaveBeenCalledTimes(1)
  expect(research.source_decisions.map(row => row.url)).toEqual([original.url])
  const saved = structuredClone(research)
  research = await inspectCreativeArtifacts([alias], research, { runDir })
  expect(openAiJson).toHaveBeenCalledTimes(1)
  expect(research).toEqual(saved)
  expect(hasCreativeArtifactEvidence(alias, research)).toBe(false)
  expect(JSON.parse(await fs.readFile(path.join(runDir, 'creative-inspections.json'), 'utf8'))).toEqual(saved.source_decisions)
})
it('keeps independent owning pages and exact changed image or representative media opportunities', async () => {
  const video = { ...original, media_type: 'video', media_url: 'https://cdn.example/work.mp4' }
  let research = await inspectCreativeArtifacts([video], {}, { runDir })
  const candidates = [
    { ...alias, media_type: 'video', media_url: video.media_url },
    { ...video, url: 'https://t.co/image-change', image_url: original.image_url + '?v=2' },
    { ...video, url: 'https://t.co/video-change', media_url: video.media_url + '?v=2' },
    { ...video, url: 'https://t.co/other-owner', final_url: 'https://huggingface.co/Other/Work' },
    { ...video, url: 'https://t.co/other-work', final_url: 'https://huggingface.co/0xSero/Other' },
  ]
  research = await inspectCreativeArtifacts(candidates, research, { runDir })
  expect(openAiJson).toHaveBeenCalledTimes(5)
  expect(research.source_decisions.slice(1).map(row => row.url).sort()).toEqual(candidates.slice(1).map(row => row.url).sort())
})
it.each([1, 2])('rekeys legacy v%i attempts for scheduling without rewriting evidence or refunding charges', async version => {
  const inspection = { source_url: original.url, media_url: original.image_url, status: 'rejected', attempt_key_version: version, attempt_key: JSON.stringify([version === 2 ? canonicalizeSourceUrl(original.url) : original.url, original.image_url, null]) }
  const oldRows = Array.from({ length: 23 }, () => ({ url: original.url, inspection: structuredClone(inspection) }))
  const fresh = { ...original, url: 'https://huggingface.co/0xSero/Fresh', final_url: 'https://huggingface.co/0xSero/Fresh' }
  let research = await inspectCreativeArtifacts([original, alias, fresh], { source_decisions: structuredClone(oldRows) }, { runDir, maxInspections: 100 })
  expect(research.source_decisions.at(-1).url).toBe(fresh.url)
  expect(research.source_decisions.slice(0, 23)).toEqual(oldRows)
  expect(openAiJson).toHaveBeenCalledTimes(1)
  research = await inspectCreativeArtifacts([{ ...fresh, image_url: fresh.image_url + '?v=2' }], research, { runDir })
  expect(research.source_decisions).toHaveLength(24)
  expect(openAiJson).toHaveBeenCalledTimes(1)
})
it('retains the ten-call batch ceiling and research rejections', async () => {
  const rejected = { ...original, url: 'https://reject.example/work', final_url: 'https://reject.example/work' }
  const fresh = Array.from({ length: 15 }, (_, i) => ({ ...original, url: `https://fresh${i}.example/work`, final_url: `https://fresh${i}.example/work` }))
  const research = await inspectCreativeArtifacts([rejected, original, alias, ...fresh], { source_decisions: [{ url: rejected.url, role: 'reject' }] }, { runDir, maxInspections: 100 })
  const rows = research.source_decisions.filter(row => row.inspection)
  expect(rows).toHaveLength(10)
  expect(rows.some(row => row.url === rejected.url || row.url === alias.url)).toBe(false)
  expect(openAiJson).toHaveBeenCalledTimes(10)
})
