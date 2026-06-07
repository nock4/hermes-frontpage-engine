import { describe, expect, it } from 'vitest'

import { buildSceneImagePrompt } from '../../scripts/lib/scene-generation.mjs'

describe('scene generation image prompt', () => {
  it('does not leak internal artifact labels or types into the plate prompt', () => {
    const prompt = buildSceneImagePrompt({
      scene_prompt: 'A moody abstract landscape with sparse source-bearing marks.',
      mood: 'moody abstract landscape',
      lighting: 'soft dusk light',
      material_language: ['paper', 'mist', 'charcoal'],
      negative_constraints: ['no dashboard cards'],
      ambiance: { color_drift: 'muted violet and rust' },
      plate_posture: {
        plate_posture: 'minimal field',
        density_target: 'airy',
        abstraction_target: 'high',
        minimality_target: 'high',
        literalness_limit: 'no literal prop inventory',
        anchor_strategy_bias: 'tiny apertures and edge notches',
        negative_space_bias: 'large uninterrupted fields',
      },
      visual_direction: {
        evidence_summary: 'Deterministic fallback from mixed audio sources.',
        brightness_profile: 'mixed',
        density_profile: 'balanced',
        geometry_profile: 'mixed',
        composition_profile: 'block-based',
        composition_archetype: 'diagrammatic fold',
        camera_plate_grammar: 'architectural section with oblique plate depth',
        visual_compositional_moves: ['hard diagonal seams', 'creased scan border', 'localized glass glare'],
        anchor_strategy: 'some anchors bold, others embedded',
      },
      artifacts: [
        {
          label: 'Signal Panel',
          artifact_type: 'signal-panel',
          role: 'source-bearing detail',
          source_url: 'https://example.com/1',
        },
        {
          label: 'Color Node',
          artifact_type: 'color-node',
          role: 'source-bearing detail',
          source_url: 'https://example.com/2',
        },
        {
          label: 'Distributed Marker',
          artifact_type: 'distributed-marker',
          role: 'source-bearing detail',
          source_url: 'https://example.com/3',
        },
      ],
    })

    expect(prompt).not.toContain('Signal Panel')
    expect(prompt).not.toContain('signal-panel')
    expect(prompt).not.toContain('Color Node')
    expect(prompt).not.toContain('color-node')
    expect(prompt).not.toContain('Distributed Marker')
    expect(prompt).not.toContain('distributed-marker')
    expect(prompt.toLowerCase()).toContain('no legible text')
    expect(prompt).toContain('Composition archetype: diagrammatic fold')
    expect(prompt).toContain('Camera / plate grammar: architectural section with oblique plate depth')
    expect(prompt).toContain('Visible compositional moves: hard diagonal seams; creased scan border; localized glass glare')
    expect(prompt).toContain('Plate posture: minimal field')
    expect(prompt).toContain('Posture targets: density airy; abstraction high; minimality high; literalness no literal prop inventory')
  })
})
