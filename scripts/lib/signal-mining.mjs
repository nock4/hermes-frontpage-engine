import fs from 'node:fs/promises'
import path from 'node:path'

import { loadManifestSignals } from './signal-adapters/manifest-adapter.mjs'
import {
  extractNtsStreamingSourceUrls,
  loadObsidianAllowlistSignals,
  normalizeNoteUrls,
  signalChannelForPath,
} from './signal-adapters/obsidian-allowlist-adapter.mjs'
import { loadMarkdownFolderSignals } from './signal-adapters/markdown-folder-adapter.mjs'
import { uniqueNonEmpty } from './string-utils.mjs'

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function daysBetween(leftDate, rightDate) {
  const left = new Date(`${leftDate}T00:00:00Z`).getTime()
  const right = new Date(`${rightDate}T00:00:00Z`).getTime()
  return Math.round((left - right) / 86_400_000)
}

const diversityStopTerms = new Set([
  'ambient',
  'edition',
  'frontpage',
  'generated',
  'image',
  'source',
  'window',
])

function normalizeDiversityTerms(values) {
  return uniqueNonEmpty(values)
    .map((value) => value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim())
    .filter((value) => value.length >= 4 && !diversityStopTerms.has(value))
    .slice(0, 32)
}

function noteDiversityPenalty(note, diversityAvoidTerms = []) {
  const terms = normalizeDiversityTerms(diversityAvoidTerms)
  if (!terms.length) return 0
  const haystack = `${note.title || ''} ${note.excerpt || ''} ${note.text || ''}`.toLowerCase()
  const matches = terms.filter((term) => haystack.includes(term)).length
  return Math.min(36, matches * 12)
}

function withDiversityScore(note, diversityAvoidTerms = []) {
  const diversity_penalty = noteDiversityPenalty(note, diversityAvoidTerms)
  return {
    ...note,
    diversity_penalty,
    selection_score: note.score - diversity_penalty,
  }
}

function wordFrequencies(notes) {
  const stop = new Set([
    'about', 'after', 'again', 'also', 'because', 'before', 'being', 'between', 'could', 'daily',
    'edition', 'front', 'from', 'have', 'into', 'just', 'like', 'more', 'note', 'notes', 'page',
    'project', 'really', 'should', 'source', 'that', 'their', 'there', 'this', 'through', 'today',
    'with', 'would', 'your',
  ])
  const counts = new Map()
  for (const note of notes) {
    for (const token of (note.text || '').toLowerCase().match(/[a-z][a-z0-9-]{2,}/g) || []) {
      if (stop.has(token)) continue
      counts.set(token, (counts.get(token) || 0) + 1)
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 48)
    .map(([term, count]) => ({ term, count }))
}

export function selectRecentSignalNotes(notes, maxNotes, { diversityAvoidTerms = [] } = {}) {
  const scored = notes.map((note) => withDiversityScore(note, diversityAvoidTerms))
  const sorted = scored.sort((a, b) => b.selection_score - a.selection_score)
  const channelOrder = ['youtube-like', 'nts-like', 'chrome-bookmark', 'twitter-bookmark']
  const minimumPerAvailableChannel = Math.min(4, Math.max(2, Math.floor(maxNotes / 8)))
  const softCaps = {
    'twitter-bookmark': Math.max(8, Math.ceil(maxNotes * 0.45)),
    'youtube-like': Math.max(5, Math.ceil(maxNotes * 0.28)),
    'nts-like': Math.max(5, Math.ceil(maxNotes * 0.24)),
    'chrome-bookmark': Math.max(5, Math.ceil(maxNotes * 0.24)),
  }
  const selected = []
  const selectedIds = new Set()
  const channelCounts = new Map()
  const add = (note) => {
    if (!note || selectedIds.has(note.id) || selected.length >= maxNotes) return false
    selectedIds.add(note.id)
    channelCounts.set(note.source_channel, (channelCounts.get(note.source_channel) || 0) + 1)
    selected.push(note)
    return true
  }

  for (const channel of channelOrder) {
    const candidates = sorted.filter((note) => note.source_channel === channel)
    for (const note of candidates.slice(0, minimumPerAvailableChannel)) add(note)
  }

  for (const note of sorted) {
    if (selected.length >= maxNotes) break
    const cap = softCaps[note.source_channel] ?? maxNotes
    if ((channelCounts.get(note.source_channel) || 0) >= cap) continue
    add(note)
  }

  for (const note of sorted) {
    if (selected.length >= maxNotes) break
    add(note)
  }

  return selected
}

function normalizeSelectedNote(note) {
  return {
    ...note,
    path: note.source_path,
    date: note.note_date,
  }
}

async function loadSignalsForMode({ inputMode, inputRoot, signalManifest, date, windowDays }) {
  if (inputMode === 'manifest') {
    return loadManifestSignals({ signalManifest, date, windowDays, daysBetween })
  }
  if (inputMode === 'markdown-folder') {
    return loadMarkdownFolderSignals({ inputRoot, date, windowDays, daysBetween })
  }
  if (inputMode === 'obsidian-allowlist') {
    return loadObsidianAllowlistSignals({ inputRoot, date, windowDays, daysBetween })
  }
  throw new Error(`Unsupported input mode: ${inputMode}`)
}

export async function mineSignals({
  vault,
  inputMode = 'obsidian-allowlist',
  inputRoot,
  signalManifest,
  date,
  windowDays,
  maxNotes,
  diversityAvoidTerms = [],
}, runDir) {
  const resolvedInputRoot = inputRoot || vault || null
  const loaded = await loadSignalsForMode({
    inputMode,
    inputRoot: resolvedInputRoot,
    signalManifest,
    date,
    windowDays,
  })

  const normalizedDiversityAvoidTerms = normalizeDiversityTerms(diversityAvoidTerms)
  const selectedNotes = selectRecentSignalNotes(loaded.notes, maxNotes, { diversityAvoidTerms: normalizedDiversityAvoidTerms })
    .map(normalizeSelectedNote)

  const urlRecords = []
  const seenUrls = new Set()
  for (const note of selectedNotes) {
    for (const url of note.urls) {
      if (seenUrls.has(url)) continue
      seenUrls.add(url)
      urlRecords.push({
        url,
        note_id: note.id,
        note_title: note.title,
        note_path: note.source_path,
        source_channel: note.source_channel,
        note_date: note.note_date,
        note_score: note.selection_score ?? note.score,
        note_raw_score: note.score,
        note_diversity_penalty: note.diversity_penalty || 0,
      })
    }
  }

  const harvest = {
    generated_at: new Date().toISOString(),
    input_mode: inputMode,
    input_root: loaded.input_root,
    signal_manifest: signalManifest || null,
    vault: inputMode === 'obsidian-allowlist' ? resolvedInputRoot : null,
    date,
    window_days: windowDays,
    selection_policy: {
      selected_count: maxNotes,
      filters: loaded.selection_filters,
      scoring: [
        'Recency: (window_days - age_days) * 2.',
        'Linked-source richness: min(url_count, 8) * 2.',
        'Channel boost is adapter-dependent and favors richer public media signals.',
        'Selection is channel-balanced when known public channels exist, then filled by score.',
        normalizedDiversityAvoidTerms.length
          ? `Variety pressure subtracts points from notes that repeat recent edition language: ${normalizedDiversityAvoidTerms.join(', ')}.`
          : 'Variety pressure is available but no recent edition terms were supplied for this run.',
      ],
      diversity_avoid_terms: normalizedDiversityAvoidTerms,
      looked_for: loaded.looked_for,
    },
    markdown_files_seen: loaded.markdown_files_seen,
    notes_scanned: loaded.notes.length,
    notes_selected: selectedNotes.map(({ text, ...note }) => note),
    motif_terms: wordFrequencies(selectedNotes),
    source_candidates: urlRecords,
  }

  await writeJson(path.join(runDir, 'signal-harvest.json'), harvest)
  return harvest
}

export {
  extractNtsStreamingSourceUrls,
  normalizeNoteUrls,
  signalChannelForPath,
}
