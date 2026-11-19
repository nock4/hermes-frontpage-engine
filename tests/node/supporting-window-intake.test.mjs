import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { mineSignals } from '../../scripts/lib/signal-mining.mjs'
import { getHistoricalSourceKeys } from '../../scripts/lib/recent-edition-context.mjs'
import { sourceContentKey } from '../../scripts/lib/source-selection-policy.mjs'

// Synthetic saved-note fixtures only: they nominate candidates and prove intake
// coverage, never eligibility. Actual-media admission is tested elsewhere.
const RUN_DATE = '2026-11-13'
let root

const write = (relative, text) => {
  const file = path.join(root, 'vault', relative)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, text)
}
const youtubeNote = (id, title = `Liked video ${id}`) => `---\nsource: "youtube"\ntitle: "${title}"\nurl: "https://www.youtube.com/watch?v=${id}"\nthumbnail: "https://i.ytimg.com/vi/${id}/maxresdefault.jpg"\n---\n\n# ${title}\n\n![thumbnail](https://i.ytimg.com/vi/${id}/maxresdefault.jpg)\nWatch: https://www.youtube.com/watch?v=${id}\n`
const ntsMap = rows => `# NTS liked tracks source map\n\n| # | Artist | Track | Best source | Confidence | URL | Notes |\n|---|---|---|---|---|---|---|\n${rows.map((row, i) => `| ${i + 1} | ${row.artist} | ${row.track} | ${row.best || 'Bandcamp'} | ${row.confidence || 'high'} | ${row.url} | saved row |`).join('\n')}\n`

function archive(editions) {
  const manifest = editions.map(({ id, date }) => ({ edition_id: id, date, path: `/editions/${id}` }))
  fs.mkdirSync(path.join(root, 'public/editions'), { recursive: true })
  fs.writeFileSync(path.join(root, 'public/editions/index.json'), JSON.stringify({ editions: manifest }))
  for (const edition of editions) {
    fs.mkdirSync(path.join(root, 'public/editions', edition.id), { recursive: true })
    fs.writeFileSync(path.join(root, 'public/editions', edition.id, 'source-bindings.json'), JSON.stringify({ bindings: edition.urls.map(source_url => ({ source_url })) }))
  }
  return getHistoricalSourceKeys({ root, fsSync: fs, sourceContentKey, date: RUN_DATE })
}

const mine = recentSourceKeys => mineSignals({
  inputMode: 'obsidian-allowlist', inputRoot: path.join(root, 'vault'), date: RUN_DATE,
  bookmarkFirst: true, bookmarkCacheDir: path.join(root, 'cache'), recentSourceKeys,
}, path.join(root, 'run'))

afterEach(() => {
  if (root) fs.rmSync(root, { recursive: true, force: true })
  root = undefined
})

describe('ordinary bookmark-first intake gathers supporting candidates from multiple saved channels', () => {
  it('reads YouTube likes, NTS/Bandcamp maps and manual-curation notes alongside fresh X bookmarks', async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'frontpage-supporting-intake-'))
    write('Inbox/tweets/art.md', '# Painting\nAn original painting.\nhttps://x.com/painter/status/9001\nhttps://pbs.twimg.com/media/ART.jpg\n')
    write('00 - Capture/youtube/a.md', youtubeNote('FRESHVID001'))
    write('00 - Capture/youtube/b.md', youtubeNote('COOLDOWN002'))
    write('00 - Capture/youtube/c.md', youtubeNote('RECENTVID03'))
    write('00 - Capture/nts-liked-tracks-source-map.md', ntsMap([
      { artist: 'A', track: 'One', url: 'https://artist-a.bandcamp.com/track/one' },
      { artist: 'B', track: 'Two', url: 'https://artist-b.bandcamp.com/track/two', confidence: 'low' },
      { artist: 'C', track: 'Three', url: 'https://artist-c.bandcamp.com/album/three', best: 'Search result' },
    ]))
    write('00 - Capture/frontpage-intake/2026-10-11/blood-pool.md', '# Kiki Smith — Blood Pool\n\nSource: https://www.artic.edu/artworks/122231/blood-pool\n\nDirect museum object page.\n')
    const ledger = archive([
      { id: 'prev', date: '2026-11-12', urls: ['https://www.youtube.com/watch?v=RECENTVID03'] },
      { id: 'old', date: '2026-08-01', urls: ['https://www.youtube.com/watch?v=COOLDOWN002'] },
    ])
    const harvest = await mine(ledger)
    const byChannel = harvest.source_candidates.reduce((acc, row) => ({ ...acc, [row.source_channel]: [...(acc[row.source_channel] || []), row.url] }), {})
    expect(Object.keys(byChannel).sort()).toEqual(['manual-curation', 'nts-like', 'twitter-bookmark', 'youtube-like'])
    // The fresh X anchor lane keeps its first position; supporting lanes follow.
    expect(harvest.source_candidates[0].url).toBe('https://x.com/painter/status/9001')
    expect(byChannel['youtube-like'].sort()).toEqual(['https://www.youtube.com/watch?v=COOLDOWN002', 'https://www.youtube.com/watch?v=FRESHVID001'])
    expect(byChannel['nts-like']).toEqual(['https://artist-a.bandcamp.com/track/one'])
    expect(byChannel['manual-curation']).toEqual(['https://www.artic.edu/artworks/122231/blood-pool'])
    const repeat = harvest.source_candidates.find(row => row.url.endsWith('COOLDOWN002'))
    expect(repeat).toMatchObject({ intake_lane: 'supporting', source_repeated_in_archive: true, supporting_repeat_eligible: true })
    expect(harvest.source_candidates.find(row => row.url.endsWith('FRESHVID001'))).toMatchObject({ intake_lane: 'supporting', source_repeated_in_archive: false })
    expect(harvest.source_candidates[0]).toMatchObject({ intake_lane: 'anchor' })
    expect(harvest.source_candidates.find(row => row.source_channel === 'nts-like').source_map_rows[0]).toMatchObject({ artist: 'A', track: 'One', confidence: 'high' })
    expect(harvest.selection_policy.supporting_intake.channels).toMatchObject({ 'youtube-like': expect.any(Object), 'nts-like': expect.any(Object), 'manual-curation': expect.any(Object) })
  })

  it('bounds supporting nominations and round-robins channels instead of letting one platform fill the lane', async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'frontpage-supporting-intake-'))
    write('Inbox/tweets/art.md', '# Painting\nhttps://x.com/painter/status/9001\nhttps://pbs.twimg.com/media/ART.jpg\n')
    for (let i = 0; i < 40; i++) write(`00 - Capture/youtube/${String(i).padStart(2, '0')}.md`, youtubeNote(`VIDEO${String(i).padStart(6, '0')}`))
    write('00 - Capture/nts-liked-tracks-source-map.md', ntsMap([{ artist: 'A', track: 'One', url: 'https://artist-a.bandcamp.com/track/one' }]))
    write('00 - Capture/frontpage-intake/x/work.md', '# Work\nSource: https://www.artic.edu/artworks/1/work\n')
    const harvest = await mine(archive([{ id: 'prev', date: '2026-11-12', urls: [] }]))
    const supporting = harvest.source_candidates.filter(row => row.intake_lane === 'supporting')
    expect(supporting.length).toBeLessThanOrEqual(18)
    expect(supporting.slice(0, 3).map(row => row.source_channel).sort()).toEqual(['manual-curation', 'nts-like', 'youtube-like'])
  })

  it('keeps the X anchor queue fresh-only: archive repeats are never nominated in the anchor lane', async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'frontpage-supporting-intake-'))
    write('Inbox/tweets/old.md', '# Painting\nhttps://x.com/painter/status/7000\nhttps://pbs.twimg.com/media/OLD.jpg\n')
    write('Inbox/tweets/new.md', '# Painting\nhttps://x.com/painter/status/7001\nhttps://pbs.twimg.com/media/NEW.jpg\n')
    const harvest = await mine(archive([{ id: 'prev', date: '2026-11-12', urls: [] }, { id: 'old', date: '2026-06-01', urls: ['https://x.com/painter/status/7000'] }]))
    expect(harvest.source_candidates.filter(row => row.intake_lane === 'anchor').map(row => row.url)).toEqual(['https://x.com/painter/status/7001'])
  })
})
