import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ sources: new Map(), attempts: [], captures: [] }))
// Real mining, ledger, scheduling, admission and anchor gates. Only network
// fetches and model responses are synthetic; no eligibility stamps are injected.
vi.mock('../../scripts/lib/source-inspection.mjs', () => ({
  inspectCandidateSource: async source => { state.captures.push(source.url); return { ...source, ...state.sources.get(source.url) } },
  findVisualReference: async () => null,
}))
vi.mock('../../scripts/lib/source-image-network-policy.mjs', async original => ({
  ...await original(),
  resolveFetchableImageUrl: async url => url,
  fetchVettedRemoteUrl: async url => new Response(Buffer.from(`synthetic pixels ${url}`), { headers: { 'content-type': 'image/png' } }),
}))
vi.mock('../../scripts/lib/source-image-geometry.mjs', async original => ({
  ...await original(), measureSourceImage: async () => ({ width: 800, height: 600 }),
}))
vi.mock('../../scripts/lib/openai-json.mjs', () => ({
  openAiJson: async ({ instructions, input }) => {
    if (instructions.includes('source-research editor')) {
      const request = JSON.parse(input)
      const source_decisions = request.candidate_sources.map(source => ({ url: source.url, role: 'content', confidence: 'high', why: 'Nominate for actual-media inspection' }))
      return { source_decisions, selected_content_urls: source_decisions.map(row => row.url), visual_reference_urls: [] }
    }
    if (instructions.startsWith('Inspect the attached actual source pixels')) {
      const source = JSON.parse(input[0].content[0].text)
      state.attempts.push(source.url)
      return { status: state.sources.get(source.url)?.pixelStatus || 'verified', artifact_kind: 'artwork', confidence: 'high', observation: 'Synthetic model fixture: painted figures' }
    }
    return { visual_summary: 'Painted figures', preserve_cues: ['red figures', 'woven texture'], visual_fertility: 'high' }
  },
}))
import { inspectSourceCandidates } from '../../scripts/lib/source-research.mjs'
import { mineSignals } from '../../scripts/lib/signal-mining.mjs'
import { getHistoricalSourceKeys } from '../../scripts/lib/recent-edition-context.mjs'
import { sourceContentKey } from '../../scripts/lib/source-selection-policy.mjs'

const RUN_DATE = '2026-11-13'
let root
const write = (relative, text) => {
  const file = path.join(root, 'vault', relative)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, text)
}
const youtube = id => `---\ntitle: "Liked ${id}"\nurl: "https://www.youtube.com/watch?v=${id}"\n---\n# Liked ${id}\nWatch: https://www.youtube.com/watch?v=${id}\n`
const yt = id => `https://www.youtube.com/watch?v=${id}`
const source = (url, extra = {}) => state.sources.set(url, {
  title: 'Painted figures artwork', description: 'Painting and textile artwork with woven figures.',
  image_url: `https://media.example/${encodeURIComponent(url)}.png`, fetch_status: 'fetch-ok', ...extra,
})

function archive(editions) {
  fs.mkdirSync(path.join(root, 'public/editions'), { recursive: true })
  fs.writeFileSync(path.join(root, 'public/editions/index.json'), JSON.stringify({ editions: editions.map(({ id, date }) => ({ edition_id: id, date, path: `/editions/${id}` })) }))
  for (const edition of editions) {
    fs.mkdirSync(path.join(root, 'public/editions', edition.id), { recursive: true })
    fs.writeFileSync(path.join(root, 'public/editions', edition.id, 'source-bindings.json'), JSON.stringify({ bindings: edition.urls.map(source_url => ({ source_url })) }))
  }
  return getHistoricalSourceKeys({ root, fsSync: fs, sourceContentKey, date: RUN_DATE })
}

async function run({ tweetStatus = 'verified', extraEditions = [] } = {}) {
  write('Inbox/tweets/a.md', '# Painting\nAn original painting.\nhttps://x.com/painter/status/9001\nhttps://pbs.twimg.com/media/ART.jpg\n')
  source('https://x.com/painter/status/9001', { source_type: 'tweet', image_url: 'https://pbs.twimg.com/media/ART.jpg', pixelStatus: tweetStatus })
  for (const id of ['FRESHVID001', 'COOLDOWN002', 'RECENTVID03']) { write(`00 - Capture/youtube/${id}.md`, youtube(id)); source(yt(id), { source_type: 'youtube', image_url: `https://i.ytimg.com/vi/${id}/hqdefault.jpg` }) }
  write('00 - Capture/nts-liked-tracks-source-map.md', '| # | Artist | Track | Best source | Confidence | URL | Notes |\n|---|---|---|---|---|---|---|\n| 1 | A | One | Bandcamp | high | https://artist-a.bandcamp.com/track/one | row |\n')
  source('https://artist-a.bandcamp.com/track/one', { image_url: 'https://f4.bcbits.com/img/a1_10.jpg' })
  write('00 - Capture/frontpage-intake/x/museum.md', '# Museum work\nSource: https://www.artic.edu/artworks/1/work\n')
  source('https://www.artic.edu/artworks/1/work')
  write('00 - Capture/frontpage-intake/x/tool.md', '# Tool\nSource: https://tools.example/agent\n')
  source('https://tools.example/agent', { description: 'AI assistant prompt guide and agent workflow tutorial.' })
  write('00 - Capture/frontpage-intake/x/fuzzy.md', '# Fuzzy\nSource: https://fuzzy.example/work\n')
  source('https://fuzzy.example/work', { pixelStatus: 'ambiguous' })
  const ledger = archive([
    { id: 'prev', date: '2026-11-12', urls: [yt('RECENTVID03')] },
    { id: 'old', date: '2026-08-01', urls: [yt('COOLDOWN002')] },
    ...extraEditions,
  ])
  const options = { inputMode: 'obsidian-allowlist', inputRoot: path.join(root, 'vault'), date: RUN_DATE, bookmarkFirst: true, bookmarkCacheDir: path.join(root, 'cache'), recentSourceKeys: ledger }
  const runDir = path.join(root, 'run')
  const harvest = await mineSignals(options, runDir)
  return { harvest, runDir, research: inspectSourceCandidates(harvest, { maxSources: 6, runDir, sourceTool: 'fetch', date: RUN_DATE, recentSourceKeys: ledger }) }
}

beforeEach(() => {
  state.sources = new Map(); state.attempts = []; state.captures = []
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'frontpage-supporting-orchestration-'))
  vi.stubEnv('DFE_SINGLE_ANCHOR_RESEARCH', '0')
  vi.stubEnv('DFE_DECISION_MODEL', 'rules')
  vi.stubEnv('DFE_BOOKMARK_CACHE_DIR', path.join(root, 'inspection-cache'))
})
afterEach(() => { vi.unstubAllEnvs(); fs.rmSync(root, { recursive: true, force: true }) })

describe('ordinary bookmark-first production orchestration with supporting repeats', () => {
  it('keeps a fresh anchor and admits multi-platform supporting windows, including a cooldown-eligible repeat', async () => {
    const { research: pending, runDir } = await run()
    const research = await pending
    const urls = research.content_sources.map(row => row.url)
    expect(urls).toEqual(expect.arrayContaining(['https://x.com/painter/status/9001', yt('COOLDOWN002'), yt('FRESHVID001'), 'https://artist-a.bandcamp.com/track/one', 'https://www.artic.edu/artworks/1/work']))
    expect(new Set(research.content_sources.map(row => row.source_channel))).toEqual(new Set(['twitter-bookmark', 'youtube-like', 'nts-like', 'manual-curation']))
    // Main artwork stays new.
    expect(research.anchor_research.anchor_source.url).toBe('https://x.com/painter/status/9001')
    expect(research.anchor_archive_repeats).toEqual([])
    // Cooldown, quarantine and ambiguous controls.
    expect(state.captures).not.toContain(yt('RECENTVID03'))
    expect(urls).not.toContain(yt('RECENTVID03'))
    expect(state.attempts).not.toContain('https://tools.example/agent')
    expect(urls).not.toContain('https://tools.example/agent')
    expect(urls).not.toContain('https://fuzzy.example/work')
    expect(state.attempts.length).toBeLessThanOrEqual(24)
    const audit = JSON.parse(fs.readFileSync(path.join(runDir, 'bookmark-acquisition.json'), 'utf8'))
    expect(audit.acquired).toBeLessThanOrEqual(24)
    expect(audit.anchor_lane_acquired).toBe(1)
    expect(audit.ledger_policy).toMatchObject({ cooldown_days: 30, previous_edition_id: 'prev' })
  })

  it('never lets a cooldown-eligible repeat become the anchor when no fresh work admits', async () => {
    const { research } = await run({ tweetStatus: 'ambiguous' })
    await expect(research).rejects.toThrow(/blocked|expected at least/)
    // Supporting acquisition never started without an admitted fresh work.
    expect(state.captures).toEqual(['https://x.com/painter/status/9001'])
  })
})

// Review blocker: an X post with a fresh status ID whose fetched media is
// already archived (>30 days, so supporting-eligible) is admitted by the
// cooldown-ledger selector but can never be the anchor. It must not end the
// anchor lane, open the supporting lane or count toward six before the real
// fresh X work is reached.
describe('anchor lane counts only full-archive anchor-eligible admissions', () => {
  // Outside the 30-day cooldown and not the previous edition: supporting-eligible, never anchor.
  const OLD_MEDIA_EDITION = [{ id: 'older', date: '2026-07-01', urls: ['https://pbs.twimg.com/media/OLDIMG.jpg'] }]
  const addSpentMediaRepostAndTweets = freshIndex => {
    write('Inbox/tweets/b.md', '# Repost\nRepost of old painting.\nhttps://x.com/other/status/7001\n')
    source('https://x.com/other/status/7001', { source_type: 'tweet', image_url: 'https://pbs.twimg.com/media/OLDIMG.jpg' })
    for (let i = 1; i <= 8; i++) {
      write(`Inbox/tweets/t${i}.md`, `# Work ${i}\nA painting.\nhttps://x.com/p${i}/status/80${i}\n`)
      source(`https://x.com/p${i}/status/80${i}`, { source_type: 'tweet', image_url: `https://pbs.twimg.com/media/W${i}.jpg`, pixelStatus: i === freshIndex ? 'verified' : 'ambiguous' })
    }
    for (const id of ['FRESHVID011', 'FRESHVID012', 'FRESHVID013', 'FRESHVID014', 'FRESHVID015', 'FRESHVID016']) {
      write(`00 - Capture/youtube/${id}.md`, youtube(id)); source(yt(id), { source_type: 'youtube', image_url: `https://i.ytimg.com/vi/${id}/hqdefault.jpg` })
    }
  }

  it.each([2, 4, 6, 8])('publishes the fresh X work at queue variant %i as the anchor despite an earlier spent-media admission', async freshIndex => {
    addSpentMediaRepostAndTweets(freshIndex)
    const { research: pending, runDir } = await run({ tweetStatus: 'ambiguous', extraEditions: OLD_MEDIA_EDITION })
    const research = await pending
    const fresh = `https://x.com/p${freshIndex}/status/80${freshIndex}`
    expect(research.anchor_research.anchor_source.url).toBe(fresh)
    expect(research.content_sources.map(row => row.url)).toContain(fresh)
    expect(research.anchor_archive_repeats).toEqual([])
    const audit = JSON.parse(fs.readFileSync(path.join(runDir, 'bookmark-acquisition.json'), 'utf8'))
    // The supporting lane opened only after the fresh work was acquired.
    const firstSupporting = state.captures.findIndex(url => !url.startsWith('https://x.com/'))
    if (firstSupporting >= 0) expect(state.captures.indexOf(fresh)).toBeLessThan(firstSupporting)
    expect(audit.acquired).toBeLessThanOrEqual(24)
    expect(state.attempts.length).toBeLessThanOrEqual(24)
  })

  it('spends zero supporting acquisitions when the only X admission has archived media', async () => {
    addSpentMediaRepostAndTweets(0)
    const { research: pending, runDir } = await run({ tweetStatus: 'ambiguous', extraEditions: OLD_MEDIA_EDITION })
    await expect(pending).rejects.toThrow(/blocked|expected at least/)
    expect(state.captures.every(url => url.startsWith('https://x.com/'))).toBe(true)
    const audit = JSON.parse(fs.readFileSync(path.join(runDir, 'bookmark-acquisition.json'), 'utf8'))
    expect(audit.supporting_lane_acquired).toBe(0)
  })
})
