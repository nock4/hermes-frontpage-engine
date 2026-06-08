import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { buildSceneImagePrompt, generateScenePlate } from '../../scripts/lib/scene-generation.mjs'

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

describe('scene generation Hermes image backend', () => {
  it('retries a transient missing image-generation result before writing the plate metadata', async () => {
    const runDir = await mkdtemp(path.join(os.tmpdir(), 'dfe-scene-retry-'))
    const written = new Map()
    let calls = 0

    try {
      const result = await generateScenePlate(
        {
          payload: {
            scene_prompt: 'A full-bleed abstract field with visible source apertures.',
            lighting: 'diffuse studio light',
            material_language: ['paper', 'ink'],
            negative_constraints: ['no text'],
            ambiance: { color_drift: 'green and graphite' },
            visual_direction: {
              visual_compositional_moves: ['small seams'],
              anchor_strategy: 'apertures in the field',
            },
            artifacts: [{ source_url: 'https://example.com/source' }],
          },
          imageModel: 'gpt-image-2-medium',
          imageBackend: 'hermes',
          imageSize: '1536x1024',
          imageQuality: 'medium',
        },
        runDir,
        {
          writeJson: async (targetPath, payload) => {
            written.set(path.basename(targetPath), payload)
            await writeFile(targetPath, JSON.stringify(payload, null, 2), 'utf8')
          },
          runHermesImageCommand: async () => {
            calls += 1
            if (calls === 1) {
              throw new Error('Codex response contained no image_generation_call result')
            }
            await writeFile(path.join(runDir, 'plate.png'), 'fake-image-bytes')
            return {
              provider: 'openai-codex',
              model: 'gpt-image-2-medium',
              source_image: '/tmp/generated.png',
              aspect_ratio: 'landscape',
            }
          },
          sleep: async () => {},
        },
      )

      const sceneGeneration = written.get('scene-generation.json')
      expect(calls).toBe(2)
      expect(result.attempts).toBe(2)
      expect(sceneGeneration.attempts).toEqual([
        { attempt: 1, ok: false, error: 'Codex response contained no image_generation_call result' },
        { attempt: 2, ok: true },
      ])
      expect(sceneGeneration.provider).toBe('openai-codex')
      expect(await readFile(path.join(runDir, 'plate.png'), 'utf8')).toBe('fake-image-bytes')
    } finally {
      await rm(runDir, { recursive: true, force: true })
    }
  })
})
