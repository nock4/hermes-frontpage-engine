import { it, expect } from 'vitest'
import http from 'node:http'
import net from 'node:net'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createSurfaceServer } from '../../scripts/services/shared-surface.mjs'
const origin = 'https://edition.example'
const headers = { Origin: origin, 'Content-Type': 'application/json', 'X-Surface': 'touch' }
const pause = (ms) => new Promise((r) => setTimeout(r, ms))
async function running(options, fn) {
  const s = createSurfaceServer({ origins: [origin], ...options })
  // macOS only binds 127.0.0.1 without privileged aliases. Assign distinct
  // transport peer identities in this test server, never from production headers.
  s.prependListener('request', (req) => {
    if (req.headers['x-test-peer']) Object.defineProperty(req.socket, 'remoteAddress', { value: req.headers['x-test-peer'], configurable: true })
  })
  await new Promise((r) => s.listen(0, '127.0.0.1', r))
  try { await fn(s.address().port) } finally { s.closeAllConnections(); await new Promise((r) => s.close(r)) }
}
function post(port, { localAddress, hold = false } = {}) {
  const req = http.request({ hostname: '127.0.0.1', port, path: '/surface?room=test', method: 'POST', headers: { ...headers, ...(localAddress ? { 'X-Test-Peer': localAddress } : {}) } })
  const result = new Promise((resolve, reject) => { req.on('response', (res) => { res.resume(); resolve(res.statusCode) }); req.on('error', reject) })
  req.write('{"x":')
  if (!hold) req.end('0.2,"y":0.3}')
  return { req, result }
}
it('raw malformed target returns 400 and the same real Node process serves the next valid request', async () => {
  const child = spawn(process.execPath, ['--input-type=module', '-e', `import {createSurfaceServer} from './scripts/services/shared-surface.mjs'; const s=createSurfaceServer({origins:['${origin}']});s.listen(0,'127.0.0.1',()=>console.log(s.address().port))`], { stdio: ['ignore', 'pipe', 'pipe'] })
  let errors = ''; child.stderr.on('data', (d) => { errors += d })
  try {
    const [data] = await once(child.stdout, 'data'), port = Number(String(data).trim())
    const response = await new Promise((resolve, reject) => {
      const socket = net.connect(port, '127.0.0.1', () => socket.write(`GET //[ HTTP/1.1\r\nHost: localhost\r\nOrigin: ${origin}\r\nConnection: close\r\n\r\n`))
      let body = ''; socket.on('data', (d) => { body += d }); socket.on('end', () => resolve(body)); socket.on('error', reject)
    })
    expect(response, errors).toContain('400 Bad Request')
    expect((await fetch(`http://127.0.0.1:${port}/surface?room=test`, { method: 'OPTIONS', headers })).status).toBe(204)
    expect(child.exitCode).toBe(null)
  } finally { child.kill(); await once(child, 'exit').catch(() => {}) }
})
it('twenty fragmented concurrent POSTs reserve the same-IP slot before reading any body', async () => {
  await running({}, async (port) => {
    const pending = Array.from({ length: 20 }, () => post(port, { hold: true }))
    await pause(30)
    for (const { req } of pending) req.end('0.2,"y":0.3}')
    const codes = await Promise.all(pending.map((p) => p.result))
    expect(codes.filter((c) => c === 204)).toHaveLength(1)
    expect(codes.filter((c) => c === 429)).toHaveLength(19)
  })
})
it('bounds body readers and releases them on abort, oversized body and deadline', async () => {
  await running({ maxReaders: 1, bodyTimeoutMs: 140 }, async (port) => {
    const first = post(port, { hold: true, localAddress: '127.0.0.2' }); first.result.catch(() => {})
    await pause(20)
    expect(await post(port, { localAddress: '127.0.0.3' }).result).toBe(503)
    first.req.destroy(); await pause(20)
    expect(await post(port, { localAddress: '127.0.0.4' }).result).toBe(204)
    const large = post(port, { hold: true, localAddress: '127.0.0.5' }); large.req.end('a'.repeat(129))
    expect(await large.result).toBe(413)
    const slow = post(port, { hold: true, localAddress: '127.0.0.6' })
    expect(await slow.result).toBe(408)
    expect(await post(port, { localAddress: '127.0.0.7' }).result).toBe(204)
    slow.req.destroy()
  })
})
it('bounds the rate map even when admitted bodies have not completed', async () => {
  await running({ maxRates: 2, bodyTimeoutMs: 200 }, async (port) => {
    const a = post(port, { hold: true, localAddress: '127.0.0.2' }), b = post(port, { hold: true, localAddress: '127.0.0.3' })
    a.result.catch(() => {}); b.result.catch(() => {})
    await pause(20)
    expect(await post(port, { localAddress: '127.0.0.4' }).result).toBe(503)
    a.req.destroy(); b.req.destroy()
  })
})
