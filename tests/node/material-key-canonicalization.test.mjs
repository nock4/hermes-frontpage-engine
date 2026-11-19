import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { mineSignals } from '../../scripts/lib/signal-mining.mjs'
import { getHistoricalSourceKeys } from '../../scripts/lib/recent-edition-context.mjs'
import { sourceContentKey } from '../../scripts/lib/source-selection-policy.mjs'
import { canonicalizeSourceUrl } from '../../scripts/lib/source-url-policy.mjs'
import { decideAnchorEligibility } from '../../scripts/lib/source-decision-gates.mjs'

// One X media asset has several URL spellings; the archive ledger must treat
// them as one material key in the main process and in the intake worker.
const RUN_DATE = '2026-11-13'
let root

function archive(editions) {
  fs.mkdirSync(path.join(root, 'public/editions'), { recursive: true })
  fs.writeFileSync(path.join(root, 'public/editions/index.json'), JSON.stringify({ editions: editions.map(({ id, date }) => ({ edition_id: id, date, path: `/editions/${id}` })) }))
  for (const edition of editions) {
    fs.mkdirSync(path.join(root, 'public/editions', edition.id), { recursive: true })
    fs.writeFileSync(path.join(root, 'public/editions', edition.id, 'source-bindings.json'), JSON.stringify({ bindings: edition.urls.map(source_url => ({ source_url })) }))
  }
  return getHistoricalSourceKeys({ root, fsSync: fs, sourceContentKey, date: RUN_DATE })
}
const write = (relative, text) => {
  const file = path.join(root, 'vault', relative)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, text)
}

afterEach(() => {
  if (root) fs.rmSync(root, { recursive: true, force: true })
  root = undefined
})

describe('pbs.twimg.com media spellings share one material key', () => {
  const spellings = [
    'https://pbs.twimg.com/media/GxArt01.jpg',
    'https://pbs.twimg.com/media/GxArt01?format=jpg',
    'https://pbs.twimg.com/media/GxArt01?format=jpg&name=large',
    'https://pbs.twimg.com/media/GxArt01.jpg?name=orig',
    'https://pbs.twimg.com/media/GxArt01.jpg:large',
  ]

  it('canonicalizes extension, format query and size variants identically', () => {
    expect(new Set(spellings.map(canonicalizeSourceUrl)).size).toBe(1)
    expect(new Set(spellings.map(url => sourceContentKey({ url }))).size).toBe(1)
    // Different asset ids stay distinct.
    expect(canonicalizeSourceUrl('https://pbs.twimg.com/media/GxArt02.jpg')).not.toBe(canonicalizeSourceUrl(spellings[0]))
  })

  it.each([
    ['https://pbs.twimg.com/media/GxArt01.jpg', 'https://pbs.twimg.com/media/GxArt01?format=jpg&name=small'],
    ['https://pbs.twimg.com/media/GxArt01?format=jpg&name=large', 'https://pbs.twimg.com/media/GxArt01.jpg'],
  ])('rejects an anchor when %s is archived and its media is %s', (archived, current) => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'frontpage-material-key-'))
    const ledger = archive([{ id: 'older', date: '2026-07-01', urls: [archived] }])
    const decision = decideAnchorEligibility({ anchorSource: { url: 'https://x.com/new/status/555', image_url: current, source_type: 'tweet', title: 'Painting' }, recentSourceKeys: ledger })
    expect(decision).toMatchObject({ decision: 'reject', reason_code: 'spent_material_family' })
  })
})

describe('intake worker material key', () => {
  const anchorLaneUrls = async ledger => (await mineSignals({
    inputMode: 'obsidian-allowlist', inputRoot: path.join(root, 'vault'), date: RUN_DATE,
    bookmarkFirst: true, bookmarkCacheDir: path.join(root, 'cache'), recentSourceKeys: ledger,
  }, path.join(root, 'run'))).source_candidates.filter(row => row.intake_lane !== 'supporting').map(row => row.url)

  it('drops a fresh-status X note whose attached media was archived under another spelling', async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'frontpage-material-key-'))
    write('Inbox/tweets/spent.md', '# Repost\nA painting.\nhttps://x.com/new/status/555\nhttps://pbs.twimg.com/media/SpentImg?format=jpg&name=small\n')
    write('Inbox/tweets/fresh.md', '# Fresh\nA painting.\nhttps://x.com/ok/status/777\nhttps://pbs.twimg.com/media/FreshImg.jpg\n')
    const urls = await anchorLaneUrls(archive([{ id: 'older', date: '2026-07-01', urls: ['https://pbs.twimg.com/media/SpentImg.jpg'] }]))
    expect(urls).toContain('https://x.com/ok/status/777')
    expect(urls).not.toContain('https://x.com/new/status/555')
  })

  it('drops an X note whose status was archived as a mobile.twitter.com URL', async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'frontpage-material-key-'))
    write('Inbox/tweets/spent.md', '# Old\nA painting.\nhttps://x.com/foo/status/4242\n')
    write('Inbox/tweets/fresh.md', '# Fresh\nA painting.\nhttps://x.com/ok/status/777\n')
    const urls = await anchorLaneUrls(archive([{ id: 'older', date: '2026-07-01', urls: ['https://mobile.twitter.com/foo/status/4242/photo/1'] }]))
    expect(urls).toContain('https://x.com/ok/status/777')
    expect(urls).not.toContain('https://x.com/foo/status/4242')
  })
})
