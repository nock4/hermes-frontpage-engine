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
      visual_direction: {
        evidence_summary: 'Deterministic fallback from mixed audio sources.',
        brightness_profile: 'mixed',
        density_profile: 'balanced',
        geometry_profile: 'mixed',
        composition_profile: 'block-based',
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
  })
})
