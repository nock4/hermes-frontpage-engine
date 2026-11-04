import { it, expect, afterAll } from 'vitest'
import { Miniflare } from 'miniflare'
import fs from 'node:fs'
const origin = 'https://daily.nockgarden.com'
let mf
afterAll(async () => { if (mf) await mf.dispose() })
it('runs real workerd routing, room-isolated DO fanout, CORS, strict denial and body limits', async () => {
  expect(fs.existsSync(new URL('./worker.mjs', import.meta.url))).toBe(true)
  mf = new Miniflare({ enableDevRegistry: false, logRequests: false, workers: [{ config: {
    name: 'relay', compatibilityDate: '2026-07-08',
    manifest: { mainModule: 'worker.mjs', modules: Object.fromEntries(['worker.mjs', 'relay.mjs'].map((name) => [name, { type: 'esm', contents: fs.readFileSync(new URL(name, import.meta.url), 'utf8') }])) },
    env: { ROOMS: { type: 'durable-object', worker: 'relay', exportName: 'SurfaceRoom' } },
    exports: { SurfaceRoom: { type: 'durable-object', storage: 'sqlite' } },
  } }] })
  const call = (room, method = 'GET', body, headers = {}) => mf.dispatchFetch(`https://relay.example/surface?room=${room}`, { method, headers: { Origin: origin, ...(method === 'POST' ? { 'Content-Type': 'application/json', 'X-Surface': 'touch' } : {}), ...headers }, ...(body === undefined ? {} : { body }) })
  const a = await call('one'), b = await call('one'), other = await call('two')
  expect([a.status, b.status, other.status]).toEqual([200, 200, 200])
  const readers = [a, b, other].map((r) => r.body.getReader())
  for (const r of readers) expect(new TextDecoder().decode((await r.read()).value)).toContain('joined')
  expect((await call('one', 'POST', '{"x":0.12345,"y":0.98765}')).status).toBe(204)
  for (const r of readers.slice(0, 2)) expect(new TextDecoder().decode((await r.read()).value)).toBe('data: {"x":0.123,"y":0.988}\n\n')
  // A new connection has no replay; the other room receives no cross-room data.
  const replay = await call('one'); const replayReader = replay.body.getReader(); await replayReader.read()
  const isolated = await Promise.race([readers[2].read().then(() => false), new Promise((r) => setTimeout(() => r(true), 120))])
  expect(isolated).toBe(true)
  expect((await call('one', 'POST', ' '.repeat(129))).status).toBe(413)
  expect((await call('invalid-room', 'POST', 'null')).status).toBe(400)
  expect((await call('one', 'GET', undefined, { Origin: 'https://evil.example' })).status).toBe(403)
  const preflight = await call('one', 'OPTIONS', undefined, { 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type,x-surface' })
  expect(preflight.status).toBe(204); expect(preflight.headers.get('access-control-allow-origin')).toBe(origin)
  expect((await call('one', 'OPTIONS', undefined, { 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization' })).status).toBe(400)
  await Promise.all([...readers, replayReader].map((r) => r.cancel()))
}, 30000)
