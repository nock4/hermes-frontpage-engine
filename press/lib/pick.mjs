// Pick: the newest saved bookmark that has not been used and has a fetchable image.
// Candidates come from the Mac sync (press/candidates.json); the ledger
// (press/ledger.json) records every source already published or ruled out.

import dns from 'node:dns/promises'
import sharp from 'sharp'

import { fetchVettedImage } from '../../scripts/lib/fetch-vetted-image.mjs'
import { canonicalizeSourceUrl } from '../../scripts/lib/source-url-policy.mjs'

export const CANDIDATES_KEY = 'press/candidates.json'
export const LEDGER_KEY = 'press/ledger.json'
const MAX_SKIPS = 2
const MIN_IMAGE_SIDE = 200
const MODEL_IMAGE_SIDE = 1568

function tweetId(url) {
  return /^https?:\/\/(?:www\.|mobile\.)?(?:x|twitter)\.com\/(?:[^/]+\/|i\/web\/)?status\/(\d+)/i.exec(String(url || ''))?.[1] || null
}

export function sourceKey(url) {
  const id = tweetId(url)
  return id ? `tweet:${id}` : canonicalizeSourceUrl(url)
}

function emptyLedger() {
  return { version: 1, used: {}, skipped: {} }
}

export function normalizeLedger(value) {
  if (!value || typeof value !== 'object') return emptyLedger()
  return { version: 1, used: { ...(value.used || {}) }, skipped: { ...(value.skipped || {}) } }
}

export function markUsed(ledger, key, record) {
  ledger.used[key] = record
  delete ledger.skipped[key]
}

export function markSkipped(ledger, key, reason, { permanent = false } = {}) {
  const previous = ledger.skipped[key]?.count || 0
  ledger.skipped[key] = { reason: String(reason).slice(0, 200), count: permanent ? MAX_SKIPS : previous + 1 }
}

// Unused first-class candidates, newest first. A candidate with an image saved
// in the note outranks one whose image still has to be looked up.
export function orderCandidates(candidates, ledger) {
  const seen = new Set()
  return (Array.isArray(candidates) ? candidates : [])
    .filter((candidate) => candidate && typeof candidate.url === 'string' && tweetId(candidate.url))
    .map((candidate) => ({ ...candidate, key: sourceKey(candidate.url), media_urls: Array.isArray(candidate.media_urls) ? candidate.media_urls : [] }))
    .filter((candidate) => {
      if (seen.has(candidate.key) || ledger.used[candidate.key] || (ledger.skipped[candidate.key]?.count || 0) >= MAX_SKIPS) return false
      seen.add(candidate.key)
      return true
    })
    .sort((a, b) => Number(b.media_urls.length > 0) - Number(a.media_urls.length > 0)
      || String(b.note_date || '').localeCompare(String(a.note_date || ''))
      || a.key.localeCompare(b.key))
}

// Public tweet lookup, used only when the saved note carries no image link.
async function lookupTweetPhotos(id, fetchImpl = fetch) {
  const token = ((Number(id) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, '')
  const response = await fetchImpl(`https://cdn.syndication.twimg.com/tweet-result?id=${id}&token=${token}`, { signal: AbortSignal.timeout(10_000) })
  if (!response.ok) throw new Error(`Tweet lookup HTTP ${response.status}`)
  const tweet = await response.json()
  return (tweet.mediaDetails || []).filter((media) => media.type === 'photo' && media.media_url_https).map((media) => media.media_url_https)
}

function originalRendition(url) {
  try {
    const parsed = new URL(url)
    if (parsed.hostname !== 'pbs.twimg.com' || !parsed.pathname.startsWith('/media/')) return url
    parsed.pathname = parsed.pathname.replace(/:(?:orig|large|small|medium|thumb)$/i, '')
    if (!/\.[a-z0-9]+$/i.test(parsed.pathname) && parsed.searchParams.get('format')) parsed.pathname += `.${parsed.searchParams.get('format')}`
    parsed.search = '?name=orig'
    return parsed.href
  } catch {
    return url
  }
}

async function defaultFetchImage(url) {
  const { response, body } = await fetchVettedImage(url, { lookup: dns.lookup })
  if (!response.ok) throw new Error(`Image HTTP ${response.status}`)
  return body
}

// Resolves one candidate into a source the rest of the press can use, or throws
// with the reason it cannot be used.
export async function loadSource(candidate, { fetchImage = defaultFetchImage, lookupPhotos = lookupTweetPhotos } = {}) {
  let mediaUrls = candidate.media_urls
  if (!mediaUrls.length) mediaUrls = await lookupPhotos(tweetId(candidate.url))
  if (!mediaUrls.length) throw new Error('no image attached to the post')
  const imageUrl = originalRendition(mediaUrls[0])
  const original = await fetchImage(imageUrl)
  let metadata
  try { metadata = await sharp(original).metadata() } catch { throw new Error('image could not be decoded') }
  if (!(metadata.width >= MIN_IMAGE_SIDE && metadata.height >= MIN_IMAGE_SIDE)) throw new Error(`image too small (${metadata.width}x${metadata.height})`)
  const jpeg = await sharp(original).rotate().resize({ width: MODEL_IMAGE_SIDE, height: MODEL_IMAGE_SIDE, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 88 }).toBuffer()
  const handle = String(candidate.handle || '').replace(/^@?/, '@')
  const text = String(candidate.text || '').replace(/https?:\/\/\S+/g, '').replace(/\s+/g, ' ').trim()
  const lead = text || String(candidate.title || '').trim() || 'saved post'
  return {
    key: candidate.key,
    url: candidate.url,
    handle: handle === '@' ? '' : handle,
    author: candidate.author || '',
    text,
    title: `${handle === '@' ? 'Saved post' : handle}: ${lead.length > 80 ? `${lead.slice(0, 77).trim()}...` : lead}`,
    note_date: candidate.note_date || null,
    image: { url: imageUrl, width: metadata.width, height: metadata.height, jpeg },
  }
}
