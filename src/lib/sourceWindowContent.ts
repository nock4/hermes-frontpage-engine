import type { SourceBindingRecord } from '../types/runtime'

export type SourceAccentTone = 'video' | 'audio' | 'social' | 'reading'

export type SourceWindowDescriptor =
  | {
      kind: 'youtube-embed'
      embedUrl: string
      allowsPlaybackPersistence: boolean
      domainLabel: string
      ctaLabel: string
      platformLabel: string
      accentTone: SourceAccentTone
    }
  | {
      kind: 'soundcloud-embed'
      embedUrl: string
      sourceUrl: string
      allowsPlaybackPersistence: boolean
      domainLabel: string
      ctaLabel: string
      platformLabel: string
      accentTone: SourceAccentTone
    }
  | {
      kind: 'bandcamp-card'
      sourceUrl: string
      artistLabel: string
      releasePath: string
      allowsPlaybackPersistence: boolean
      domainLabel: string
      ctaLabel: string
      platformLabel: string
      accentTone: SourceAccentTone
    }
  | {
      kind: 'audio-dock'
      streamUrl: string | null
      allowsPlaybackPersistence: boolean
      domainLabel: string
      ctaLabel: string
      platformLabel: string
      accentTone: SourceAccentTone
    }
  | {
      kind: 'social-card'
      sourceUrl: string | null
      allowsPlaybackPersistence: boolean
      domainLabel: string
      ctaLabel: string
      platformLabel: string
      sourceLabel?: string
      postLabel?: string
      byline?: string
      accentTone: SourceAccentTone
    }
  | {
      kind: 'rich-preview'
      sourceUrl: string | null
      allowsPlaybackPersistence: boolean
      domainLabel: string
      ctaLabel: string
      platformLabel: string
      accentTone: SourceAccentTone
    }

const getDomainLabel = (sourceUrl: string | null) => {
  if (!sourceUrl) return 'unbound source'

  try {
    return new URL(sourceUrl).hostname.replace(/^www\./, '')
  } catch {
    return 'linked source'
  }
}

const getPlatformLabel = (sourceUrl: string | null, fallback: string) => {
  if (!sourceUrl) return fallback

  try {
    const hostname = new URL(sourceUrl).hostname.replace(/^www\./, '')
    if (hostname === 'soundcloud.com') return 'SoundCloud'
    if (hostname === 'bandcamp.com' || hostname.endsWith('.bandcamp.com')) return 'Bandcamp'
    if (hostname === 'youtube.com' || hostname === 'youtu.be' || hostname === 'm.youtube.com') return 'YouTube'
    if (hostname === 'x.com' || hostname === 'twitter.com') return 'X'
    if (hostname === 'instagram.com') return 'Instagram'
    return fallback
  } catch {
    return fallback
  }
}

const getSourceLabel = (sourceUrl: string | null) => {
  if (!sourceUrl) return undefined

  try {
    const url = new URL(sourceUrl)
    const hostname = url.hostname.replace(/^www\./, '')
    if ((hostname === 'x.com' || hostname === 'twitter.com') && url.pathname.split('/').filter(Boolean)[0]) {
      return `@${url.pathname.split('/').filter(Boolean)[0]}`
    }
    return undefined
  } catch {
    return undefined
  }
}

const getSocialMetadata = (sourceUrl: string | null) => {
  if (!sourceUrl) return { sourceLabel: undefined, postLabel: undefined, byline: undefined }

  try {
    const url = new URL(sourceUrl)
    const hostname = url.hostname.replace(/^www\./, '')
    const parts = url.pathname.split('/').filter(Boolean)
    const handle = (hostname === 'x.com' || hostname === 'twitter.com') && parts[0] ? `@${parts[0]}` : undefined
    const statusIndex = parts.findIndex((part) => part === 'status')
    const statusId = statusIndex >= 0 ? parts[statusIndex + 1] : undefined

    return {
      sourceLabel: handle,
      postLabel: statusId ? `Post ${statusId}` : undefined,
      byline: handle ? `Posted by ${handle} on ${getPlatformLabel(sourceUrl, 'social')}` : undefined,
    }
  } catch {
    return { sourceLabel: undefined, postLabel: undefined, byline: undefined }
  }
}

const toYouTubeEmbedUrl = (sourceUrl: string | null) => {
  if (!sourceUrl) return null

  try {
    const url = new URL(sourceUrl)
    const hostname = url.hostname.replace(/^www\./, '')

    if (hostname === 'youtu.be') {
      const videoId = url.pathname.replace(/^\//, '').trim()
      return videoId ? `https://www.youtube.com/embed/${videoId}?autoplay=1&rel=0` : null
    }

    if (hostname === 'youtube.com' || hostname === 'm.youtube.com') {
      if (url.pathname === '/watch') {
        const videoId = url.searchParams.get('v')
        return videoId ? `https://www.youtube.com/embed/${videoId}?autoplay=1&rel=0` : null
      }

      if (url.pathname.startsWith('/embed/')) {
        const videoId = url.pathname.split('/').pop()?.trim()
        return videoId ? `https://www.youtube.com/embed/${videoId}?autoplay=1&rel=0` : null
      }
    }
  } catch {
    return null
  }

  return null
}

const toSoundCloudEmbedUrl = (sourceUrl: string | null) => {
  if (!sourceUrl) return null

  try {
    const url = new URL(sourceUrl)
    if (url.hostname.replace(/^www\./, '') !== 'soundcloud.com') return null
    return `https://w.soundcloud.com/player/?url=${encodeURIComponent(sourceUrl)}&auto_play=false&hide_related=false&show_comments=false&show_user=true&show_reposts=false&visual=true`
  } catch {
    return null
  }
}

const getBandcampMetadata = (sourceUrl: string | null) => {
  if (!sourceUrl) return null

  try {
    const url = new URL(sourceUrl)
    const hostname = url.hostname.replace(/^www\./, '')
    if (hostname === 'bandcamp.com' || !hostname.endsWith('.bandcamp.com')) return null

    return {
      sourceUrl,
      artistLabel: hostname.replace(/\.bandcamp\.com$/, ''),
      releasePath: url.pathname || '/',
    }
  } catch {
    return null
  }
}

const isNtsUrl = (sourceUrl: string | null) => {
  if (!sourceUrl) return false

  try {
    const url = new URL(sourceUrl)
    return url.hostname.replace(/^www\./, '') === 'nts.live'
  } catch {
    return false
  }
}

export const getSourceWindowDescriptor = (binding: SourceBindingRecord): SourceWindowDescriptor => {
  const domainLabel = getDomainLabel(binding.source_url)
  const allowsPlaybackPersistence = binding.playback_persistence

  if (binding.source_type === 'youtube' || binding.window_type === 'video') {
    const embedUrl = toYouTubeEmbedUrl(binding.source_url)
    if (embedUrl) {
      return {
        kind: 'youtube-embed',
        embedUrl,
        allowsPlaybackPersistence,
        domainLabel,
        ctaLabel: 'Open on YouTube',
        platformLabel: 'YouTube',
        accentTone: 'video',
      }
    }
  }

  if (binding.window_type === 'audio' || binding.source_type === 'nts' || binding.source_type === 'audio') {
    const soundcloudEmbedUrl = toSoundCloudEmbedUrl(binding.source_url)
    if (soundcloudEmbedUrl && binding.source_type !== 'nts') {
      return {
        kind: 'soundcloud-embed',
        embedUrl: soundcloudEmbedUrl,
        sourceUrl: binding.source_url ?? 'https://soundcloud.com',
        allowsPlaybackPersistence,
        domainLabel,
        ctaLabel: 'Open track source',
        platformLabel: 'SoundCloud',
        accentTone: 'audio',
      }
    }

    const bandcampMetadata = getBandcampMetadata(binding.source_url)
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
        accentTone: 'audio',
      }
    }

    return {
      kind: 'audio-dock',
      streamUrl: binding.source_url,
      allowsPlaybackPersistence,
      domainLabel,
      ctaLabel: isNtsUrl(binding.source_url) || binding.source_type === 'nts' ? 'Resolved track source required' : 'Open track source',
      platformLabel: isNtsUrl(binding.source_url) || binding.source_type === 'nts' ? 'NTS signal' : getPlatformLabel(binding.source_url, 'Track source'),
      accentTone: 'audio',
    }
  }

  if (binding.window_type === 'social' || binding.source_type === 'tweet') {
    const socialMetadata = getSocialMetadata(binding.source_url)
    return {
      kind: 'social-card',
      sourceUrl: binding.source_url,
      allowsPlaybackPersistence,
      domainLabel,
      ctaLabel: 'Open post',
      platformLabel: getPlatformLabel(binding.source_url, 'Social source'),
      sourceLabel: socialMetadata.sourceLabel ?? getSourceLabel(binding.source_url),
      postLabel: socialMetadata.postLabel,
      byline: socialMetadata.byline,
      accentTone: 'social',
    }
  }

  return {
    kind: 'rich-preview',
    sourceUrl: binding.source_url,
    allowsPlaybackPersistence,
    domainLabel,
    ctaLabel: 'Open source',
    platformLabel: getPlatformLabel(binding.source_url, 'Web source'),
    accentTone: 'reading',
  }
}

export const getActiveBindingAmbienceMode = (binding: SourceBindingRecord | null): string => {
  if (!binding) return 'ambient-idle'
  const descriptor = getSourceWindowDescriptor(binding)
  if (descriptor.accentTone === 'video') return 'ambient-video'
  if (descriptor.accentTone === 'audio') return 'ambient-audio'
  if (descriptor.accentTone === 'social') return 'ambient-social'
  return 'ambient-reading'
}
