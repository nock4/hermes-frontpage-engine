import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { canonicalizeSourceUrl, extractUrls, isYouTubeVideoUrl } from './source-url-policy.mjs'
import { extractNtsStreamingSourceRows, normalizeNoteUrls } from './signal-adapters/obsidian-allowlist-adapter.mjs'

const options = JSON.parse(fs.readFileSync(0, 'utf8'))
const { inputRoot, cacheDir } = options
// Local metadata indexing is distinct from paid acquisition/pixel inspection.
// Cover every authorized saved lane before selecting a small model-facing batch.
const maxMetadataBytes = 32 * 1024 * 1024
let metadataBytes = 0
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
// Supporting windows obey only the cooldown subset; absent subset = strict.
const supportingBlocked = new Set((options.supportingBlockedKeys || options.recentSourceKeys || []).map(materialKey))
let state = { version: 1, entries: {}, after: null }
try { state = JSON.parse(fs.readFileSync(statePath, 'utf8')) } catch (e) { if (e.code !== 'ENOENT') throw e }
if (state.version !== 1) throw new Error('Unsupported bookmark metadata cache version')
const files = []
let directories = 0
function walk(relative, into = files) {
  if (++directories > 1000) throw new Error('Bookmark directory budget exceeded (1000); narrow saved-content folders')
  const full = path.join(inputRoot, relative)
  progress('readdir', full)
  let entries
  try { entries = fs.readdirSync(full, { withFileTypes: true }) } catch (e) { if (e.code === 'ENOENT') return; throw e }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    const rel = path.join(relative, entry.name)
    if (entry.isDirectory()) walk(rel, into)
    else if (entry.isFile() && entry.name.endsWith('.md')) into.push(rel)
    if (into.length > 10000) throw new Error('Bookmark metadata budget exceeded (10000 files); narrow saved-content folders')
  }
}
// Explicit saved lanes only; no recursive whole-vault walk or incidental links.
for (const dir of ['Inbox/tweets', '00 - Capture/tweets', '01 - Active/themes', 'Themes']) walk(dir)
// Invalidate cursor semantics once; exact note and pixel caches remain intact.
if (state.intake_paths_version !== 3) {
  state.after = null
  state.scan_after = null
  state.queue_after = null
  state.intake_paths_version = 3
}
files.sort().reverse()
const live = new Set(files)
for (const key of Object.keys(state.entries)) if (!live.has(key)) delete state.entries[key]
let notesRead = 0
for (const relative of files) {
  const full = path.join(inputRoot, relative)
  progress('stat', full)
  const stat = fs.statSync(full)
  const signature = `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`
  if (state.entries[relative]?.signature === signature) continue
  // Never nominate stale metadata. Resource exhaustion is a local index error,
  // not an editorial shortage inferred from a lexical prefix of the vault.
  delete state.entries[relative]
  if (stat.size > 131072) throw new Error(`Saved-note metadata oversized: ${relative}`)
  metadataBytes += stat.size
  if (metadataBytes > maxMetadataBytes) throw new Error('Saved-note metadata exceeds 32 MiB indexing budget; no partial nomination issued')
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
// Prefer media-backed nominations but retain a final sparse-owner exploration
// lane: only acquisition can reveal attachments absent from a saved note.
// Classification uses owning prose/attachments, never a thematic folder or tags.
// These are opportunities for pixel inspection, never eligibility assertions.
const nominationLane = note => {
  const prose = note.excerpt.replace(/^---\r?\n[\s\S]*?\r?\n---/, '').replace(/^#{2,3} Related\s*\n(?:\s*[-*] \[\[[^\n]+\n?)*/gm, '').replace(/#[\p{L}\p{N}_-]+/gu, '')
  const creative = /\b(artwork|painting|drawing|illustration|sculpture|photograph|animation|collage|printmaking|woodcut|ceramic|visual reference|attached visual|video art)\b/i.test(prose)
  const media = note.metadata.attached_media_urls.length > 0
  return media && creative ? 0 : creative ? 1 : media ? 2 : 3
}
const fresh = files.filter(relative => {
  const note = state.entries[relative]?.note
  return note && ![...note.urls, ...note.metadata.attached_media_urls].some(url => ledger.has(materialKey(url)))
})
const queueKey = relative => `${nominationLane(state.entries[relative].note)}:${hash(materialKey(state.entries[relative].note.urls[0]))}`
fresh.sort((a, b) => queueKey(a).localeCompare(queueKey(b)) || a.localeCompare(b))
// Advance across the entire stable priority queue before wrapping. Rejected but
// unspent strong-label records must not permanently starve sparse real artwork.
// A nomination cursor is not acquisition evidence. Yesterday's early success
// can leave unused artwork behind that cursor; give it first chance today.
// Within the same publication day retain bounded fallback traversal.
if (options.date && state.queue_date !== options.date) {
  state.queue_after = null
  state.queue_date = options.date
}
const next = state.queue_after ? fresh.findIndex(relative => queueKey(relative) > state.queue_after) : 0
const offset = Math.max(0, next)
const queue = [...fresh.slice(offset), ...fresh.slice(0, offset)]
const families = new Set()
const notes = []
for (const relative of queue) {
  const note = state.entries[relative].note
  state.after = relative
  state.queue_after = queueKey(relative)
  const key = materialKey(note.urls[0])
  if (families.has(key)) continue
  families.add(key)
  notes.push({ ...note, text: note.excerpt })
  if (notes.length >= maxNotes) break
}
// Supporting lane (2026-11-13 policy): after the fresh X anchor queue, nominate
// a bounded, channel-interleaved set of saved YouTube likes, NTS/Bandcamp/
// SoundCloud map rows (existing high/medium filter) and authorized
// manual-curation notes. Cooldown-eligible archive repeats may appear here as
// supporting-only nominations; nothing here confers eligibility.
const MAX_SUPPORTING_NOMINATIONS = 18
const supportingDirs = [['00 - Capture/youtube', 'youtube-like'], ['Inbox/youtube', 'youtube-like'], ['00 - Capture/frontpage-intake', 'manual-curation']]
const supportingMapFiles = ['00 - Capture/nts-liked-tracks-source-map.md', '00 - Capture/nts-liked-tracks-source-map-batch-1.md', '00 - Capture/nts-liked-tracks-source-map-batch-2.md', '00 - Capture/nts-liked-tracks-source-map-batch-3.md', 'Inbox/nts-liked-tracks-source-map.md', 'Inbox/nts-liked-tracks-source-map-batch-1.md', 'Inbox/nts-liked-tracks-source-map-batch-2.md', 'Inbox/nts-liked-tracks-source-map-batch-3.md']
const supportingFiles = []
for (const [dir, channel] of supportingDirs) {
  const found = []
  walk(dir, found)
  supportingFiles.push(...found.sort().map(relative => [relative, channel]))
}
for (const relative of supportingMapFiles) {
  try { if (fs.statSync(path.join(inputRoot, relative)).isFile()) supportingFiles.push([relative, 'nts-like']) } catch (e) { if (e.code !== 'ENOENT') throw e }
}
const taken = new Set(notes.map(note => materialKey(note.urls[0])))
const supportingByChannel = new Map()
const supportingAudit = {}
for (const [relative, channel] of supportingFiles) {
  const full = path.join(inputRoot, relative)
  progress('stat', full)
  const stat = fs.statSync(full)
  if (stat.size > 524288) throw new Error(`Supporting saved-note metadata oversized: ${relative}`)
  metadataBytes += stat.size
  if (metadataBytes > maxMetadataBytes) throw new Error('Saved-note metadata exceeds 32 MiB indexing budget; no partial nomination issued')
  progress('readFile', full)
  const text = fs.readFileSync(full, 'utf8')
  const title = text.match(/^---[\s\S]*?\ntitle:\s*["']?(.+?)["']?\s*\n[\s\S]*?---/m)?.[1] || text.match(/^#\s+(.+)$/m)?.[1] || path.basename(relative, '.md')
  const frontmatterUrl = text.match(/^---\r?\n[\s\S]*?^\s*(?:url|source_url|source):\s*["']?(https?:\/\/[^\s"']+)/m)?.[1]
  const explicitSource = text.match(/^\s*Source:\s*(https?:\/\/\S+)/im)?.[1]
  let entries = []
  if (channel === 'nts-like') {
    entries = extractNtsStreamingSourceRows(text).map(row => ({ url: row.url, rows: [{ ...row, evidence_origin: 'saved-note-row', note_path: relative, note_title: title }] }))
  } else if (channel === 'youtube-like') {
    const url = [frontmatterUrl, ...normalizeNoteUrls(extractUrls(text), channel)].filter(Boolean).find(isYouTubeVideoUrl)
    if (url) entries = [{ url }]
  } else {
    const allowed = normalizeNoteUrls(extractUrls(text), channel)
    const url = [explicitSource, frontmatterUrl].filter(Boolean).map(value => value.replace(/[)>\].,]+$/, '')).find(value => allowed.includes(value)) || allowed[0]
    if (url) entries = [{ url }]
  }
  const audit = supportingAudit[channel] ||= { files: 0, urls: 0, cooldown_blocked: 0, fresh: 0, repeat_eligible: 0, nominated: 0 }
  audit.files += 1
  for (const entry of entries) {
    audit.urls += 1
    const key = materialKey(entry.url)
    if (supportingBlocked.has(key)) { audit.cooldown_blocked += 1; continue }
    if (taken.has(key)) continue
    taken.add(key)
    const repeat = ledger.has(key)
    audit[repeat ? 'repeat_eligible' : 'fresh'] += 1
    const lane = supportingByChannel.get(channel) || []
    lane.push({
      id: hash(`${relative}\n${entry.url}`).slice(0, 12), source_channel: channel,
      title, note_date: stat.mtime.toISOString().slice(0, 10), excerpt: text.slice(0, 6000).replace(/\|[^\n]*\|\n?/g, ''),
      urls: [entry.url], source_path: relative, path: relative, score: 0,
      ...(entry.rows ? { source_map_rows: entry.rows } : {}),
      intake_lane: 'supporting', supporting_repeat_eligible: repeat,
      metadata: { adapter: 'supporting-lane', stat_mtime: stat.mtime.toISOString(), note_sha256: hash(text), attached_media_urls: [] },
      order: `${repeat ? 1 : 0}:${hash(`${options.date || ''}:${key}`)}`,
    })
    supportingByChannel.set(channel, lane)
  }
}
// Fresh first, then a deterministic per-day rotation so failed nominations do
// not starve the same lane every morning; round-robin channels to the cap.
const lanes = [...supportingByChannel.entries()].sort(([a], [b]) => a.localeCompare(b))
  .map(([, lane]) => lane.sort((a, b) => a.order.localeCompare(b.order)))
const supportingNotes = []
for (let index = 0; supportingNotes.length < MAX_SUPPORTING_NOMINATIONS && lanes.some(lane => index < lane.length); index += 1) {
  for (const lane of lanes) {
    if (index < lane.length && supportingNotes.length < MAX_SUPPORTING_NOMINATIONS) {
      const { order, ...note } = lane[index]
      supportingNotes.push({ ...note, text: note.excerpt })
      supportingAudit[note.source_channel].nominated += 1
    }
  }
}
fs.mkdirSync(cacheDir, { recursive: true })
const temporary = `${statePath}.${process.pid}.tmp`
fs.writeFileSync(temporary, JSON.stringify(state))
fs.renameSync(temporary, statePath)
process.stdout.write(JSON.stringify({ input_root: inputRoot, notes, supporting_notes: supportingNotes,
  supporting_audit: { max_nominations: MAX_SUPPORTING_NOMINATIONS, cooldown_ledger: Boolean(options.supportingBlockedKeys), channels: supportingAudit },
  markdown_files_seen: files.length,
  selection_filters: ['Bookmark-first bounded saved-note intake; metadata is nomination only; archive and actual-media gates required.'],
  looked_for: ['unused owning X/Twitter bookmarks'],
  audit: { notes_read: notesRead, metadata_reads: notesRead, metadata_bytes_read: metadataBytes, metadata_coverage_complete: true, nomination_lanes: [0, 1, 2, 3].map(lane => ({ lane, unused: fresh.filter(relative => nominationLane(state.entries[relative].note) === lane).length })), cached_notes: Object.keys(state.entries).length, unused_cached_notes: fresh.length, metadata_files: files.length, max_metadata_files: 10000, max_metadata_bytes: maxMetadataBytes, max_notes: maxNotes, cache_path: statePath },
}))
