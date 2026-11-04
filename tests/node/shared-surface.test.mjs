import { it, expect } from 'vitest'
import { createSurfaceServer } from '../../scripts/services/shared-surface.mjs'
it('serves real bounded ephemeral events; rejects foreign origins and malformed/rate-limited messages', async () => {
  const server = createSurfaceServer({ origins: ['https://edition.example'], maxClients: 2, ttlMs: 1000 })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${server.address().port}`
  const abort = new AbortController()
  try {
    expect(
      (await fetch(`${base}/surface?room=edition`, { headers: { Origin: 'https://evil.example' } })).status,
    ).toBe(403)
    const response = await fetch(`${base}/surface?room=edition`, {
        headers: { Origin: 'https://edition.example' },
        signal: abort.signal,
      }),
      reader = response.body.getReader()
    await reader.read()
    const headers = {
      Origin: 'https://edition.example',
      'Content-Type': 'application/json',
      'X-Surface': 'touch',
    }
    expect(
      (
        await fetch(`${base}/surface?room=edition`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ x: 2, y: 0 }),
        })
      ).status,
    ).toBe(400)
    // Invalid admitted bodies consume the same synchronous 80ms peer slot.
    expect((await fetch(`${base}/surface?room=edition`, { method: 'POST', headers, body: '{}' })).status).toBe(429)
    await new Promise((r) => setTimeout(r, 85))
    expect(
      (
        await fetch(`${base}/surface?room=edition`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ x: 0.2, y: 0.3 }),
        })
      ).status,
    ).toBe(204)
    expect(new TextDecoder().decode((await reader.read()).value)).toContain('"x":0.2')
    expect(
      (
        await fetch(`${base}/surface?room=edition`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ x: 0.2, y: 0.3 }),
        })
      ).status,
    ).toBe(429)
  } finally {
    abort.abort()
    server.closeAllConnections()
    await new Promise((r) => server.close(r))
  }
})
