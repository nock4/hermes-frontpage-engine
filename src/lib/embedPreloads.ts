import type { SourceBindingRecord } from '../types/runtime'
import { getSourceWindowDescriptor } from './sourceWindowContent'
import { sanitizeSourceImageUrl } from './sourceUrl'
import { getTweetEmbedSrcDoc } from './tweetEmbed'

export type EmbedPreload = {
  id: string
  kind: 'youtube' | 'tweet' | 'soundcloud' | 'image'
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
      const srcDoc = getTweetEmbedSrcDoc(descriptor.sourceUrl)
      const key = `tweet:${descriptor.sourceUrl}`
      if (seen.has(key)) continue
      seen.add(key)
      preloads.push({ id: binding.id, kind: 'tweet', srcDoc, title: binding.title })
      continue
    }

    if (descriptor.kind === 'soundcloud-embed') {
      const key = `soundcloud:${descriptor.embedUrl}`
      if (seen.has(key)) continue
      seen.add(key)
      preloads.push({ id: binding.id, kind: 'soundcloud', src: descriptor.embedUrl, title: binding.title })
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
