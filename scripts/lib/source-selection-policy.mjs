import {
  canonicalizeSourceUrl,
  hostnameForUrl,
  isAllowedSourceUrl,
  isBandcampStreamingSourceUrl,
  isSoundCloudStreamingSourceUrl,
  isYouTubeVideoUrl,
  youtubeId,
} from './source-url-policy.mjs'

const DEFAULT_MAX_CONTENT_ITEMS = 10
const DEFAULT_TARGET_CONTENT_ITEMS = 9
const SOURCE_CHANNELS = ['youtube-like', 'nts-like', 'chrome-bookmark', 'twitter-bookmark']

export function classifySource(url) {
  try {
    const parsed = new URL(url)
    const host = parsed.hostname.replace(/^www\./, '')
    if (host.includes('youtube.com') || host.includes('youtu.be')) return { source_type: 'youtube', window_type: 'video', kind: 'video' }
    if (host === 'x.com' || host === 'twitter.com') return { source_type: 'tweet', window_type: 'social', kind: 'social' }
    if (host.includes('github.com')) return { source_type: 'github', window_type: 'web', kind: 'web' }
    if (host.includes('nts.live')) return { source_type: 'nts', window_type: 'audio', kind: 'audio' }
    if (host.includes('soundcloud.com') || host.includes('bandcamp.com')) return { source_type: 'audio', window_type: 'audio', kind: 'audio' }
  } catch {
    return { source_type: 'web', window_type: 'web', kind: 'web' }
  }
  return { source_type: 'article', window_type: 'web', kind: 'article' }
}

export function isAllowedInspectedSource(source) {
  if (source?.youtube_embed_status === 'unavailable' || source?.embed_status === 'unavailable') return false
  return [source?.url, source?.source_url, source?.final_url]
    .filter(Boolean)
    .every(isAllowedSourceUrl)
}

function preferredCanonicalUrl(source) {
  const urls = [source?.final_url, source?.source_url, source?.url].filter(Boolean)
  const nonShortener = urls.find((url) => !['t.co', 'bit.ly', 'tinyurl.com'].includes(hostnameForUrl(url)))
  return nonShortener || urls[0] || ''
}

export function sourceContentKey(source) {
  return canonicalizeSourceUrl(preferredCanonicalUrl(source))
}

function sourceDomainKey(source) {
  return hostnameForUrl(preferredCanonicalUrl(source)) || hostnameForUrl(source?.url)
}

function sourceCandidateKey(candidate) {
  return canonicalizeSourceUrl(candidate?.url)
}

function noteSelectionKey(record, sourceKey) {
  const noteKey = record.note_id || record.note_title || record.note_path || 'unknown'
  if (record.source_channel === 'nts-like') return ['nts-like', noteKey, sourceKey].join(':')
  return noteKey
}

export function scoreVisualCandidate(candidate) {
  const text = `${candidate?.note_title || ''} ${candidate?.note_path || ''} ${candidate?.url || ''}`.toLowerCase()
  let score = Number(candidate?.note_score || 0) / 4

  if (/(art|artist|visual|image|photo|gallery|portfolio|design|garden|landscape|plant|native|pollinator|biodiversity|wildlife|oudolf|wildones|homegrown|prairie|meadow|field-guide|assets|media|cutscene|game|shader|canvas)/.test(text)) score += 18
  if (/(oudolf|nativegardendesigns|homegrownnationalpark|wildones|michiganflora|mtcubacenter|prairiemoon|detroitvacantland|dfc-lots)/.test(text)) score += 12
  if (/(github|quickstart|docs|documentation|api|llm\.txt|localhost|127\.0\.0\.1|health|conceptual_guide|langmem)/.test(text)) score -= 14
  if (/\.(png|jpe?g|webp|avif)(\?|$)/.test(text)) score += 10
  if (/\.pdf(\?|$)/.test(text)) score -= 6

  return score
}

export function isLowValueVisualImage(imageUrl) {
  if (!imageUrl) return true
  let lower = imageUrl.toLowerCase()
  if (lower.startsWith('data:')) return true
  if (lower.includes('image/svg+xml')) return true
  try {
    const parsed = new URL(imageUrl)
    lower = `${parsed.hostname}${parsed.pathname}${parsed.search}`.toLowerCase()
  } catch {
    lower = imageUrl.toLowerCase()
  }

  return /\.svg(?:$|[?#])/.test(lower)
    || /\.ico(?:$|[?#])/.test(lower)
    || lower.includes('abs.twimg.com')
    || lower.includes('favicon')
    || lower.includes('apple-touch-icon')
    || lower.includes('site-icon')
    || lower.includes('wordmark')
    || lower.includes('profile_images')
    || lower.includes('profile_pic')
    || lower.includes('profile-picture')
    || lower.includes('/profile/')
    || lower.includes('s100x100')
    || lower.includes('templatethumbnail')
    || lower.includes('static/images/x.png')
    || lower.includes('abs.twimg.com/emoji/')
    || lower.includes('/logo')
    || /(?:^|[/_\-.])icon(?:[/_\-.]|$)/.test(lower)
    || lower.includes('githubassets.com')
    || lower.includes('opengraph.githubassets.com')
}

export function isDirectRasterImageUrl(sourceUrl) {
  if (!sourceUrl) return false
  let lower = sourceUrl.toLowerCase()
  try {
    const parsed = new URL(sourceUrl)
    lower = `${parsed.hostname}${parsed.pathname}`.toLowerCase()
  } catch {
    lower = sourceUrl.toLowerCase()
  }

  return /\.(png|jpe?g|webp|avif)(?:$|[?#])/.test(lower)
    || lower.includes('pbs.twimg.com/media/')
}

export function visualReferenceScore(source, recentSourceKeys = new Set()) {
  if (isLowValueVisualImage(source?.image_url)) return Number.NEGATIVE_INFINITY
  let score = scoreVisualCandidate(source)
  const sourceUrls = sourceUrlsForScoring(source)
  if (source.image_url) score += 8
  if (source.fetch_status === 'browser-harness' || source.fetch_status === 'fetch-ok') score += 4
  if (source.source_channel === 'nts-like' && sourceUrls.some(isBandcampStreamingSourceUrl)) score += 18
  if (source.source_channel === 'youtube-like' && sourceUrls.some(isYouTubeVideoUrl)) score += 8
  if (source.source_channel === 'twitter-bookmark') score -= 35
  if (recentSourceKeys.has(sourceContentKey(source)) || recentSourceKeys.has(canonicalizeSourceUrl(source.image_url))) score -= 100
  return score
}

export function selectBestVisualReference(sources, recentSourceKeys = new Set()) {
  const ranked = [...sources]
    .filter((source) => source.image_url && !isLowValueVisualImage(source.image_url))
    .map((source) => ({ source, score: visualReferenceScore(source, recentSourceKeys) }))
    .filter((entry) => Number.isFinite(entry.score))
    .sort((left, right) => right.score - left.score)

  return ranked.find((entry) => entry.score >= 0) || ranked[0] || null
}

function sourceSelectionScore(candidate, recentSourceKeys = new Set()) {
  if (!isAllowedSourceUrl(candidate?.url)) return Number.NEGATIVE_INFINITY
  const text = `${candidate?.note_title || ''} ${candidate?.note_path || ''}`.toLowerCase()
  let score = Number(candidate.note_score || 0) + scoreVisualCandidate(candidate)
  if (candidate.source_channel === 'youtube-like') score += 18
  if (candidate.source_channel === 'nts-like') score += 16
  if (candidate.source_channel === 'chrome-bookmark') score += 12
  if (candidate.source_channel === 'twitter-bookmark') score += 4
  if (candidate.source_channel === 'youtube-like' && isYouTubeVideoUrl(candidate.url)) score += 36
  if (candidate.source_channel === 'twitter-bookmark' && classifySource(candidate.url).source_type === 'tweet') score += 14
  if (candidate.source_channel === 'twitter-bookmark' && isTwitterMediaUrl(candidate.url)) score -= 10
  if (candidate.source_channel === 'nts-like' && isYouTubeVideoUrl(candidate.url)) score += 30
  if (candidate.source_channel === 'nts-like' && isBandcampStreamingSourceUrl(candidate.url)) score += 12
  if (candidate.source_channel === 'nts-like' && isSoundCloudStreamingSourceUrl(candidate.url)) score += 6
  if (/daily frontpage (?:direct )?renderable seed|recovery seed/.test(text)) score -= 18
  if (/emergency directly renderable raster|source-window fill only/.test(text)) score -= 22
  if (recentSourceKeys.has(sourceCandidateKey(candidate))) score -= 80
  return score
}

export function selectSourceCandidatesForInspection(signalHarvest, maxSources, { recentSourceKeys = new Set() } = {}) {
  const selected = []
  const seen = new Set()
  const domainCounts = new Map()
  const noteCounts = new Map()
  const add = (candidate, { allowRecent = false, domainLimit = 2, noteLimit = 2 } = {}) => {
    const key = sourceCandidateKey(candidate)
    if (!key || seen.has(key)) return
    if (!allowRecent && recentSourceKeys.has(key)) return
    const domainKey = hostnameForUrl(candidate.url) || 'unknown'
    const noteKey = noteSelectionKey(candidate, key)
    if ((domainCounts.get(domainKey) || 0) >= domainLimit) return
    if ((noteCounts.get(noteKey) || 0) >= noteLimit) return
    seen.add(key)
    domainCounts.set(domainKey, (domainCounts.get(domainKey) || 0) + 1)
    noteCounts.set(noteKey, (noteCounts.get(noteKey) || 0) + 1)
    selected.push(candidate)
  }

  const ranked = [...signalHarvest.source_candidates]
    .map((candidate) => ({ candidate, score: sourceSelectionScore(candidate, recentSourceKeys) }))
    .filter((entry) => Number.isFinite(entry.score))
    .sort((left, right) => right.score - left.score)

  for (const channel of SOURCE_CHANNELS) {
    for (const { candidate } of ranked.filter((entry) => entry.candidate.source_channel === channel).slice(0, 8)) {
      if (selected.length >= maxSources) break
      add(candidate, { allowRecent: false, domainLimit: 3, noteLimit: 4 })
    }
  }

  for (const { candidate } of ranked.filter((entry) => (
    entry.candidate.source_channel === 'nts-like'
    && !isYouTubeVideoUrl(entry.candidate.url)
    && (isBandcampStreamingSourceUrl(entry.candidate.url) || isSoundCloudStreamingSourceUrl(entry.candidate.url))
  )).slice(0, 10)) {
    if (selected.length >= maxSources) break
    add(candidate, { allowRecent: false, domainLimit: 4, noteLimit: 8 })
  }

  for (const { candidate } of ranked) {
    if (selected.length >= maxSources) break
    add(candidate, { allowRecent: false, domainLimit: 2, noteLimit: 1 })
  }

  for (const { candidate } of ranked) {
    if (selected.length >= maxSources) break
    add(candidate, { allowRecent: true, domainLimit: 3, noteLimit: 3 })
  }

  return selected
}

function sourceUrlsForScoring(source) {
  return [source?.url, source?.source_url, source?.final_url].filter(Boolean)
}

function isTwitterMediaUrl(url) {
  const host = hostnameForUrl(url)
  return host === 'pbs.twimg.com' || host === 'video.twimg.com'
}

export function sourceContentScore(source, recentSourceKeys = new Set()) {
  if (!isAllowedInspectedSource(source)) return Number.NEGATIVE_INFINITY
  if (recentSourceKeys.has(sourceContentKey(source))) return Number.NEGATIVE_INFINITY
  const sourceUrls = sourceUrlsForScoring(source)
  if (source.source_channel === 'twitter-bookmark' && sourceUrls.some(isTwitterMediaUrl)) return Number.NEGATIVE_INFINITY
  let score = Number(source.note_score || 0) / 2
  if (source.image_url && !isLowValueVisualImage(source.image_url)) score += 12
  if (isDirectRasterImageUrl(source.url) || isDirectRasterImageUrl(source.final_url)) score += 8
  if (source.fetch_status === 'browser-harness' || source.fetch_status === 'fetch-ok') score += 4
  if (['youtube', 'tweet', 'github', 'nts', 'audio'].includes(source.source_type)) score += 3
  if (source.source_channel === 'youtube-like') score += 18
  if (source.source_channel === 'nts-like') score += 16
  if (source.source_channel === 'chrome-bookmark') score += 12
  if (source.source_channel === 'twitter-bookmark') score += 4
  if (source.source_channel === 'twitter-bookmark' && source.source_type === 'tweet') score += 10
  if (source.source_channel === 'twitter-bookmark' && sourceUrls.some(isTwitterMediaUrl)) score -= 8
  if (source.source_channel === 'nts-like' && sourceUrls.some(isYouTubeVideoUrl)) score += 30
  if (source.source_channel === 'nts-like' && sourceUrls.some(isBandcampStreamingSourceUrl)) score += 12
  if (source.source_channel === 'nts-like' && sourceUrls.some(isSoundCloudStreamingSourceUrl)) score += 6
  return score
}

function noteHasDirectMediaForSource(source, signalHarvest) {
  if (!signalHarvest?.notes_selected) return false
  const lookupValues = new Set([source.note_id, source.note_path, source.note_title].filter(Boolean))
  const note = signalHarvest.notes_selected.find((candidate) => (
    lookupValues.has(candidate.id) || lookupValues.has(candidate.path) || lookupValues.has(candidate.title)
  ))
  return Boolean(note?.urls?.some((url) => isDirectRasterImageUrl(url) && !isLowValueVisualImage(url)))
}

export function sourceHasRenderableCardSurface(source, signalHarvest = null) {
  if (!isAllowedInspectedSource(source)) return false
  const sourceUrls = [source.url, source.source_url, source.final_url].filter(Boolean)
  if (source.source_channel === 'twitter-bookmark' && sourceUrls.some(isTwitterMediaUrl)) return false
  if (sourceUrls.some((url) => youtubeId(url))) return source.youtube_embed_status !== 'unavailable' && source.embed_status !== 'unavailable'
  if (sourceUrls.some(isDirectRasterImageUrl)) return true
  if (source.image_url && !isLowValueVisualImage(source.image_url)) return true
  if (classifySource(source.url || source.source_url || '').source_type === 'tweet' && noteHasDirectMediaForSource(source, signalHarvest)) return true
  return false
}

export function selectContentSources(
  sources,
  {
    recentSourceKeys = new Set(),
    maxItems = DEFAULT_MAX_CONTENT_ITEMS,
    targetItems = DEFAULT_TARGET_CONTENT_ITEMS,
    signalHarvest = null,
  } = {},
) {
  const duplicateGroupKey = (source) => {
    if (source.source_channel === 'twitter-bookmark') {
      return ['twitter-bookmark', source.note_id || source.note_title || source.title].filter(Boolean).join(':')
    }
    return null
  }
  const ranked = [...sources]
    .filter((source) => source?.url)
    .filter((source) => sourceHasRenderableCardSurface(source, signalHarvest))
    .map((source) => ({ source, score: sourceContentScore(source, recentSourceKeys) }))
    .filter((entry) => Number.isFinite(entry.score))
    .sort((left, right) => right.score - left.score)

  const selected = []
  const seenKeys = new Set()
  const seenGroups = new Set()
  const domainCounts = new Map()
  const noteCounts = new Map()
  const add = ({ source }, { allowRecent = false, domainLimit = 2, noteLimit = 2 } = {}) => {
    if (selected.length >= maxItems) return
    const key = sourceContentKey(source)
    if (!key || seenKeys.has(key)) return
    const groupKey = duplicateGroupKey(source)
    if (groupKey && seenGroups.has(groupKey)) return
    if (!allowRecent && recentSourceKeys.has(key)) return
    const domainKey = sourceDomainKey(source) || 'unknown'
    const noteKey = noteSelectionKey(source, key)
    if ((domainCounts.get(domainKey) || 0) >= domainLimit) return
    if ((noteCounts.get(noteKey) || 0) >= noteLimit) return
    seenKeys.add(key)
    if (groupKey) seenGroups.add(groupKey)
    domainCounts.set(domainKey, (domainCounts.get(domainKey) || 0) + 1)
    noteCounts.set(noteKey, (noteCounts.get(noteKey) || 0) + 1)
    selected.push(source)
  }

  for (const channel of SOURCE_CHANNELS) {
    for (const entry of ranked.filter(({ source }) => source.source_channel === channel).slice(0, channel === 'twitter-bookmark' ? 2 : 3)) {
      if (selected.length >= targetItems) break
      add(entry, { allowRecent: false, domainLimit: 3, noteLimit: 3 })
    }
  }

  for (const entry of ranked) {
    if (selected.length >= targetItems) break
    add(entry, { allowRecent: false, domainLimit: 2, noteLimit: 1 })
  }

  for (const entry of ranked) {
    if (selected.length >= maxItems) break
    add(entry, { allowRecent: false, domainLimit: 3, noteLimit: 3 })
  }

  return selected.slice(0, maxItems)
}
