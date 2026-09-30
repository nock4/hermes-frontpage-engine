import { it, expect, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
vi.mock('../../scripts/lib/openai-json.mjs',()=>({openAiJson:vi.fn()}))
vi.mock('../../scripts/lib/source-image-network-policy.mjs',()=>({resolveFetchableImageUrl:vi.fn(async u=>u),fetchVettedRemoteUrl:vi.fn()}))
import { openAiJson } from '../../scripts/lib/openai-json.mjs'
import { fetchVettedRemoteUrl } from '../../scripts/lib/source-image-network-policy.mjs'
import { inspectCreativeArtifacts } from '../../scripts/lib/creative-artifact-inspection.mjs'
import { sourceContentKey, hasCreativeArtifactEvidence } from '../../scripts/lib/source-selection-policy.mjs'
const bytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64')
const source={url:'https://art.example/work',image_url:'https://art.example/art.png'}
it('skips an archived prefix and exclusions before spending the bounded inspection budget', async () => {
 const runDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ingestion-archive-'))
 try {
  const archived = Array.from({ length: 30 }, (_, i) => ({ url: `https://archive${i}.example/work`, image_url: `https://archive${i}.example/art.png` }))
  const fresh = Array.from({ length: 30 }, (_, i) => ({ url: `https://fresh${i}.example/work`, image_url: `https://fresh${i}.example/art.png` }))
  const staleImage = { ...source, image_url: archived[0].image_url }
  const rejected = { ...source, url: 'https://rejected.example/work' }
  const quarantined = { ...source, note_id: 'tool' }
  const sources = [...archived, staleImage, rejected, quarantined, ...fresh]
  const recentSourceKeys = new Set(archived.map(sourceContentKey))
  recentSourceKeys.add(sourceContentKey({ url: archived[0].image_url }))
  const options = { runDir, recentSourceKeys, maxInspections: 100, signalHarvest: { notes_selected: [{ id: 'tool', excerpt: 'Claude Code MCP agent workflow' }] } }
  fetchVettedRemoteUrl.mockImplementation(async () => new Response(bytes, { headers: { 'content-type': 'image/png' } }))
  openAiJson.mockReset().mockResolvedValue({ status: 'ambiguous' })
  let research = { source_decisions: [{ url: rejected.url, role: 'reject' }] }
  for (const count of [10, 20, 24, 24]) {
   research = await inspectCreativeArtifacts(sources, research, options)
   expect(openAiJson).toHaveBeenCalledTimes(count)
  }
  expect(research.source_decisions.filter(row => row.inspection).map(row => row.url)).toEqual(fresh.slice(0, 24).map(row => row.url))
 } finally { await fs.rm(runDir, { recursive: true, force: true }); openAiJson.mockClear() }
})
it('prioritizes fresh creative media over a high-score tool promo and folder-only hints', async () => {
 const runDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ingestion-priority-'))
 try {
  const promo = { ...source, url: 'https://example.com/promo', title: 'A new AI writing tool demo', note_score: 99999 }
  const folderOnly = { ...source, url: 'https://example.com/plain', note_path: 'themes/artwork/painting/gallery.md', note_score: 99999 }
  const creative = { ...source, url: 'https://x.com/painter/status/123', title: 'A painting in my new exhibition', note_score: 1 }
  const stale = { ...creative, url: 'https://x.com/painter/status/124', image_url: 'https://example.com/spent.jpg' }
  const quarantined = { ...creative, url: 'https://x.com/painter/status/125', note_id: 'tool' }
  fetchVettedRemoteUrl.mockImplementation(async () => new Response(bytes, { headers: { 'content-type': 'image/png' } }))
  openAiJson.mockReset().mockResolvedValue({ status: 'ambiguous' })
  const r = await inspectCreativeArtifacts([promo, folderOnly, stale, quarantined, creative], {}, {
   runDir, maxInspections: 1, recentSourceKeys: new Set([sourceContentKey(stale)]),
   signalHarvest: { notes_selected: [{ id: 'tool', excerpt: 'Claude Code MCP agent workflow' }] },
  })
  expect(r.source_decisions.map(row => row.url)).toEqual([creative.url])
  expect(hasCreativeArtifactEvidence(creative, r)).toBe(false)
 } finally { await fs.rm(runDir, { recursive: true, force: true }); openAiJson.mockClear() }
})
it('does not let photo language in a tool promo outrank actual game media', async () => {
 const runDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ingestion-promo-'))
 try {
  const promo = { ...source, url: 'https://x.com/example/status/123', title: 'AI tool tracks your location: upload a photo to get coordinates', note_score: 99999 }
  const game = { ...source, url: 'https://x.com/example/status/124', title: 'A relaxing bird game over the ocean', note_score: 1 }
  fetchVettedRemoteUrl.mockImplementation(async () => new Response(bytes, { headers: { 'content-type': 'image/png' } }))
  openAiJson.mockReset().mockResolvedValue({ status: 'ambiguous' })
  const r = await inspectCreativeArtifacts([promo, game], {}, { runDir, maxInspections: 1 })
  expect(r.source_decisions.map(row => row.url)).toEqual([game.url])
 } finally { await fs.rm(runDir, { recursive: true, force: true }); openAiJson.mockClear() }
})
it.each(['rejected', 'ambiguous', 'unknown'])('dedupes named/authorless tweet %s attempts across batches only for identical media', async status => {
 const runDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ingestion-family-'))
 try {
  const named = { ...source, url: 'https://twitter.com/painter/status/123', media_type: 'video', media_url: 'https://example.com/video.mp4' }
  const alias = { ...named, url: 'https://x.com/status/123' }
  fetchVettedRemoteUrl.mockImplementation(async () => new Response(bytes, { headers: { 'content-type': 'image/png' } }))
  openAiJson.mockReset().mockResolvedValue({ status })
  let r = await inspectCreativeArtifacts([named, alias], {}, { runDir })
  expect(openAiJson).toHaveBeenCalledTimes(1)
  r = await inspectCreativeArtifacts([alias], r, { runDir })
  expect(openAiJson).toHaveBeenCalledTimes(1)
  r = await inspectCreativeArtifacts([{ ...alias, image_url: source.image_url + '?changed=1' }, { ...alias, media_url: 'https://example.com/other.mp4' }, { ...alias, url: 'https://example.com/status/123' }], r, { runDir })
  expect(openAiJson).toHaveBeenCalledTimes(4)
  expect(hasCreativeArtifactEvidence(alias, r)).toBe(false)
 } finally { await fs.rm(runDir, { recursive: true, force: true }); openAiJson.mockClear() }
})
it('honors legacy family failures without refunding actual attempts from the run cap', async () => {
 const runDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ingestion-legacy-'))
 try {
  const named = 'https://twitter.com/painter/status/123'
  const alias = { ...source, url: 'https://x.com/status/123' }
  const inspection = { source_url: named, media_url: source.image_url, status: 'unknown', attempt_key: JSON.stringify([named, source.image_url, source.image_url]) }
  const research = { source_decisions: Array.from({ length: 23 }, () => ({ url: named, inspection })) }
  fetchVettedRemoteUrl.mockImplementation(async () => new Response(bytes, { headers: { 'content-type': 'image/png' } }))
  openAiJson.mockReset().mockResolvedValue({ status: 'unknown' })
  const r = await inspectCreativeArtifacts([alias, { ...source, url: 'https://example.com/fresh' }, { ...source, url: 'https://example.com/another' }], research, { runDir })
  expect(openAiJson).toHaveBeenCalledTimes(1)
  expect(r.source_decisions.at(-1).url).toBe('https://example.com/fresh')
 } finally { await fs.rm(runDir, { recursive: true, force: true }); openAiJson.mockClear() }
})
it('passes exact raster bytes to model, caches failures and caps a batch',async()=>{
 const runDir=await fs.mkdtemp(path.join(os.tmpdir(),'ingestion-'))
 fetchVettedRemoteUrl.mockImplementation(async()=>new Response(bytes,{headers:{'content-type':'image/png'}}))
 openAiJson.mockResolvedValue({status:'unknown'})
 let r=await inspectCreativeArtifacts([source,{...source,url:source.url+'2'}],{}, {runDir,maxInspections:1})
 expect(openAiJson).toHaveBeenCalledTimes(1)
 const image=openAiJson.mock.calls[0][0].input[0].content[1].image_url
 expect(Buffer.from(image.split(',')[1],'base64')).toEqual(bytes)
 expect(await fs.readFile(r.source_decisions[0].inspection.capture_path)).toEqual(bytes)
 r=await inspectCreativeArtifacts([source],r,{runDir})
 expect(openAiJson).toHaveBeenCalledTimes(1)
 expect(hasCreativeArtifactEvidence(source,r)).toBe(false)
 expect(JSON.parse(await fs.readFile(path.join(runDir,'source-autoresearch.json'),'utf8'))).toEqual(r)
})
it('propagates inspection deadline and caches timeout as ineligible without retry', async()=>{
 const runDir=await fs.mkdtemp(path.join(os.tmpdir(),'ingestion-timeout-'))
 openAiJson.mockReset().mockRejectedValue(new Error('Hermes inspection timed out after 25ms'))
 let r=await inspectCreativeArtifacts([source],{}, {runDir,inspectionTimeoutMs:25})
 expect(openAiJson.mock.calls[0][0].timeoutMs).toBe(25)
 expect(r.source_decisions[0].inspection.error).toContain('timed out')
 expect(hasCreativeArtifactEvidence(source,r)).toBe(false)
 r=await inspectCreativeArtifacts([source],r,{runDir,inspectionTimeoutMs:25})
 expect(openAiJson).toHaveBeenCalledTimes(1)
})
it('supplies bounded retained parent and matched note evidence for a benign poster rejection', async()=>{
 const runDir=await fs.mkdtemp(path.join(os.tmpdir(),'ingestion-parent-'))
 const poster={...source,title:'Blue composition',visible_text:'Geometric shapes',note_id:'saved',note_path:'THEMATIC_FOLDER',parent_source:{description:'Sponsored event advertisement; complete registration form'},editorial_evidence:[{visible_text:'Administrative CTA'}]}
 openAiJson.mockReset().mockImplementation(async({input})=>{
  const payload=JSON.parse(input[0].content[0].text)
  expect(payload.parent_source.description).toContain('registration form')
  expect(payload.editorial_evidence[0].visible_text).toBe('Administrative CTA')
  expect(payload.matched_saved_note.excerpt).toContain('Promo booking')
  expect(payload.visible_text).toBe('Geometric shapes')
  expect(JSON.stringify(payload)).not.toContain('THEMATIC_FOLDER')
  expect(payload.matched_saved_note.excerpt.length).toBeLessThanOrEqual(2000)
  return {status:'rejected',artifact_kind:'product',confidence:'high',observation:'Parent establishes promotional administrative content'}
 })
 const r=await inspectCreativeArtifacts([poster],{},{runDir,signalHarvest:{notes_selected:[{id:'saved',excerpt:'Promo booking '+ 'x'.repeat(10000)}]}})
 expect(openAiJson).toHaveBeenCalledTimes(1)
 expect(r.source_decisions[0].inspection.status).toBe('rejected')
 expect(hasCreativeArtifactEvidence(poster,r)).toBe(false)
})
it.each([null,{}, {status:'ambiguous'}, {status:'verified',artifact_kind:'unknown',confidence:'high'}, new Error('offline')])('rejects malformed/unknown/model failure %j',async observed=>{
 const runDir=await fs.mkdtemp(path.join(os.tmpdir(),'ingestion-'))
 openAiJson.mockReset()
 if(observed instanceof Error) openAiJson.mockRejectedValue(observed);else openAiJson.mockResolvedValue(observed)
 const r=await inspectCreativeArtifacts([source],{},{runDir})
 expect(hasCreativeArtifactEvidence(source,r)).toBe(false)
})
