import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

import { extractUrls, isAllowedSourceUrl } from '../source-url-policy.mjs'
import { uniqueNonEmpty } from '../string-utils.mjs'

function compactText(text, limit = 1600) {
  return String(text || '').replace(/\s+/g, ' ').trim().slice(0, limit)
}

export async function loadManifestSignals({ signalManifest, date, windowDays, daysBetween }) {
  if (!signalManifest) throw new Error('signalManifest is required for manifest input mode.')
  const raw = await fs.readFile(signalManifest, 'utf8')
  const entries = JSON.parse(raw)
  if (!Array.isArray(entries)) throw new Error('Signal manifest must be a JSON array.')

  const notes = []
  for (const [index, entry] of entries.entries()) {
    const noteDate = entry.note_date || entry.captured_at || entry.date || date
    const ageDays = daysBetween(date, noteDate)
    if (ageDays < 0 || ageDays > windowDays) continue

    const urls = uniqueNonEmpty([
      ...(entry.url ? [entry.url] : []),
      ...((Array.isArray(entry.urls) ? entry.urls : [])),
      ...extractUrls(entry.text || ''),
    ]).filter(isAllowedSourceUrl)
    if (!urls.length) continue

    const title = entry.title || `Manifest signal ${index + 1}`
    const text = entry.text || entry.excerpt || [title, ...urls].join('\n')
    const sourcePath = path.relative(process.cwd(), signalManifest) || signalManifest
    const score = (windowDays - ageDays) * 2 + Math.min(urls.length, 8) * 2 + 9

    notes.push({
      id: entry.id || crypto.createHash('sha1').update(`${signalManifest}:${index}:${title}`).digest('hex').slice(0, 12),
      source_channel: entry.source_channel || 'manual-curation',
      title,
      note_date: noteDate,
      excerpt: compactText(entry.excerpt || text),
      text,
      urls,
      source_path: sourcePath,
      metadata: {
        adapter: 'manifest',
        manifest_index: index,
        ...(entry.metadata || {}),
      },
      score,
      path: sourcePath,
      date: noteDate,
    })
  }

  return {
    adapter: 'manifest',
    input_root: signalManifest,
    markdown_files_seen: 1,
    notes,
    selection_filters: [
      'JSON manifest entries only.',
      `Keep entries whose captured date is from ${date} back through ${windowDays} days.`,
      'Accept url, urls, and URLs found inside text fields.',
      'Reject local/private endpoints and text/data/document URLs before source research.',
    ],
    looked_for: [
      'curated URLs and notes supplied by the user',
      'starter sample data for public demos',
    ],
  }
}
