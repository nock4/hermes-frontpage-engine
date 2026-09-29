import { describe, expect, it } from 'vitest'
import { buildSourceContract } from '../../scripts/lib/source-contract.mjs'
import { buildSceneImagePrompt } from '../../scripts/lib/scene-generation.mjs'
import { buildSourceFidelityRecoveryPayload } from '../../scripts/pipeline/run-from-scratch-mode.mjs'
import { buildSourceImageFingerprints, enrichSourceImageFingerprints } from '../../scripts/lib/source-image-fingerprints.mjs'

const photo = {
  image_url: 'https://img.youtube.com/vi/AHjyQBp4RK8/hqdefault.jpg',
  title: 'Flying Saucer Attack', width: 480, height: 360,
  visual_summary: 'Grainy mustard-yellow band photograph with five overlapping foreground figures.',
  preserve_cues: [
    'Preserve the edge-to-edge foreground figure arrangement, with large cropped heads at both sides.',
    'Keep the left figure tall dark hair mass, rounded eyeglass loops and patterned open-neck shirt.',
    'Retain the central bob-shaped hair silhouette and dark torso.',
    'Keep the slender pale spire slightly right of center and the elongated dark saucer high above it.',
  ],
}

describe('representational photo recomposition', () => {
  it('requires structural recomposition rather than scale plus weathering in the contract and provider prompt', () => {
    const contract = buildSourceContract({ sourceImageFingerprints: [photo] })
    const prompt = buildSceneImagePrompt({ source_image_fingerprints: [photo], source_contract: contract })
    expect(contract.must_transform.join(' ')).toContain('at least one structural change')
    expect(contract.must_preserve.join(' ')).toContain('Source observation to recompose')
    expect(prompt).toContain('rounded eyeglass loops')
    expect(prompt).toContain('bob-shaped hair silhouette')
    expect(prompt).toContain('elongated dark saucer')
    expect(prompt).toContain('not requirements for exact count, order, positions, or full-scene restaging')
    expect(prompt).not.toContain('Preserve this source aspect and camera framing')
    expect(prompt).not.toContain('without losing the centered source object')
    expect(prompt).toContain('measured source is landscape (480x360)')
    expect(prompt).toContain('No visible annotation glyphs or QA chrome')
  })

  it('does not feed overcopied arrangement back as a retained cue to keep during recovery', () => {
    const recovery = buildSourceFidelityRecoveryPayload({ source_image_fingerprints: [photo], scene_prompt: 'Five people in the same left-to-right order.' }, {
      blockers: ['anchor copied without edition transformation', 'source image recreated instead of borrowed'],
      retained_critical_elements: ['Five overlapping foreground figures in the same left-to-right sequence'],
      missing_critical_elements: ['Black letterbox bands'],
      drift_risks: ['Overcopying: same five-person arrangement'],
    })
    expect(recovery.scene_prompt).not.toContain('Five people in the same left-to-right order')
    expect(recovery.source_reference_preserve.join(' ')).not.toContain('Keep retained source cue')
    expect(recovery.scene_prompt).toContain('at least one structural change')
    expect(recovery.scene_prompt).not.toContain('restore the audit-missing source identifiers before adding seams')
    expect(recovery.negative_constraints.join(' ')).not.toContain('do not fragment the primary source objects')
  })

  it('asks vision for concrete grammar rather than an exact composition to preserve', async () => {
    const candidates = [{ image_url: photo.image_url }]
    let instructions
    await enrichSourceImageFingerprints(candidates, buildSourceImageFingerprints(candidates), {
      analyzer: async (request) => { instructions = request.instructions; return photo },
    })
    expect(instructions).not.toContain('exact composition identity the generated plate must preserve')
    expect(instructions).toContain('not requirements for exact count, order, positions, or full-scene restaging')
  })
})
