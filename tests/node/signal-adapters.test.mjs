import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { loadManifestSignals } from '../../scripts/lib/signal-adapters/manifest-adapter.mjs'
import { loadMarkdownFolderSignals } from '../../scripts/lib/signal-adapters/markdown-folder-adapter.mjs'
import { loadObsidianAllowlistSignals } from '../../scripts/lib/signal-adapters/obsidian-allowlist-adapter.mjs'

const daysBetween = (leftDate, rightDate) => {
  const left = new Date(`${leftDate}T00:00:00Z`).getTime()
  const right = new Date(`${rightDate}T00:00:00Z`).getTime()
  return Math.round((left - right) / 86_400_000)
}

describe('signal adapters', () => {
  it('loads manifest mode entries into normalized notes', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dfe-manifest-'))
    const manifestPath = path.join(tempDir, 'signals.json')
    await fs.writeFile(manifestPath, JSON.stringify([
      {
        title: 'Manifest entry',
        url: 'https://example.com/story',
        source_channel: 'manual-curation',
        captured_at: '2026-04-28',
      },
    ]))

    const loaded = await loadManifestSignals({
      signalManifest: manifestPath,
      date: '2026-04-29',
      windowDays: 30,
      daysBetween,
    })

    expect(loaded.adapter).toBe('manifest')
    expect(loaded.notes).toHaveLength(1)
    expect(loaded.notes[0]).toMatchObject({
      source_channel: 'manual-curation',
      title: 'Manifest entry',
      note_date: '2026-04-28',
      source_path: path.relative(process.cwd(), manifestPath) || manifestPath,
    })
  })

  it('loads markdown-folder notes into normalized notes', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dfe-md-notes-'))
    await fs.writeFile(path.join(tempDir, '2026-04-28-note.md'), [
      '---',
      'title: Folder note',
      'source_channel: research-note',
      'note_date: 2026-04-28',
      '---',
      '',
      'https://example.com/article',
    ].join('\n'))

    const loaded = await loadMarkdownFolderSignals({
      inputRoot: tempDir,
      date: '2026-04-29',
      windowDays: 30,
      daysBetween,
    })

    expect(loaded.adapter).toBe('markdown-folder')
    expect(loaded.notes).toHaveLength(1)
    expect(loaded.notes[0]).toMatchObject({
      source_channel: 'research-note',
      title: 'Folder note',
      note_date: '2026-04-28',
      source_path: '2026-04-28-note.md',
    })
  })

  it('preserves legacy obsidian allowlist mode', async () => {
    const vault = await fs.mkdtemp(path.join(os.tmpdir(), 'dfe-vault-'))
    await fs.mkdir(path.join(vault, 'Inbox', 'tweets'), { recursive: true })
    await fs.writeFile(path.join(vault, 'Inbox', 'tweets', '2026-04-28-post.md'), '# Saved\nhttps://x.com/person/status/123')

    const loaded = await loadObsidianAllowlistSignals({
      inputRoot: vault,
      date: '2026-04-29',
      windowDays: 30,
      daysBetween,
    })

    expect(loaded.adapter).toBe('obsidian-allowlist')
    expect(loaded.notes).toHaveLength(1)
    expect(loaded.notes[0]).toMatchObject({
      source_channel: 'twitter-bookmark',
      source_path: 'Inbox/tweets/2026-04-28-post.md',
    })
  })
})
