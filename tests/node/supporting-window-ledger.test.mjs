import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { getHistoricalSourceKeys } from '../../scripts/lib/recent-edition-context.mjs'
import { selectContentSources, sourceContentKey, sourceContentScore } from '../../scripts/lib/source-selection-policy.mjs'
import { decideAnchorEligibility } from '../../scripts/lib/source-decision-gates.mjs'

// Nick: "the main artwork should stay new while the supporting windows repeat."
// Anchor = full archive, any age, any field, same date included.
// Supporting = blocked only within the 30-day cooldown or the previous edition.
const RUN_DATE = '2026-11-13'
let root

const surface = (url, extra = {}) => ({
  url, source_url: url, final_url: url, title: 'Saved work', description: 'Painting and textile exhibition',
  image_url: `${url.replace(/\/$/, '')}/still.jpg`, fetch_status: 'fetch-ok', source_channel: 'chrome-bookmark',
  source_type: 'article', note_id: url, ...extra,
})

function archive(editions) {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'frontpage-supporting-ledger-'))
  const manifest = editions.map(({ id, date }) => ({ edition_id: id, date, path: `/editions/${id}` }))
  fs.mkdirSync(path.join(root, 'public/editions'), { recursive: true })
  fs.writeFileSync(path.join(root, 'public/editions/index.json'), JSON.stringify({ editions: manifest }))
  for (const edition of editions) {
    const dir = path.join(root, 'public/editions', edition.id)
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'source-bindings.json'), JSON.stringify({ bindings: edition.bindings }))
  }
}
const ledgerFor = (options = {}) => getHistoricalSourceKeys({ root, fsSync: fs, sourceContentKey, date: RUN_DATE, ...options })
const binding = (url, extra = {}) => ({ source_url: url, source_image_url: `${url}/still.jpg`, ...extra })

const oldSupporting = 'https://label.bandcamp.com/album/old-supporting'
const oldAnchor = 'https://x.com/painter/status/1001'
const oldAnchorImage = 'https://pbs.twimg.com/media/OLD_ANCHOR.jpg'
const recentSupporting = 'https://label.bandcamp.com/album/recent-supporting'
const previousSupporting = 'https://www.youtube.com/watch?v=PREVIOUS01'
const sameDateSupporting = 'https://museum.example/objects/same-date'

afterEach(() => {
  if (root) fs.rmSync(root, { recursive: true, force: true })
  root = undefined
})

function standardArchive() {
  archive([
    { id: 'same-day', date: RUN_DATE, bindings: [binding(sameDateSupporting)] },
    { id: 'previous', date: '2026-11-12', bindings: [binding(previousSupporting)] },
    { id: 'recent', date: '2026-10-30', bindings: [binding(recentSupporting)] },
    { id: 'old', date: '2026-09-01', bindings: [
      binding(oldAnchor, { source_image_url: oldAnchorImage, source_media_url: oldAnchorImage }),
      binding(oldSupporting),
    ] },
  ])
}

describe('supporting-window repeat cooldown', () => {
  it('admits a previously published supporting source outside the 30-day cooldown as a supporting window', () => {
    standardArchive()
    const ledger = ledgerFor()
    const source = surface(oldSupporting, { source_channel: 'nts-like' })
    expect(selectContentSources([source], { recentSourceKeys: ledger }).map(row => row.url)).toEqual([oldSupporting])
  })

  it('allows a former anchor to return only as a supporting window after cooldown, never as anchor', () => {
    standardArchive()
    const ledger = ledgerFor()
    const source = surface(oldAnchor, { image_url: oldAnchorImage, source_channel: 'twitter-bookmark', source_type: 'tweet' })
    expect(selectContentSources([source], { recentSourceKeys: ledger }).map(row => row.url)).toEqual([oldAnchor])
    expect(decideAnchorEligibility({ anchorSource: source, recentSourceKeys: ledger }).decision).toBe('reject')
  })

  it.each([
    ['used 14 days ago', recentSupporting],
    ['used in the immediately previous edition', previousSupporting],
    ['used earlier the same date', sameDateSupporting],
  ])('keeps blocking a supporting source %s', (_, url) => {
    standardArchive()
    const ledger = ledgerFor()
    expect(sourceContentScore(surface(url), ledger)).toBe(Number.NEGATIVE_INFINITY)
    expect(selectContentSources([surface(url)], { recentSourceKeys: ledger })).toEqual([])
  })

  it('blocks the immediately previous edition even when it is older than the cooldown', () => {
    const gapSupporting = 'https://label.bandcamp.com/album/gap-previous'
    archive([
      { id: 'gap-previous', date: '2026-09-20', bindings: [binding(gapSupporting)] },
      { id: 'older', date: '2026-08-01', bindings: [binding(oldSupporting)] },
    ])
    const ledger = ledgerFor()
    expect(selectContentSources([surface(gapSupporting)], { recentSourceKeys: ledger })).toEqual([])
    expect(selectContentSources([surface(oldSupporting)], { recentSourceKeys: ledger }).map(row => row.url)).toEqual([oldSupporting])
  })

  it('blocks supporting repeats through any persisted image/media alias inside the cooldown', () => {
    const page = 'https://new-page.example/work'
    archive([{ id: 'recent', date: '2026-11-01', bindings: [binding('https://other.example/a', { source_media_url: 'https://cdn.example/shared.jpg' })] }])
    const ledger = ledgerFor()
    expect(selectContentSources([surface(page, { image_url: 'https://cdn.example/shared.jpg' })], { recentSourceKeys: ledger })).toEqual([])
  })

  it.each([
    ['source_url', { url: oldSupporting }],
    ['final_url', { final_url: oldSupporting }],
    ['image_url', { image_url: `${oldSupporting}/still.jpg` }],
    ['source_media_url', { source_media_url: `${oldSupporting}/still.jpg` }],
    ['source_image_aliases', { source_image_aliases: [`${oldSupporting}/still.jpg`] }],
    ['resolved_url', { resolved_url: oldSupporting }],
    ['inspected media_url', { media_url: `${oldSupporting}/still.jpg` }],
    ['parent tweet family under another username', { url: 'https://twitter.com/i/web/status/1001', source_url: 'https://twitter.com/i/web/status/1001', final_url: 'https://twitter.com/i/web/status/1001' }],
  ])('never admits an archived %s as anchor at any age', (_, fields) => {
    standardArchive()
    const ledger = ledgerFor()
    const anchor = { ...surface('https://fresh.example/painting'), ...fields }
    expect(decideAnchorEligibility({ anchorSource: anchor, recentSourceKeys: ledger }).decision).toBe('reject')
  })

  it('never admits a same-date published source as anchor or supporting', () => {
    standardArchive()
    const ledger = ledgerFor()
    expect(decideAnchorEligibility({ anchorSource: surface(sameDateSupporting), recentSourceKeys: ledger }).decision).toBe('reject')
  })

  it('stays fully strict when no run date is known or a plain Set ledger is supplied', () => {
    standardArchive()
    const strict = getHistoricalSourceKeys({ root, fsSync: fs, sourceContentKey })
    expect(selectContentSources([surface(oldSupporting)], { recentSourceKeys: strict })).toEqual([])
    expect(selectContentSources([surface(oldSupporting)], { recentSourceKeys: new Set([sourceContentKey({ url: oldSupporting })]) })).toEqual([])
  })

  it('keeps editorial quarantine on cooldown-eligible repeats', () => {
    const tool = 'https://tools.example/agent'
    archive([{ id: 'old', date: '2026-08-01', bindings: [binding(tool)] }, { id: 'prev', date: '2026-11-12', bindings: [] }])
    const ledger = ledgerFor()
    expect(selectContentSources([surface(tool, { description: 'AI assistant prompt guide and agent workflow tutorial' })], { recentSourceKeys: ledger })).toEqual([])
  })

  it('ranks fresh material ahead of cooldown repeats and keeps one window per family', () => {
    standardArchive()
    const ledger = ledgerFor()
    const fresh = surface('https://label.bandcamp.com/album/fresh', { source_channel: 'nts-like', note_id: 'n1' })
    const repeat = surface(oldSupporting, { source_channel: 'nts-like', note_id: 'n2' })
    const duplicate = { ...repeat, note_id: 'n3', title: 'Same family again' }
    const selected = selectContentSources([repeat, duplicate, fresh], { recentSourceKeys: ledger })
    expect(selected.map(row => row.url)).toEqual([fresh.url, oldSupporting])
  })
})
