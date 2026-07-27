import {
  isBandcampStreamingSourceUrl,
  isSoundCloudStreamingSourceUrl,
  isYouTubeVideoUrl,
} from './source-url-policy.mjs'

function isDirectRasterImageUrl(sourceUrl) {
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

export function classifyMediaUrl(sourceUrl) {
  try {
    const url = new URL(sourceUrl)
    const host = url.hostname.replace(/^www\./, '').toLowerCase()
    const pathname = url.pathname.toLowerCase()

    if (host === 'youtu.be' || host.endsWith('youtube.com') || host === 'youtube-nocookie.com') {
      if (isYouTubeVideoUrl(sourceUrl)) {
        return { provider: 'youtube', media_class: 'youtube-video', source_type: 'youtube', window_type: 'video', embed_strategy: 'native-iframe' }
      }
      if (url.searchParams.has('list') || pathname.startsWith('/playlist')) {
        return { provider: 'youtube', media_class: 'youtube-playlist', source_type: 'article', window_type: 'web', embed_strategy: 'web-card' }
      }
      return { provider: 'youtube', media_class: 'youtube-page', source_type: 'article', window_type: 'web', embed_strategy: 'web-card' }
    }

    if (host === 'x.com' || host === 'twitter.com' || host === 'mobile.twitter.com' || host === 'mobile.x.com') {
      if (/\/status(?:es)?\//.test(pathname)) return { provider: 'x', media_class: 'tweet', source_type: 'tweet', window_type: 'social', embed_strategy: 'native-iframe-or-media-first' }
      return { provider: 'x', media_class: 'x-page', source_type: 'article', window_type: 'web', embed_strategy: 'web-card' }
    }

    if (host === 'pbs.twimg.com' || host === 'video.twimg.com') {
      return { provider: 'x-cdn', media_class: 'tweet-raw-media', source_type: 'article', window_type: 'image', embed_strategy: 'never-primary-content-source' }
    }

    if (host.includes('nts.live')) {
      return { provider: 'nts', media_class: 'nts-show', source_type: 'nts', window_type: 'audio', embed_strategy: 'native-or-audio-card' }
    }

    if (isBandcampStreamingSourceUrl(sourceUrl)) {
      return { provider: 'bandcamp', media_class: pathname.startsWith('/track/') ? 'bandcamp-track' : 'bandcamp-album', source_type: 'audio', window_type: 'audio', embed_strategy: 'native-iframe' }
    }

    if (isSoundCloudStreamingSourceUrl(sourceUrl)) {
      return { provider: 'soundcloud', media_class: 'soundcloud-track', source_type: 'audio', window_type: 'audio', embed_strategy: 'native-iframe' }
    }

    if (isDirectRasterImageUrl(sourceUrl)) {
      return { provider: host, media_class: 'direct-raster-image', source_type: 'image', window_type: 'image', embed_strategy: 'image' }
    }

    if (host.includes('github.com')) return { provider: 'github', media_class: 'github-page', source_type: 'github', window_type: 'web', embed_strategy: 'web-card' }

    return { provider: host || 'unknown', media_class: 'web-page', source_type: 'article', window_type: 'web', embed_strategy: 'web-card' }
  } catch {
    return { provider: 'unknown', media_class: 'invalid-url', source_type: 'web', window_type: 'web', embed_strategy: 'web-card' }
  }
}
