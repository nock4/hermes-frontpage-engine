import { describe, expect, it } from 'vitest'

import { buildSourceContract, assertSourceContractPromptSafe } from '../../scripts/lib/source-contract.mjs'

describe('source contract', () => {
  it('turns source-image fingerprints into an explicit preserve/transform contract', () => {
    const contract = buildSourceContract({
      sourceImageFingerprints: [{
        title: 'Sky Box',
        image_url: 'https://assets.example/sky-box.jpg',
        visual_fertility: 'high',
        preserve_cues: ['square crop', 'vertical light shafts', 'lower flare nodes', 'horizontal beam'],
        composition_moves: ['centered square field', 'hard light geometry'],
      }],
      platePosture: { plate_posture: 'source-led balanced' },
      visualDirection: { composition_archetype: 'minimal field', camera_plate_grammar: 'flat square light study' },
    })

    expect(contract.mode).toBe('source-image')
    expect(contract.must_preserve).toEqual(expect.arrayContaining(['square crop', 'vertical light shafts']))
    expect(contract.must_transform.join(' ')).toContain('arrangement')
    expect(contract.forbidden_drift.join(' ')).toContain('same palette but not the same source')
    expect(contract.forbidden_overcopy.join(' ')).toContain('near-identical')
    expect(contract.prompt_conflicts).toEqual([])
  })

  it('skips source-image mode for low-fertility dominant image seeds', () => {
    const contract = buildSourceContract({
      sourceImageFingerprints: [{
        title: 'Black text on white',
        image_url: 'https://assets.example/text.png',
        visual_fertility: 'low',
        visual_summary: 'near-white blank field with a single centered lowercase wordmark',
        low_fertility_reason: 'text-only wordmark',
      }],
    })

    expect(contract.mode).toBe('skipped-no-valid-dominant-source-image')
    expect(contract.must_preserve).toEqual([])
    expect(contract.skip_reason).toContain('low-fertility')
  })

  it('does not treat a macro posture label as a conflict when the source remains explicitly dominant', () => {
    const contract = buildSourceContract({
      sourceImageFingerprints: [{
        title: 'Van Gogh chair',
        image_url: 'https://uploads0.wikiart.org/images/vincent-van-gogh/van-gogh-s-chair-1889.jpg!Large.jpg',
        visual_fertility: 'high',
        preserve_cues: ['Central yellow-green wooden chair', 'rush woven seat', 'turquoise wall field'],
      }],
      visualDirection: {
        composition_archetype: 'material macro',
        camera_plate_grammar: 'source-led object study',
      },
      platePosture: { plate_posture: 'material macro' },
      scenePrompt: 'Keep the chair as the dominant source mass while transforming surface and scale.',
    })

    expect(contract.mode).toBe('source-image')
    expect(contract.prompt_conflicts).toEqual([])
    expect(() => assertSourceContractPromptSafe(contract)).not.toThrow()
  })

  it('does not confuse replacement typography with source replacement', () => {
    const contract = buildSourceContract({
      sourceImageFingerprints: [{
        title: 'Environment sleeve',
        image_url: 'https://img.youtube.com/vi/BPykMwQ8hBE/hqdefault.jpg',
        visual_fertility: 'high',
        preserve_cues: ['centered square cover panel', 'black margins', 'diagonal concrete bridge slab'],
      }],
      visualDirection: {
        composition_archetype: 'architectural section',
        camera_plate_grammar: 'low upward architectural macro under a bridge slab',
        visual_compositional_moves: ['white title-like strokes gather near the top as short bands, never readable replacement typography'],
      },
      scenePrompt: 'Source-bearing marks are seam cuts and sky glints; no readable text.',
    })

    expect(contract.prompt_conflicts).toEqual([])
    expect(() => assertSourceContractPromptSafe(contract)).not.toThrow()
  })

  it('detects source preservation contradictions before image generation', () => {
    const contract = buildSourceContract({
      sourceImageFingerprints: [{
        title: 'Interior source',
        image_url: 'https://assets.example/interior.jpg',
        preserve_cues: ['wide room framing', 'left doorway', 'right seated figure'],
      }],
      visualDirection: {
        composition_archetype: 'material macro landscape horizon',
        camera_plate_grammar: 'extreme crop with central figure skyline',
      },
      scenePrompt: 'No literal depiction of the source reference image; replace with an unrelated macro texture field.',
    })

    expect(contract.prompt_conflicts).toEqual(expect.arrayContaining([
      'source-preserve contract conflicts with macro/landscape replacement language',
      'source-preserve contract conflicts with no-literal-depiction language',
    ]))
    expect(() => assertSourceContractPromptSafe(contract)).toThrow(/source contract prompt conflicts/)
  })
})
