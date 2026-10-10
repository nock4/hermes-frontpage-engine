import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import dns from 'node:dns/promises'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

// Only the model and network are fixtures; run the real harvest, source
// inspection, autoresearch request serialization, and eligibility gates.
vi.mock('../../scripts/lib/openai-json.mjs', () => ({
  openAiJson: async ({ instructions, input }) => {
    if (!instructions.includes('source-research editor')) throw new Error('No verified media in this fixture')
    const request = JSON.parse(input)
    return { selected_content_urls: [], visual_reference_urls: [], source_decisions: request.candidate_sources.map(source => ({ url: source.url, role: 'reject', why: 'Fixture explicitly rejects unverified media' })) }
  },
}))
import { mineSignals } from '../../scripts/lib/signal-mining.mjs'
import { inspectSourceCandidates } from '../../scripts/lib/source-research.mjs'
import { inspectWithFetch } from '../../scripts/lib/source-inspection.mjs'

const youtube = 'https://www.youtube.com/watch?v=1i-CByghAMA&t=12'
const bandcamp = 'https://metronrecords.bandcamp.com/album/komachi'
const notePath = '00 - Capture/nts-liked-tracks-source-map.md'
// Seven-column format copied from the actual allowlisted NTS map. Repeated
// album URL and rejected rows are synthetic additions testing row isolation.
const markdown = `# NTS liked tracks source map
${'Saved listening context. '.repeat(90)}
| # | Artist | Track | Best source | Confidence | URL | Notes |
|---|---|---|---|---|---|---|
| 7 | VAIKO EPLIK | Kuningal On Külm | YouTube | medium | [link](${youtube}) | Best confirmed original version was an official topic upload. |
| 16 | MEITEI, 冥丁 | Nami | Bandcamp | high | [link](${bandcamp}) | Official/label Bandcamp album page containing the track. |
| 17 | MEITEI, 冥丁 | Another track | Bandcamp | medium-high | [link](${bandcamp}) | Shared release, not a dedicated track page. |
| 18 | Rejected artist | Low match | YouTube | low | https://www.youtube.com/watch?v=lowmatch |
| 19 | Rejected artist | Search | YouTube-search | medium | https://www.youtube.com/results?search_query=music |
| 20 | Rejected artist | Unverified | unverified | high | https://soundcloud.com/artist/song |
| 21 | Rejected artist | Private | Bandcamp | high | http://127.0.0.1/track/private |
| 22 | Rejected artist | Document | Web | high | https://example.com/music.txt |
`
let root
let harvest
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'nts-provenance-'))
  await fs.mkdir(path.join(root, '00 - Capture'))
  await fs.writeFile(path.join(root, notePath), markdown)
  await fs.utimes(path.join(root, notePath), new Date('2026-04-15T12:00:00Z'), new Date('2026-04-15T12:00:00Z'))
  harvest = await mineSignals({ inputMode: 'obsidian-allowlist', inputRoot: root, date: '2026-04-16', windowDays: 7, maxNotes: 8 }, root)
  vi.stubEnv('DFE_TEST_USE_GLOBAL_FETCH', '1')
  vi.stubEnv('DFE_SINGLE_ANCHOR_RESEARCH', '0')
  vi.spyOn(dns, 'lookup').mockResolvedValue([{ address: '93.184.216.34', family: 4 }])
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline fixture') }))
})
afterEach(async () => {
  vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs()
  await fs.rm(root, { recursive: true, force: true })
})

it('retains exact NTS row identities, attribution and confidence without adding rejected URLs', () => {
  expect(harvest.source_candidates.map(source => source.url)).toEqual([youtube, bandcamp])
  const [video, album] = harvest.source_candidates
  expect(video.note_title).toBe('VAIKO EPLIK — Kuningal On Külm')
  expect(video.source_map_rows).toEqual([{
    evidence_origin: 'saved-note-row', note_path: notePath, note_title: 'NTS liked tracks source map',
    row_number: '7', url: youtube, artist: 'VAIKO EPLIK', track: 'Kuningal On Külm',
    best_source: 'YouTube', confidence: 'medium', notes: 'Best confirmed original version was an official topic upload.',
  }])
  expect(album.source_map_rows.map(row => row.track)).toEqual(['Nami', 'Another track'])
  expect(album.source_map_rows.every(row => row.url === bandcamp && row.note_path === notePath)).toBe(true)
  expect(harvest.notes_selected[0].title).toBe('NTS liked tracks source map')
  expect(video).not.toHaveProperty('inspection')
})

it('keeps row identity through thumbnail fallback without claiming fetched or verified music', async () => {
  const candidate = harvest.source_candidates[0]
  const source = await inspectWithFetch(candidate, candidate.url, { source_type: 'youtube' })
  expect(source.title).toBe('VAIKO EPLIK — Kuningal On Külm')
  expect(source.source_map_rows).toEqual(candidate.source_map_rows)
  expect(source.fetch_status).toBe('fetch-error-youtube-thumbnail-fallback: offline fixture')
  expect(source.image_url).toBe('https://img.youtube.com/vi/1i-CByghAMA/hqdefault.jpg')
  expect(source).not.toHaveProperty('inspection')
})

it('keeps fetched page metadata distinct from saved row claims', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('<title>Provider release title</title><meta name="description" content="Provider description">', { headers: { 'content-type': 'text/html' } })))
  const candidate = harvest.source_candidates[1]
  const source = await inspectWithFetch(candidate, candidate.url, { source_type: 'audio' })
  expect(source.title).toBe('Provider release title')
  expect(source.description).toBe('Provider description')
  expect(source.source_map_rows).toEqual(candidate.source_map_rows)
  expect(source.source_map_rows.map(row => row.confidence)).toEqual(['high', 'medium-high'])
  expect(source.fetch_status).toBe('fetch-ok')
  expect(source).not.toHaveProperty('inspection')
})

it('serializes row provenance into the actual autoresearch request and still blocks rejected media', async () => {
  await expect(inspectSourceCandidates(harvest, { maxSources: 6, runDir: root, sourceTool: 'fetch', date: '2026-04-16' })).rejects.toThrow(/blocked|expected at least 6/)
  const request = JSON.parse(await fs.readFile(path.join(root, 'source-autoresearch-request.json'), 'utf8'))
  const source = request.candidate_sources.find(source => source.url === youtube)
  expect(source.source_map_rows).toEqual(harvest.source_candidates[0].source_map_rows)
  expect(source.source_map_rows?.[0]?.track).toBe('Kuningal On Külm')
  expect(source.note_excerpt).not.toContain('Kuningal')
  // Row evidence belongs to each candidate, not a second full map dumped into
  // the short signal summary (which could also mention uninspected URLs).
  expect(request.signal_summary.notes_selected[0]).not.toHaveProperty('source_map_rows')
  expect(request.hard_rules.join(' ')).toContain('Saved-note row attribution is not independent verification')
  const evidence = JSON.parse(await fs.readFile(path.join(root, 'source-candidate-evidence.json'), 'utf8'))
  expect(evidence.evidence.find(source => source.url === youtube).source_map_rows).toEqual(source.source_map_rows)
  const research = JSON.parse(await fs.readFile(path.join(root, 'source-research.json'), 'utf8'))
  expect(research.content_source_count).toBe(0)
  expect(research.content_sources).toEqual([])
})
