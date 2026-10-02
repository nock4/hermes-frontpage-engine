import { describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { SourceWindow } from './SourceWindow'
import { getSourceVisualImageUrl, getSourceVisualMode } from './SourceWindowBody'
import type { SourceBindingRecord } from '../../types/runtime'

const makeBinding = (cropRisk: 'low' | 'medium' | 'high'): SourceBindingRecord => ({
  source_media_url: 'https://media.example/source.jpg',
  source_visual: {
    poster_asset_path: '/editions/test/assets/source-poster.jpg',
    render_mode: 'poster-crop',
    crop_risk: cropRisk,
  },
} as SourceBindingRecord)

describe('YouTube stage surfaces', () => {
  const binding = {
    ...makeBinding('low'), id: 'youtube', artifact_id: 'hero', source_type: 'youtube',
    source_url: 'https://www.youtube.com/watch?v=prYhH_jDOVQ', window_type: 'video',
    title: 'Ambient music from forgotten CDs', kicker: 'youtube.com',
    source_image_url: 'https://media.example/source.jpg', source_media_type: 'image',
  } as SourceBindingRecord

  it('keeps native playback and an external readable primary title', () => {
    const html = renderToStaticMarkup(createElement(SourceWindow, { binding, mode: 'primary', surface: 'stage', onClose() {} }))
    expect(html).toContain('<iframe')
    expect(html).toContain('class="source-window__media-title"')
    expect(html).not.toContain('class="visual-source-card"')
  })

  it.each(['preview', 'primary'] as const)('contains unavailable YouTube imagery in landscape %s', (mode) => {
    vi.stubGlobal('window', { matchMedia: vi.fn().mockReturnValue({ matches: true }) })
    try {
      const html = renderToStaticMarkup(createElement(SourceWindow, { binding: { ...binding, embed_status: 'unavailable' }, mode, surface: 'stage', onClose() {} }))
      expect(html).toContain('data-source-visual-mode="raw"')
      expect(html).toContain('--source-ambient-image:')
      expect(html).toContain('Open on YouTube')
      expect(html).toContain('href="https://www.youtube.com/watch?v=prYhH_jDOVQ"')
      expect(html).not.toContain('<iframe')
      expect(html).not.toContain('/editions/test/assets/source-poster.jpg')
    } finally { vi.unstubAllGlobals() }
  })
})

describe('native audio stage provenance', () => {
  it.each([
    ['bandcamp', 'https://music-from-memory.bandcamp.com/track/modern-living-snow-bird', '<iframe src="https://bandcamp.com/EmbeddedPlayer/track=2043450709/size=large/"></iframe>'],
    ['soundcloud', 'https://soundcloud.com/example/track', '<iframe src="https://w.soundcloud.com/player/?url=https%3A//soundcloud.com/example/track"></iframe>'],
  ])('keeps %s primary title outside its native iframe', (_provider, source_url, source_embed_html) => {
    const binding = { id: 'audio', artifact_id: 'hero', source_type: 'audio', window_type: 'audio', source_url, source_embed_html, title: 'Audio title', source_title: 'Exact source provenance' } as SourceBindingRecord
    const html = renderToStaticMarkup(createElement(SourceWindow, { binding, mode: 'primary', surface: 'stage', onClose() {} }))
    expect(html).toContain('<iframe')
    expect(html).toContain('<strong class="source-window__media-title">Exact source provenance</strong>')
    expect(html).not.toContain('class="visual-source-card"')
  })
})

describe('source visual crop fallback', () => {
  it.each(['medium', 'high'] as const)('uses contained raw media for %s-risk poster crops', (cropRisk) => {
    const binding = makeBinding(cropRisk)

    expect(getSourceVisualImageUrl(binding, binding.source_media_url ?? null)).toBe(binding.source_media_url)
    expect(getSourceVisualMode(binding, binding.source_media_url ?? null)).toBe('raw')
  })

  it('keeps poster crops for low-risk imagery', () => {
    const binding = makeBinding('low')

    expect(getSourceVisualImageUrl(binding, binding.source_media_url ?? null)).toBe('/editions/test/assets/source-poster.jpg')
    expect(getSourceVisualMode(binding, binding.source_media_url ?? null)).toBe('poster-crop')
  })

  it('uses contained raw media with ambient fill on short landscape screens', () => {
    vi.stubGlobal('window', { matchMedia: vi.fn().mockReturnValue({ matches: true }) })
    const binding = makeBinding('low')

    try {
      expect(getSourceVisualImageUrl(binding, binding.source_media_url ?? null)).toBe(binding.source_media_url)
      expect(getSourceVisualMode(binding, binding.source_media_url ?? null)).toBe('raw')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('does not force video players into contained still-image mode', () => {
    vi.stubGlobal('window', { matchMedia: vi.fn().mockReturnValue({ matches: true }) })
    const binding = { ...makeBinding('low'), source_media_type: 'video' } as SourceBindingRecord

    try {
      expect(getSourceVisualMode(binding, binding.source_media_url ?? null)).toBe('poster-crop')
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
