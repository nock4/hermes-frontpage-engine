import { describe, expect, it } from 'vitest'
import type { SourceBindingRecord } from '../types/runtime'
import { getSourceWindowDescriptor } from './sourceWindowContent'
import { getActiveBindingAmbienceMode } from './sourceWindowTone'
import { sanitizeSourceUrl } from './sourceUrl'

const makeBinding = (overrides: Partial<SourceBindingRecord> = {}): SourceBindingRecord => ({
  id: 'binding-1',
  artifact_id: 'artifact-1',
  source_type: 'article',
  source_url: 'https://example.com/article',
  window_type: 'web',
  hover_behavior: 'preview',
  click_behavior: 'pin-open',
  playback_persistence: false,
  fallback_type: 'rich-preview',
  title: 'Example article',
  kicker: 'Article',
  excerpt: 'Example excerpt',
  ...overrides,
})

describe('getSourceWindowDescriptor', () => {
  it('converts YouTube watch URLs into embed URLs', () => {
    const descriptor = getSourceWindowDescriptor(
      makeBinding({
        source_type: 'youtube',
        source_url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=12s',
        window_type: 'video',
        playback_persistence: true,
      }),
    )

    expect(descriptor.kind).toBe('youtube-embed')
    if (descriptor.kind !== 'youtube-embed') throw new Error('expected youtube descriptor')
    expect(descriptor.embedUrl).toBe('https://www.youtube.com/embed/dQw4w9WgXcQ?autoplay=1&rel=0')
    expect(descriptor.allowsPlaybackPersistence).toBe(true)
  })

  it('treats youtube urls as embeddable even when the binding metadata still says web fallback', () => {
    const descriptor = getSourceWindowDescriptor(
      makeBinding({
        source_type: 'concept-note',
        source_url: 'https://www.youtube.com/watch?v=7Ul_1yuxEVs',
        window_type: 'web',
      }),
    )

    expect(descriptor.kind).toBe('youtube-embed')
    if (descriptor.kind !== 'youtube-embed') throw new Error('expected youtube descriptor')
    expect(descriptor.platformLabel).toBe('YouTube')
    expect(descriptor.embedUrl).toBe('https://www.youtube.com/embed/7Ul_1yuxEVs?autoplay=1&rel=0')
  })

  it('uses provider-native detection for YouTube shorts, live, and music URLs', () => {
    const cases = [
      ['https://www.youtube.com/shorts/abc123XYZ00?feature=share', 'https://www.youtube.com/embed/abc123XYZ00?autoplay=1&rel=0'],
      ['https://www.youtube.com/live/live123XYZ0?si=abc', 'https://www.youtube.com/embed/live123XYZ0?autoplay=1&rel=0'],
      ['https://music.youtube.com/watch?v=music123XYZ', 'https://www.youtube.com/embed/music123XYZ?autoplay=1&rel=0'],
    ]

    for (const [sourceUrl, expectedEmbedUrl] of cases) {
      const descriptor = getSourceWindowDescriptor(
        makeBinding({
          source_type: 'concept-note',
          source_url: sourceUrl,
          window_type: 'web',
        }),
      )

      expect(descriptor.kind).toBe('youtube-embed')
      if (descriptor.kind !== 'youtube-embed') throw new Error('expected youtube descriptor')
      expect(descriptor.embedUrl).toBe(expectedEmbedUrl)
    }
  })

  it('uses source-truth YouTube linkout when a binding is marked unavailable for native embed', () => {
    const descriptor = getSourceWindowDescriptor(
      makeBinding({
        source_type: 'youtube',
        source_url: 'https://youtube.com/watch?v=YEgmpe8nToU',
        window_type: 'video',
        embed_status: 'unavailable',
      }),
    )

    expect(descriptor.kind).toBe('youtube-linkout')
    if (descriptor.kind !== 'youtube-linkout') throw new Error('expected youtube linkout descriptor')
    expect(descriptor.platformLabel).toBe('YouTube')
    expect(descriptor.sourceUrl).toBe('https://youtube.com/watch?v=YEgmpe8nToU')
    expect(descriptor.ctaLabel).toBe('Watch on YouTube')
  })

  it('uses source-truth YouTube linkout when a binding is still processing for native embed', () => {
    const descriptor = getSourceWindowDescriptor(
      makeBinding({
        source_type: 'youtube',
        source_url: 'https://youtube.com/watch?v=5qap5aO4i9A',
        window_type: 'video',
        embed_status: 'processing',
      }),
    )

    expect(descriptor.kind).toBe('youtube-linkout')
    if (descriptor.kind !== 'youtube-linkout') throw new Error('expected youtube linkout descriptor')
    expect(descriptor.sourceUrl).toBe('https://youtube.com/watch?v=5qap5aO4i9A')
  })

  it('does not create a special embed path for nts.live show URLs', () => {
    const descriptor = getSourceWindowDescriptor(
      makeBinding({
        source_type: 'nts',
        source_url: 'https://www.nts.live/shows/test-show',
        window_type: 'audio',
        playback_persistence: true,
      }),
    )

    expect(descriptor.kind).toBe('audio-dock')
    if (descriptor.kind !== 'audio-dock') throw new Error('expected audio dock descriptor')
    expect(descriptor.streamUrl).toBe('https://www.nts.live/shows/test-show')
    expect(descriptor.ctaLabel).toBe('Resolved track source required')
    expect(descriptor.allowsPlaybackPersistence).toBe(true)
  })

  it('uses a SoundCloud embed path for resolved track sources when available', () => {
    const descriptor = getSourceWindowDescriptor(
      makeBinding({
        source_type: 'audio',
        source_url: 'https://soundcloud.com/forss/flickermood',
        window_type: 'audio',
        playback_persistence: true,
      }),
    )

    expect(descriptor.kind).toBe('soundcloud-embed')
    if (descriptor.kind !== 'soundcloud-embed') throw new Error('expected soundcloud descriptor')
    expect(descriptor.platformLabel).toBe('SoundCloud')
    expect(descriptor.embedUrl).toContain('w.soundcloud.com/player/')
    expect(descriptor.embedUrl).toContain(encodeURIComponent('https://soundcloud.com/forss/flickermood'))
    expect(descriptor.ctaLabel).toBe('Open track source')
    expect(descriptor.accentTone).toBe('audio')
  })

  it('uses a provider-aware bandcamp card for resolved track sources when no direct embed path exists', () => {
    const descriptor = getSourceWindowDescriptor(
      makeBinding({
        source_type: 'audio',
        source_url: 'https://noproblematapes.bandcamp.com/track/example-track',
        window_type: 'audio',
        playback_persistence: true,
      }),
    )

    expect(descriptor.kind).toBe('bandcamp-card')
    if (descriptor.kind !== 'bandcamp-card') throw new Error('expected bandcamp descriptor')
    expect(descriptor.platformLabel).toBe('Bandcamp')
    expect(descriptor.artistLabel).toBe('noproblematapes')
    expect(descriptor.releasePath).toBe('/track/example-track')
    expect(descriptor.ctaLabel).toBe('Open on Bandcamp')
    expect(descriptor.accentTone).toBe('audio')
  })

  it('adds richer provenance fields for X links', () => {
    const descriptor = getSourceWindowDescriptor(
      makeBinding({
        source_type: 'tweet',
        source_url: 'https://x.com/nick/status/123',
        window_type: 'social',
      }),
    )

    expect(descriptor.kind).toBe('tweet-embed')
    if (descriptor.kind !== 'tweet-embed') throw new Error('expected tweet descriptor')
    expect(descriptor.domainLabel).toBe('x.com')
    expect(descriptor.platformLabel).toBe('X')
    expect(descriptor.sourceLabel).toBe('@nick')
    expect(descriptor.postLabel).toBe('Post 123')
    expect(descriptor.byline).toBe('Posted by @nick on X')
    expect(descriptor.accentTone).toBe('social')
  })

  it('treats X article urls as reading previews instead of tweet embeds', () => {
    const descriptor = getSourceWindowDescriptor(
      makeBinding({
        source_type: 'tweet',
        source_url: 'https://x.com/i/article/1947619289998414258',
        window_type: 'social',
      }),
    )

    expect(descriptor.kind).toBe('rich-preview')
    if (descriptor.kind !== 'rich-preview') throw new Error('expected rich preview descriptor')
    expect(descriptor.platformLabel).toBe('X article')
    expect(descriptor.ctaLabel).toBe('Read article')
    expect(descriptor.accentTone).toBe('reading')
  })

  it('falls back to a rich web preview for article-like sources', () => {
    const descriptor = getSourceWindowDescriptor(makeBinding())

    expect(descriptor.kind).toBe('rich-preview')
    if (descriptor.kind !== 'rich-preview') throw new Error('expected rich preview descriptor')
    expect(descriptor.domainLabel).toBe('example.com')
    expect(descriptor.ctaLabel).toBe('Open source')
    expect(descriptor.platformLabel).toBe('Web source')
  })

  it('tolerates invalid source urls from binding data without crashing', () => {
    const descriptor = getSourceWindowDescriptor(makeBinding({ source_url: sanitizeSourceUrl('not a url') }))

    expect(descriptor.kind).toBe('rich-preview')
    if (descriptor.kind !== 'rich-preview') throw new Error('expected rich preview descriptor')
    expect(descriptor.sourceUrl).toBeNull()
    expect(descriptor.domainLabel).toBe('unbound source')
    expect(descriptor.platformLabel).toBe('Web source')
  })

  it('drops unsafe source urls before they reach navigation descriptors', () => {
    const descriptor = getSourceWindowDescriptor(makeBinding({ source_url: sanitizeSourceUrl('javascript:alert(1)') }))

    expect(descriptor.kind).toBe('rich-preview')
    if (descriptor.kind !== 'rich-preview') throw new Error('expected rich preview descriptor')
    expect(descriptor.sourceUrl).toBeNull()
  })
})

describe('getActiveBindingAmbienceMode', () => {
  it('returns idle when there is no active binding', () => {
    expect(getActiveBindingAmbienceMode(null)).toBe('ambient-idle')
  })

  it('maps video bindings to video ambiance', () => {
    expect(getActiveBindingAmbienceMode(makeBinding({ source_type: 'youtube', window_type: 'video', source_url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' }))).toBe('ambient-video')
  })

  it('maps provider-native YouTube URLs to video ambiance even with stale metadata', () => {
    expect(getActiveBindingAmbienceMode(makeBinding({ source_type: 'concept-note', window_type: 'web', source_url: 'https://music.youtube.com/watch?v=dQw4w9WgXcQ' }))).toBe('ambient-video')
  })

  it('maps audio bindings to audio ambiance', () => {
    expect(getActiveBindingAmbienceMode(makeBinding({ source_type: 'audio', window_type: 'audio' }))).toBe('ambient-audio')
  })

  it('maps social bindings to social ambiance', () => {
    expect(getActiveBindingAmbienceMode(makeBinding({ source_type: 'tweet', window_type: 'social' }))).toBe('ambient-social')
  })

  it('maps X article urls to reading ambiance even if their binding metadata still says social', () => {
    expect(getActiveBindingAmbienceMode(makeBinding({ source_type: 'tweet', window_type: 'social', source_url: 'https://x.com/i/article/1947619289998414258' }))).toBe('ambient-reading')
  })

  it('maps generic web bindings to reading ambiance', () => {
    expect(getActiveBindingAmbienceMode(makeBinding())).toBe('ambient-reading')
  })
})
