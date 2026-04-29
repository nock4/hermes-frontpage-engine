import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  extractNtsStreamingSourceUrls,
  mineSignals,
  normalizeNoteUrls,
  selectRecentSignalNotes,
  signalChannelForPath,
} from '../../scripts/lib/signal-mining.mjs'

describe('saved-signal mining', () => {
  it('maps only explicit saved-content paths to source channels', () => {
    expect(signalChannelForPath('Inbox/tweets/2026-04-26-post.md')).toBe('twitter-bookmark')
    expect(signalChannelForPath('Inbox/youtube/2026-04-26-video.md')).toBe('youtube-like')
    expect(signalChannelForPath('Inbox/nts-liked-tracks-source-map.md')).toBe('nts-like')
    expect(signalChannelForPath('Resources/Collections/Chrome Bookmarks.md')).toBe('chrome-bookmark')
    expect(signalChannelForPath('Private/memory.md')).toBe(null)
  })

  it('keeps only direct NTS streaming sources and ranks YouTube first', () => {
    const urls = extractNtsStreamingSourceUrls(`
| # | Artist | Track | Best source | Confidence | URL |
| 1 | Artist | Track | Bandcamp | high | https://artist.bandcamp.com/track/song |
| 2 | Artist | Track | YouTube | high | https://www.youtube.com/watch?v=abc123 |
| 3 | Artist | Track | Search | high | https://www.youtube.com/results?search_query=artist |
| 4 | Artist | Track | SoundCloud | low | https://soundcloud.com/artist/song |
`)

    expect(urls).toEqual([
      'https://www.youtube.com/watch?v=abc123',
      'https://artist.bandcamp.com/track/song',
    ])
  })

  it('normalizes YouTube-like notes without accepting thumbnails or document URLs', () => {
    expect(normalizeNoteUrls([
      'https://i.ytimg.com/vi/abc123/hqdefault.jpg',
      'https://www.youtube.com/watch?v=abc123',
      'https://example.com/llm.txt',
    ], 'youtube-like')).toEqual(['https://www.youtube.com/watch?v=abc123'])
  })

  it('selects recent signals with channel variety before score-only filling', () => {
    const notes = [
      { id: 'tweet-a', source_channel: 'twitter-bookmark', score: 100 },
      { id: 'tweet-b', source_channel: 'twitter-bookmark', score: 99 },
      { id: 'yt-a', source_channel: 'youtube-like', score: 20 },
      { id: 'nts-a', source_channel: 'nts-like', score: 19 },
      { id: 'chrome-a', source_channel: 'chrome-bookmark', score: 18 },
    ]

    expect(selectRecentSignalNotes(notes, 4).map((note) => note.source_channel)).toEqual([
      'youtube-like',
      'nts-like',
      'chrome-bookmark',
      'twitter-bookmark',
    ])
  })

  it('penalizes notes that repeat recent edition language when filling within a channel', () => {
    const notes = [
      { id: 'repeat-a', source_channel: 'youtube-like', score: 100, title: 'threshold corridor gate ambience', excerpt: '', text: '' },
      { id: 'fresh-a', source_channel: 'youtube-like', score: 82, title: 'ceramic food market repair footage', excerpt: '', text: '' },
      { id: 'fresh-b', source_channel: 'youtube-like', score: 70, title: 'outdoor civic weather diary', excerpt: '', text: '' },
    ]

    expect(selectRecentSignalNotes(notes, 2, {
      diversityAvoidTerms: ['threshold', 'corridor', 'gate'],
    }).map((note) => note.id)).toEqual([
      'fresh-a',
      'fresh-b',
    ])
  })

  it('mines manifest signals for public mode', async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dfe-manifest-run-'))
    const runDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dfe-run-'))
    const manifestPath = path.join(rootDir, 'signals.json')
    await fs.writeFile(manifestPath, JSON.stringify([
      {
        title: 'Manifest source',
        url: 'https://example.com/story',
        source_channel: 'manual-curation',
        captured_at: '2026-04-25',
      },
      {
        title: 'Older source',
        url: 'https://example.com/too-old',
        source_channel: 'manual-curation',
        captured_at: '2026-01-01',
      },
    ]))

    const harvest = await mineSignals({
      inputMode: 'manifest',
      signalManifest: manifestPath,
      date: '2026-04-27',
      windowDays: 30,
      maxNotes: 10,
    }, runDir)

    expect(harvest.input_mode).toBe('manifest')
    expect(harvest.notes_scanned).toBe(1)
    expect(harvest.notes_selected[0]).toMatchObject({
      title: 'Manifest source',
      source_channel: 'manual-curation',
    })
    expect(harvest.source_candidates.map((source) => source.url)).toEqual(['https://example.com/story'])
  })

  it('mines only recent allowlisted saved-signal notes in legacy obsidian mode', async () => {
    const vault = await fs.mkdtemp(path.join(os.tmpdir(), 'dfe-signal-vault-'))
    const runDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dfe-signal-run-'))
    await fs.mkdir(path.join(vault, 'Inbox', 'tweets'), { recursive: true })
    await fs.mkdir(path.join(vault, 'Resources'), { recursive: true })
    await fs.mkdir(path.join(vault, 'Private'), { recursive: true })

    await fs.writeFile(path.join(vault, 'Inbox', 'tweets', '2026-04-25-post.md'), [
      '# Saved Tweet',
      'https://x.com/person/status/123',
    ].join('\n'))
    await fs.writeFile(path.join(vault, 'Inbox', 'nts-liked-tracks-source-map.md'), [
      '| # | Artist | Track | Best source | Confidence | URL |',
      '| 1 | Artist | Track | YouTube | high | https://www.youtube.com/watch?v=abc123 |',
      '| 2 | Artist | Track | Search | high | https://www.youtube.com/results?search_query=artist |',
    ].join('\n'))
    await fs.writeFile(path.join(vault, 'Resources', 'Chrome Bookmarks.md'), 'https://example.com/old-bookmark')
    await fs.writeFile(path.join(vault, 'Private', 'memory.md'), 'https://example.com/private')

    const recent = new Date('2026-04-26T12:00:00Z')
    const old = new Date('2026-03-20T12:00:00Z')
    await fs.utimes(path.join(vault, 'Inbox', 'nts-liked-tracks-source-map.md'), recent, recent)
    await fs.utimes(path.join(vault, 'Resources', 'Chrome Bookmarks.md'), old, old)

    const harvest = await mineSignals({
      inputMode: 'obsidian-allowlist',
      inputRoot: vault,
      date: '2026-04-27',
      windowDays: 30,
      maxNotes: 10,
    }, runDir)

    expect(harvest.input_mode).toBe('obsidian-allowlist')
    expect(harvest.markdown_files_seen).toBe(3)
    expect(harvest.notes_scanned).toBe(2)
    expect(harvest.notes_selected.map((note) => note.path).sort()).toEqual([
      'Inbox/nts-liked-tracks-source-map.md',
      'Inbox/tweets/2026-04-25-post.md',
    ])
    expect(harvest.source_candidates.map((source) => source.url).sort()).toEqual([
      'https://www.youtube.com/watch?v=abc123',
      'https://x.com/person/status/123',
    ])
    await expect(fs.readFile(path.join(runDir, 'signal-harvest.json'), 'utf8')).resolves.toContain('"selection_policy"')
  })
})
