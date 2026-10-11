import { hostnameForUrl } from './source-url-policy.mjs'

function validatedVideoId(sourceUrl) {
  try {
    const source = new URL(sourceUrl)
    if (!['http:', 'https:'].includes(source.protocol) || source.username || source.password || source.port) return null
    if (!['youtube.com', 'www.youtube.com', 'music.youtube.com', 'youtu.be'].includes(source.hostname)) return null
    const id = source.hostname === 'youtu.be'
      ? source.pathname.match(/^\/([\w-]+)$/)?.[1]
      : source.pathname === '/watch' ? source.searchParams.get('v') : null
    return id && /^[\w-]+$/.test(id) ? id : null
  } catch { return null }
}

// Provider-fetched uploader identity is a scheduling key, not artwork authorship
// or admission evidence. Never infer it from saved prose or a video title.
export function validatedYouTubeCreator(sourceUrl, authorUrl) {
  try {
    if (!validatedVideoId(sourceUrl)) return null
    const author = new URL(authorUrl)
    if (author.protocol !== 'https:' || !['youtube.com', 'www.youtube.com'].includes(author.hostname) || author.username || author.password || author.port || author.search || author.hash) return null
    if (!/^\/(?:@[\w.%-]+|channel\/UC[\w-]{22}|user\/[\w.-]+)\/?$/.test(author.pathname)) return null
    return { provider: 'youtube', source_url: sourceUrl, author_url: `https://www.youtube.com${author.pathname.replace(/\/$/, '')}`, evidence: 'oembed' }
  } catch { return null }
}

function providerId(value) {
  // Never round provider snowflakes through an unsafe JavaScript number.
  if (typeof value === 'number' && !Number.isSafeInteger(value)) return null
  return typeof value === 'string' || typeof value === 'number'
    ? /^[1-9]\d*$/.test(String(value)) ? String(value) : null : null
}

function validatedStatus(sourceUrl) {
  try {
    const source = new URL(sourceUrl)
    if (!['http:', 'https:'].includes(source.protocol) || source.username || source.password || source.port) return null
    if (!['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com'].includes(source.hostname)) return null
    const match = source.pathname.match(/^\/(?:(?:([A-Za-z0-9_]{1,15})|i\/web)\/)?status\/([1-9]\d*)\/?$/)
    return match ? { id: match[2], handle: match[1]?.toLowerCase() } : null
  } catch { return null }
}

// Only call with the fetched provider response, not candidate/note metadata.
// The requested handle is not authoritative: status IDs survive handle changes.
export function validatedXCreator(sourceUrl, tweet) {
  const source = validatedStatus(sourceUrl)
  const canonical = validatedStatus(tweet?.url)
  const id = providerId(tweet?.id)
  const handle = tweet?.author?.screen_name
  if (!source || !canonical?.handle || !id || source.id !== id || canonical.id !== id
    || typeof handle !== 'string' || !/^[A-Za-z0-9_]{1,15}$/.test(handle)
    || canonical.handle !== handle.toLowerCase()) return null
  return { provider: 'x', evidence: 'fxtwitter', source_url: sourceUrl, tweet_id: id,
    canonical_url: `https://x.com/${canonical.handle}/status/${id}`,
    author_handle: canonical.handle, author_id: providerId(tweet.author.id) }
}

export function schedulingOwner(source) {
  const url = source.final_url || source.resolved_url || source.source_url || source.url
  const host = hostnameForUrl(url).replace(/^www\./, '').replace(/^twitter\.com$/, 'x.com')
  const attribution = source.creator_attribution
  if (attribution?.provider === 'youtube' && attribution.evidence === 'oembed'
    && validatedVideoId(attribution.source_url)
    && validatedVideoId(attribution.source_url) === validatedVideoId(source.source_url || source.url)
    && ['youtube.com', 'music.youtube.com', 'youtu.be'].includes(host)) {
    const validated = validatedYouTubeCreator(attribution.source_url, attribution.author_url)
    if (validated) return validated.author_url.includes('/@') ? validated.author_url.toLowerCase() : validated.author_url
  }
  if (attribution?.provider === 'x' && attribution.evidence === 'fxtwitter' && host === 'x.com') {
    const validated = validatedXCreator(attribution.source_url, {
      id: attribution.tweet_id, url: attribution.canonical_url,
      author: { screen_name: attribution.author_handle, id: attribution.author_id },
    })
    if (validated && validatedStatus(source.source_url || source.url)?.id === validated.tweet_id
      && validatedStatus(url)?.id === validated.tweet_id) {
      return validated.author_id ? `https://x.com/i/user/${validated.author_id}` : `https://x.com/${validated.author_handle}`
    }
  }
  return host
}
