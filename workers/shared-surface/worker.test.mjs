import { setFlagsFromString } from 'node:v8'
import { runInNewContext } from 'node:vm'
import { setImmediate as nextTurn } from 'node:timers/promises'
import { it, expect } from 'vitest'
import { Miniflare } from 'miniflare'
import fs from 'node:fs'
import { RelaySseReader } from './sse-test-reader.mjs'
const origin = 'https://daily.nockgarden.com'
const joined = ': joined; ephemeral only\n\n'
it('runs real workerd routing, room-isolated DO fanout, CORS, strict denial and body limits despite response GC', async () => {
  expect(fs.existsSync(new URL('./worker.mjs', import.meta.url))).toBe(true)
  const mf = new Miniflare({ enableDevRegistry: false, logRequests: false, workers: [{ config: {
    name: 'relay', compatibilityDate: '2026-07-08',
    manifest: { mainModule: 'worker.mjs', modules: Object.fromEntries(['worker.mjs', 'relay.mjs'].map((name) => [name, { type: 'esm', contents: fs.readFileSync(new URL(name, import.meta.url), 'utf8') }])) },
    env: { ROOMS: { type: 'durable-object', worker: 'relay', exportName: 'SurfaceRoom' } },
    exports: { SurfaceRoom: { type: 'durable-object', storage: 'sqlite' } },
  } }] })
  const readers = []
  const call = (room, method = 'GET', body, headers = {}) => mf.dispatchFetch(`https://relay.example/surface?room=${room}`, { method, headers: { Origin: origin, ...(method === 'POST' ? { 'Content-Type': 'application/json', 'X-Surface': 'touch' } : {}), ...headers }, ...(body === undefined ? {} : { body }) })
  const subscribe = async (room) => {
    const response = await call(room)
    // Acquire before any subsequent request/await: Undici's original Response
    // can be finalized even while Miniflare's replacement Response is retained.
    const reader = new RelaySseReader(response.body)
    readers.push(reader)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('text/event-stream')
    return reader
  }
  try {
    const a = await subscribe('one'), b = await subscribe('one'), other = await subscribe('two')
    // Deterministic GC pressure, not a synthetic transport: the direct real
    // workerd sequence must survive the finalizer that caused premature EOF.
    setFlagsFromString('--expose_gc'); const gc = runInNewContext('gc')
    gc(); await nextTurn(); gc(); await nextTurn()
    for (const reader of [a, b, other]) await reader.frame(joined)
    expect((await call('one', 'POST', '{"x":0.12345,"y":0.98765}')).status).toBe(204)
    for (const reader of [a, b]) await reader.frame('data: {"x":0.123,"y":0.988}\n\n')
    // Exact join is mandatory, not an unchecked first-read skip. Preserve and
    // inspect any coalesced tail; both new subscriber and other room stay silent.
    const replay = await subscribe('one'); await replay.frame(joined)
    await Promise.all([other.quiet(120), replay.quiet(120)])
    expect((await call('one', 'POST', ' '.repeat(129))).status).toBe(413)
    expect((await call('invalid-room', 'POST', 'null')).status).toBe(400)
    expect((await call('one', 'GET', undefined, { Origin: 'https://evil.example' })).status).toBe(403)
    const preflight = await call('one', 'OPTIONS', undefined, { 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type,x-surface' })
    expect(preflight.status).toBe(204); expect(preflight.headers.get('access-control-allow-origin')).toBe(origin)
    expect((await call('one', 'OPTIONS', undefined, { 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization' })).status).toBe(400)
  } finally {
    const cleanup = await Promise.allSettled(readers.map(reader => reader.close()))
    await mf.dispose()
    const failed = cleanup.filter(result => result.status === 'rejected')
    if (failed.length) throw new AggregateError(failed.map(result => result.reason), 'reader cleanup failed')
  }
}, 30000)
