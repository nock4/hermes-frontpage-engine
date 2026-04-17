import type { SourceBindingRecord } from '../types/runtime'

export type SourceWindowDescriptor =
  | {
      kind: 'youtube-embed'
      embedUrl: string
      allowsPlaybackPersistence: boolean
      domainLabel: string
      ctaLabel: string
    }
  | {
      kind: 'nts-embed'
      embedUrl: string
      allowsPlaybackPersistence: boolean
      domainLabel: string
      ctaLabel: string
    }
  | {
      kind: 'audio-dock'
      streamUrl: string | null
      allowsPlaybackPersistence: boolean
      domainLabel: string
      ctaLabel: string
    }
  | {
      kind: 'social-card'
      sourceUrl: string | null
      allowsPlaybackPersistence: boolean
      domainLabel: string
      ctaLabel: string
    }
  | {
      kind: 'rich-preview'
      sourceUrl: string | null
      allowsPlaybackPersistence: boolean
      domainLabel: string
      ctaLabel: string
    }

const getDomainLabel = (sourceUrl: string | null) => {
  if (!sourceUrl) return 'unbound source'

  try {
    return new URL(sourceUrl).hostname.replace(/^www\./, '')
  } catch {
    return 'linked source'
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
      }
    }
  }

  if ((binding.window_type === 'audio' || binding.source_type === 'nts') && isNtsUrl(binding.source_url)) {
    return {
      kind: 'nts-embed',
      embedUrl: binding.source_url ?? 'https://www.nts.live/',
      allowsPlaybackPersistence,
      domainLabel,
      ctaLabel: 'Open on NTS',
    }
  }

  if (binding.window_type === 'audio' || binding.source_type === 'nts') {
    return {
      kind: 'audio-dock',
      streamUrl: binding.source_url,
      allowsPlaybackPersistence,
      domainLabel,
      ctaLabel: 'Open audio source',
    }
  }

  if (binding.window_type === 'social' || binding.source_type === 'tweet') {
    return {
      kind: 'social-card',
      sourceUrl: binding.source_url,
      allowsPlaybackPersistence,
      domainLabel,
      ctaLabel: 'Open post',
    }
  }

  return {
    kind: 'rich-preview',
    sourceUrl: binding.source_url,
    allowsPlaybackPersistence,
    domainLabel,
    ctaLabel: 'Open source',
  }
}
