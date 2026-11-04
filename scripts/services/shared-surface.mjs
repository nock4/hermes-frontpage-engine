import http from 'node:http'
import { pathToFileURL } from 'node:url'

/** Memory-only SSE relay. Host behind TLS; no files, identity, replay or visitors. */
export function createSurfaceServer({ origins = [], maxClients = 64, ttlMs = 120000, maxReaders = 32, maxRates = 1024, bodyTimeoutMs = 5000 } = {}) {
  const allowed = new Set(origins),
    clients = new Set(),
    rates = new Map()
  let readers = 0
  const server = http.createServer((req, res) => {
    const finish = (status) => {
      if (res.destroyed || res.writableEnded) return
      if (!req.complete && req.method === 'POST') {
        res.setHeader('Connection', 'close')
        res.once('finish', () => req.destroy())
      }
      res.writeHead(status)
      res.end()
    }
    // Node does not consume rejected promises from async request listeners.
    // Enclose parsing, admission, body reads and broadcasts in one boundary.
    void handle().catch((error) => {
      if (!res.headersSent) finish(error.status || 400)
      else res.end()
    })
    async function handle() {
    const origin = req.headers.origin
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Vary', 'Origin')
    if (!origin || !allowed.has(origin)) return finish(403)
    res.setHeader('Access-Control-Allow-Origin', origin)
    const u = new URL(req.url, 'http://localhost'),
      room = u.searchParams.get('room')
    if (u.pathname !== '/surface' || !room || !/^[a-zA-Z0-9_-]{1,100}$/.test(room)) return finish(400)
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type,X-Surface')
      return finish(204)
    }
    if (req.method === 'GET') {
      if (clients.size >= Math.min(256, maxClients)) return finish(503)
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'X-Accel-Buffering': 'no' })
      res.write(': joined; ephemeral only\n\n')
      const client = { room, res }
      clients.add(client)
      const timer = setTimeout(() => res.end(), Math.min(ttlMs, 120000))
      timer.unref()
      req.on('close', () => {
        clearTimeout(timer)
        clients.delete(client)
      })
      return
    }
    if (
      req.method !== 'POST' ||
      req.headers['x-surface'] !== 'touch' ||
      req.headers['content-type'] !== 'application/json'
    )
      return finish(400)
    const ip = req.socket.remoteAddress,
      now = Date.now()
    for (const [key, time] of rates) if (now - time > 60000) rates.delete(key)
    if (rates.size >= Math.min(1024, maxRates) && !rates.has(ip)) return finish(503)
    if (now - (rates.get(ip) || 0) < 80) return finish(429)
    if (readers >= Math.min(32, maxReaders)) return finish(503)
    // Reserve synchronously, including invalid/aborted requests: body arrival
    // must not open a concurrency bypass or an unbounded peer map.
    rates.set(ip, now)
    readers++
    let body
    try {
      body = await new Promise((resolve, reject) => {
        let size = 0
        const chunks = []
        const cleanup = () => {
          clearTimeout(timer)
          req.off('data', data)
          req.off('end', end)
          req.off('error', fail)
          req.off('aborted', aborted)
          req.pause()
        }
        const fail = (error) => { cleanup(); reject(error) }
        const aborted = () => fail(Error('aborted'))
        const data = (chunk) => {
          size += chunk.length
          if (size > 128) fail(Object.assign(Error('body limit'), { status: 413 }))
          else chunks.push(chunk)
        }
        const end = () => { cleanup(); resolve(Buffer.concat(chunks).toString('utf8')) }
        const timer = setTimeout(() => fail(Object.assign(Error('body deadline'), { status: 408 })), Math.min(5000, bodyTimeoutMs))
        timer.unref()
        req.on('data', data)
        req.once('end', end)
        req.once('error', fail)
        req.once('aborted', aborted)
      })
    } finally {
      readers--
    }
      const d = JSON.parse(body)
      if (
        Object.keys(d).sort().join(',') !== 'x,y' ||
        ![d.x, d.y].every((n) => Number.isFinite(n) && n >= 0 && n <= 1)
      )
        return finish(400)
      const event = `data: ${JSON.stringify({ x: Math.round(d.x * 1000) / 1000, y: Math.round(d.y * 1000) / 1000 })}\n\n`
      for (const client of clients)
        if (client.room === room) {
          if (client.res.writableLength > 4096) client.res.end()
          else client.res.write(event)
        }
      finish(204)
    }
  })
  server.requestTimeout = 5000
  server.headersTimeout = 10000
  server.maxHeadersCount = 24
  server.on('close', () => {
    for (const c of clients) c.res.end()
    clients.clear()
    rates.clear()
  })
  return server
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const origins = (process.env.SURFACE_ORIGINS || '').split(',').filter(Boolean)
  if (!origins.length) throw Error('SURFACE_ORIGINS must explicitly allow edition origin(s)')
  const port = Number(process.env.PORT || 4181),
    host = process.env.HOST || '127.0.0.1'
  createSurfaceServer({ origins }).listen(port, host, () =>
    console.log(`Ephemeral surface listening on ${host}:${port}; TLS reverse proxy required for production`),
  )
}
