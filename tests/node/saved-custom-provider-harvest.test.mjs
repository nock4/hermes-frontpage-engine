import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { expect, it } from 'vitest'
import { mineSignals, extractNtsStreamingSourceUrls } from '../../scripts/lib/signal-mining.mjs'

// Verbatim saved rows from 00 - Capture/nts-liked-tracks-source-map.md.
const rows = `| 108 | Tengui | Shadows | Bandcamp | high | [link](https://store.broken20.com/track/shadows) | Official Bandcamp track page from Transference. |
| 111 | Vond | Black Hole Space Window | Bandcamp | high | [link](https://downloadmusic.mortiis.com/track/black-hole-space-window) | Official Bandcamp track page from The Dark River. |
| 155 | TIM KOCH | Estranger | Bandcamp | high | [link](https://shop.cpurecords.net/track/estranger) | Exact Bandcamp/CPU Records stream for the track from Tourbillon; artist Bandcamp mirror also exists. |`
const urls = ['https://store.broken20.com/track/shadows', 'https://downloadmusic.mortiis.com/track/black-hole-space-window', 'https://shop.cpurecords.net/track/estranger']

it('harvests saved custom-domain Bandcamp work rows with exact row and note provenance', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'custom-provider-harvest-'))
  try {
    const notePath = '00 - Capture/nts-liked-tracks-source-map.md'
    await fs.mkdir(path.join(root, '00 - Capture'))
    await fs.writeFile(path.join(root, notePath), '# Saved music\n\n' + rows)
    await fs.utimes(path.join(root, notePath), new Date('2026-10-10'), new Date('2026-10-10'))
    const harvest = await mineSignals({ inputRoot: root, date: '2026-10-11', windowDays: 1000, maxNotes: 4 }, path.join(root, 'out'))
    expect(harvest.source_candidates.map(c => c.url)).toEqual(urls)
    expect(harvest.notes_selected).toHaveLength(1)
    for (const [i, candidate] of harvest.source_candidates.entries()) {
      expect(candidate.note_path).toBe(notePath)
      expect(candidate.note_id).toBe(harvest.notes_selected[0].id)
      expect(candidate.source_map_rows).toEqual([expect.objectContaining({ url: urls[i], note_path: notePath, note_title: 'Saved music', evidence_origin: 'saved-note-row', best_source: 'Bandcamp', confidence: 'high' })])
      expect(candidate.creative_artifact_inspection).toBeUndefined()
    }
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})

it('uses explicit saved provider attribution for unrelated custom hosts, not arbitrary paths or low/search rows', () => {
  const candidates = [
    ['Bandcamp', 'high', 'https://music.example.org/track/a'],
    ['Bandcamp (official artist page)', 'medium', 'https://label.example.net/album/b'],
    ['Bandcamp', 'low', 'https://music.example.org/track/low'],
    ['Bandcamp search', 'high', 'https://music.example.org/track/search'],
    ['Bandcamp unverified', 'high', 'https://music.example.org/track/unverified'],
    ['Website', 'high', 'https://music.example.org/track/other'],
    ['Bandcamp', 'high', 'https://music.example.org/'],
    ['Bandcamp', 'high', 'https://music.example.org/track/'],
    ['Bandcamp', 'high', 'https://127.0.0.1/track/private'],
    ['Bandcamp', 'high', 'https://music.example.org/track/data.json'],
  ]
  const text = candidates.map(([provider, confidence, url], i) => `| ${i + 1} | Artist | Work | ${provider} | ${confidence} | ${url} |`).join('\n')
  expect(extractNtsStreamingSourceUrls(text)).toEqual(['https://music.example.org/track/a', 'https://label.example.net/album/b'])
})
