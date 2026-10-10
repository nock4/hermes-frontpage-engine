import { afterEach, expect, it, vi } from 'vitest'
import dns from 'node:dns/promises'
import http from 'node:http'
import https from 'node:https'
import { EventEmitter } from 'node:events'
import { Readable } from 'node:stream'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
vi.mock('../../scripts/lib/openai-json.mjs', () => ({ openAiJson: vi.fn(async () => ({ status: 'ambiguous' })) }))
import { inspectCandidateSource } from '../../scripts/lib/source-inspection.mjs'
import { inspectCreativeArtifacts } from '../../scripts/lib/creative-artifact-inspection.mjs'
import { openAiJson } from '../../scripts/lib/openai-json.mjs'
import { sourceContentKey, sourceContentScore, selectContentSources } from '../../scripts/lib/source-selection-policy.mjs'
import { decideAnchorEligibility } from '../../scripts/lib/source-decision-gates.mjs'
import { buildAnchorResearch } from '../../scripts/lib/anchor-source-research.mjs'

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.clearAllMocks() })

it.each(['initial', 'redirect'])('includes %s image DNS in the single 8-second health deadline', async hop => {
  vi.useFakeTimers()
  vi.stubEnv('DFE_TEST_USE_GLOBAL_FETCH', '1')
  const image = `https://deadline-${hop}.example/art.jpg`
  let entered = false
  let finishDns
  vi.spyOn(dns, 'lookup').mockImplementation(async host => {
    if (host === (hop === 'initial' ? `deadline-${hop}.example` : 'pending-redirect.example')) {
      entered = true
      return new Promise(resolve => { finishDns = resolve })
    }
    return [{ address: '93.184.216.34', family: 4 }]
  })
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async url => {
    if (String(url).includes('owner.example')) return new Response(`<meta property="og:image" content="${image}">`, { headers: { 'content-type': 'text/html' } })
    return new Response('', { status: 302, headers: { location: 'https://pending-redirect.example/art.jpg' } })
  })
  let result
  const pending = inspectCandidateSource({ url: 'https://owner.example/work' }, { sourceTool: 'fetch' }).then(source => { result = source })
  await vi.advanceTimersByTimeAsync(1)
  expect(entered).toBe(true)
  await vi.advanceTimersByTimeAsync(8000)
  try {
    expect(result, 'normalization must settle before the outer source deadline').toBeDefined()
    expect(result.image_url).toBeNull()
    const calls = fetch.mock.calls.length
    finishDns([{ address: '93.184.216.34', family: 4 }])
    await vi.advanceTimersByTimeAsync(1)
    expect(fetch).toHaveBeenCalledTimes(calls)
  } finally {
    await vi.advanceTimersByTimeAsync(35000)
    await pending
  }
})

it('retains prior, declared and cross-host redirect image aliases for content and anchor gates', async () => {
  const prior = 'https://prior.example/art.jpg'
  const original = 'https://declared.example/art.jpg'
  const resolved = 'https://cdn.example/art.jpg'
  transport(original, resolved)
  const source = await inspectCandidateSource({ url: 'https://owner.example/work', source_image_url: prior }, { sourceTool: 'fetch' })
  expect(source.source_image_url).toBe(prior)
  expect(source.image_url).toBe(resolved)
  for (const url of [prior, original, resolved]) {
    const recentSourceKeys = new Set([sourceContentKey({ url })])
    expect(sourceContentScore(source, recentSourceKeys), url).toBe(-Infinity)
    expect(selectContentSources([source], { recentSourceKeys }), url).toEqual([])
    expect(decideAnchorEligibility({ anchorSource: source, recentSourceKeys }), url).toMatchObject({ decision: 'reject', reason_code: 'spent_material_family' })
  }
  expect(source.source_image_aliases).toEqual([prior, original, resolved])
  const research = await buildAnchorResearch(source)
  expect(research.direct_image_candidates.find(row => row.lineage === 'primary_anchor_image').source_image_aliases).toEqual(source.source_image_aliases)
})
function transport(image, location, { uaSensitive = false } = {}) {
  vi.stubEnv('DFE_TEST_USE_GLOBAL_FETCH', '0')
  vi.spyOn(dns, 'lookup').mockImplementation(async host => [{ address: host === 'private.example' ? '127.0.0.1' : '93.184.216.34', family: 4 }])
  const calls = []
  const request = (options, callback) => {
    calls.push(options)
    const req = new EventEmitter()
    req.destroy = error => queueMicrotask(() => req.emit('error', error))
    req.end = () => queueMicrotask(() => {
      const url = `${options.protocol}//${options.hostname}${options.path}`
      const denied = uaSensitive && options.headers['user-agent']
      const page = options.path === '/work'
      const redirect = url === image && location
      const body = denied ? 'Forbidden' : page ? `<meta property="og:image" content="${image}">` : redirect ? '' : 'actual image bytes'
      const response = Readable.from([Buffer.from(body)])
      response.statusCode = denied ? 403 : redirect ? 301 : 200
      response.headers = { 'content-type': denied || page ? 'text/html' : 'image/jpeg', ...(redirect ? { location } : {}) }
      callback(response)
    })
    return req
  }
  vi.spyOn(http, 'request').mockImplementation(request)
  vi.spyOn(https, 'request').mockImplementation(request)
  return calls
}
it('normalizes owner-declared public HTTP image redirects using individually pinned requests', async () => {
  const original = 'http://zoomquilt.org/img/zoomquilt.jpg'
  const resolved = 'https://zoomquilt.org/img/zoomquilt.jpg'
  const calls = transport(original, resolved)
  const source = await inspectCandidateSource({ url: 'https://owner.example/work' }, { sourceTool: 'fetch' })
  expect(source.image_url).toBe(resolved)
  expect(source.source_image_url).toBe(original)
  for (const url of [original, resolved]) {
    expect(sourceContentScore(source, new Set([sourceContentKey({ url })]))).toBe(-Infinity)
  }
  for (const options of calls) {
    const done = vi.fn(); options.lookup(options.hostname, { all: true }, done)
    expect(done).toHaveBeenCalledWith(null, [{ address: '93.184.216.34', family: 4 }])
  }
})
it('uses the same ordinary default request identity for owning page and image health', async () => {
  const image = 'https://gallery.example/sculpture.jpg'
  const calls = transport(image, null, { uaSensitive: true })
  const source = await inspectCandidateSource({ url: 'https://gallery.example/work' }, { sourceTool: 'fetch' })
  expect(source.image_url).toBe(image)
  expect(calls.every(call => !call.headers['user-agent'])).toBe(true)
})
it.each(['http://127.0.0.1/private.jpg', 'https://private.example/image.jpg', 'https://u:p@public.example/image.jpg', 'file:///etc/passwd', 'https://bad.example/%xx', 'https://bad.example/a b', 'http://images.example/loop.jpg'])('rejects unsafe or looping image Location %s', async location => {
  const calls = transport('http://images.example/loop.jpg', location)
  const source = await inspectCandidateSource({ url: 'https://owner.example/work' }, { sourceTool: 'fetch' })
  expect(source.image_url).toBeNull()
  expect(calls.length).toBeLessThanOrEqual(2)
})
it('captures full redirected bytes and stamps resolved identity without granting eligibility', async () => {
  const image = 'http://images.example/capture.jpg', resolved = 'https://cdn.example/capture.jpg'
  const calls = transport(image, resolved)
  const runDir = await fs.mkdtemp(path.join(os.tmpdir(), 'redirect-capture-'))
  try {
    const research = await inspectCreativeArtifacts([{ url: 'https://artist.example/artwork', title: 'Painting', image_url: image }], {}, { runDir })
    const inspection = research.source_decisions[0].inspection
    expect(inspection.status).toBe('ambiguous')
    expect(inspection.media_url).toBe(image)
    expect(inspection.resolved_media_url).toBe(resolved)
    expect(await fs.readFile(inspection.capture_path, 'utf8')).toBe('actual image bytes')
    expect(openAiJson).toHaveBeenCalledOnce()
    expect(calls.every(call => !call.headers.range && !call.headers['user-agent'])).toBe(true)
  } finally { await fs.rm(runDir, { recursive: true, force: true }) }
})
