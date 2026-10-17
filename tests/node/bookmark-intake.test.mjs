import { describe, it, expect } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { loadBookmarkBatch, runVaultWorker } from '../../scripts/lib/bookmark-intake.mjs'
import { acquireBookmarkArtwork } from '../../scripts/lib/bookmark-artwork.mjs'
import { mineSignals } from '../../scripts/lib/signal-mining.mjs'
import { cachedArtifactObservation } from '../../scripts/lib/bookmark-inspection-cache.mjs'

async function fixture(count = 40) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bookmark-test-'))
  const vault = path.join(root, 'vault')
  await fs.mkdir(path.join(vault, 'Inbox/tweets'), { recursive: true })
  for (let i = 0; i < count; i++) await fs.writeFile(path.join(vault, 'Inbox/tweets', `${String(i).padStart(3, '0')}.md`), `# Artwork ${i}\nhttps://x.com/artist/status/${10000 + i}\n![art](https://pbs.twimg.com/media/${i}.jpg)\n`)
  return { root, vault, cacheDir: path.join(root, 'cache') }
}

describe('bounded bookmark intake', () => {
  it('wires ordinary mining to bounded acquisition and reports actual counts and policy', async () => {
    const f = await fixture()
    try {
      const h = await mineSignals({ inputMode: 'obsidian-allowlist', inputRoot: f.vault, date: '2026-10-17', windowDays: 1000, maxNotes: 1209, bookmarkFirst: true, bookmarkCacheDir: f.cacheDir }, path.join(f.root, 'run'))
      expect(h.notes_scanned).toBe(40)
      expect(h.notes_selected).toHaveLength(24)
      expect(h.source_candidates).toHaveLength(24)
      expect(h.selection_policy.selected_count).toBe(24)
      expect(h.selection_policy.scoring.join(' ')).toMatch(/cursor/i)
      expect(h.source_candidates.every(c => c.note_path && /x.com/.test(c.url))).toBe(true)
    } finally { await fs.rm(f.root, { recursive: true, force: true }) }
  })
  it('keeps exact source overrides on the legacy intake path without dropping saved provenance', async () => {
    const f = await fixture()
    const override = { source_url: 'https://x.com/artist/status/10000', title: 'Exact saved work' }
    try {
      const h = await mineSignals({ inputMode: 'obsidian-allowlist', inputRoot: f.vault, date: new Date().toISOString().slice(0, 10), windowDays: 1000, maxNotes: 40, bookmarkFirst: true, bookmarkCacheDir: f.cacheDir, inspirationOverride: override }, path.join(f.root, 'run'))
      expect(h.selection_policy.bookmark_first).toBe(false)
      expect(h.notes_selected).toHaveLength(40)
      expect(h.manual_inspiration_override.source_url).toBe(override.source_url)
      expect(h.source_candidates.find(c => c.url === override.source_url)).toMatchObject({ source_channel: 'twitter-bookmark', note_path: 'Inbox/tweets/000.md' })
      await expect(fs.access(f.cacheDir)).rejects.toThrow()
    } finally { await fs.rm(f.root, { recursive: true, force: true }) }
  })
  it('reads only a small deterministic batch, persists metadata and rotates without rereading the whole vault', async () => {
    const f = await fixture()
    try {
      const a = await loadBookmarkBatch({ inputRoot: f.vault, cacheDir: f.cacheDir, maxReads: 8, maxNotes: 6 })
      expect(a.audit.notes_read).toBe(8)
      expect(a.notes).toHaveLength(6)
      expect(a.markdown_files_seen).toBe(40)
      const b = await loadBookmarkBatch({ inputRoot: f.vault, cacheDir: f.cacheDir, maxReads: 8, maxNotes: 6 })
      expect(b.audit.notes_read).toBe(8)
      expect(b.audit.cached_notes).toBe(16)
      expect(b.notes.map(n => n.id)).not.toEqual(a.notes.map(n => n.id))
    } finally { await fs.rm(f.root, { recursive: true, force: true }) }
  })
  it('invalidates changed notes and excludes spent parent material even if its attachment is fresh', async () => {
    const f = await fixture(1)
    try {
      await loadBookmarkBatch({ inputRoot: f.vault, cacheDir: f.cacheDir })
      await fs.writeFile(path.join(f.vault, 'Inbox/tweets/000.md'), '# Changed\nhttps://x.com/artist/status/10000\nhttps://pbs.twimg.com/media/new.jpg\n')
      const a = await loadBookmarkBatch({ inputRoot: f.vault, cacheDir: f.cacheDir, recentSourceKeys: new Set(['https://x.com/artist/status/10000']) })
      expect(a.audit.notes_read).toBe(1)
      expect(a.notes).toHaveLength(0)
    } finally { await fs.rm(f.root, { recursive: true, force: true }) }
  })
  it('rejects archive aliases by tweet ID and ignores duplicate owning notes', async () => {
    const f = await fixture(1)
    try {
      await fs.copyFile(path.join(f.vault, 'Inbox/tweets/000.md'), path.join(f.vault, 'Inbox/tweets/duplicate.md'))
      const a = await loadBookmarkBatch({ inputRoot: f.vault, cacheDir: f.cacheDir })
      expect(a.notes).toHaveLength(1)
      const b = await loadBookmarkBatch({ inputRoot: f.vault, cacheDir: f.cacheDir, recentSourceKeys: new Set(['x.com/i/status/10000']) })
      expect(b.notes).toHaveLength(0)
    } finally { await fs.rm(f.root, { recursive: true, force: true }) }
  })
  it('retains literal i/web status provenance and applies the same parent ledger', async () => {
    const f = await fixture(1)
    try {
      await fs.appendFile(path.join(f.vault, 'Inbox/tweets/000.md'), '\n[View on X](https://x.com/i/web/status/10000)\n')
      const a = await loadBookmarkBatch({ inputRoot: f.vault, cacheDir: f.cacheDir })
      expect(a.notes.map(n => n.urls[0])).toEqual(['https://x.com/i/web/status/10000'])
      const b = await loadBookmarkBatch({ inputRoot: f.vault, cacheDir: f.cacheDir, recentSourceKeys: new Set(['x.com/artist/status/10000']) })
      expect(b.notes).toHaveLength(0)
    } finally { await fs.rm(f.root, { recursive: true, force: true }) }
  })
  it('does not starve unchanged records when one note changes every run', async () => {
    const f = await fixture(6)
    try {
      await loadBookmarkBatch({ inputRoot: f.vault, cacheDir: f.cacheDir, maxNotes: 2 })
      const seen = new Set()
      for (let i = 0; i < 3; i++) {
        await fs.appendFile(path.join(f.vault, 'Inbox/tweets/005.md'), `\nEdit ${i}`)
        const batch = await loadBookmarkBatch({ inputRoot: f.vault, cacheDir: f.cacheDir, maxNotes: 2 })
        for (const note of batch.notes) seen.add(note.id)
      }
      expect(seen.size).toBe(6)
    } finally { await fs.rm(f.root, { recursive: true, force: true }) }
  })
  it('advances incremental reading even when every note is touched between runs', async () => {
    const f = await fixture(6)
    try {
      const seen = new Set()
      for (let i = 0; i < 3; i++) {
        for (let n = 0; n < 6; n++) await fs.appendFile(path.join(f.vault, 'Inbox/tweets', `${String(n).padStart(3, '0')}.md`), `\nTouch ${i}`)
        const batch = await loadBookmarkBatch({ inputRoot: f.vault, cacheDir: f.cacheDir, maxReads: 2, maxNotes: 2 })
        expect(batch.audit.notes_read).toBe(2)
        for (const note of batch.notes) seen.add(note.id)
      }
      expect(seen.size).toBe(6)
    } finally { await fs.rm(f.root, { recursive: true, force: true }) }
  })
  it('uses owning View on X provenance rather than truncated title URLs or incidental thematic links', async () => {
    const f = await fixture(0)
    try {
      await fs.writeFile(path.join(f.vault, 'Inbox/tweets/a.md'), '# https://x.com/a/status/123\nsource: https://x.com/b/status/999\nText mentions https://x.com/b/status/999\n[View on X](https://x.com/a/status/12345)')
      await fs.mkdir(path.join(f.vault, '01 - Active/themes'), { recursive: true })
      await fs.writeFile(path.join(f.vault, '01 - Active/themes/essay.md'), '# An essay\nMention https://x.com/a/status/888')
      const a = await loadBookmarkBatch({ inputRoot: f.vault, cacheDir: f.cacheDir })
      expect(a.notes.map(n => n.urls[0])).toEqual(['https://x.com/a/status/12345'])
    } finally { await fs.rm(f.root, { recursive: true, force: true }) }
  })
  it('kills and reaps a blocked vault worker and identifies the operation', async () => {
    await expect(runVaultWorker({ inputRoot: '/blocked' }, { timeoutMs: 1000, workerCode: 'process.stderr.write("readdir /blocked"); setInterval(()=>{},1000)' })).rejects.toThrow(/Vault access timeout.*readdir \/blocked/)
  })
})

describe('exact-media inspection cache', () => {
  it('reuses only identical bytes, literal media identity, context and model; never caches metadata as an inspection', async () => {
    const f = await fixture(0)
    let calls = 0
    const inspect = async () => { calls++; return { status: 'verified', confidence: 'high', artifact_kind: 'artwork', observation: 'Synthetic fixture only' } }
    const options = { cacheDir: f.cacheDir, bytes: Buffer.from('synthetic pixels'), sourceUrl: 'https://x.com/a/status/1', imageUrl: 'https://pbs.twimg.com/media/a.jpg', context: { title: 'A' }, model: 'test' }
    try {
      await cachedArtifactObservation(options, inspect)
      expect((await cachedArtifactObservation(options, inspect)).cache_hit).toBe(true)
      expect(calls).toBe(1)
      let expectedCalls = 1
      for (const change of [{ bytes: Buffer.from('changed') }, { imageUrl: options.imageUrl + '?name=orig' }, { sourceUrl: 'https://x.com/b/status/2' }, { context: { title: 'Changed' } }, { model: 'other' }, { mime: 'image/jpeg' }, { resolvedMediaUrl: 'https://cdn.example/a.jpg' }]) {
        await cachedArtifactObservation({ ...options, ...change }, inspect)
        expectedCalls++
      }
      expect(calls).toBe(expectedCalls)
      const configPath = path.join(f.root, 'config.yaml')
      await fs.writeFile(configPath, 'model: one')
      await cachedArtifactObservation({ ...options, transportConfigPath: configPath }, inspect)
      await fs.writeFile(configPath, 'model: two')
      await cachedArtifactObservation({ ...options, transportConfigPath: configPath }, inspect)
      expect(calls).toBe(expectedCalls + 2)
      const bad = { ...options, sourceUrl: 'https://x.com/no/status/3' }
      await expect(cachedArtifactObservation(bad, async () => ({ title: 'Artwork' }))).rejects.toThrow(/Invalid actual-media observation/)
    } finally { await fs.rm(f.root, { recursive: true, force: true }) }
  })
})

describe('bounded artwork acquisition', () => {
  const candidates = Array.from({ length: 40 }, (_, i) => ({ url: `https://x.com/artist/status/${10000 + i}`, source_channel: 'twitter-bookmark', note_id: String(i) }))
  it('refills rejections, early stops and never admits metadata alone', async () => {
    const calls = []
    const result = await acquireBookmarkArtwork({ candidates, batchSize: 3, target: 6, maxAcquisitions: 12 }, {
      acquire: async rows => { calls.push(...rows); return rows },
      research: async rows => ({ source_decisions: rows.map(s => ({ url: s.url, role: 'content' })) }),
      inspect: async (rows, research) => ({ ...research, source_decisions: [...research.source_decisions, ...rows.map(s => ({ url: s.url, mockEligible: Number(s.note_id) >= 3 }))] }),
      select: (rows, research) => rows.filter(s => research.source_decisions.some(d => d.url === s.url && d.mockEligible)),
    })
    expect(calls).toHaveLength(9)
    expect(result.contentSources).toHaveLength(6)
    const noPixels = await acquireBookmarkArtwork({ candidates, maxAcquisitions: 7 }, {
      acquire: async rows => rows, research: async () => ({ source_decisions: [] }), inspect: async (_, r) => r, select: () => [],
    })
    expect(noPixels.audit.acquired).toBe(7)
    expect(noPixels.contentSources).toHaveLength(0)
  })
})
