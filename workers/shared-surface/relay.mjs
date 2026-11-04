// Pure Web APIs: the same bounded relay is exercised in Node and workerd.
export const ORIGIN = 'https://daily.nockgarden.com'
const encoder = new TextEncoder()
const failure = (status) => Object.assign(new Error('request rejected'), { status })

export function validateRequest(request) {
  let url
  try { url = new URL(request.url) } catch { throw failure(400) }
  if (request.headers.get('Origin') !== ORIGIN) throw failure(403)
  const entries = [...url.searchParams]
  if (url.pathname !== '/surface' || url.hash || url.username || url.password || entries.length !== 1 || entries[0][0] !== 'room' || !/^[a-zA-Z0-9_-]{1,100}$/.test(entries[0][1])) throw failure(400)
  if (request.method === 'OPTIONS') {
    if (!['GET', 'POST'].includes(request.headers.get('Access-Control-Request-Method'))) throw failure(400)
    const requested = request.headers.get('Access-Control-Request-Headers')
    if (requested !== null && requested.split(',').some((h) => !['content-type', 'x-surface'].includes(h.trim().toLowerCase()))) throw failure(400)
  } else if (request.method !== 'GET' && (request.method !== 'POST' || request.headers.get('X-Surface') !== 'touch' || request.headers.get('Content-Type') !== 'application/json')) throw failure(400)
  return entries[0][1]
}

export function reply(status, request, extra = {}) {
  return new Response(null, { status, headers: {
    'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', Vary: 'Origin',
    ...(request.headers.get('Origin') === ORIGIN ? { 'Access-Control-Allow-Origin': ORIGIN } : {}), ...extra,
  } })
}

export class Relay {
  clients = new Set()
  rates = new Map()
  readers = 0
  rateTimer = null
  constructor({ maxClients = 64, maxReaders = 32, maxRates = 1024, bodyTimeoutMs = 5000 } = {}) {
    this.limits = { maxClients: Math.min(64, maxClients), maxReaders: Math.min(32, maxReaders), maxRates: Math.min(1024, maxRates), bodyTimeoutMs: Math.min(5000, bodyTimeoutMs) }
  }
  async fetch(request) {
    try {
      validateRequest(request)
      if (request.method === 'OPTIONS') return reply(204, request, { 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type,X-Surface' })
      if (request.method === 'GET') return this.join(request)
      return await this.publish(request)
    } catch (error) { return reply([400, 403, 408, 413, 429, 503].includes(error.status) ? error.status : 400, request) }
  }
  join(request) {
    if (this.clients.size >= this.limits.maxClients) return reply(503, request)
    let controller, timer
    const client = { close: () => {
      if (!this.clients.delete(client)) return
      clearTimeout(timer)
      try { controller.close() } catch { /* already cancelled */ }
    } }
    const stream = new ReadableStream({
      start(c) { controller = c; c.enqueue(encoder.encode(': joined; ephemeral only\n\n')) },
      cancel: () => client.close(),
    }, { highWaterMark: 4096, size: (chunk) => chunk.byteLength })
    client.send = (bytes) => {
      if (controller.desiredSize < bytes.byteLength) {
        // Error discards the queue; never retain slow-reader event history.
        controller.error(new Error('slow subscriber'))
        client.close()
      } else controller.enqueue(bytes)
    }
    this.clients.add(client)
    timer = setTimeout(client.close, 120000)
    const response = reply(200, request, { 'Content-Type': 'text/event-stream', 'X-Accel-Buffering': 'no' })
    return new Response(stream, response)
  }
  pruneRates() {
    const now = Date.now()
    for (const [key, time] of this.rates) if (now - time >= 60000) this.rates.delete(key)
  }
  armRateCleanup() {
    if (this.rateTimer !== null || !this.rates.size) return
    const expires = Math.min(...this.rates.values()) + 60000
    this.rateTimer = setTimeout(() => {
      this.rateTimer = null
      this.pruneRates()
      this.armRateCleanup()
    }, Math.max(1, expires - Date.now()))
  }
  async publish(request) {
    const length = request.headers.get('Content-Length')
    if (length !== null && (!/^\d+$/.test(length) || Number(length) > 128)) return reply(Number(length) > 128 ? 413 : 400, request)
    const key = (request.headers.get('CF-Connecting-IP') || 'unknown').slice(0, 64), now = Date.now()
    this.pruneRates()
    if (!this.rates.has(key) && this.rates.size >= this.limits.maxRates) return reply(503, request)
    if (this.rates.has(key) && now - this.rates.get(key) < 80) return reply(429, request)
    if (this.readers >= this.limits.maxReaders) return reply(503, request)
    // No await before BOTH reservations. DO events may interleave at body reads.
    this.rates.set(key, now)
    this.armRateCleanup()
    this.readers++
    let text
    try { text = await this.readBody(request) } finally { this.readers-- }
    const data = JSON.parse(text)
    if (!data || Array.isArray(data) || Object.keys(data).sort().join(',') !== 'x,y' || ![data.x, data.y].every((n) => Number.isFinite(n) && n >= 0 && n <= 1)) return reply(400, request)
    const bytes = encoder.encode(`data: ${JSON.stringify({ x: Math.round(data.x * 1000) / 1000, y: Math.round(data.y * 1000) / 1000 })}\n\n`)
    for (const client of this.clients) client.send(bytes)
    return reply(204, request)
  }
  async readBody(request) {
    if (!request.body) throw failure(400)
    const reader = request.body.getReader()
    let timer, size = 0
    const chunks = []
    const deadline = new Promise((_, reject) => { timer = setTimeout(() => reject(failure(408)), this.limits.bodyTimeoutMs) })
    try {
      for (;;) {
        const { done, value } = await Promise.race([reader.read(), deadline])
        if (done) break
        size += value.byteLength
        if (size > 128 || chunks.length >= 128) throw failure(413)
        chunks.push(value)
      }
      const bytes = new Uint8Array(size)
      let offset = 0
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    } finally {
      clearTimeout(timer)
      // Never await cancellation: a hostile underlying sender must not hold a slot.
      void reader.cancel().catch(() => {})
      reader.releaseLock()
    }
  }
  dispose() {
    for (const client of this.clients) client.close()
    clearTimeout(this.rateTimer)
    this.rateTimer = null
    this.rates.clear()
  }
}
