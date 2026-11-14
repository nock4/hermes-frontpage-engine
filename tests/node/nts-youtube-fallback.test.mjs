import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { extractNtsStreamingSourceRows } from '../../scripts/lib/signal-adapters/obsidian-allowlist-adapter.mjs'
import { mineSignals } from '../../scripts/lib/signal-mining.mjs'
import { getHistoricalSourceKeys } from '../../scripts/lib/recent-edition-context.mjs'
import { sourceContentKey, selectContentSources } from '../../scripts/lib/source-selection-policy.mjs'
import { acquireBookmarkArtwork } from '../../scripts/lib/bookmark-artwork.mjs'
import { acquireBoundedBookmarkSources } from '../../scripts/lib/source-research.mjs'

// Rows copied verbatim from Nick's rewritten NTS maps (2026-11-13) and from the
// pre-rewrite backup. They nominate candidates only; actual-media admission is
// mocked below and never confers eligibility on its own.
const HEADER = '| # | Artist | Track | Best source | Confidence | URL | Notes |\n|---|---|---|---|---|---|---|'
const REAL = {
  feeo: '| 1 | FEEO | Requiem | YouTube | high | [link](https://www.youtube.com/watch?v=NG6-Lrj4TQw) | YouTube match: "Requiem" on feeo; embeddable. Previous source (Bandcamp): https://feeo.bandcamp.com/track/requiem. Official artist Bandcamp track page. |',
  wakasa: '| 123 | SHINJI WAKASA | Cobalt Dawn | YouTube | high | [link](https://www.youtube.com/watch?v=zlYI-WDD-Ak) | YouTube match: "Cobalt Dawn" on Shinji Wakasa - Topic; embeddable. Previous source (Bandcamp (official artist page)): https://shinjiwakasa.bandcamp.com/track/cobalt-dawn-2. Exact track match on official Bandcamp. |',
  cocteau: '| 53 | COCTEAU TWINS | Feet Like Fins | YouTube | medium | [link](https://www.youtube.com/watch?v=0PeRN1dI_dU) | YouTube match: "Cocteau Twins -  Feet Like Fins" on glasscandles2u; embeddable. Previous source (SoundCloud): https://soundcloud.com/cocteau-twins/feet-like-fins-1. Exact full-length track on the cocteau-twins SoundCloud account. |',
  yokota: '| 17 | SUSUMU YOKOTA | Tayutafu | YouTube | high | [link](https://www.youtube.com/watch?v=Zwow7VPbftA) | YouTube match: "Tayutafu" on Susumu Yokota - Topic; embeddable. Previous source (Bandcamp): https://susumuyokota.bandcamp.com/album/image-1983-1998-skintone-edition. Official Bandcamp release containing the track. |',
  mcguire: '| 18 | MARK MCGUIRE | Sun Shining Through The Open Barn Door | YouTube | high | [link](https://www.youtube.com/watch?v=M-Y4ZqPguDU) | YouTube match: "Sun Shining Through the Open Barn Door" on Mark McGuire - Topic; embeddable. Previous source (YouTube-search): https://www.youtube.com/results?search_query=Mark+McGuire+Sun+Shining+Through+The+Open+Barn+Door. Strong topic/official match surfaced but exact watch URL was not exposed. |',
  mutate: '| 2 | MU TATE | Choreography Of Life | YouTube | high | [link](https://www.youtube.com/watch?v=DXQ7QcnbOhk) | YouTube match: "choreography of life" on mu tate - Topic; embeddable. Previous source: unverified. No verified public stream found yet. |',
}
// Pre-rewrite (backup) format rows: no "Previous source" pattern.
const OLD = {
  feeo: '| 1 | FEEO | Requiem | Bandcamp | high | [link](https://feeo.bandcamp.com/track/requiem) | Official artist Bandcamp track page. |',
  rose: '| 8 | BRAD ROSE | The Sound Leaves | Bandcamp | high | [link](https://room40.bandcamp.com/track/the-sound-leaves) | Official Room40 Bandcamp track page. |',
}
const table = rows => `# NTS liked tracks source map\n\n${HEADER}\n${rows.join('\n')}\n`

describe('NTS map parser exposes a Previous-source fallback', () => {
  it('parses Bandcamp/SoundCloud previous sources from Notes as row.fallback_url', () => {
    const rows = extractNtsStreamingSourceRows(table([REAL.feeo, REAL.wakasa, REAL.cocteau, REAL.yokota]))
    const byTrack = Object.fromEntries(rows.map(row => [row.track, row]))
    expect(byTrack.Requiem).toMatchObject({ url: 'https://www.youtube.com/watch?v=NG6-Lrj4TQw', fallback_url: 'https://feeo.bandcamp.com/track/requiem', fallback_label: 'Bandcamp' })
    expect(byTrack['Cobalt Dawn']).toMatchObject({ fallback_url: 'https://shinjiwakasa.bandcamp.com/track/cobalt-dawn-2', fallback_label: 'Bandcamp (official artist page)' })
    expect(byTrack['Feet Like Fins']).toMatchObject({ fallback_url: 'https://soundcloud.com/cocteau-twins/feet-like-fins-1', fallback_label: 'SoundCloud' })
    expect(byTrack.Tayutafu.fallback_url).toBe('https://susumuyokota.bandcamp.com/album/image-1983-1998-skintone-edition')
  })

  it('never turns a search locator or an unverified previous source into a fallback', () => {
    const rows = extractNtsStreamingSourceRows(table([REAL.mcguire, REAL.mutate]))
    expect(rows.map(row => row.url)).toEqual(['https://www.youtube.com/watch?v=M-Y4ZqPguDU', 'https://www.youtube.com/watch?v=DXQ7QcnbOhk'])
    for (const row of rows) {
      expect(row.fallback_url).toBeUndefined()
      expect(row.fallback_label).toBeUndefined()
    }
  })

  it('rejects private/non-streaming fallbacks and self-references', () => {
    const rows = extractNtsStreamingSourceRows(table([
      '| 3 | X | Private | YouTube | high | [link](https://www.youtube.com/watch?v=aaaaaaaaaaa) | Previous source (Bandcamp): http://127.0.0.1/track/private. |',
      '| 4 | X | Doc | YouTube | high | [link](https://www.youtube.com/watch?v=bbbbbbbbbbb) | Previous source (Web): https://example.com/music.txt. |',
      '| 5 | X | Self | YouTube | high | [link](https://www.youtube.com/watch?v=ccccccccccc) | Previous source (YouTube): https://www.youtube.com/watch?v=ccccccccccc. |',
      '| 6 | X | SCsearch | YouTube | high | [link](https://www.youtube.com/watch?v=ddddddddddd) | Previous source (SoundCloud-search): https://soundcloud.com/search?q=x. |',
    ]))
    expect(rows).toHaveLength(4)
    for (const row of rows) expect(row.fallback_url).toBeUndefined()
  })

  it('leaves old-format rows byte-for-byte unchanged in shape', () => {
    const rows = extractNtsStreamingSourceRows(table([OLD.feeo, OLD.rose]))
    expect(rows).toEqual([
      { row_number: '1', url: 'https://feeo.bandcamp.com/track/requiem', artist: 'FEEO', track: 'Requiem', best_source: 'Bandcamp', confidence: 'high', notes: 'Official artist Bandcamp track page.' },
      { row_number: '8', url: 'https://room40.bandcamp.com/track/the-sound-leaves', artist: 'BRAD ROSE', track: 'The Sound Leaves', best_source: 'Bandcamp', confidence: 'high', notes: 'Official Room40 Bandcamp track page.' },
    ])
  })
})

// ---------------------------------------------------------------- worker / intake
const RUN_DATE = '2026-11-13'
let root
const write = (relative, text) => {
  const file = path.join(root, 'vault', relative)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, text)
}
function archive(editions) {
  fs.mkdirSync(path.join(root, 'public/editions'), { recursive: true })
  fs.writeFileSync(path.join(root, 'public/editions/index.json'), JSON.stringify({ editions: editions.map(({ id, date }) => ({ edition_id: id, date, path: `/editions/${id}` })) }))
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
const ntsCandidates = harvest => harvest.source_candidates.filter(row => row.source_channel === 'nts-like')
afterEach(() => {
  if (root) fs.rmSync(root, { recursive: true, force: true })
  root = undefined
})

describe('supporting lane nominates one candidate per NTS track', () => {
  const setup = () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'nts-yt-fallback-'))
    write('Inbox/tweets/art.md', '# Painting\nAn original painting.\nhttps://x.com/painter/status/9001\nhttps://pbs.twimg.com/media/ART.jpg\n')
    write('00 - Capture/nts-liked-tracks-source-map-batch-1.md', table([REAL.feeo, REAL.cocteau, REAL.mcguire]))
  }

  it('uses the YouTube URL as primary and carries the verified previous source as fallback_urls', async () => {
    setup()
    const harvest = await mine(archive([{ id: 'prev', date: '2026-11-12', urls: [] }]))
    const nts = ntsCandidates(harvest)
    expect(nts.map(row => row.url).sort()).toEqual([
      'https://www.youtube.com/watch?v=0PeRN1dI_dU',
      'https://www.youtube.com/watch?v=M-Y4ZqPguDU',
      'https://www.youtube.com/watch?v=NG6-Lrj4TQw',
    ])
    const feeo = nts.find(row => row.url.endsWith('NG6-Lrj4TQw'))
    expect(feeo.fallback_urls).toEqual(['https://feeo.bandcamp.com/track/requiem'])
    expect(feeo.source_map_rows[0]).toMatchObject({ artist: 'FEEO', track: 'Requiem', fallback_url: 'https://feeo.bandcamp.com/track/requiem', evidence_origin: 'saved-note-row' })
    expect(nts.find(row => row.url.endsWith('M-Y4ZqPguDU')).fallback_urls).toBeUndefined()
    // No second window-candidate for the same track via its fallback URL.
    expect(harvest.source_candidates.some(row => row.url === 'https://feeo.bandcamp.com/track/requiem')).toBe(false)
  })

  it('blocks the whole track family when its previous (Bandcamp) source was used within the cooldown', async () => {
    setup()
    const harvest = await mine(archive([
      { id: 'prev', date: '2026-11-12', urls: ['https://feeo.bandcamp.com/track/requiem'] },
      { id: 'recent', date: '2026-11-01', urls: ['https://www.youtube.com/watch?v=0PeRN1dI_dU'] },
    ]))
    const urls = ntsCandidates(harvest).map(row => row.url)
    expect(urls).not.toContain('https://www.youtube.com/watch?v=NG6-Lrj4TQw')
    expect(urls).not.toContain('https://www.youtube.com/watch?v=0PeRN1dI_dU')
    expect(urls.some(url => /bandcamp|soundcloud/.test(url))).toBe(false)
    expect(harvest.selection_policy.supporting_intake.channels['nts-like'].cooldown_blocked).toBe(2)
  })

  it('allows a family whose fallback was used outside the cooldown as a supporting repeat', async () => {
    setup()
    const harvest = await mine(archive([
      { id: 'prev', date: '2026-11-12', urls: [] },
      { id: 'old', date: '2026-08-01', urls: ['https://feeo.bandcamp.com/track/requiem'] },
    ]))
    const feeo = ntsCandidates(harvest).find(row => row.url.endsWith('NG6-Lrj4TQw'))
    expect(feeo).toBeDefined()
    expect(feeo.fallback_urls).toEqual(['https://feeo.bandcamp.com/track/requiem'])
    // The track (via its previous Bandcamp window) already appeared: a family
    // repeat, eligible only as a supporting window.
    expect(feeo.supporting_repeat_eligible).toBe(true)
  })

  it('does not nominate a track twice when another row repeats its fallback or primary', async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'nts-yt-fallback-'))
    write('Inbox/tweets/art.md', '# Painting\nhttps://x.com/painter/status/9001\nhttps://pbs.twimg.com/media/ART.jpg\n')
    write('00 - Capture/nts-liked-tracks-source-map.md', table([OLD.feeo]))
    write('00 - Capture/nts-liked-tracks-source-map-batch-1.md', table([REAL.feeo]))
    const harvest = await mine(archive([{ id: 'prev', date: '2026-11-12', urls: [] }]))
    expect(ntsCandidates(harvest)).toHaveLength(1)
  })
})

// ---------------------------------------------------------------- acquisition
function adapters({ admitted = new Set(), dropped = new Set() } = {}, log = { acquired: [], batches: [] }) {
  return {
    log,
    acquire: async batch => { log.acquired.push(...batch.map(row => row.url)); log.batches.push(batch); return batch.filter(row => !dropped.has(row.url)).map(row => ({ ...row })) },
    research: async () => ({ source_decisions: [] }),
    inspect: async (sources, research) => ({ ...research, source_decisions: [...research.source_decisions, ...sources.map(s => ({ url: s.url, inspection: { status: admitted.has(s.url) ? 'verified' : 'ambiguous', confidence: 'high' } }))] }),
    select: (sources, research) => sources.filter(s => research.source_decisions.some(r => r.url === s.url && r.inspection?.status === 'verified')),
  }
}
const tweet = { url: 'https://x.com/a/status/1', source_channel: 'twitter-bookmark' }
const YT = 'https://www.youtube.com/watch?v=NG6-Lrj4TQw'
const BC = 'https://feeo.bandcamp.com/track/requiem'
const ntsRow = { row_number: '1', url: YT, artist: 'FEEO', track: 'Requiem', fallback_url: BC, fallback_label: 'Bandcamp', evidence_origin: 'saved-note-row', note_path: '00 - Capture/nts-liked-tracks-source-map-batch-1.md' }
const ntsCandidate = { url: YT, source_channel: 'nts-like', intake_lane: 'supporting', fallback_urls: [BC], source_map_rows: [ntsRow], note_path: ntsRow.note_path }

describe('supporting acquisition falls back from YouTube to the saved previous source', () => {
  it('tries the fallback once when the YouTube primary fails actual-media admission, inside the shared budget', async () => {
    const a = adapters({ admitted: new Set([tweet.url, BC]) })
    const result = await acquireBookmarkArtwork({ candidates: [tweet], supportingCandidates: [ntsCandidate] }, a)
    expect(a.log.acquired).toEqual([tweet.url, YT, BC])
    const used = result.contentSources.find(s => s.url === BC)
    expect(used).toMatchObject({ supporting_fallback_of: YT, source_map_rows: [ntsRow], intake_lane: 'supporting' })
    expect(result.audit).toMatchObject({ acquired: 3, supporting_lane_acquired: 2, supporting_fallbacks_attempted: 1, supporting_fallbacks_used: 1 })
  })

  it('tries the fallback when YouTube capture/acquisition returns nothing', async () => {
    const a = adapters({ admitted: new Set([tweet.url, BC]), dropped: new Set([YT]) })
    const result = await acquireBookmarkArtwork({ candidates: [tweet], supportingCandidates: [ntsCandidate] }, a)
    expect(a.log.acquired).toEqual([tweet.url, YT, BC])
    expect(result.contentSources.map(s => s.url)).toEqual([tweet.url, BC])
  })

  it('never tries the fallback after a successful YouTube admission', async () => {
    const a = adapters({ admitted: new Set([tweet.url, YT, BC]) })
    const result = await acquireBookmarkArtwork({ candidates: [tweet], supportingCandidates: [ntsCandidate] }, a)
    expect(a.log.acquired).toEqual([tweet.url, YT])
    expect(result.audit).toMatchObject({ supporting_fallbacks_attempted: 0, supporting_fallbacks_used: 0 })
  })

  it('never falls back for anchor-lane candidates', async () => {
    const anchorWithFallback = { ...tweet, fallback_urls: ['https://x.example.bandcamp.com/track/z'] }
    const second = { url: 'https://x.com/a/status/2', source_channel: 'twitter-bookmark' }
    const a = adapters({ admitted: new Set([second.url]) })
    const result = await acquireBookmarkArtwork({ candidates: [anchorWithFallback, second], supportingCandidates: [] }, a)
    expect(a.log.acquired).toEqual([tweet.url, second.url])
    expect(result.audit.supporting_fallbacks_attempted).toBe(0)
  })

  it('never exceeds the shared acquisition allowance to try a fallback', async () => {
    const a = adapters({ admitted: new Set([tweet.url, BC]) })
    const result = await acquireBookmarkArtwork({ candidates: [tweet], supportingCandidates: [ntsCandidate], maxAcquisitions: 2 }, a)
    expect(a.log.acquired).toEqual([tweet.url, YT])
    expect(result.audit).toMatchObject({ acquired: 2, supporting_fallbacks_attempted: 0 })
  })

  it('tries a fallback at most once and never chains', async () => {
    const chained = { ...ntsCandidate, fallback_urls: [BC, 'https://soundcloud.com/feeo/requiem'] }
    const a = adapters({ admitted: new Set([tweet.url]) })
    const result = await acquireBookmarkArtwork({ candidates: [tweet], supportingCandidates: [chained] }, a)
    expect(a.log.acquired).toEqual([tweet.url, YT, BC])
    expect(result.audit.supporting_fallbacks_attempted).toBe(1)
    expect(result.audit.supporting_fallbacks_used).toBe(0)
  })

  it('never yields two windows for one track even if both primary and fallback admit', async () => {
    // select admits YouTube only after the fallback batch (synthetic late flip).
    const log = { acquired: [], batches: [] }
    const a = adapters({ admitted: new Set([tweet.url, BC]) }, log)
    let flip = false
    const select = a.select
    a.select = (sources, research) => flip ? sources : select(sources, research)
    const inspect = a.inspect
    a.inspect = async (sources, research) => { const out = await inspect(sources, research); if (sources.some(s => s.url === BC)) flip = true; return out }
    const result = await acquireBookmarkArtwork({ candidates: [tweet], supportingCandidates: [ntsCandidate] }, a)
    const family = result.contentSources.filter(s => [YT, BC].includes(s.url))
    expect(family).toHaveLength(1)
  })
})

describe('final selection keeps one window per NTS track family', () => {
  it('selectContentSources drops a second source from the same track family', () => {
    const base = { source_channel: 'nts-like', title: 'Requiem', image_url: 'https://i.ytimg.com/vi/NG6-Lrj4TQw/hqdefault.jpg', source_type: 'video', embed_url: 'https://www.youtube.com/embed/NG6-Lrj4TQw', note_id: 'n1', note_path: 'map.md' }
    const sources = [
      { ...base, url: YT, nts_track_family: YT },
      { ...base, url: BC, source_type: 'audio', image_url: 'https://f4.bcbits.com/img/a1_10.jpg', nts_track_family: YT, supporting_fallback_of: YT },
    ]
    const selected = selectContentSources(sources, {})
    expect(selected.filter(s => s.nts_track_family === YT)).toHaveLength(1)
  })
})

describe('bookmark-acquisition.json records supporting fallbacks', () => {
  it('writes attempted/used counts and charges the shared 24 budget', async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'nts-yt-fallback-'))
    const runDir = path.join(root, 'run')
    const budget = { acquisitions: 0, inspections: 0 }
    const a = adapters({ admitted: new Set([tweet.url, BC]) })
    await acquireBoundedBookmarkSources({ source_candidates: [] }, {
      candidates: [tweet], supportingCandidates: [ntsCandidate], desired: 6, runDir, budget,
      adapters: { acquire: a.acquire, research: a.research, inspectRaw: (s, r) => a.inspect(s, r), select: a.select, anchorEligible: () => true },
    })
    const audit = JSON.parse(fs.readFileSync(path.join(runDir, 'bookmark-acquisition.json'), 'utf8'))
    expect(audit).toMatchObject({ supporting_fallbacks_attempted: 1, supporting_fallbacks_used: 1, acquired: 3 })
    expect(audit.supporting_fallbacks).toEqual([{ primary_url: YT, fallback_url: BC, admitted: true }])
    expect(budget.acquisitions).toBe(3)
  })
})
