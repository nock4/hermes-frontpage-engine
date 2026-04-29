import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

import { extractUrls, isAllowedSourceUrl, isPreferredNtsStreamingSourceUrl, isYouTubeThumbnailUrl, isYouTubeVideoUrl, ntsStreamingSourceRank } from '../source-url-policy.mjs'
import { uniqueNonEmpty } from '../string-utils.mjs'

const allowedSignalDirectories = [
  'Inbox/tweets',
  'Inbox/youtube',
]

const allowedSignalFiles = [
  'Inbox/nts-liked-tracks-source-map.md',
  'Inbox/nts-liked-tracks-source-map-batch-1.md',
  'Inbox/nts-liked-tracks-source-map-batch-2.md',
  'Inbox/nts-liked-tracks-source-map-batch-3.md',
  'Resources/Chrome Bookmarks.md',
  'Resources/Collections/Chrome Bookmarks.md',
  'Resources/Collections/YouTube Likes.md',
]

async function pathExists(filePath) {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

function normalizeRelativePath(filePath) {
  return filePath.split(path.sep).join('/')
}

export function signalChannelForPath(relativePath) {
  const normalized = normalizeRelativePath(relativePath)
  const lower = normalized.toLowerCase()
  if (lower.startsWith('inbox/tweets/')) return 'twitter-bookmark'
  if (lower.startsWith('inbox/youtube/')) return 'youtube-like'
  if (lower.startsWith('inbox/nts-liked-tracks-source-map')) return 'nts-like'
  if (lower === 'resources/chrome bookmarks.md' || lower === 'resources/collections/chrome bookmarks.md') return 'chrome-bookmark'
  if (lower === 'resources/collections/youtube likes.md') return 'youtube-like'
  return null
}

async function listMarkdownFiles(dir, files = []) {
  const entries = await fs.readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.name.startsWith('.') || ['node_modules', 'dist', 'tmp'].includes(entry.name)) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) await listMarkdownFiles(full, files)
    else if (entry.isFile() && entry.name.endsWith('.md')) files.push(full)
  }
  return files
}

async function listAllowedSignalMarkdownFiles(vault) {
  const files = []
  for (const relativeDir of allowedSignalDirectories) {
    const full = path.join(vault, relativeDir)
    if (await pathExists(full)) files.push(...await listMarkdownFiles(full))
  }
  for (const relativeFile of allowedSignalFiles) {
    const full = path.join(vault, relativeFile)
    if ((await pathExists(full)) && full.endsWith('.md')) files.push(full)
  }
  return [...new Set(files)]
}

function parseMarkdownTableCells(line) {
  const trimmed = line.trim()
  if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) return []
  return trimmed.slice(1, -1).split('|').map((cell) => cell.trim())
}

export function extractNtsStreamingSourceUrls(text) {
  const rows = []
  for (const line of text.split('\n')) {
    const cells = parseMarkdownTableCells(line)
    if (cells.length < 6 || !/^\d+$/.test(cells[0])) continue

    const bestSource = cells[3].toLowerCase()
    const confidence = cells[4].toLowerCase()
    const url = extractUrls(cells[5])[0]
    if (!url) continue
    if (bestSource.includes('unverified') || bestSource.includes('search') || confidence === 'low') continue
    if (!isPreferredNtsStreamingSourceUrl(url)) continue
    rows.push({ url, bestSource, confidence })
  }

  return uniqueNonEmpty(rows
    .sort((left, right) => ntsStreamingSourceRank(left.url) - ntsStreamingSourceRank(right.url))
    .map((row) => row.url))
}

export function normalizeNoteUrls(urls, sourceChannel) {
  const filtered = uniqueNonEmpty(urls).filter(isAllowedSourceUrl)
  if (sourceChannel !== 'youtube-like') return filtered

  const videoUrls = filtered.filter(isYouTubeVideoUrl)
  const supportingUrls = filtered.filter((url) => !isYouTubeThumbnailUrl(url) && !videoUrls.includes(url))
  return uniqueNonEmpty([...videoUrls, ...supportingUrls])
}

function extractTitle(text, fallback) {
  const frontmatterTitle = text.match(/^---[\s\S]*?\ntitle:\s*["']?(.+?)["']?\s*\n[\s\S]*?---/m)?.[1]
  if (frontmatterTitle) return frontmatterTitle.trim()
  const heading = text.match(/^#\s+(.+)$/m)?.[1]
  if (heading) return heading.trim()
  return fallback.replace(/[-_]/g, ' ').replace(/\.md$/, '').trim()
}

function extractDateFromPath(filePath) {
  const match = filePath.match(/20\d{2}-\d{2}-\d{2}/)
  return match?.[0] || null
}

function compactText(text, limit = 1600) {
  return text
    .replace(/^---[\s\S]*?---\s*/m, '')
    .replace(/!\[[^\]]*\]\([^)]+\)/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, limit)
}

export async function loadObsidianAllowlistSignals({ inputRoot, date, windowDays, daysBetween }) {
  if (!(await pathExists(inputRoot))) throw new Error(`Vault path does not exist: ${inputRoot}`)

  const files = await listAllowedSignalMarkdownFiles(inputRoot)
  const notes = []
  for (const filePath of files) {
    const stat = await fs.stat(filePath)
    const relativePath = path.relative(inputRoot, filePath)
    const source_channel = signalChannelForPath(relativePath)
    if (!source_channel) continue
    const pathDate = extractDateFromPath(relativePath)
    const mtimeDate = stat.mtime.toISOString().slice(0, 10)
    const noteDate = pathDate || mtimeDate
    const ageDays = daysBetween(date, noteDate)
    if (ageDays < 0 || ageDays > windowDays) continue

    const text = await fs.readFile(filePath, 'utf8')
    const urls = source_channel === 'nts-like'
      ? extractNtsStreamingSourceUrls(text)
      : normalizeNoteUrls(extractUrls(text), source_channel)
    if (!urls.length) continue

    const title = extractTitle(text, path.basename(filePath))
    const channelBoost = source_channel === 'twitter-bookmark' ? 8 : source_channel === 'youtube-like' ? 10 : source_channel === 'nts-like' ? 10 : 7
    const score = (windowDays - ageDays) * 2 + Math.min(urls.length, 8) * 2 + channelBoost

    notes.push({
      id: crypto.createHash('sha1').update(relativePath).digest('hex').slice(0, 12),
      source_channel,
      title,
      note_date: noteDate,
      excerpt: compactText(text),
      text,
      urls,
      source_path: normalizeRelativePath(relativePath),
      metadata: {
        adapter: 'obsidian-allowlist',
        stat_mtime: stat.mtime.toISOString(),
      },
      score,
      path: normalizeRelativePath(relativePath),
      date: noteDate,
    })
  }

  return {
    adapter: 'obsidian-allowlist',
    input_root: inputRoot,
    markdown_files_seen: files.length,
    notes,
    selection_filters: [
      'Markdown files only.',
      'Only enumerate explicit saved-content signal paths: Inbox/tweets, Inbox/youtube, Inbox NTS liked-track source maps, Resources Chrome Bookmarks, and Resources/Collections YouTube Likes.',
      `Keep notes whose date is from ${date} back through ${windowDays} days.`,
      'Reject local/private endpoints and text/data/document URLs before source research.',
      'For NTS liked-track maps, use only direct streamable source URLs and skip low-confidence or search rows.',
    ],
    looked_for: [
      'recent saved Twitter/X bookmarks with source media',
      'recent YouTube liked videos',
      'recent NTS liked tracks and resolved track sources',
      'recent Chrome bookmarks',
    ],
  }
}
