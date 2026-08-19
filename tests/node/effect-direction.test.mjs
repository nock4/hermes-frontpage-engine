import { describe, expect, it } from 'vitest'

import { inferEffectDirectionFromResearch } from '../../scripts/lib/effect-direction.mjs'

describe('effect direction inference', () => {
  it('chooses condensation marks for wet weather and glass autoresearch instead of torn paper', () => {
    const effect = inferEffectDirectionFromResearch({
      autoresearch: {
        aesthetic_thesis: 'Rainy club windows and wet reflective street glass turn the edition into a fogged pane.',
        visual_motifs: ['fogged glass', 'droplet trails', 'wet reflections', 'finger-wiped clearings'],
        capture_notes: ['verify rainy video stills and reflective window surfaces'],
        source_decisions: [
          { why: 'The image is useful for condensation, glass glare, and water beads.' },
        ],
      },
      selected_image_material: [{ visual_reason: 'wet reflective glass with water beads' }],
      source_image_fingerprints: [{ surface_cues: ['fogged glass', 'droplet trails'] }],
    }, [])

    expect(effect.effect_family).toBe('glass-condensation')
    expect(effect.surface_language).toContain('fogged glass')
    expect(effect.source_window_mark_types).toContain('wiped apertures')
    expect(effect.avoid_effects).toContain('torn paper')
    expect(effect.prompt_sentence).toContain('wiped condensation marks')
    expect(effect.prompt_sentence).toContain('not torn paper')
  })

  it('penalizes repeated torn poster effects when recent editions used ripped-paper grammar', () => {
    const effect = inferEffectDirectionFromResearch({
      autoresearch: {
        aesthetic_thesis: 'A printed zine archive of posters and collage scraps.',
        visual_motifs: ['poster scraps', 'collage layers', 'paste marks'],
      },
    }, [
      { title: 'Torn Wall', scene_family: 'torn-poster-wall', visual_summary: 'ripped paper seams and poster paste' },
      { title: 'Paper Gate', scene_family: 'paper-sleeve', visual_summary: 'torn edge apertures' },
    ])

    expect(effect.effect_family).not.toBe('torn-paper')
    expect(effect.recent_effect_penalty).toContain('torn-paper')
    expect(effect.avoid_effects).toContain('ripped collage')
  })
})
