import { describe, expect, it } from 'vitest'

import type { AboutRecord } from '../types/about'
import { getAboutTypographyStyle, getSourceWindowPlacementStyle } from './runtimeStyles'

const about: AboutRecord = {
  about_id: 'about-1',
  label: 'About this page',
  title: 'Signal Field',
  short_blurb: 'Scene note',
  body: ['One', 'Two'],
  typography: {
    profile_id: 'signal-field',
    heading_family: "'DFE Fraunces', Georgia, serif",
    body_family: "'DFE Newsreader', Georgia, serif",
    accent_family: "'DFE Space Grotesk', sans-serif",
    heading_weight: 700,
    body_weight: 430,
    accent_weight: 720,
    rationale: 'Test profile',
  },
}

describe('runtime style helpers', () => {
  it('builds about typography css variables from edition about metadata', () => {
    expect(getAboutTypographyStyle(about)).toEqual({
      '--about-heading-font': "'DFE Fraunces', Georgia, serif",
      '--about-body-font': "'DFE Newsreader', Georgia, serif",
      '--about-accent-font': "'DFE Space Grotesk', sans-serif",
      '--about-heading-weight': 700,
      '--about-body-weight': 430,
      '--about-accent-weight': 720,
      '--source-card-title-font': "'DFE Fraunces', Georgia, serif",
      '--source-card-body-font': "'DFE Newsreader', Georgia, serif",
      '--source-card-accent-font': "'DFE Space Grotesk', sans-serif",
      '--source-card-title-weight': 700,
      '--source-card-body-weight': 430,
      '--source-card-accent-weight': 720,
    })
    expect(getAboutTypographyStyle(null)).toBeUndefined()
  })

  it('converts stage placement geometry into css percentages and bloom origin values', () => {
    const placement = {
      anchorSide: 'right' as const,
      expansionLabel: 'right' as const,
      routeProfile: 'linear' as const,
      contactProfile: 'pin' as const,
      seamProfile: 'stitch' as const,
      x: 0.1,
      y: 0.2,
      width: 0.3,
      maxHeight: 0.4,
      tone: 'hero' as const,
      emissionX: 0.22,
      emissionY: 0.38,
    }

    const style = getSourceWindowPlacementStyle(placement, 2)
    expect(style.left).toBe('10%')
    expect(style.top).toBe('20%')
    expect(style.width).toBe('30%')
    expect(style.maxWidth).toBe('calc(100% - 1.5rem)')
    expect(style.maxHeight).toBe('min(40%, calc(100% - 1.5rem))')
    expect(style.zIndex).toBe(42)
    expect(style['--emission-x']).toBe('22%')
    expect(style['--emission-y']).toBe('38%')
    expect(style['--source-window-bloom-x']).toBe('40%')
    expect(parseFloat(style['--source-window-bloom-y'])).toBeCloseTo(45)
    const [bloomOriginX, bloomOriginY] = style['--source-window-bloom-origin'].split(' ')
    expect(bloomOriginX).toBe('40%')
    expect(parseFloat(bloomOriginY)).toBeCloseTo(45)
  })
})
