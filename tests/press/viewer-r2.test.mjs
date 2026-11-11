import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { onRequest } from '../../functions/editions/[[path]].js'
import { createHandler, localBucket, staticAssets } from '../../press/serve.mjs'

async function site() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'press-viewer-'))
  const dist = path.join(root, 'dist')
  const bucket = path.join(root, 'bucket')
  const write = async (file, body) => { await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, body) }
  const staticIndex = { current_edition_id: 'old-v1', editions: [{ edition_id: 'old-v1', date: '2026-11-09', is_live: true }] }
  await write(path.join(dist, 'index.html'), '<!doctype html><title>app</title>')
  await write(path.join(dist, 'editions/index.json'), JSON.stringify(staticIndex))
  await write(path.join(dist, 'editions/old-v1/edition.json'), '{"from":"static"}')
  return { dist, bucket, write, staticIndex }
}

const get = (handler, pathname, init) => handler(new Request(`http://site.test${pathname}`, init))

describe('editions from R2', () => {
  it('changes nothing until a bucket is bound', async () => {
    const { dist, staticIndex } = await site()
    const handler = await createHandler({ bucketDir: '', distDir: dist })
    expect(await (await get(handler, '/editions/index.json')).json()).toEqual(staticIndex)
    expect(await (await get(handler, '/editions/old-v1/edition.json')).json()).toEqual({ from: 'static' })
  })

  it('serves bucket files first and falls back to the static archive', async () => {
    const { dist, bucket, write } = await site()
    await write(path.join(bucket, 'editions/new-v1/edition.json'), '{"from":"bucket"}')
    await write(path.join(bucket, 'editions/new-v1/assets/plate.png'), Buffer.from([1, 2, 3]))
    await write(path.join(bucket, 'press/ledger.json'), '{"private":true}')
    const handler = await createHandler({ bucketDir: bucket, distDir: dist })

    const fromBucket = await get(handler, '/editions/new-v1/edition.json')
    expect(await fromBucket.json()).toEqual({ from: 'bucket' })
    expect(fromBucket.headers.get('content-type')).toContain('application/json')
    const plate = await get(handler, '/editions/new-v1/assets/plate.png')
    expect(plate.headers.get('content-type')).toBe('image/png')
    expect(plate.headers.get('etag')).toBeTruthy()
    const cached = await get(handler, '/editions/new-v1/assets/plate.png', { headers: { 'if-none-match': plate.headers.get('etag') } })
    expect(cached.status).toBe(304)

    expect(await (await get(handler, '/editions/old-v1/edition.json')).json()).toEqual({ from: 'static' })
    // Client routes and anything outside editions/ never reach the bucket.
    expect((await get(handler, '/editions/new-v1')).headers.get('content-type')).toContain('text/html')
    expect((await get(handler, '/press/ledger.json')).headers.get('content-type')).toContain('text/html')
    const traversal = await onRequest({ request: new Request('http://site.test/editions/%2e%2e/press/ledger.json'), env: { EDITIONS_BUCKET: localBucket(bucket), ASSETS: staticAssets(dist) } })
    expect(traversal.headers.get('content-type')).toContain('text/html')
  })

  it('makes a parked edition live at its go-live time without any scheduler', async () => {
    const { dist, bucket, write } = await site()
    const entry = (goLiveAt) => ({ edition_id: 'new-v1', date: '2026-11-11', go_live_at: goLiveAt, manifest_item: { edition_id: 'new-v1', date: '2026-11-11', is_live: false } })
    const handler = await createHandler({ bucketDir: bucket, distDir: dist })

    await write(path.join(bucket, 'press/parked.json'), JSON.stringify({ version: 1, entries: [entry(new Date(Date.now() + 3_600_000).toISOString())] }))
    expect((await (await get(handler, '/editions/index.json')).json()).current_edition_id).toBe('old-v1')

    await write(path.join(bucket, 'press/parked.json'), JSON.stringify({ version: 1, entries: [entry(new Date(Date.now() - 1000).toISOString())] }))
    const live = await (await get(handler, '/editions/index.json')).json()
    expect(live.current_edition_id).toBe('new-v1')
    expect(live.editions.map((item) => [item.edition_id, item.is_live])).toEqual([['new-v1', true], ['old-v1', false]])
  })

  it('reads a prefixed press, for previewing the shadow run', async () => {
    const { dist, bucket, write } = await site()
    await write(path.join(bucket, 'shadow/editions/index.json'), JSON.stringify({ current_edition_id: 'shadow-v1', editions: [] }))
    const handler = await createHandler({ bucketDir: bucket, distDir: dist, prefix: 'shadow/' })
    expect((await (await get(handler, '/editions/index.json')).json()).current_edition_id).toBe('shadow-v1')
  })
})
