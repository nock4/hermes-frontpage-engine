import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { getHistoricalSourceKeys, getRecentEditionSummaries } from '../../scripts/lib/recent-edition-context.mjs'
import { selectContentSources, sourceContentKey, sourceContentScore } from '../../scripts/lib/source-selection-policy.mjs'
import { decideAnchorEligibility } from '../../scripts/lib/source-decision-gates.mjs'

let root
const original = 'https://art.example/old'
const resolved = 'https://gallery.example/art'
const oldImage = 'https://cdn.example/old-art.jpg'
const oldMedia = 'https://cdn.example/old-film.mp4'
const key = (url) => sourceContentKey({ url })
const fresh = {
  url: 'https://fresh.example/painting',
  source_url: 'https://fresh.example/painting',
  final_url: 'https://fresh.example/painting',
  image_url: 'https://cdn.example/fresh-painting.jpg',
  title: 'Painting gallery artwork',
  source_type: 'article',
  source_channel: 'chrome-bookmark',
  fetch_status: 'browser-harness',
  note_id: 'fresh-art',
}

function archive(binding) {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'frontpage-alias-ledger-'))
  const editions = ['newer', 'older'].map((edition_id) => ({ edition_id, path: `/editions/${edition_id}` }))
  fs.mkdirSync(path.join(root, 'public/editions'), { recursive: true })
  fs.writeFileSync(path.join(root, 'public/editions/index.json'), JSON.stringify({ editions }))
  for (const item of editions) {
    const dir = path.join(root, 'public', item.path)
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'source-bindings.json'), JSON.stringify({
      bindings: item.edition_id === 'older' ? [binding] : [],
    }))
  }
  return getHistoricalSourceKeys({ root, fsSync: fs, sourceContentKey })
}

function expectSpent(source, recentSourceKeys, reason = 'spent_source_url') {
  // Positive controls ensure repeat rejection is not a renderability failure.
  expect(selectContentSources([source])).toEqual([source])
  expect(decideAnchorEligibility({ anchorSource: source }).decision).toBe('accept')
  expect(sourceContentScore(source, recentSourceKeys)).toBe(Number.NEGATIVE_INFINITY)
  expect(selectContentSources([source], { recentSourceKeys })).toEqual([])
  expect(decideAnchorEligibility({ anchorSource: source, recentSourceKeys })).toMatchObject({
    decision: 'reject', reason_code: reason,
  })
}

afterEach(() => {
  if (root) fs.rmSync(root, { recursive: true, force: true })
  root = undefined
})

describe('archive source aliases', () => {
  it('retains original and resolved page keys alongside image/media across the whole archive', () => {
    const keys = archive({ source_url: original, resolved_url: resolved, source_image_url: oldImage, source_media_url: oldMedia })
    expect([...keys].sort()).toEqual([original, resolved, oldImage, oldMedia].map(key).sort())
    const recent = getRecentEditionSummaries({ root, fsSync: fs, sourceContentKey, limit: 1 })
    expect(recent[0].source_keys).toEqual([])
    const all = getRecentEditionSummaries({ root, fsSync: fs, sourceContentKey, limit: 2 })
    expect(all[1].source_keys.sort()).toEqual([...keys].sort())
    expect(selectContentSources([fresh], { recentSourceKeys: keys })).toEqual([fresh])
  })

  it.each([original, resolved])('rejects a direct candidate at archived alias %s even with a new image', (url) => {
    const keys = archive({ source_url: original, resolved_url: resolved, source_image_url: oldImage })
    expectSpent({ ...fresh, url, source_url: url, final_url: url }, keys)
  })

  it.each([original, resolved])('checks candidate final_url separately when only %s is archived', (url) => {
    const keys = archive({ source_url: url, source_image_url: oldImage })
    const source = { ...fresh, final_url: url }
    expect(keys.has(sourceContentKey(source))).toBe(false)
    expectSpent(source, keys)
  })

  it.each(['image_url', 'source_image_url', 'source_media_url'])('rejects archived material through candidate %s outside the recent window', (field) => {
    const keys = archive({ source_url: original, source_image_url: oldImage, source_media_url: oldMedia })
    expectSpent({ ...fresh, [field]: field === 'source_media_url' ? oldMedia : oldImage }, keys, 'spent_material_family')
  })

  it.each([
    ['https://twitter.com/artist/status/123?s=20', 'https://x.com/artist/status/123', 'https://x.com/artist/status/123?utm_source=saved'],
    ['https://youtu.be/abc123', 'https://www.youtube.com/watch?v=abc123&feature=share', 'https://www.youtube.com/watch?v=abc123&t=10'],
  ])('preserves canonical provider identity for %s', (source_url, resolved_url, candidateUrl) => {
    const keys = archive({ source_url, resolved_url })
    expect([...keys]).toEqual([key(source_url)])
    expect(key(candidateUrl)).toBe(key(source_url))
    expectSpent({ ...fresh, final_url: candidateUrl }, keys)
  })
})
