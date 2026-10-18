import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { canonicalizeSourceUrl, extractUrls } from './source-url-policy.mjs'

const options = JSON.parse(fs.readFileSync(0, 'utf8'))
const { inputRoot, cacheDir } = options
const maxReads = Math.max(1, Math.min(48, options.maxReads || 48))
const maxNotes = Math.max(1, Math.min(24, options.maxNotes || 24))
const progress = (op, file) => fs.writeSync(2, `${op} ${file}\n`)
const hash = text => createHash('sha256').update(text).digest('hex')
const statePath = path.join(cacheDir, `${hash(path.resolve(inputRoot))}.json`)
const materialKey = url => {
  const canonical = canonicalizeSourceUrl(url)
  const tweet = canonical.match(/^x\.com\/(?:[^/]+\/|i\/web\/)?status\/(\d+)(?:[/?#]|$)/)
  return tweet ? `tweet:${tweet[1]}` : canonical
}
const ledger = new Set((options.recentSourceKeys || []).map(materialKey))
let state = { version: 1, entries: {}, after: null }
try { state = JSON.parse(fs.readFileSync(statePath, 'utf8')) } catch (e) { if (e.code !== 'ENOENT') throw e }
if (state.version !== 1) throw new Error('Unsupported bookmark metadata cache version')
const files = []
let directories = 0
function walk(relative) {
  if (++directories > 1000) throw new Error('Bookmark directory budget exceeded (1000); narrow saved-content folders')
  const full = path.join(inputRoot, relative)
  progress('readdir', full)
  let entries
  try { entries = fs.readdirSync(full, { withFileTypes: true }) } catch (e) { if (e.code === 'ENOENT') return; throw e }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    const rel = path.join(relative, entry.name)
    if (entry.isDirectory()) walk(rel)
    else if (entry.isFile() && entry.name.endsWith('.md')) files.push(rel)
    if (files.length > 10000) throw new Error('Bookmark metadata budget exceeded (10000 files); narrow saved-content folders')
  }
}
// Explicit saved lanes only; no recursive whole-vault walk or incidental links.
for (const dir of ['Inbox/tweets', '00 - Capture/tweets', '01 - Active/themes', 'Themes']) walk(dir)
// The vault files saved bookmarks from Inbox into Themes. Rewind the cursors
// once when that lane is introduced so a warmed legacy cache cannot strand it.
// Preserve all exact-note metadata and the separate exact-media verdict cache.
if (state.intake_paths_version !== 2) {
  state.after = null
  state.scan_after = null
  state.intake_paths_version = 2
}
files.sort().reverse()
const live = new Set(files)
for (const key of Object.keys(state.entries)) if (!live.has(key)) delete state.entries[key]
let notesRead = 0
const scanOffset = Math.max(0, state.scan_after ? files.findIndex(relative => relative < state.scan_after) : 0)
for (const relative of [...files.slice(scanOffset), ...files.slice(0, scanOffset)]) {
  const full = path.join(inputRoot, relative)
  progress('stat', full)
  const stat = fs.statSync(full)
  const signature = `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`
  if (state.entries[relative]?.signature === signature) continue
  // Invalidate before applying read budget; stale notes cannot be selected.
  delete state.entries[relative]
  if (notesRead >= maxReads) continue
  if (stat.size > 131072) continue
  progress('readFile', full)
  const text = fs.readFileSync(full, 'utf8')
  notesRead++
  state.scan_after = relative
  const urls = extractUrls(text)
  const owners = urls.filter(url => /^https?:\/\/(?:www\.)?(?:x\.com|twitter\.com)\/(?:[^/]+\/|i\/web\/)?status\/\d+(?:[/?#]|$)/.test(url))
  const primary = owners[0]
  // Thematic notes need an owning primary link, not an incidental mention.
  const frontmatter = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1] || ''
  const explicit = text.match(/^\s*\[View on (?:X|Twitter)\]\((https?:\/\/[^)]+)\)/im)?.[1]
    || frontmatter.match(/^\s*(?:url|source_url|source):\s*["']?(https?:\/\/[^\s"']+)/m)?.[1]
  const owner = explicit ? owners.find(url => canonicalizeSourceUrl(url) === canonicalizeSourceUrl(explicit))
    : /^(?:01 - Active\/themes|Themes)\//.test(relative) ? null : primary
  const note = owner ? {
    id: hash(relative).slice(0, 12), source_channel: 'twitter-bookmark',
    title: text.match(/^#\s+(.+)$/m)?.[1] || path.basename(relative),
    note_date: stat.mtime.toISOString().slice(0, 10),
    excerpt: text.slice(0, 6000), urls: [owner], source_path: relative,
    path: relative, score: 0,
    metadata: { adapter: 'bookmark-first', stat_mtime: stat.mtime.toISOString(), note_sha256: hash(text), attached_media_urls: urls.filter(url => /^https:\/\/pbs\.twimg\.com\/media\//.test(url)) },
  } : null
  state.entries[relative] = { signature, note }

}
const fresh = files.filter(relative => {
  const note = state.entries[relative]?.note
  return note && ![...note.urls, ...note.metadata.attached_media_urls].some(url => ledger.has(materialKey(url)))
})
// Advance by actual visited path, not requested slots. Changing a note must not
// repeatedly steal a slot and strand unchanged entries at every wraparound.
const next = state.after ? fresh.findIndex(relative => relative < state.after) : 0
const offset = Math.max(0, next)
const queue = [...fresh.slice(offset), ...fresh.slice(0, offset)]
const families = new Set()
const notes = []
for (const relative of queue) {
  const note = state.entries[relative].note
  state.after = relative
  const key = materialKey(note.urls[0])
  if (families.has(key)) continue
  families.add(key)
  notes.push({ ...note, text: note.excerpt })
  if (notes.length >= maxNotes) break
}
fs.mkdirSync(cacheDir, { recursive: true })
const temporary = `${statePath}.${process.pid}.tmp`
fs.writeFileSync(temporary, JSON.stringify(state))
fs.renameSync(temporary, statePath)
process.stdout.write(JSON.stringify({ input_root: inputRoot, notes, markdown_files_seen: files.length,
  selection_filters: ['Bookmark-first bounded saved-note intake; metadata is nomination only; archive and actual-media gates required.'],
  looked_for: ['unused owning X/Twitter bookmarks'],
  audit: { notes_read: notesRead, cached_notes: Object.keys(state.entries).length, unused_cached_notes: fresh.length, metadata_files: files.length, max_reads: maxReads, max_notes: maxNotes, cache_path: statePath },
}))
