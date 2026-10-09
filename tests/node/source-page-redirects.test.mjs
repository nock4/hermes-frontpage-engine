import dns from 'node:dns/promises'
import http from 'node:http'
import https from 'node:https'
import { EventEmitter } from 'node:events'
import { Readable } from 'node:stream'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { inspectCandidateSource, inspectWithFetch } from '../../scripts/lib/source-inspection.mjs'
import { fetchVettedRemoteUrl } from '../../scripts/lib/source-image-network-policy.mjs'
import { isAiToolingContentSource } from '../../scripts/lib/source-selection-policy.mjs'

const start = 'http://art.example/work'
let requests
let lookup
function transport(routes) {
  const request = (options, onResponse) => {
    const req = new EventEmitter()
    req.destroy = vi.fn((error) => queueMicrotask(() => req.emit('error', error)))
    req.end = () => queueMicrotask(() => {
      const route = routes[`${options.protocol}//${options.hostname}${options.path}`]
      if (!route) throw new Error(`Unexpected request: ${options.hostname}${options.path}`)
      if (route.hang) return
      const response = Readable.from([Buffer.from(route.body || '')])
      response.statusCode = route.status || 200
      response.headers = route.headers || { 'content-type': 'text/html' }
      onResponse(response)
    })
    requests.push({ options, req })
    return req
  }
  vi.spyOn(http, 'request').mockImplementation(request)
  vi.spyOn(https, 'request').mockImplementation(request)
}
function inspect(options) {
  return inspectWithFetch({ url: start, note_title: 'Saved art' }, start, {}, options)
}
beforeEach(() => {
  requests = []
  vi.stubEnv('DFE_TEST_USE_GLOBAL_FETCH', '0')
  lookup = vi.spyOn(dns, 'lookup').mockResolvedValue([{ address: '93.184.216.34', family: 4 }])
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs() })

it('keeps the low-level vetted fetch no-redirect invariant', async () => {
  transport({ [start]: { status: 308, headers: { location: 'https://gallery.example/' } } })
  const response = await fetchVettedRemoteUrl(start)
  expect(response.status).toBe(308)
  expect(response.headers.get('location')).toBe('https://gallery.example/')
  expect(requests).toHaveLength(1)
})

it('retains the final identity for editorial quarantine', async () => {
  transport({ [start]: { status: 301, headers: { location: 'https://trynoah.ai/' } }, 'https://trynoah.ai/': { body: '<title>Beautiful colors</title>' } })
  const source = await inspectCandidateSource({ url: start, note_title: 'Saved art' }, { sourceTool: 'fetch' })
  expect(source).toMatchObject({ url: start, source_url: start, final_url: 'https://trynoah.ai/', fetch_status: 'fetch-ok' })
  expect(isAiToolingContentSource(source)).toBe(true)
})

it.each([301, 302, 303, 307, 308])('follows source-page %s with final-relative media and original provenance', async (status) => {
  transport({
    [start]: { status, headers: { location: 'https://gallery.example/exhibit/' } },
    'https://gallery.example/exhibit/': { body: '<title>Actual art</title><meta property="og:image" content="art.jpg">' },
    'https://gallery.example/exhibit/art.jpg': { body: 'jpeg', headers: { 'content-type': 'image/jpeg' } },
  })
  const result = await inspectCandidateSource({ url: start, note_title: 'Saved art' }, { sourceTool: 'fetch' })
  expect(result).toMatchObject({ url: start, source_url: start, final_url: 'https://gallery.example/exhibit/', title: 'Actual art', fetch_status: 'fetch-ok', image_url: 'https://gallery.example/exhibit/art.jpg' })
  expect(lookup).toHaveBeenCalledWith('gallery.example', { all: true })
  for (const { options } of requests) {
    const callback = vi.fn()
    options.lookup(options.hostname, { all: true }, callback)
    expect(callback).toHaveBeenCalledWith(null, [{ address: '93.184.216.34', family: 4 }])
  }
})

it('accepts exactly three relative redirects', async () => {
  transport({ [start]: { status: 301, headers: { location: '/one' } }, 'http://art.example/one': { status: 302, headers: { location: 'two' } }, 'http://art.example/two': { status: 307, headers: { location: '/three' } }, 'http://art.example/three': { body: '<title>Three</title>' } })
  expect(await inspect()).toMatchObject({ fetch_status: 'fetch-ok', final_url: 'http://art.example/three', title: 'Three' })
  expect(requests).toHaveLength(4)
  expect(lookup).toHaveBeenCalledTimes(4)
})
it('rejects a fourth redirect without requesting it', async () => {
  transport(Object.fromEntries([start, 'http://art.example/1', 'http://art.example/2', 'http://art.example/3'].map((url, i) => [url, { status: 308, headers: { location: `/${i + 1}` } }])))
  expect((await inspect()).fetch_status).toMatch(/fetch-error:.*redirect limit/i)
  expect(requests).toHaveLength(4)
})
it.each([undefined, '', 'http://[broken', 'https://', 'http://a/%zz', 'https://a/\nprivate', 'file:///etc/passwd', 'javascript:alert(1)', 'ftp://example.com/art', 'https://user:secret@example.com/art'])('rejects missing, malformed, or unsafe Location %s', async (location) => {
  transport({ [start]: { status: 301, headers: location === undefined ? {} : { location } } })
  expect((await inspect()).fetch_status).toMatch(/fetch-error:/)
  expect(requests).toHaveLength(1)
})
it.each(['http://127.0.0.1/art', 'http://169.254.169.254/', 'http://[::1]/', 'http://private.example/art'])('blocks private redirect %s before connection', async (location) => {
  lookup.mockImplementation(async (host) => [{ address: host === 'private.example' ? '10.0.0.1' : '93.184.216.34', family: 4 }])
  transport({ [start]: { status: 302, headers: { location } } })
  expect(await inspect()).toMatchObject({ source_url: start, final_url: location, image_url: null, fetch_status: expect.stringMatching(/fetch-error:.*blocked/i) })
  expect(requests).toHaveLength(1)
})
it('revalidates DNS on same-host redirects (rebinding)', async () => {
  lookup.mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }]).mockResolvedValue([{ address: '127.0.0.1', family: 4 }])
  transport({ [start]: { status: 301, headers: { location: '/next' } } })
  expect((await inspect()).fetch_status).toMatch(/fetch-error:.*blocked/i)
  expect(requests).toHaveLength(1)
})
it('rejects loops including fragment-only changes', async () => {
  transport({ [start]: { status: 301, headers: { location: '#again' } } })
  expect((await inspect()).fetch_status).toMatch(/fetch-error:.*loop/i)
  expect(requests).toHaveLength(1)
})
it('charges redirect response bodies against the total byte budget', async () => {
  transport({ [start]: { status: 301, headers: { location: '/next' }, body: '123456' }, 'http://art.example/next': { body: '12345' } })
  expect((await inspect({ maxBytes: 10 })).fetch_status).toMatch(/fetch-error:.*exceeded 4 bytes/i)
  expect(requests[1].req.destroy).toHaveBeenCalled()
})
it('bounds DNS and prevents a late lookup from opening a connection', async () => {
  let release
  lookup.mockImplementation(() => new Promise((resolve) => { release = resolve }))
  transport({})
  const result = await inspect({ timeoutMs: 20 })
  expect(result.fetch_status).toMatch(/fetch-error:.*timed out/i)
  release([{ address: '93.184.216.34', family: 4 }])
  await new Promise((resolve) => setImmediate(resolve))
  expect(requests).toHaveLength(0)
})
it('uses one deadline across DNS and hops and destroys a stalled request', async () => {
  vi.useFakeTimers()
  try {
    transport({ [start]: { status: 301, headers: { location: '/hang' } }, 'http://art.example/hang': { hang: true } })
    lookup.mockImplementation(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); return [{ address: '93.184.216.34', family: 4 }] })
    const result = inspect({ timeoutMs: 100 })
    await vi.advanceTimersByTimeAsync(101)
    expect((await result).fetch_status).toMatch(/fetch-error:.*timed out/i)
    expect(requests).toHaveLength(2)
    expect(requests[1].req.destroy).toHaveBeenCalled()
  } finally { vi.useRealTimers() }
})
