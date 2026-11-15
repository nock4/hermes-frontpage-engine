import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { anchorSource, morningCaption, sendMorningPost } from '../../press/lib/morning.mjs'
import { LocalStore } from '../../press/lib/store.mjs'

const id = '2099-01-01-synthetic-v1'
const env = { TELEGRAM_BOT_TOKEN: 'token', TELEGRAM_CHAT_ID: '42', PRESS_SITE_URL: 'https://example.test/' }

async function fixture({ poster = true } = {}) {
  const store = new LocalStore(await fs.mkdtemp(path.join(os.tmpdir(), 'morning-')))
  await store.put(`editions/${id}/edition.json`, Buffer.from(JSON.stringify({ edition_id: id, title: 'Synthetic Title' })))
  await store.put(`editions/${id}/assets/plate.png`, Buffer.from('plate'))
  await store.put(`editions/${id}/source-bindings.json`, Buffer.from(JSON.stringify({ bindings: [
    { artifact_id: 'module-x', source_url: 'https://x.com/other/status/1' },
    { artifact_id: 'hero-x', source_url: 'https://x.com/anchor/status/2', source_title: '@anchor: a print',
      source_visual: { poster_asset_path: `/editions/${id}/assets/source-posters/hero.jpg` } },
  ] })))
  if (poster) await store.put(`editions/${id}/assets/source-posters/hero.jpg`, Buffer.from('poster'))
  return store
}

function recorder() {
  const calls = []
  return { calls, fetchImpl: async (url, init) => { calls.push({ url, form: init.body }); return new Response('{}') } }
}

describe('morning post', () => {
  it('picks the hero binding as the anchor source, with its poster image', async () => {
    const source = await anchorSource(await fixture(), id)
    expect(source.url).toBe('https://x.com/anchor/status/2')
    expect(String(source.image)).toBe('poster')
  })

  it('sends the front page and the source image as one album with the links in the caption', async () => {
    const { calls, fetchImpl } = recorder()
    const result = await sendMorningPost({ store: await fixture(), editionId: id, env, fetchImpl, log: () => {}, screenshot: async () => Buffer.from('shot') })
    expect(result).toEqual({ sent: true, method: 'sendMediaGroup', photos: 2 })
    expect(calls[0].url).toMatch(/\/sendMediaGroup$/)
    const media = JSON.parse(calls[0].form.get('media'))
    expect(media.map((m) => m.media)).toEqual(['attach://frontpage.png', 'attach://source.jpg'])
    expect(media[0].caption).toContain('Synthetic Title')
    expect(media[0].caption).toContain('https://example.test/')
    expect(media[0].caption).toContain('https://x.com/anchor/status/2')
    expect(Buffer.from(await calls[0].form.get('frontpage.png').arrayBuffer()).toString()).toBe('shot')
  })

  it('falls back to the plate when no screenshot, and to one photo when there is no source image', async () => {
    const { calls, fetchImpl } = recorder()
    const result = await sendMorningPost({ store: await fixture({ poster: false }), editionId: id, env, fetchImpl, log: () => {}, screenshot: async () => null })
    expect(result).toEqual({ sent: true, method: 'sendPhoto', photos: 1 })
    expect(Buffer.from(await calls[0].form.get('photo').arrayBuffer()).toString()).toBe('plate')
  })

  it('never throws and never reports the token-bearing URL', async () => {
    const result = await sendMorningPost({ store: await fixture(), editionId: id, env, log: () => {}, screenshot: async () => null,
      fetchImpl: async () => { throw new TypeError('https://api.telegram.org/bottoken/sendMediaGroup unreachable') } })
    expect(result).toEqual({ sent: false, reason: 'morning TypeError' })
    expect(await sendMorningPost({ store: await fixture(), editionId: id, env: {}, log: () => {}, screenshot: async () => null })).toEqual({ sent: false, reason: 'telegram not configured' })
  })

  it('caption stays within Telegram limits', () => {
    expect(morningCaption({ title: 'x'.repeat(5000), editionId: id, siteUrl: 'https://example.test/' }).length).toBeLessThanOrEqual(1000)
  })
})
