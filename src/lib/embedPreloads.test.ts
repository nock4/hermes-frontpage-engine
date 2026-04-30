import { describe, expect, it } from 'vitest'

import type { SourceBindingRecord } from '../types/runtime'
import { collectEmbedPreloads } from './embedPreloads'

const baseBinding: SourceBindingRecord = {
  id: 'binding-1',
  artifact_id: 'artifact-1',
  source_type: 'article',
  source_url: 'https://example.com/story',
  window_type: 'web',
  hover_behavior: 'preview',
  click_behavior: 'pin-open',
  playback_persistence: false,
  fallback_type: 'rich-preview',
  title: 'Example binding',
  kicker: 'Scene detail',
  excerpt: 'Example excerpt',
}

describe('collectEmbedPreloads', () => {
  it('preloads every supported media type before any source window is open', () => {
    const embeds = collectEmbedPreloads({
      bindings: [
        {
          ...baseBinding,
          id: 'yt-1',
          source_type: 'youtube',
          source_url: 'https://www.youtube.com/watch?v=XUbG8jboh4M',
          window_type: 'video',
        },
        {
          ...baseBinding,
          id: 'tweet-1',
          source_type: 'social',
          source_url: 'https://x.com/garrytan/status/2044479509874020852',
          window_type: 'social',
          source_embed_html: '<blockquote class="twitter-tweet"><a href="https://x.com/garrytan/status/2044479509874020852"></a></blockquote>',
        },
        {
          ...baseBinding,
          id: 'soundcloud-1',
          source_type: 'audio',
          source_url: 'https://soundcloud.com/visible-cloaks/terrazzo',
          window_type: 'audio',
        },
        {
          ...baseBinding,
          id: 'image-1',
          source_image_url: 'https://images.example.com/story.jpg',
          source_image_alt: 'Story image',
        },
      ],
      reviewMode: 'live',
      openBindingIds: [],
    })

    expect(embeds.map((embed) => embed.kind)).toEqual(['youtube', 'tweet', 'soundcloud', 'image'])
  })

  it('dedupes identical media urls on the same page', () => {
    const embeds = collectEmbedPreloads({
      bindings: [
        {
          ...baseBinding,
          id: 'yt-1',
          source_type: 'youtube',
          source_url: 'https://www.youtube.com/watch?v=XUbG8jboh4M',
          window_type: 'video',
        },
        {
          ...baseBinding,
          id: 'yt-2',
          source_type: 'youtube',
          source_url: 'https://youtu.be/XUbG8jboh4M',
          window_type: 'video',
        },
        {
          ...baseBinding,
          id: 'image-1',
          source_image_url: 'https://images.example.com/story.jpg',
        },
        {
          ...baseBinding,
          id: 'image-2',
          source_image_url: 'https://images.example.com/story.jpg',
        },
      ],
      reviewMode: 'live',
      openBindingIds: [],
    })

    expect(embeds).toHaveLength(2)
    expect(embeds[0]?.kind).toBe('youtube')
    expect(embeds[1]?.kind).toBe('image')
  })

  it('drops private-host image preloads', () => {
    const embeds = collectEmbedPreloads({
      bindings: [
        {
          ...baseBinding,
          id: 'image-1',
          source_image_url: 'http://127.0.0.1:8080/private.jpg',
        },
      ],
      reviewMode: 'live',
      openBindingIds: [],
    })

    expect(embeds).toEqual([])
  })

  it('preloads tweet embeds from the validated tweet url instead of trusting raw embed html', () => {
    const embeds = collectEmbedPreloads({
      bindings: [
        {
          ...baseBinding,
          id: 'tweet-1',
          source_type: 'social',
          source_url: 'https://x.com/garrytan/status/2044479509874020852',
          window_type: 'social',
          source_embed_html: '<img src=x onerror=alert(1)><script>alert(1)</script>',
        },
      ],
      reviewMode: 'live',
      openBindingIds: [],
    })

    expect(embeds).toHaveLength(1)
    expect(embeds[0]?.kind).toBe('tweet')
    expect(embeds[0]?.srcDoc).toContain('https://x.com/garrytan/status/2044479509874020852')
    expect(embeds[0]?.srcDoc).not.toContain('onerror=alert(1)')
    expect(embeds[0]?.srcDoc).not.toContain('<script>alert(1)</script>')
  })

  it('turns off preload if a source window is already open', () => {
    const embeds = collectEmbedPreloads({
      bindings: [
        {
          ...baseBinding,
          id: 'yt-1',
          source_type: 'youtube',
          source_url: 'https://www.youtube.com/watch?v=XUbG8jboh4M',
          window_type: 'video',
        },
      ],
      reviewMode: 'live',
      openBindingIds: ['yt-1'],
    })

    expect(embeds).toEqual([])
  })
})
