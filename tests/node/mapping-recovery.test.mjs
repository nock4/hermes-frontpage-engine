import { describe, it, expect } from 'vitest'
import { recoverMappedPlate } from '../../scripts/lib/mapping-recovery.mjs'
const analysis = n => ({ inspection_mode: 'openai-vision', detected_objects: Array.from({ length: n }, (_, i) => ({ label: `visible-${i}`, visual_evidence: `contour-${i}` })) })
function fixture(initial = analysis(0)) {
  const context = { payload: { scene_prompt: 'retain handmade silhouettes', source_image_fingerprints: [{ image_url: 'exact-source' }], artifacts: [{ source: 'same-owner' }] }, researchField: { sources: [{ inspection: 'unchanged' }] }, signalHarvest: { owning: 'same-note' }, analysis: initial }
  const events = []
  return { context, events, snapshot: async tag => events.push(tag), replan: async () => events.push('replan'), generate: async () => events.push('generate'), audit: async () => events.push('audit'), map: async () => { events.push('map'); context.analysis = analysis(6) }, wait: async () => events.push('wait') }
}
describe('same-source mapping continuation', () => {
  it('retains exact source ownership and critique, audits correction before remapping', async () => {
    const deps = fixture(), before = structuredClone(deps.context.researchField)
    await recoverMappedPlate(deps)
    expect(deps.events).toEqual(['mapping-blocked', 'replan', 'generate', 'audit', 'map'])
    expect(deps.context.researchField).toEqual(before)
    expect(deps.context.payload.mapping_recovery_diagnostics.detected_objects).toHaveLength(0)
    expect(deps.context.payload.scene_prompt).toContain('0 real visible')
    expect(deps.context.payload.scene_prompt).toContain('not labels')
  })
  it('retries transient inspection on the exact plate, never generates for provider failure', async () => {
    const deps = fixture({ inspection_error: 'provider timeout', detected_objects: [] })
    await recoverMappedPlate(deps)
    expect(deps.events).toEqual(['inspection-failed', 'wait', 'map'])
  })
  it('does not convert a repeated provider failure into image generation', async () => {
    const deps = fixture({ inspection_error: 'provider timeout', detected_objects: [] }); deps.map = async () => deps.events.push('map')
    await expect(recoverMappedPlate(deps)).rejects.toThrow('provider timeout')
    expect(deps.events).not.toContain('generate')
  })
  it('fails closed after one correction below one, without fallback rectangles', async () => {
    const deps = fixture(); deps.map = async () => { deps.events.push('map') }
    await expect(recoverMappedPlate(deps)).rejects.toThrow('0 real mapped objects')
    expect(deps.events.filter(x => x === 'generate')).toHaveLength(1)
  })
  it('does not remap or package a fidelity-blocked correction', async () => {
    const deps = fixture(); deps.audit = async () => { throw new Error('fidelity blocked') }
    await expect(recoverMappedPlate(deps)).rejects.toThrow('fidelity blocked')
    expect(deps.events).not.toContain('map')
  })
  it.each([1, 2, 5, 6, 10])('does not regenerate a good %s-window candidate', async (count) => {
    const deps = fixture(analysis(count)); await recoverMappedPlate(deps); expect(deps.events).toEqual([])
  })
})
