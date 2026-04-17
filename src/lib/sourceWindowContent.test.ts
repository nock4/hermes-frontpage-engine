import { describe, expect, it } from 'vitest'
import type { SourceBindingRecord } from '../types/runtime'
import { getSourceWindowDescriptor } from './sourceWindowContent'

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

  it('keeps audio bindings in an audio-dock descriptor', () => {
    const descriptor = getSourceWindowDescriptor(
      makeBinding({
        source_type: 'nts',
        source_url: 'https://www.nts.live/',
        window_type: 'audio',
        playback_persistence: true,
      }),
    )

    expect(descriptor.kind).toBe('audio-dock')
    expect(descriptor.ctaLabel).toBe('Open audio source')
    expect(descriptor.allowsPlaybackPersistence).toBe(true)
  })

  it('uses a social card descriptor for social links that are not directly embeddable yet', () => {
    const descriptor = getSourceWindowDescriptor(
      makeBinding({
        source_type: 'tweet',
        source_url: 'https://x.com/nick/status/123',
        window_type: 'social',
      }),
    )

    expect(descriptor.kind).toBe('social-card')
    expect(descriptor.domainLabel).toBe('x.com')
  })

  it('falls back to a rich web preview for article-like sources', () => {
    const descriptor = getSourceWindowDescriptor(makeBinding())

    expect(descriptor.kind).toBe('rich-preview')
    expect(descriptor.domainLabel).toBe('example.com')
    expect(descriptor.ctaLabel).toBe('Open source')
  })
})
