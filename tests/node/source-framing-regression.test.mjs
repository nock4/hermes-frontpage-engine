import { describe, it, expect } from 'vitest'
import { buildSceneImagePrompt } from '../../scripts/lib/scene-generation.mjs'
import { buildSourceContract } from '../../scripts/lib/source-contract.mjs'
import { buildSourceImageFingerprints, enrichSourceImageFingerprints } from '../../scripts/lib/source-image-fingerprints.mjs'
import { isAiToolingContentSource } from '../../scripts/lib/source-selection-policy.mjs'

const source = { image_url: 'https://example.com/game.jpg', width: 1920, height: 1080, visual_summary: 'Wide elevated voxel garden game scene', preserve_cues: ['Tall red square posts and square paving', 'Keep the game HUD and debug sliders subordinate'], composition_moves: ['typographic masses beside a diagonal grid'] }
describe('measured source framing', () => {
  it('retains landscape measurements through prompt normalization, not square objects or graphic overlays', () => {
    const prompt = buildSceneImagePrompt({ source_image_fingerprints: [source] })
    expect(prompt).toContain('1920x1080')
    expect(prompt).toContain('source is landscape')
    expect(prompt).not.toContain('source is square')
    expect(prompt).not.toContain('graphic/editorial/poster/package reference')
    expect(prompt).toContain('No game HUD')
    expect(prompt).not.toContain('Keep the game HUD')
  })
  it('does not infer frame geometry from square posts when dimensions are unknown', () => {
    const prompt = buildSceneImagePrompt({ source_image_fingerprints: [{ ...source, width: null, height: null }] })
    expect(prompt).not.toContain('source is square')
    expect(prompt).not.toContain('source is portrait')
  })
  it('puts measured geometry first in the source contract and removes UI preserve cues', () => {
    const contract = buildSourceContract({ sourceImageFingerprints: [source] })
    expect(contract.must_preserve[0]).toContain('1920x1080')
    expect(contract.must_preserve.join(' ')).not.toContain('Keep the game HUD')
  })
  it('uses decoded dimensions rather than candidate metadata or vision prose', async () => {
    const candidates = [{ ...source, width: 100, height: 100 }]
    const enriched = await enrichSourceImageFingerprints(candidates, buildSourceImageFingerprints(candidates), {
      measureImage: async () => ({ width: 1920, height: 1080 }),
      analyzer: async () => ({ visual_summary: 'square paving', preserve_cues: ['Keep the game HUD'] }),
    })
    expect(enriched[0]).toMatchObject({ width: 1920, height: 1080 })
    expect(enriched[0].preserve_cues).toEqual([])
  })
  it('quarantines explicit AI spritesheet workflow and confirmed AI product sources, not game artwork', () => {
    for (const source of [
      { description: 'One of the best ways to get AI spritesheets: generate a 3d model, animate it, capture frames' },
      { url: 'https://taalas.com/the-path-to-ubiquitous-ai/' },
      { url: 'https://trynoah.ai', title: 'Noah AI' },
    ]) expect(isAiToolingContentSource(source)).toBe(true)
    expect(isAiToolingContentSource({ title: 'Voxel garden game artwork' })).toBe(false)
  })
})
