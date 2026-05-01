export function slugify(value) {
  return String(value || 'daily-edition')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'daily-edition'
}

export function uniqueNonEmpty(values) {
  const list = Array.isArray(values) ? values : [values]
  return [...new Set(list.map((value) => String(value || '').trim()).filter(Boolean))]
}

export function sentenceList(values, limit = 4) {
  const entries = uniqueNonEmpty(values).slice(0, limit)
  if (!entries.length) return ''
  if (entries.length === 1) return entries[0]
  if (entries.length === 2) return `${entries[0]} and ${entries[1]}`
  return `${entries.slice(0, -1).join(', ')}, and ${entries.at(-1)}`
}
