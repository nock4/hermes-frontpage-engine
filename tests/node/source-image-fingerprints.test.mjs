import { describe, expect, it } from 'vitest'

import { buildSourceImageFingerprints, buildSourceImageContactSheetSvg, enrichSourceImageFingerprints, isLowFertilitySourceFingerprint } from '../../scripts/lib/source-image-fingerprints.mjs'

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

  it('can enrich fingerprints with vision-derived preserve cues', async () => {
    const candidates = [
      {
        caption: 'package image',
        image_url: 'https://assets.example/album.jpg',
        page_url: 'https://example.com/album',
        lineage: 'direct_link',
      },
    ]
    const base = buildSourceImageFingerprints(candidates)
    const enriched = await enrichSourceImageFingerprints(candidates, base, {
      analyzer: async () => ({
        visual_summary: 'square album cover with a cropped portrait head filling the lower left',
        preserve_cues: ['cropped human head mass low-left', 'white title text band along the top edge', 'hand gripping right edge'],
        palette_cues: ['warm skin and black hair against tan sleeve'],
        surface_cues: ['printed sleeve paper'],
        composition_moves: ['tight portrait crop', 'top title band'],
      }),
    })

    expect(enriched[0].visual_summary).toContain('cropped portrait head')
    expect(enriched[0].preserve_cues).toContain('white title text band along the top edge')
    expect(enriched[0].composition_moves).toContain('tight portrait crop')
  })

  it('marks near-empty text/wordmark images as low-fertility plate anchors', async () => {
    const candidates = [{
      title: 'sssluke wordmark cover',
      image_url: 'https://assets.example/wordmark.jpg',
      page_url: 'https://example.com/wordmark',
      lineage: 'primary_anchor_image',
    }]
    const base = buildSourceImageFingerprints(candidates)
    const enriched = await enrichSourceImageFingerprints(candidates, base, {
      analyzer: async () => ({
        visual_summary: 'near-white blank field with a single centered lowercase wordmark',
        preserve_cues: ['large blank field', 'single centered wordmark', 'minimalist cover'],
        palette_cues: ['off-white and black'],
        surface_cues: ['flat digital cover'],
        composition_moves: ['large negative field with small source pressure marks'],
        visual_fertility: 'low',
        low_fertility_reason: 'Too close to a text-only wordmark on a blank field to anchor a new edition.',
      }),
    })

    expect(enriched[0].visual_fertility).toBe('low')
    expect(isLowFertilitySourceFingerprint(enriched[0])).toBe(true)
    expect(isLowFertilitySourceFingerprint({
      visual_summary: 'portrait photograph with hands, fabric, room, and diagonal crop',
      preserve_cues: ['figure mass', 'room background'],
    })).toBe(false)
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
