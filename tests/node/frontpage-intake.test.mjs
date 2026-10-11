import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
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

// These are synthetic saved-note fixtures, not new bookmarks or eligibility proof.
describe('authorized frontpage intake lane', () => {
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
