// @ts-expect-error shared JS module is consumed via a typed wrapper here
import { sanitizeSourceText as sanitizeSourceTextImpl } from '../../shared/source-text.js'

export function sanitizeSourceText(
  value: string | null | undefined,
  fallback = 'Source unavailable',
  maxChars = 280,
): string {
  return sanitizeSourceTextImpl(value, fallback, maxChars)
}
