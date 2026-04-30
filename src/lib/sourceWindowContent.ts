import type { SourceBindingRecord } from '../types/runtime'
import type { SourceWindowDescriptor } from '../types/sourceWindows'
import { sanitizeSourceUrl } from './sourceUrl'
import { getSourceWindowAccentTone } from './sourceWindowTone'

const getDomainLabel = (sourceUrl: string | null) => {
  if (!sourceUrl) return 'unbound source'
  return getHostname(sourceUrl) ?? 'linked source'
}

const getParsedSourceUrl = (sourceUrl: string | null) => {
  if (!sourceUrl) return null

  try {
    const url = new URL(sourceUrl)
    return {
      url,
      hostname: url.hostname.replace(/^www\./, ''),
      pathParts: url.pathname.split('/').filter(Boolean),
    }
  } catch {
    return null
  }
}

const getHostname = (sourceUrl: string | null) => getParsedSourceUrl(sourceUrl)?.hostname ?? null

const isYouTubeHostname = (hostname: string) => (
  hostname === 'youtube.com'
  || hostname === 'm.youtube.com'
  || hostname === 'music.youtube.com'
  || hostname === 'youtu.be'
  || hostname === 'youtube-nocookie.com'
)

const getPlatformLabel = (sourceUrl: string | null, fallback: string) => {
  const hostname = getHostname(sourceUrl)
  if (!hostname) return fallback
  if (hostname === 'soundcloud.com') return 'SoundCloud'
  if (hostname === 'bandcamp.com' || hostname.endsWith('.bandcamp.com')) return 'Bandcamp'
  if (isYouTubeHostname(hostname)) return 'YouTube'
  if (hostname === 'x.com' || hostname === 'twitter.com') return 'X'
  if (hostname === 'instagram.com') return 'Instagram'
  return fallback
}

const getSourceLabel = (sourceUrl: string | null) => {
  const parsed = getParsedSourceUrl(sourceUrl)
  if (!parsed) return undefined
  if ((parsed.hostname === 'x.com' || parsed.hostname === 'twitter.com') && parsed.pathParts[0]) {
    return `@${parsed.pathParts[0]}`
  }
  return undefined
}

const getSocialMetadata = (sourceUrl: string | null) => {
  if (!sourceUrl) return { sourceLabel: undefined, postLabel: undefined, byline: undefined }

  const parsed = getParsedSourceUrl(sourceUrl)
  if (!parsed) {
    return { sourceLabel: undefined, postLabel: undefined, byline: undefined, statusId: undefined, isTweet: false, isXArticle: false }
  }

  const isXDomain = parsed.hostname === 'x.com' || parsed.hostname === 'twitter.com'
  const handle = isXDomain && parsed.pathParts[0] ? `@${parsed.pathParts[0]}` : undefined
  const statusIndex = parsed.pathParts.findIndex((part) => part === 'status')
  const statusId = statusIndex >= 0 ? parsed.pathParts[statusIndex + 1] : undefined
  const isXArticle = isXDomain && parsed.pathParts[0] === 'i' && parsed.pathParts[1] === 'article'

  return {
    sourceLabel: isXArticle ? 'X article' : handle,
    postLabel: isXArticle ? 'Article' : statusId ? `Post ${statusId}` : undefined,
    byline: isXArticle ? 'Published on X' : handle ? `Posted by ${handle} on ${getPlatformLabel(sourceUrl, 'social')}` : undefined,
    statusId,
    isTweet: Boolean(isXDomain && handle && statusId),
    isXArticle,
  }
}

const getYouTubeVideoId = (sourceUrl: string | null) => {
  const parsed = getParsedSourceUrl(sourceUrl)
  if (!parsed) return null

  if (parsed.hostname === 'youtu.be') {
    return parsed.pathParts[0]?.trim() || null
  }

  if (isYouTubeHostname(parsed.hostname)) {
    if (parsed.url.pathname === '/watch') {
      return parsed.url.searchParams.get('v')?.trim() || null
    }

    if (['embed', 'shorts', 'live', 'v'].includes(parsed.pathParts[0] ?? '')) {
      return parsed.pathParts[1]?.trim() || null
    }
  }

  return null
}

export const getYouTubeThumbnailUrl = (sourceUrl: string | null) => {
  const videoId = getYouTubeVideoId(sourceUrl)
  return videoId ? `https://img.youtube.com/vi/${videoId}/hqdefault.jpg` : null
}

const toYouTubeEmbedUrl = (sourceUrl: string | null) => {
  const videoId = getYouTubeVideoId(sourceUrl)
  return videoId ? `https://www.youtube.com/embed/${videoId}?autoplay=1&rel=0` : null
}

const toSoundCloudEmbedUrl = (sourceUrl: string | null) => {
  if (getHostname(sourceUrl) !== 'soundcloud.com' || !sourceUrl) return null
  return `https://w.soundcloud.com/player/?url=${encodeURIComponent(sourceUrl)}&auto_play=false&hide_related=false&show_comments=false&show_user=true&show_reposts=false&visual=true`
}

const getBandcampMetadata = (sourceUrl: string | null) => {
  const parsed = getParsedSourceUrl(sourceUrl)
  if (!parsed || parsed.hostname === 'bandcamp.com' || !parsed.hostname.endsWith('.bandcamp.com') || !sourceUrl) return null

  return {
    sourceUrl,
    artistLabel: parsed.hostname.replace(/\.bandcamp\.com$/, ''),
    releasePath: parsed.url.pathname || '/',
  }
}

const isNtsUrl = (sourceUrl: string | null) => getHostname(sourceUrl) === 'nts.live'

const buildYouTubeDescriptor = (embedUrl: string, allowsPlaybackPersistence: boolean, domainLabel: string): SourceWindowDescriptor => ({
  kind: 'youtube-embed',
  embedUrl,
  allowsPlaybackPersistence,
  domainLabel,
  ctaLabel: 'Open on YouTube',
  platformLabel: 'YouTube',
  accentTone: 'video',
})

const buildYouTubeLinkoutDescriptor = (sourceUrl: string, allowsPlaybackPersistence: boolean, domainLabel: string): SourceWindowDescriptor => ({
  kind: 'youtube-linkout',
  sourceUrl,
  allowsPlaybackPersistence,
  domainLabel,
  ctaLabel: 'Watch on YouTube',
  platformLabel: 'YouTube',
  accentTone: 'video',
})

export const getSourceWindowDescriptor = (binding: SourceBindingRecord): SourceWindowDescriptor => {
  const sourceUrl = sanitizeSourceUrl(binding.source_url)
  const domainLabel = getDomainLabel(sourceUrl)
  const allowsPlaybackPersistence = binding.playback_persistence
  const accentTone = getSourceWindowAccentTone(binding)
  const youtubeEmbedUrl = toYouTubeEmbedUrl(sourceUrl)

  if (youtubeEmbedUrl && (binding.source_type === 'youtube' || binding.window_type === 'video' || binding.window_type === 'web')) {
    if ((binding.embed_status === 'unavailable' || binding.embed_status === 'processing') && sourceUrl) {
      return buildYouTubeLinkoutDescriptor(sourceUrl, allowsPlaybackPersistence, domainLabel)
    }

    return buildYouTubeDescriptor(youtubeEmbedUrl, allowsPlaybackPersistence, domainLabel)
  }

  if (binding.window_type === 'audio' || binding.source_type === 'nts' || binding.source_type === 'audio') {
    const soundcloudEmbedUrl = toSoundCloudEmbedUrl(sourceUrl)
    if (soundcloudEmbedUrl && binding.source_type !== 'nts') {
      const resolvedSourceUrl = sourceUrl ?? 'https://soundcloud.com'
      return {
        kind: 'soundcloud-embed',
        embedUrl: soundcloudEmbedUrl,
        sourceUrl: resolvedSourceUrl,
        allowsPlaybackPersistence,
        domainLabel,
        ctaLabel: 'Open track source',
        platformLabel: 'SoundCloud',
        accentTone,
      }
    }

    const bandcampMetadata = getBandcampMetadata(sourceUrl)
    if (bandcampMetadata && binding.source_type !== 'nts') {
      return {
        kind: 'bandcamp-card',
        sourceUrl: bandcampMetadata.sourceUrl,
        artistLabel: bandcampMetadata.artistLabel,
        releasePath: bandcampMetadata.releasePath,
        allowsPlaybackPersistence,
        domainLabel,
        ctaLabel: 'Open on Bandcamp',
        platformLabel: 'Bandcamp',
        accentTone,
      }
    }

    return {
      kind: 'audio-dock',
      streamUrl: sourceUrl,
      allowsPlaybackPersistence,
      domainLabel,
      ctaLabel: isNtsUrl(sourceUrl) || binding.source_type === 'nts' ? 'Resolved track source required' : 'Open track source',
      platformLabel: isNtsUrl(sourceUrl) || binding.source_type === 'nts' ? 'NTS signal' : getPlatformLabel(sourceUrl, 'Track source'),
      accentTone,
    }
  }

  if (binding.window_type === 'social' || binding.source_type === 'tweet') {
    const socialMetadata = getSocialMetadata(sourceUrl)
    if (sourceUrl && socialMetadata.isTweet) {
      return {
        kind: 'tweet-embed',
        sourceUrl,
        allowsPlaybackPersistence,
        domainLabel,
        ctaLabel: 'Open post',
        platformLabel: getPlatformLabel(sourceUrl, 'Social source'),
        sourceLabel: socialMetadata.sourceLabel ?? getSourceLabel(sourceUrl),
        postLabel: socialMetadata.postLabel,
        byline: socialMetadata.byline,
        accentTone,
      }
    }

    if (sourceUrl && socialMetadata.isXArticle) {
      return {
        kind: 'rich-preview',
        sourceUrl,
        allowsPlaybackPersistence,
        domainLabel,
        ctaLabel: 'Read article',
        platformLabel: 'X article',
        accentTone: 'reading',
      }
    }

    return {
      kind: 'social-card',
      sourceUrl,
      allowsPlaybackPersistence,
      domainLabel,
      ctaLabel: 'Open post',
      platformLabel: getPlatformLabel(sourceUrl, 'Social source'),
      sourceLabel: socialMetadata.sourceLabel ?? getSourceLabel(sourceUrl),
      postLabel: socialMetadata.postLabel,
      byline: socialMetadata.byline,
      accentTone,
    }
  }

  return {
    kind: 'rich-preview',
    sourceUrl,
    allowsPlaybackPersistence,
    domainLabel,
    ctaLabel: 'Open source',
    platformLabel: getPlatformLabel(sourceUrl, 'Web source'),
    accentTone,
  }
}
