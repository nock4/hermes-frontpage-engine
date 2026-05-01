const X_SHELL_START = /\bdon['\u2019]t miss what['\u2019]s happening\b/i
const X_CONVERSATION_MARKER = /\bconversation\b/i
const X_AFTER_CONTENT_MARKER = /\bnew to x\?/i

function stripInvisibleControls(value) {
  return value.replace(/[\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/g, '')
}

function truncateAtWord(value, maxChars) {
  if (value.length <= maxChars) return value

  const sentence = value.slice(0, maxChars).match(/^(.+?[.!?])(?:\s|$)/)
  if (sentence?.[1] && sentence[1].length >= Math.min(80, maxChars - 12)) return sentence[1].trim()

  const wordIndex = value.lastIndexOf(' ', maxChars)
  if (wordIndex >= Math.min(48, maxChars - 10)) return `${value.slice(0, wordIndex).trim()}...`

  return `${value.slice(0, maxChars).trim()}...`
}

function stripLoggedOutXShell(value) {
  if (!X_SHELL_START.test(value)) return value

  const conversationMatch = value.match(X_CONVERSATION_MARKER)
  const afterContentMatch = value.match(X_AFTER_CONTENT_MARKER)
  if (conversationMatch?.index === undefined) return ''

  const contentStart = conversationMatch.index + conversationMatch[0].length
  const contentEnd = afterContentMatch?.index !== undefined && afterContentMatch.index > contentStart
    ? afterContentMatch.index
    : value.length

  return value.slice(contentStart, contentEnd).trim()
}

export function sanitizeSourceText(value, fallback = '', maxChars = 500) {
  const normalized = stripInvisibleControls(String(value || ''))
    .replace(/\s+/g, ' ')
    .trim()

  const withoutShell = stripLoggedOutXShell(normalized)
    .replace(/\s+Terms of Service\s+\|\s+Privacy Policy.*$/i, '')
    .replace(/\s+Show more\s+Terms of Service.*$/i, '')
    .replace(/\s+Read \d+ replies\b.*$/i, '')
    .trim()

  const cleaned = withoutShell || fallback.trim()
  return truncateAtWord(cleaned.replace(/\s+/g, ' ').trim(), maxChars)
}
