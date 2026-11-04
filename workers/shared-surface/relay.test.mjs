import { describe, it, expect, afterEach, vi } from 'vitest'
import fs from 'node:fs'

const origin = 'https://daily.nockgarden.com'
const file = new URL('./relay.mjs', import.meta.url)
const req = (method = 'GET', body, extra = {}, path = '/surface?room=edition') => new Request(`https://relay.example${path}`, {
  method, headers: { Origin: origin, ...(method === 'POST' ? { 'Content-Type': 'application/json', 'X-Surface': 'touch', 'CF-Connecting-IP': '192.0.2.1' } : {}), ...extra },
  ...(body !== undefined ? { body, duplex: 'half' } : {}),
})
let relays = []
afterEach(() => { for (const r of relays) r.dispose(); relays = []; vi.useRealTimers() })
async function relay(options) { const { Relay } = await import('./relay.mjs'); const r = new Relay(options); relays.push(r); return r }
const post = (r, data, headers) => r.fetch(req('POST', typeof data === 'string' || data instanceof ReadableStream ? data : JSON.stringify(data), headers))

it('provides the production relay implementation', () => expect(fs.existsSync(file)).toBe(true))
describe('strict public protocol', () => {
  it('rejects malformed URL without throwing and survives', async () => {
    const r = await relay()
    expect((await r.fetch({ url: 'http://[', headers: new Headers({ Origin: origin }) })).status).toBe(400)
    expect((await r.fetch(req('OPTIONS', undefined, { 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type,x-surface' }))).status).toBe(204)
  })
  it('denies absent/foreign/localhost origins and extra paths/query/invalid room', async () => {
    const r = await relay()
    for (const Origin of ['', 'https://evil.example', 'http://localhost:4173']) expect((await r.fetch(req('GET', undefined, { Origin }))).status).toBe(403)
    for (const path of ['/proxy?room=x', '/surface', '/surface?room=a.b', '/surface?room=' + 'a'.repeat(101), '/surface?room=a&room=b', '/surface?room=a&url=https://example.com']) expect((await r.fetch(req('GET', undefined, {}, path))).status).toBe(400)
  })
  it('checks preflight methods and exact supported header names', async () => {
    const r = await relay()
    for (const h of [{ 'Access-Control-Request-Method': 'DELETE' }, { 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization' }, {}]) expect((await r.fetch(req('OPTIONS', undefined, h))).status).toBe(400)
    const response = await r.fetch(req('OPTIONS', undefined, { 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'Content-Type, X-Surface' }))
    expect(response.status).toBe(204)
    expect(response.headers.get('access-control-allow-origin')).toBe(origin)
    expect(response.headers.get('access-control-allow-credentials')).toBe(null)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect((await r.fetch(req('DELETE'))).status).toBe(400)
  })
  it('accepts only finite numeric x/y in range, strict JSON object, no extras', async () => {
    const r = await relay(); let i = 0
    for (const body of ['null', '[]', 'true', '{', '{"x":0,"y":1,"z":1}', '{"x":"0","y":1}', '{"x":-0.1,"y":1}', '{"x":0,"y":1.01}', '{"x":1e999,"y":0}']) expect((await post(r, body, { 'CF-Connecting-IP': `ip${i++}` })).status).toBe(400)
    expect((await post(r, { x: 0, y: 1 }, { 'X-Surface': 'other' })).status).toBe(400)
    expect((await post(r, { x: 0, y: 1 }, { 'Content-Type': 'text/plain' })).status).toBe(400)
    expect((await post(r, ' '.repeat(129), { 'CF-Connecting-IP': 'big' })).status).toBe(413)
  })
})
describe('bounded ephemeral fanout', () => {
  it('delivers rounded coordinates to joined streams only, cancellation frees capacity', async () => {
    const r = await relay({ maxClients: 2 })
    const a = await r.fetch(req()), b = await r.fetch(req())
    expect((await r.fetch(req())).status).toBe(503)
    expect(a.headers.get('content-type')).toBe('text/event-stream')
    const readers = [a.body.getReader(), b.body.getReader()]
    for (const reader of readers) expect(new TextDecoder().decode((await reader.read()).value)).toContain(': joined')
    expect((await post(r, { x: 0.123456, y: 0.987654 })).status).toBe(204)
    for (const reader of readers) expect(new TextDecoder().decode((await reader.read()).value)).toBe('data: {"x":0.123,"y":0.988}\n\n')
    await readers[1].cancel()
    expect(r.clients.size).toBe(1)
    const c = await r.fetch(req()); await c.body.cancel(); await readers[0].cancel()
    expect(r.clients.size).toBe(0)
  })
  it('expires streams at two minutes and removes orphan rate keys at one minute', async () => {
    vi.useFakeTimers(); const r = await relay(); const a = await r.fetch(req()); const reader = a.body.getReader(); await reader.read()
    await post(r, { x: 0, y: 1 }); expect(r.rates.size).toBe(1)
    await vi.advanceTimersByTimeAsync(60001); expect(r.rates.size).toBe(0)
    await reader.read(); await vi.advanceTimersByTimeAsync(60000)
    expect(await reader.read()).toEqual({ value: undefined, done: true }); expect(r.clients.size).toBe(0)
  })
  it('drops slow subscribers rather than buffering past 4096 bytes', async () => {
    const r = await relay(); expect((await r.fetch(req())).status).toBe(200)
    for (let i = 0; i < 200; i++) await post(r, { x: 0.1, y: 0.1 }, { 'CF-Connecting-IP': `peer${i}` })
    expect(r.clients.size).toBe(0)
  })
  it('reserves rates and reader slots before awaiting partial bodies; bounded map and expiry', async () => {
    const r = await relay({ maxReaders: 1, maxRates: 2, bodyTimeoutMs: 40 })
    let cancelled = false
    const slow = new ReadableStream({ cancel() { cancelled = true } })
    const pending = post(r, slow)
    expect((await post(r, { x: 0, y: 0 })).status).toBe(429)
    expect((await post(r, { x: 0, y: 0 }, { 'CF-Connecting-IP': 'other' })).status).toBe(503)
    expect((await pending).status).toBe(408); expect(cancelled).toBe(true); expect(r.readers).toBe(0)
    expect((await post(r, { x: 0, y: 0 }, { 'CF-Connecting-IP': 'other' })).status).toBe(204)
    expect((await post(r, { x: 0, y: 0 }, { 'CF-Connecting-IP': 'third' })).status).toBe(503)
  })
  it('bounds chunk count even when sender streams zero-byte chunks', async () => {
    const r = await relay()
    const body = new ReadableStream({ start(c) { for (let i = 0; i < 129; i++) c.enqueue(new Uint8Array(0)); c.enqueue(new TextEncoder().encode('{"x":0,"y":0}')); c.close() } })
    expect((await post(r, body)).status).toBe(413)
  })
  it('releases aborted body readers without retaining chunks', async () => {
    const r = await relay()
    const body = new ReadableStream({ start(c) { c.error(Error('aborted')) } })
    expect((await post(r, body)).status).toBe(400); expect(r.readers).toBe(0)
  })
})
