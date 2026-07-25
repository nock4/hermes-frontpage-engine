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
    expect(prompt).not.toContain('Use the attached source image as the main composition reference')
    expect(prompt).toContain('No dominant source image is attached')
    expect(prompt).toContain('SOURCE FIELD')
    expect(prompt).toContain('TRANSFORM')
    expect(prompt).toContain('COMPOSITION')
    expect(prompt).toContain('ANCHORS')
    expect(prompt).toContain('LIMITS')
    expect(prompt).toContain('diagrammatic fold')
    expect(prompt).toContain('architectural section with oblique plate depth')
    expect(prompt).toContain('hard diagonal seams; creased scan border')
    expect(prompt).toContain('Formal risk:')
    expect(prompt).toContain('source windows as real marks from the source field')
    expect(prompt).toContain('minimal field')
    expect(prompt.length).toBeLessThan(1850)
  })

  it('prints source image fingerprints as plate grammar rather than thumbnail instructions', () => {
    const prompt = buildSceneImagePrompt({
      scene_prompt: 'A source-led plate shaped by research image pressure.',
      mood: 'charged source image field',
      lighting: 'hard flash and soft falloff',
      material_language: ['gloss sleeve', 'scan grain'],
      negative_constraints: ['no literal copied logos'],
      ambiance: { color_drift: 'acid green over charcoal' },
      visual_direction: {
        visual_compositional_moves: ['giant negative left field'],
        anchor_strategy: 'plate seeds become apertures and edge scars',
      },
      source_image_fingerprints: [
        {
          title: 'Acid sleeve scan',
          image_url: 'https://assets.example/acid-sleeve.jpg',
          source_role: 'dominant plate seed',
          palette_cues: ['acid / neon saturation'],
          surface_cues: ['gloss / flash glare'],
          composition_moves: ['hard diagonal crop or seam', 'torn or irregular edge behavior'],
          do_not_copy_literally: ['Do not reproduce logos, legible text, identifiable subjects, or page chrome from this source image.'],
        },
      ],
      artifacts: [{ source_url: 'https://example.com/source', role: 'hero source-bearing anchor' }],
    })

    expect(prompt).toContain('BORROW')
    expect(prompt).toContain('Acid sleeve scan')
    expect(prompt).toContain('acid / neon saturation')
    expect(prompt).toContain('gloss / flash glare')
    expect(prompt).toContain('hard diagonal crop or seam; torn or irregular edge behavior')
    expect(prompt).toContain('SOURCE-INSPIRATION LOCK')
    expect(prompt).toContain('No unrelated replacement scene')
    expect(prompt).toContain('Borrow recognizable elements')
    expect(prompt).not.toContain('no literal depiction of the source reference image')
    expect(prompt).toContain('never cards, pasted thumbnails')
    expect(prompt).not.toContain('sky/cloud')
    expect(prompt).not.toContain('vertical shafts')
    expect(prompt).toContain('not as a composition to copy')
    expect(prompt).not.toContain('Source image plate seeds:')
    expect(prompt.length).toBeLessThan(2300)
  })

  it('tells source-image runs to borrow elements instead of recreating the same still life', () => {
    const prompt = buildSceneImagePrompt({
      scene_prompt: 'A cloud-ceramic plinth rupture plate.',
      lighting: 'diffuse studio light',
      material_language: ['satin ceramic', 'gold lightning inlay'],
      source_image_fingerprints: [{
        title: 'Cloud ceramics',
        image_url: 'https://assets.example/ceramics.jpg',
        visual_summary: 'Square studio product image of three hand-painted ceramic vases on a white plinth.',
        preserve_cues: [
          'Three-vase arrangement: small dark teal round vase centered in front, taller pale blue vase set back left, peach-lavender round vase set back right.',
          'White rectangular plinth occupies the lower third with visible top plane and front vertical face; background is nearly blank pale gray.',
          'Painted sky motifs wrap around the ceramics with thin branching gold lightning on the front vase.',
        ],
      }],
      visual_direction: {
        composition_archetype: 'product-photo rupture',
        camera_plate_grammar: 'side-lit object slab',
        visual_compositional_moves: ['large ceramic aperture', 'shifted scale rupture'],
      },
      plate_posture: { plate_posture: 'source-led balanced' },
      artifacts: Array.from({ length: 9 }, (_, index) => ({ source_url: `https://example.com/${index}` })),
    })

    expect(prompt).toContain('Use the attached source image as inspiration')
    expect(prompt).toContain('not as a picture to recreate')
    expect(prompt).toContain('BORROW')
    expect(prompt).toContain('change at least two of arrangement, scale, object count, crop, surface state, or spatial logic')
    expect(prompt).toContain('Do not start by duplicating the original source framing and object layout')
    expect(prompt).toContain('near-identical still life')
    expect(prompt).not.toContain('Use the attached source image as the main composition reference')
    expect(prompt).not.toContain('Transform the exact full source composition')
    expect(prompt).not.toContain('KEEP ORIGINAL FRAMING')
  })

  it('keeps graphic editorial source references as layout instead of metaphor', () => {
    const prompt = buildSceneImagePrompt({
      scene_prompt: 'Preserve the wide black cover framing, left-heavy empty text block as illegible pale mass, right off-white blob with gridded route gesture, sparse red accents, and low side light; transform it into a dense torn nocturne poster wall where source anchors are ripped apertures.',
      mood: 'handled nocturnal research wall, bright unknowns cut into black paper',
      lighting: 'low side light',
      material_language: ['matte black article-cover stock', 'torn off-white gridded paper'],
      negative_constraints: ['no legible words'],
      source_reference_preserve: [
        'wide horizontal crop with a dominant black background and strong left-right separation',
        'large pale off-white organic island on the right, carrying a thin rising route gesture and faint grid pressure',
        'left-side block of large typographic mass converted to illegible pale torn shapes',
      ],
      visual_direction: {
        evidence_summary: 'The strongest visual evidence is an article cover image with graphic poster residue.',
        composition_archetype: 'torn poster wall',
        camera_plate_grammar: 'torn wall',
        visual_compositional_moves: ['one large cropped article-cover fragment dominates the field'],
      },
      source_image_fingerprints: [{
        title: 'Graphic article cover',
        image_url: 'https://assets.example/cover.jpg',
        preserve_cues: ['wide horizontal crop', 'large pale off-white organic island', 'left-side block of typographic mass'],
        composition_moves: ['left-right graphic separation'],
      }],
      plate_posture: { plate_posture: 'poster wall' },
      artifacts: [{ source_url: 'https://example.com/source', role: 'hero source-bearing anchor' }],
    })

    expect(prompt).toContain('Use the attached source image as inspiration')
    expect(prompt).toContain('wide horizontal crop')
    expect(prompt).toContain('large pale off-white organic island')
    expect(prompt).toContain('graphic/editorial/poster/package reference')
    expect(prompt).toContain('Do not preserve the exact cover/card/photo arrangement')
    expect(prompt).toContain('Do not replace it with unrelated macro texture')
    expect(prompt).toContain('Posture: poster wall')
  })

  it('does not let recovery mode contradict inspiration-not-copy policy', () => {
    const previous = process.env.DFE_SOURCE_PRESERVE_PLATE
    process.env.DFE_SOURCE_PRESERVE_PLATE = '1'
    try {
      const prompt = buildSceneImagePrompt({
        scene_prompt: 'A birthday-card cutaway section.',
        lighting: 'soft tabletop daylight',
        material_language: ['matte paper', 'graphite line'],
        source_image_fingerprints: [{
          title: 'Birthday card',
          image_url: 'https://assets.example/card.jpg',
          visual_summary: 'Portrait photo of a handmade birthday card on a patterned surface.',
          preserve_cues: ['angel outline', 'yellow halo', 'small birthday cake', 'teal patterned tabletop'],
        }],
        visual_direction: { composition_archetype: 'architectural section', camera_plate_grammar: 'paper cutaway' },
        artifacts: [{ source_url: 'https://example.com/source' }],
      })
      expect(prompt).toContain('RECOVERY TRANSFORM')
      expect(prompt).toContain('Do not rebuild the full source composition')
      expect(prompt).toContain('change at least two of arrangement, scale, object count, crop, surface state, or spatial logic')
      expect(prompt).not.toContain('Keep every named PRESERVE cue visible at once')
      expect(prompt).not.toContain('Rebuild from the full source composition first')
    } finally {
      if (previous === undefined) delete process.env.DFE_SOURCE_PRESERVE_PLATE
      else process.env.DFE_SOURCE_PRESERVE_PLATE = previous
    }
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
      const promptFull = JSON.parse(await readFile(path.join(runDir, 'scene-prompt-full.json'), 'utf8'))
      expect(promptFull.compact_prompt).toContain('SOURCE FIELD')
      expect(promptFull.compact_prompt).toContain('TRANSFORM')
      expect(promptFull.payload.scene_prompt).toContain('full-bleed abstract field')
    } finally {
      await rm(runDir, { recursive: true, force: true })
    }
  })

  it('passes source image fingerprints into edit-capable Hermes image providers', async () => {
    const runDir = await mkdtemp(path.join(os.tmpdir(), 'dfe-scene-source-image-'))
    let seenArgs = []
    try {
      await generateScenePlate(
        {
          payload: {
            scene_prompt: 'A transformed full-frame source plate.',
            lighting: 'source light',
            material_language: ['paint'],
            ambiance: { color_drift: 'source palette' },
            source_image_fingerprints: [{
              title: 'Source image',
              image_url: 'https://assets.example/source.jpg',
              preserve_cues: ['full room framing', 'right-side player gesture'],
            }],
            visual_direction: {},
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
            await writeFile(targetPath, JSON.stringify(payload, null, 2), 'utf8')
          },
          runHermesImageCommand: async (_command, args) => {
            seenArgs = args
            await writeFile(path.join(runDir, 'plate.png'), 'fake-image-bytes')
            return {
              provider: 'openai-codex',
              model: 'gpt-image-2-medium',
              source_image: '/tmp/generated.png',
              input_image_url: 'https://assets.example/source.jpg',
              modality: 'image',
              aspect_ratio: 'landscape',
            }
          },
          sleep: async () => {},
        },
      )
      expect(seenArgs).toContain('--image-url')
      expect(seenArgs[seenArgs.indexOf('--image-url') + 1]).toBe('https://assets.example/source.jpg')
      const sceneGeneration = JSON.parse(await readFile(path.join(runDir, 'scene-generation.json'), 'utf8'))
      expect(sceneGeneration.input_image_url).toBe('https://assets.example/source.jpg')
      expect(sceneGeneration.modality).toBe('image')
    } finally {
      await rm(runDir, { recursive: true, force: true })
    }
  })
})
