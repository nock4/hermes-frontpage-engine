import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

import { extractUrls, isAllowedSourceUrl } from '../source-url-policy.mjs'
import { uniqueNonEmpty } from '../string-utils.mjs'

async function pathExists(filePath) {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
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

function frontmatterValue(text, key) {
  const match = text.match(new RegExp(`^---[\\s\\S]*?\\n${key}:\\s*["']?(.+?)["']?\\s*\\n[\\s\\S]*?---`, 'm'))
  return match?.[1]?.trim() || null
}

function extractDateFromPath(filePath) {
  const match = filePath.match(/20\d{2}-\d{2}-\d{2}/)
  return match?.[0] || null
}

function compactText(text, limit = 1600) {
  return String(text || '')
    .replace(/^---[\s\S]*?---\s*/m, '')
    .replace(/!\[[^\]]*\]\([^)]+\)/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, limit)
}

export async function loadMarkdownFolderSignals({ inputRoot, date, windowDays, daysBetween }) {
  if (!inputRoot) throw new Error('inputRoot is required for markdown-folder input mode.')
  if (!(await pathExists(inputRoot))) throw new Error(`Markdown input root does not exist: ${inputRoot}`)

  const files = await listMarkdownFiles(inputRoot)
  const notes = []
  for (const filePath of files) {
    const stat = await fs.stat(filePath)
    const relativePath = path.relative(inputRoot, filePath).split(path.sep).join('/')
    const text = await fs.readFile(filePath, 'utf8')
    const noteDate = frontmatterValue(text, 'note_date') || frontmatterValue(text, 'date') || extractDateFromPath(relativePath) || stat.mtime.toISOString().slice(0, 10)
    const ageDays = daysBetween(date, noteDate)
    if (ageDays < 0 || ageDays > windowDays) continue

    const urls = uniqueNonEmpty(extractUrls(text)).filter(isAllowedSourceUrl)
    if (!urls.length) continue

    const title = frontmatterValue(text, 'title') || text.match(/^#\s+(.+)$/m)?.[1]?.trim() || path.basename(filePath, '.md').replace(/[-_]/g, ' ')
    const sourceChannel = frontmatterValue(text, 'source_channel') || 'markdown-note'
    const score = (windowDays - ageDays) * 2 + Math.min(urls.length, 8) * 2 + 8

    notes.push({
      id: crypto.createHash('sha1').update(relativePath).digest('hex').slice(0, 12),
      source_channel: sourceChannel,
      title,
      note_date: noteDate,
      excerpt: compactText(text),
      text,
      urls,
      source_path: relativePath,
      metadata: {
        adapter: 'markdown-folder',
        stat_mtime: stat.mtime.toISOString(),
      },
      score,
      path: relativePath,
      date: noteDate,
    })
  }

  return {
    adapter: 'markdown-folder',
    input_root: inputRoot,
    markdown_files_seen: files.length,
    notes,
    selection_filters: [
      'Markdown files under the provided input root only.',
      `Keep notes whose date is from ${date} back through ${windowDays} days.`,
      'Use frontmatter note_date/date first, then YYYY-MM-DD in the path, then file mtime.',
      'Reject local/private endpoints and text/data/document URLs before source research.',
    ],
    looked_for: [
      'local markdown notes with URLs',
      'portable note folders that do not require Obsidian',
    ],
  }
}
