// Read saved-bookmark notes from the Obsidian vault and turn them into press
// candidates. Lifted from scripts/lib/bookmark-vault-worker.mjs: the same saved
// lanes and the same "owning post" rule, without the cursor and cache machinery.

import fs from 'node:fs'
import path from 'node:path'

import { canonicalizeSourceUrl, extractUrls } from '../../scripts/lib/source-url-policy.mjs'
import { sourceKey } from './pick.mjs'

// Explicit saved lanes only; never a whole-vault walk.
const SAVED_LANES = ['Inbox/tweets', '00 - Capture/tweets', '01 - Active/themes', 'Themes']
const POST_URL = /^https?:\/\/(?:www\.)?(?:x\.com|twitter\.com)\/(?:[^/]+\/|i\/web\/)?status\/\d+(?:[/?#]|$)/
const MEDIA_URL = /^https:\/\/pbs\.twimg\.com\/media\//
const MAX_NOTE_BYTES = 131072

const frontmatterValue = (frontmatter, name) => frontmatter.match(new RegExp(`^\\s*${name}:\\s*["']?([^"'\\n]+)`, 'm'))?.[1]?.trim() || ''

// One note -> one candidate, or null when the note does not own a post.
export function parseNote(relativePath, text, modifiedAt) {
  const urls = extractUrls(text)
  const posts = urls.filter((url) => POST_URL.test(url))
  if (!posts.length) return null
  const frontmatter = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1] || ''
  const explicit = text.match(/^\s*\[View on (?:X|Twitter)\]\((https?:\/\/[^)]+)\)/im)?.[1]
    || frontmatter.match(/^\s*(?:url|source_url|source):\s*["']?(https?:\/\/[^\s"']+)/m)?.[1]
  // Thematic notes need an owning link, not an incidental mention.
  const owner = explicit
    ? posts.find((url) => canonicalizeSourceUrl(url) === canonicalizeSourceUrl(explicit))
    : /^(?:01 - Active\/themes|Themes)\//.test(relativePath) ? null : posts[0]
  if (!owner) return null
  const url = `https://${canonicalizeSourceUrl(owner)}`
  const quote = text.split(/\r?\n/).filter((line) => /^>\s?/.test(line)).map((line) => line.replace(/^>\s?/, '').trim()).filter(Boolean).join(' ')
  return {
    key: sourceKey(url),
    url,
    handle: frontmatterValue(frontmatter, 'handle') || `@${url.split('/')[3]}`,
    author: frontmatterValue(frontmatter, 'author'),
    title: (text.match(/^#\s+(.+)$/m)?.[1] || path.basename(relativePath, '.md')).trim().slice(0, 160),
    text: quote.slice(0, 600),
    media_urls: [...new Set(urls.filter((candidate) => MEDIA_URL.test(candidate)))].slice(0, 4),
    note_date: modifiedAt.toISOString().slice(0, 10),
    tweet_date: frontmatterValue(frontmatter, 'date') || null,
  }
}

export function scanVault(vaultRoot) {
  const files = []
  const walk = (relative) => {
    let entries
    try { entries = fs.readdirSync(path.join(vaultRoot, relative), { withFileTypes: true }) } catch (error) { if (error.code === 'ENOENT') return; throw error }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue
      const child = path.join(relative, entry.name)
      if (entry.isDirectory()) walk(child)
      else if (entry.isFile() && entry.name.endsWith('.md')) files.push(child)
      if (files.length > 10000) throw new Error('More than 10000 saved notes; narrow the saved lanes')
    }
  }
  for (const lane of SAVED_LANES) walk(lane)

  const byKey = new Map()
  for (const relative of files.sort()) {
    const full = path.join(vaultRoot, relative)
    const stat = fs.statSync(full)
    if (stat.size > MAX_NOTE_BYTES) continue
    const candidate = parseNote(relative, fs.readFileSync(full, 'utf8'), stat.mtime)
    if (!candidate) continue
    const existing = byKey.get(candidate.key)
    // The same post can be filed twice; keep the copy that carries an image.
    if (!existing || (candidate.media_urls.length && !existing.media_urls.length)) byKey.set(candidate.key, candidate)
  }
  return { notes: files.length, candidates: [...byKey.values()].sort((a, b) => b.note_date.localeCompare(a.note_date) || a.key.localeCompare(b.key)) }
}
