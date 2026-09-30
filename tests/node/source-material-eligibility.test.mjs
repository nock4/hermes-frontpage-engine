import { describe, expect, it } from 'vitest'
import { selectAnchorSource } from '../../scripts/lib/anchor-source-research.mjs'
import { selectBestVisualReference } from '../../scripts/lib/source-selection-policy.mjs'
import { buildPromotedVisualAnchorMaterial } from '../../scripts/lib/source-research.mjs'
import { buildSourceImageFingerprints, enrichSourceImageFingerprints, isLowFertilitySourceFingerprint } from '../../scripts/lib/source-image-fingerprints.mjs'
import * as fingerprintsModule from '../../scripts/lib/source-image-fingerprints.mjs'

const documentation = {
  url: 'https://x.com/itsandrewgao/status/2027579258328256574',
  title: '@itsandrewgao', description: 'https://component.gallery/',
  note_title: 'https://component.gallery/', source_channel: 'twitter-bookmark',
  source_type: 'tweet', window_type: 'social', note_score: 1548, fetch_status: 'fetch-ok',
}
const artwork = {
  url: 'https://art.example/painting', title: 'Original painting',
  image_url: 'https://art.example/painting.jpg', source_channel: 'web', fetch_status: 'fetch-ok',
}
const derived = {
  url: 'https://cdn.example/opaque.webp', image_url: 'https://cdn.example/opaque.webp',
  page_url: 'https://library.example/components', title: 'Anchor image material 1',
  source_channel: 'anchor-derived', description: 'Image found on a page derived from the anchor research.',
}

describe('dominant source material eligibility', () => {
  it('inspects every selected seed so a fertile fourth image is not an unverified fallback', async () => {
    const candidates = Array.from({ length: 5 }, (_, i) => ({ image_url: `https://art.example/${i}.jpg` }))
    let calls = 0
    const result = await enrichSourceImageFingerprints(candidates, buildSourceImageFingerprints(candidates), {
      analyzer: async () => ({ visual_summary: 'Red figure on blue ground', preserve_cues: ['red figure', 'blue ground'], visual_fertility: ++calls === 4 ? 'high' : 'low' }),
    })
    expect(calls).toBe(5)
    expect(fingerprintsModule.screenSourceImageMaterial(candidates, result).selected_image_material).toEqual([candidates[3]])
  })
  it('blocks generation on failed vision rather than silently dropping fidelity into source-field mode', () => {
    const failed = { image_url: derived.image_url, vision_error: 'Malformed JSON', preserve_cues: [], visual_summary: '' }
    expect(() => fingerprintsModule.screenSourceImageMaterial([derived], [failed])).toThrow(/vision.*before image generation/i)
  })

  it('promotes only a verified alternate without re-running vision or retaining failed seeds', () => {
    const failed = { image_url: derived.image_url, vision_error: 'Malformed JSON' }
    const valid = { image_url: artwork.image_url, visual_summary: 'Painting of a red figure in a blue room', preserve_cues: ['red figure', 'blue room'], visual_fertility: 'high' }
    const result = fingerprintsModule.screenSourceImageMaterial([derived, artwork], [failed, valid])
    expect(result.selected_image_material).toEqual([artwork])
    expect(result.source_image_fingerprints).toEqual([{ ...valid, source_role: 'dominant plate seed' }])
    expect(result.rejected_image_fingerprints).toEqual([failed])
    expect(fingerprintsModule.screenSourceImageMaterial([], []).selected_image_material).toEqual([])
  })

  it('can demote successfully inspected low-fertility seeds without calling failed vision a success', () => {
    const low = { image_url: derived.image_url, visual_summary: 'White developer-documentation page', preserve_cues: ['text column'], visual_fertility: 'low' }
    const result = fingerprintsModule.screenSourceImageMaterial([derived], [low])
    expect(result.selected_image_material).toEqual([])
    expect(result.source_image_fingerprints).toEqual([])
    expect(result.rejected_image_fingerprints).toEqual([low])
  })
  it('does not give a component-gallery bookmark an artwork-first anchor lane', () => {
    expect(selectAnchorSource([documentation, artwork])?.url).toBe(artwork.url)
    expect(selectAnchorSource([documentation])).toBeNull()
  })

  it.each([
    { ...derived, page_url: 'https://component.gallery/' },
    { ...derived, description: 'Developer documentation screenshot showing UI components' },
    { ...derived, description: 'Design system component library interface examples' },
  ])('does not choose documentation UI as a visual reference or promoted seed', (source) => {
    expect(selectBestVisualReference([source, artwork])?.source.url).toBe(artwork.url)
    expect(buildPromotedVisualAnchorMaterial(source)).toBeNull()
  })

  it('preserves parent page provenance when promoting derived images', () => {
    expect(buildPromotedVisualAnchorMaterial(derived)?.candidate.page_url).toBe(derived.page_url)
    expect(buildPromotedVisualAnchorMaterial(derived, {
      recentSourceKeys: new Set(['library.example/components']),
    })).toBeNull()
  })

  it('cannot resurrect an explicitly rejected image by losing its parent URL', () => {
    const reference = { ...derived, page_url: undefined }
    expect(buildPromotedVisualAnchorMaterial(reference, {
      imageSourceMaterial: { rejected_reused_image_material: [{ page_url: derived.page_url, image_url: derived.image_url }] },
    })).toBeNull()
  })

  it('fails closed on malformed or absent vision instead of accepting textual fallback as fertile', async () => {
    const candidates = [{ image_url: derived.image_url, title: 'Anchor image material 1' }]
    const failed = await enrichSourceImageFingerprints(candidates, buildSourceImageFingerprints(candidates), {
      analyzer: async () => { throw new Error('Expected JSON: malformed response') },
    })
    expect(failed[0].vision_error).toContain('malformed')
    expect(isLowFertilitySourceFingerprint(failed[0])).toBe(true)
    expect(isLowFertilitySourceFingerprint(buildSourceImageFingerprints(candidates)[0])).toBe(true)
    for (const response of [{}, { visual_summary: 'abstract photograph', preserve_cues: [] }]) {
      const empty = await enrichSourceImageFingerprints(candidates, buildSourceImageFingerprints(candidates), { analyzer: async () => response })
      expect(isLowFertilitySourceFingerprint(empty[0])).toBe(true)
    }
  })

  it('rejects successful vision of documentation even if the model calls it high fertility', () => {
    expect(isLowFertilitySourceFingerprint({
      image_url: derived.image_url, visual_fertility: 'high',
      visual_summary: 'A developer-documentation page with pale left rail and broad content column',
      preserve_cues: ['white field', 'aligned text columns', 'blue divider'],
    })).toBe(true)
  })
})
