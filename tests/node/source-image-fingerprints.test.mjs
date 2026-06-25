import { describe, expect, it } from 'vitest'

import { buildSourceImageFingerprints, buildSourceImageContactSheetSvg } from '../../scripts/lib/source-image-fingerprints.mjs'

describe('source image fingerprints', () => {
  it('turns selected source images into plate-language fingerprints', () => {
    const fingerprints = buildSourceImageFingerprints([
      {
        title: 'Acid sleeve scan with torn diagonal crop',
        caption: 'A glossy album cover: neon green field, black shadow, flash glare, torn paper edge.',
        image_url: 'https://assets.example/acid-sleeve.jpg',
        page_url: 'https://example.com/sleeve',
        visual_reason: 'Strong crop logic, saturated palette, torn edge, and visible glare.',
        lineage: 'archive_reference',
        score: 84,
      },
    ])

    expect(fingerprints).toHaveLength(1)
    expect(fingerprints[0]).toMatchObject({
      title: 'Acid sleeve scan with torn diagonal crop',
      image_url: 'https://assets.example/acid-sleeve.jpg',
      page_url: 'https://example.com/sleeve',
      lineage: 'archive_reference',
      source_role: 'dominant plate seed',
    })
    expect(fingerprints[0].palette_cues).toContain('acid / neon saturation')
    expect(fingerprints[0].surface_cues).toContain('gloss / flash glare')
    expect(fingerprints[0].composition_moves).toContain('torn or irregular edge behavior')
    expect(fingerprints[0].do_not_copy_literally).toContain('Do not reproduce logos, legible text, identifiable subjects, or page chrome from this source image.')
  })

  it('builds a contact-sheet svg from source image material for review artifacts', () => {
    const svg = buildSourceImageContactSheetSvg([
      {
        title: 'Sleeve scan',
        image_url: 'https://assets.example/sleeve.jpg',
        palette_cues: ['acid / neon saturation'],
        composition_moves: ['hard diagonal crop or seam'],
      },
    ])

    expect(svg).toContain('<svg')
    expect(svg).toContain('https://assets.example/sleeve.jpg')
    expect(svg).toContain('Sleeve scan')
    expect(svg).toContain('acid / neon saturation')
    expect(svg).toContain('hard diagonal crop or seam')
  })
})
