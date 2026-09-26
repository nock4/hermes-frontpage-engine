import { describe, expect, it } from 'vitest'
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
})
