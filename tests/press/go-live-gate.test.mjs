import { describe, expect, it } from 'vitest'

import { onRequest } from '../../functions/editions/[[path]].js'

const staticIndex = { current_edition_id: 'old-v1', editions: [{ edition_id: 'old-v1', date: '2026-11-09', is_live: true }] }
const entry = (goLiveAt) => ({ edition_id: 'new-v1', date: '2026-11-11', go_live_at: goLiveAt, manifest_item: { edition_id: 'new-v1', date: '2026-11-11', is_live: false } })

// Stands in for Pages static assets: known files, the app shell for anything
// else, and "not modified" for a conditional request, as Pages answers.
function site(files) {
  const asked = []
  const ASSETS = {
    fetch: async (request) => {
      const { pathname } = new URL(request.url)
      asked.push(pathname)
      if (request.headers.get('if-none-match')) return new Response(null, { status: 304 })
      if (!(pathname in files)) return new Response('<!doctype html>', { headers: { 'content-type': 'text/html' } })
      return new Response(files[pathname], { headers: { 'content-type': 'application/json', etag: '"static"' } })
    },
  }
  const get = (pathname, init) => onRequest({ request: new Request(`http://site.test${pathname}`, init), env: { ASSETS } })
  return { get, asked }
}

describe('go-live gate', () => {
  it('serves the static manifest untouched when nothing is parked', async () => {
    for (const parked of [undefined, '{"version":1,"entries":[]}', 'not json']) {
      const { get } = site({ '/editions/index.json': JSON.stringify(staticIndex), ...(parked ? { '/press/parked.json': parked } : {}) })
      const response = await get('/editions/index.json')
      expect(response.headers.get('etag')).toBe('"static"')
      expect(await response.json()).toEqual(staticIndex)
    }
  })

  it('hides a parked edition until its time, then makes it current', async () => {
    const files = { '/editions/index.json': JSON.stringify(staticIndex) }
    const { get } = site(files)
    files['/press/parked.json'] = JSON.stringify({ version: 1, entries: [entry(new Date(Date.now() + 3_600_000).toISOString())] })
    expect(await (await get('/editions/index.json')).json()).toEqual(staticIndex)

    files['/press/parked.json'] = JSON.stringify({ version: 1, entries: [entry(new Date(Date.now() - 1000).toISOString())] })
    // A browser revalidating its cached copy must still get the new manifest.
    const live = await get('/editions/index.json', { headers: { 'if-none-match': '"static"' } })
    expect(live.status).toBe(200)
    const index = await live.json()
    expect(index.current_edition_id).toBe('new-v1')
    expect(index.editions.map((item) => [item.edition_id, item.is_live])).toEqual([['new-v1', true], ['old-v1', false]])
  })

  it('leaves every other request to the static site', async () => {
    const { get, asked } = site({ '/editions/old-v1/edition.json': '{"from":"static"}' })
    expect(await (await get('/editions/old-v1/edition.json')).json()).toEqual({ from: 'static' })
    expect((await get('/editions/index.json', { method: 'POST' })).headers.get('content-type')).toBe('text/html')
    expect(asked).toEqual(['/editions/old-v1/edition.json', '/editions/index.json'])
  })
})
