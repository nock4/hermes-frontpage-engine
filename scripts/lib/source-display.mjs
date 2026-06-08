export function domain(sourceUrl) {
  try {
    return new URL(sourceUrl).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

function stripSourceTitleChrome(value) {
  return String(value || '')
    .replace(/https?:\/\/\S+/gi, '')
    .replace(/\s+/g, ' ')
    .replace(/^[^A-Za-z0-9@#"'(]+/, '')
    .replace(/[|:,\-–—\s]+$/g, '')
    .replace(/\s*\/\s*X$/i, '')
    .trim()
}

function isFilenameLikeTitle(value) {
  const title = stripSourceTitleChrome(value)
  return /^[A-Za-z0-9_-]+\.(?:png|jpe?g|webp|avif)(?:\s+\(\d+\s*[x×]\s*\d+\))?$/i.test(title)
    || /^[A-Za-z0-9_-]{10,}\.(?:png|jpe?g|webp|avif)$/i.test(title)
}

function trimDisplayTitle(value, limit = 96) {
  const title = stripSourceTitleChrome(value)
  if (title.length <= limit) return title
  const wordIndex = title.lastIndexOf(' ', limit)
  return `${title.slice(0, wordIndex > 48 ? wordIndex : limit).trim()}...`
}

function imageStemFromUrl(sourceUrl) {
  try {
    const pathname = new URL(sourceUrl).pathname
    const lastSegment = pathname.split('/').filter(Boolean).pop() || ''
    return stripSourceTitleChrome(decodeURIComponent(lastSegment)
      .replace(/!.*$/g, '')
      .replace(/\.(?:png|jpe?g|webp|avif)$/i, '')
      .replace(/[_-]+/g, ' '))
  } catch {
    return ''
  }
}

function cleanDisplayTitle(value) {
  const title = stripSourceTitleChrome(value)
  if (!title) return ''

  const xPost = title.match(/^[^:]+ on X:\s*"([^"]+)"/i)
  if (xPost?.[1]) return trimDisplayTitle(xPost[1])
  const xOpenQuote = title.match(/^[^:]+ on X:\s*"(.+)$/i)
  if (xOpenQuote?.[1]) return trimDisplayTitle(xOpenQuote[1].replace(/"+$/g, ''))
  if (isFilenameLikeTitle(title)) return ''
  if (/^(home|homepage|untitled|image|photo|site icon)$/i.test(title)) return ''
  return trimDisplayTitle(title)
}

export function getSourceDisplayTitle(source, fallback) {
  const directTitle = cleanDisplayTitle(source?.title)
  if (directTitle) return directTitle

  const noteTitle = cleanDisplayTitle(source?.note_title)
  if (noteTitle) return noteTitle

  const fallbackTitle = cleanDisplayTitle(fallback)
  if (fallbackTitle) return fallbackTitle

  return domain(source?.final_url || source?.url || source?.source_url || '') || 'Source material'
}

export function getDistinctSourceDisplayTitle(source, fallback, usedTitles = new Set()) {
  const title = getSourceDisplayTitle(source, fallback)
  if (!usedTitles.has(title)) {
    usedTitles.add(title)
    return title
  }

  const sourceUrl = source?.final_url || source?.url || source?.source_url || ''
  const stem = imageStemFromUrl(sourceUrl)
  const host = domain(sourceUrl)
  const suffixes = [stem, host, 'alternate source'].filter(Boolean)
  for (const suffix of suffixes) {
    const candidate = trimDisplayTitle(`${title} — ${suffix}`, 124)
    if (!usedTitles.has(candidate)) {
      usedTitles.add(candidate)
      return candidate
    }
  }

  let counter = 2
  while (usedTitles.has(`${title} — ${counter}`)) counter += 1
  const numbered = `${title} — ${counter}`
  usedTitles.add(numbered)
  return numbered
}
