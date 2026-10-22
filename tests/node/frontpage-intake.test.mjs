import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ sources: new Map(), requests: [], attempts: [], batches: [] }))
// Run real mining, orchestration, serialization and media/editorial/archive gates.
// Only network and model responses are synthetic; never inject eligibility stamps.
vi.mock('../../scripts/lib/source-inspection.mjs', () => ({
  inspectCandidateSource: async source => ({ ...source, ...state.sources.get(source.url) }),
  findVisualReference: async () => null,
}))
vi.mock('../../scripts/lib/source-image-network-policy.mjs', async original => ({
  ...await original(),
  resolveFetchableImageUrl: async url => url,
  fetchVettedRemoteUrl: async () => new Response(Buffer.from('synthetic test pixels'), { headers: { 'content-type': 'image/png' } }),
}))
vi.mock('../../scripts/lib/source-image-geometry.mjs', async original => ({
  ...await original(), measureSourceImage: async () => ({ width: 800, height: 600 }),
}))
vi.mock('../../scripts/lib/creative-artifact-inspection.mjs', async original => {
  const actual = await original()
  return { ...actual, inspectCreativeArtifacts: async (...args) => {
    const before = state.attempts.length
    const result = await actual.inspectCreativeArtifacts(...args)
    state.batches.push(state.attempts.length - before)
    return result
  } }
})
vi.mock('../../scripts/lib/openai-json.mjs', () => ({
  openAiJson: async ({ instructions, input }) => {
    if (instructions.includes('source-research editor')) {
      const request = JSON.parse(input)
      state.requests.push({ request, attempts: state.attempts.length })
      // Honor the serialized channel contract, rather than always returning
      // content and concealing a contradictory prompt. Substantive exclusions
      // still win even when the channel is authorized.
      const channelRule = request.hard_rules.find(rule => rule.startsWith('Public content must come only')) || ''
      const manualAllowed = channelRule.includes('explicitly authorized saved manual-curation nominations')
      const source_decisions = request.candidate_sources.map(source => ({
        url: source.url, confidence: 'high',
        role: source.source_channel === 'manual-curation' && !manualAllowed ? 'reject'
          : /identity mismatch/i.test(source.description) ? 'reject' : 'content',
        why: source.source_channel === 'manual-curation' && !manualAllowed ? 'Outside allowed saved-signal channels'
          : /identity mismatch/i.test(source.description) ? 'Owning work identity mismatch' : 'Nominate creative work for actual-media inspection',
      }))
      return { source_decisions, selected_content_urls: source_decisions.filter(row => row.role === 'content').map(row => row.url), visual_reference_urls: [] }
    }
    if (instructions.startsWith('Inspect the attached actual source pixels')) {
      const source = JSON.parse(input[0].content[0].text)
      state.attempts.push(source.url)
      return { status: state.sources.get(source.url)?.pixelStatus || 'verified', artifact_kind: 'artwork', confidence: 'high', observation: 'Synthetic model fixture: painted textile figures' }
    }
    return { visual_summary: 'Painted textile figures', preserve_cues: ['red figures', 'woven texture'], visual_fertility: 'high' }
  },
}))
import { inspectSourceCandidates } from '../../scripts/lib/source-research.mjs'
import { loadObsidianAllowlistSignals, signalChannelForPath } from '../../scripts/lib/signal-adapters/obsidian-allowlist-adapter.mjs'
import { mineSignals } from '../../scripts/lib/signal-mining.mjs'
import { canonicalizeSourceUrl } from '../../scripts/lib/source-url-policy.mjs'
import { hasCreativeArtifactEvidence, isAiToolingContentSource, selectContentSources } from '../../scripts/lib/source-selection-policy.mjs'

const lane = '00 - Capture/frontpage-intake'
const date = '2026-10-11'
const daysBetween = (a, b) => Math.round((Date.parse(a) - Date.parse(b)) / 86_400_000)
async function writeNote(root, relativePath, text) {
  const file = path.join(root, relativePath)
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, text)
  await fs.utimes(file, new Date(`${date}T12:00:00Z`), new Date(`${date}T12:00:00Z`))
}

beforeEach(() => {
  state.sources = new Map(); state.requests = []; state.attempts = []; state.batches = []
  vi.stubEnv('DFE_SINGLE_ANCHOR_RESEARCH', '0')
  vi.stubEnv('DFE_DECISION_MODEL', 'rules')
})
afterEach(() => vi.unstubAllEnvs())

async function researchSavedNominations(fixtures, check) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dfe-intake-research-'))
  try {
    const vault = path.join(root, 'vault')
    for (const [index, fixture] of fixtures.entries()) {
      await writeNote(vault, `${lane}/${date}/work-${index}.md`, `# Textile artwork ${index}\nSaved nomination; inspect actual media before admission.\n${fixture.url}`)
      state.sources.set(fixture.url, {
        title: `Textile artwork ${index}`, description: 'Painted woven figures in a gallery work.',
        image_url: `https://media${index}.example/work.png`, fetch_status: 'fetch-ok', ...fixture,
      })
    }
    const recentSourceKeys = new Set(fixtures.filter(source => source.repeated).map(source => canonicalizeSourceUrl(source.url)))
    const options = { inputMode: 'obsidian-allowlist', inputRoot: vault, date, windowDays: 30, maxNotes: fixtures.length, recentSourceKeys }
    const harvest = await mineSignals(options, root)
    expect(harvest.notes_selected).toHaveLength(fixtures.length)
    expect(harvest.source_candidates).toHaveLength(fixtures.length)
    expect(harvest.source_candidates.every(source => source.source_channel === 'manual-curation' && !source.inspection)).toBe(true)
    await expect(inspectSourceCandidates(harvest, { ...options, maxSources: 6, runDir: root, sourceTool: 'fetch' })).rejects.toThrow(/blocked|expected at least 6/)
    const request = JSON.parse(await fs.readFile(path.join(root, 'source-autoresearch-request.json'), 'utf8'))
    const research = JSON.parse(await fs.readFile(path.join(root, 'source-research.json'), 'utf8'))
    expect(state.requests).toHaveLength(1)
    expect(state.requests[0]).toEqual({ request, attempts: 0 })
    expect(request.candidate_sources.every(source => source.source_channel === 'manual-curation')).toBe(true)
    expect(request.candidate_sources.every(source => source.note_excerpt.includes('Saved nomination; inspect actual media before admission.'))).toBe(true)
    expect(request.hard_rules.join(' ')).toContain('These are text nominations, not verified visual eligibility')
    expect(research.source_floor_diagnostics.min_required_content_sources).toBe(1)
    expect(state.attempts.length).toBeLessThanOrEqual(24)
    expect(state.batches.every(count => count <= 10)).toBe(true)
    await check({ request, research, harvest })
  } finally { await fs.rm(root, { recursive: true, force: true }) }
}

// These are synthetic saved-note fixtures, not new bookmarks or eligibility proof.
describe('authorized frontpage intake lane', () => {
  it('nominates saved manual-curation through the serialized channel contract without overriding substantive gates', async () => {
    const fresh = [
      'https://artist-a.example/projects/textile', 'https://artist-b.example/photography/room',
      'https://vimeo.com/123456789', 'https://vimeo.com/987654321',
    ]
    const rejected = 'https://reject.example/work'
    const tooling = 'https://tooling.example/work'
    const ambiguous = 'https://ambiguous.example/work'
    const repeated = 'https://spent.example/work'
    await researchSavedNominations([
      ...fresh.map(url => ({ url })),
      { url: rejected, description: 'Owning work identity mismatch: saved attribution does not match this work.' },
      { url: tooling, description: 'AI assistant prompt guide and agent workflow tutorial.' },
      { url: ambiguous, pixelStatus: 'ambiguous' },
      { url: repeated, repeated: true },
    ], ({ research }) => {
      expect(research.content_sources.map(source => source.url).sort()).toEqual([...fresh].sort())
      expect(research.content_sources.every(source => source.source_channel === 'manual-curation')).toBe(true)
      expect(state.attempts).toEqual(expect.arrayContaining([...fresh, ambiguous]))
      expect(state.attempts).not.toEqual(expect.arrayContaining([rejected]))
      expect(state.attempts).not.toEqual(expect.arrayContaining([tooling]))
      expect(state.attempts).not.toEqual(expect.arrayContaining([repeated]))
      expect(research.autoresearch.source_decisions).toContainEqual(expect.objectContaining({ url: rejected, role: 'reject', why: 'Owning work identity mismatch' }))
      // A nomination is not an inspection; even fertile fingerprints cannot turn
      // ambiguous actual-media results into a fifth source or clear the floor.
      expect(research.content_source_count).toBe(4)
    })
  })

  it('keeps authorized but ambiguous nominations at zero admission and the unchanged 24-total/10-batch caps', async () => {
    await researchSavedNominations(Array.from({ length: 30 }, (_, index) => ({
      url: `https://owner${index}.example/work`, pixelStatus: 'ambiguous',
    })), ({ research }) => {
      expect(state.attempts).toHaveLength(24)
      expect(new Set(state.attempts).size).toBe(24)
      expect(state.batches).toContain(10)
      expect(research.content_sources).toEqual([])
      expect(research.content_source_count).toBe(0)
    })
  })
  it('recursively harvests all 12 saved nominations with their exact context, dates and URLs', async () => {
    const vault = await fs.mkdtemp(path.join(os.tmpdir(), 'dfe-intake-'))
    try {
      for (let i = 0; i < 12; i++) {
        await writeNote(vault, `${lane}/${date}/nested/work-${i}.md`, `# Work ${i}\nSaved nomination: inspect the textile before admission.\nhttps://example.com/work-${i}`)
      }
      const loaded = await loadObsidianAllowlistSignals({ inputRoot: vault, date, windowDays: 30, daysBetween })
      expect(loaded.markdown_files_seen).toBe(12)
      expect(loaded.notes).toHaveLength(12)
      for (let i = 0; i < 12; i++) {
        expect(loaded.notes.find(note => note.title === `Work ${i}`)).toMatchObject({
          source_channel: 'manual-curation',
          source_path: `${lane}/${date}/nested/work-${i}.md`,
          note_date: date,
          urls: [`https://example.com/work-${i}`],
          excerpt: expect.stringContaining('Saved nomination: inspect the textile before admission.'),
        })
      }
      expect(loaded.selection_filters.join(' ')).toContain(lane)
    } finally { await fs.rm(vault, { recursive: true, force: true }) }
  })

  it('does not broaden sibling paths, infer bookmarks, or bypass date and URL security filters', async () => {
    const vault = await fs.mkdtemp(path.join(os.tmpdir(), 'dfe-intake-bounds-'))
    try {
      for (const relativePath of [
        '00 - Capture/unrelated/2026-10-11.md',
        '00 - Capture/frontpage-intake-other/2026-10-11.md',
        '00 - Capture/frontpage-intake.md',
        'Inbox/frontpage-intake/2026-10-11.md',
      ]) {
        expect(signalChannelForPath(relativePath)).toBe(null)
        await writeNote(vault, relativePath, '# Not authorized\nhttps://example.com/outside')
      }
      await writeNote(vault, `${lane}/2026-01-01/stale.md`, 'https://example.com/stale')
      await writeNote(vault, `${lane}/2026-10-12/future.md`, 'https://example.com/future')
      await writeNote(vault, `${lane}/${date}/.hidden.md`, 'https://example.com/hidden')
      await writeNote(vault, `${lane}/${date}/not-markdown.txt`, 'https://example.com/text')
      await writeNote(vault, `${lane}/${date}/no-url.md`, '# Nomination without a source URL')
      await writeNote(vault, `${lane}/${date}/unsafe.md`, 'http://127.0.0.1/private\nhttp://192.168.1.1/private\nhttps://example.com/data.json')
      await writeNote(vault, `${lane}/${date}/mixed.md`, '# Saved context\nhttps://x.com/artist/status/123\nhttps://www.youtube.com/watch?v=abc123\nhttp://localhost/private\nhttps://example.com/llm.txt')
      const loaded = await loadObsidianAllowlistSignals({ inputRoot: vault, date, windowDays: 30, daysBetween })
      expect(loaded.notes).toHaveLength(1)
      expect(loaded.notes[0]).toMatchObject({
        source_channel: 'manual-curation',
        urls: ['https://x.com/artist/status/123', 'https://www.youtube.com/watch?v=abc123'],
      })
    } finally { await fs.rm(vault, { recursive: true, force: true }) }
  })

  it('keeps nominations subject to harvest caps, archive pressure and affirmative editorial evidence', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dfe-intake-gates-'))
    const vault = path.join(root, 'vault')
    const freshUrl = 'https://example.com/fresh'
    const oldUrl = 'https://example.com/published'
    try {
      await writeNote(vault, `${lane}/${date}/fresh.md`, `# Fresh nomination\nAI assistant prompt guide.\n${freshUrl}`)
      await writeNote(vault, `${lane}/${date}/old.md`, `# Published nomination\n${oldUrl}`)
      const options = { inputMode: 'obsidian-allowlist', inputRoot: vault, date, windowDays: 30, maxNotes: 1, recentSourceKeys: new Set([canonicalizeSourceUrl(oldUrl)]) }
      const harvest = await mineSignals(options, path.join(root, 'run'))
      expect(harvest.notes_scanned).toBe(2)
      expect(harvest.notes_selected).toHaveLength(1)
      expect(harvest.source_candidates).toHaveLength(1)
      expect(harvest.source_candidates[0]).toMatchObject({ url: freshUrl, note_date: date, source_channel: 'manual-curation', source_repeated_in_archive: false })
      expect(harvest.notes_selected[0].excerpt).toContain('AI assistant prompt guide.')
      const candidate = { ...harvest.source_candidates[0], image_url: 'https://example.com/art.jpg' }
      expect(isAiToolingContentSource(candidate, harvest)).toBe(true)
      expect(hasCreativeArtifactEvidence(candidate, { source_decisions: [] }, harvest)).toBe(false)
      expect(selectContentSources([candidate], { signalHarvest: harvest, autoresearch: { source_decisions: [] } })).toEqual([])
      const withRepeated = await mineSignals({ ...options, maxNotes: 2 }, path.join(root, 'run-all'))
      expect(withRepeated.source_candidates.find(source => source.url === oldUrl)).toMatchObject({ source_repeated_in_archive: true, note_historical_source_penalty: 240 })
    } finally { await fs.rm(root, { recursive: true, force: true }) }
  })
})
