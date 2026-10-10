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
  return host
}
