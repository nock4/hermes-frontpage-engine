import type { SourceBindingRecord } from '../types/runtime'
import { getSourceWindowDescriptor } from './sourceWindowContent'
import { sanitizeSourceImageUrl } from './sourceUrl'
import { getTweetEmbedUrl } from './tweetEmbed'

export type EmbedPreload = {
  id: string
  kind: 'youtube' | 'tweet' | 'soundcloud' | 'bandcamp' | 'image'
  src?: string
  srcDoc?: string
  title: string
}

function getYouTubePreloadUrl(embedUrl: string) {
  const url = new URL(embedUrl)
  url.searchParams.set('autoplay', '0')
  url.searchParams.set('mute', '1')
  url.searchParams.set('controls', '0')
  url.searchParams.set('playsinline', '1')
  return url.toString()
}

interface CollectEmbedPreloadsOptions {
  bindings: SourceBindingRecord[]
  reviewMode: 'live' | 'debug' | 'clickable' | 'solo'
  openBindingIds: string[]
}

export function collectEmbedPreloads({ bindings, reviewMode, openBindingIds }: CollectEmbedPreloadsOptions): EmbedPreload[] {
  if (reviewMode !== 'live' || openBindingIds.length > 0) return []

  const seen = new Set<string>()
  const preloads: EmbedPreload[] = []

  for (const binding of bindings) {
    const descriptor = getSourceWindowDescriptor(binding)

    if (descriptor.kind === 'youtube-embed') {
      const src = getYouTubePreloadUrl(descriptor.embedUrl)
      const key = `youtube:${src}`
      if (seen.has(key)) continue
      seen.add(key)
      preloads.push({ id: binding.id, kind: 'youtube', src, title: binding.title })
      continue
    }

    if (descriptor.kind === 'tweet-embed') {
      const src = getTweetEmbedUrl(descriptor.sourceUrl)
      if (!src) continue
      const key = `tweet:${src}`
      if (seen.has(key)) continue
      seen.add(key)
      preloads.push({ id: binding.id, kind: 'tweet', src, title: binding.title })
      continue
    }

    if (descriptor.kind === 'soundcloud-embed' || descriptor.kind === 'bandcamp-embed') {
      const key = `${descriptor.kind}:${descriptor.embedUrl}`
      if (seen.has(key)) continue
      seen.add(key)
      preloads.push({ id: binding.id, kind: descriptor.kind === 'bandcamp-embed' ? 'bandcamp' : 'soundcloud', src: descriptor.embedUrl, title: binding.title })
    }

    const sourceImageUrl = sanitizeSourceImageUrl(binding.source_image_url)
    if (sourceImageUrl) {
      const key = `image:${sourceImageUrl}`
      if (seen.has(key)) continue
      seen.add(key)
      preloads.push({ id: `${binding.id}-image`, kind: 'image', src: sourceImageUrl, title: binding.title })
    }
  }

  return preloads
}
