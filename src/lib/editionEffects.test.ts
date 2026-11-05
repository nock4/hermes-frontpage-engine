import { describe, it, expect, vi } from 'vitest'
import { normalizeEffects, planEffects, effectKinds } from './editionEffects.mjs'
const artifact = {
  id: 'silver',
  polygon: [
    [0.2, 0.2],
    [0.8, 0.2],
    [0.8, 0.8],
    [0.2, 0.8],
  ],
  bounds: { x: 0.2, y: 0.2, w: 0.6, h: 0.6 },
  source_binding_ids: ['owner'],
}
const binding = {
  id: 'owner',
  artifact_id: 'silver',
  source_url: 'https://artist.example/work',
  source_media_type: 'image',
  source_media_url: '/original.png',
}
const context = { editionId: 'candidate', artifacts: [artifact], bindings: [binding] }
const evidence = [
  {
    artifact_id: 'silver',
    binding_id: 'owner',
    material: 'metal',
    observation: 'Inspected silver reflective ridges',
    modalities: ['reflective', 'resonant', 'depth', 'fracture', 'touch'],
  },
]
const editorialSources = [{ artifact_id: 'silver', binding_id: 'owner', source_url: binding.source_url, observation: 'Synthetic source inspection: hammered silver ridges', capture_sha256: 'a'.repeat(64), brief: 'Inspect the silver ridges through a local optical gesture.' }]
const editorial = effectKinds.map(kind => ({ schema_version: 1 as const, kind, decision: 'keep' as const, artifact_id: 'silver', binding_id: 'owner', source_url: binding.source_url, source_observation: editorialSources[0].observation, capture_sha256: editorialSources[0].capture_sha256, brief_quote: editorialSources[0].brief, plate_observation: evidence[0].observation, why_behavior: 'Synthetic fixture approval: reveal ridge relationships.', why_input: 'Synthetic fixture approval: local input explores ridge direction.', why_not_none: 'Synthetic fixture approval: transient deformation reveals ridge relationships absent at rest.' }))
describe('optional edition experiences', () => {
  it('leaves archive editions off', () => expect(normalizeEffects(undefined, context)).toBeNull())
  it('plans a deterministic bounded explicitly approved subset without mutating sources', () => {
    const before = JSON.stringify(context)
    const a = planEffects({ ...context, evidence, editorial, editorialSources, seed: 'day1' })
    expect(a.effects.length).toBeGreaterThan(0)
    expect(a.effects.length).toBeLessThanOrEqual(3)
    expect(planEffects({ ...context, evidence, editorial, editorialSources, seed: 'day1' })).toEqual(a)
    expect(
      new Set(
        Array.from(
          { length: 20 },
          (_, i) => planEffects({ ...context, evidence, editorial, editorialSources, seed: String(i) }).effects[0]?.kind,
        ),
      ).size,
    ).toBeGreaterThan(1)
    expect(
      a.effects.every(
        (e) =>
          e.artifact_id === 'silver' &&
          e.binding_id === 'owner' &&
          e.evidence.observation === evidence[0].observation,
      ),
    ).toBe(true)
    expect(JSON.stringify(context)).toBe(before)
  })
  it('does not infer material eligibility from a label, prose or missing admission', () => {
    expect(planEffects({ ...context, evidence: [], seed: 'x' }).effects).toEqual([])
    expect(
      planEffects({ ...context, evidence: [{ ...evidence[0], modalities: [] }], seed: 'x' }).effects,
    ).toEqual([])
  })
  it('rejects unsupported geometry, owners, duplicates and overbudget contracts', () => {
    const p = planEffects({ ...context, evidence, editorial, editorialSources, seed: 'x' })
    expect(() => normalizeEffects({ ...p, edition_id: 'other' }, context)).toThrow()
    expect(() =>
      normalizeEffects({ ...p, effects: [{ ...p.effects[0], artifact_id: 'absent' }] }, context),
    ).toThrow()
    expect(() => normalizeEffects({ ...p, effects: Array(4).fill(p.effects[0]) }, context)).toThrow()
    expect(() => normalizeEffects(p, { ...context, artifacts: [{ ...artifact, polygon: [] }] })).toThrow()
    expect(() =>
      normalizeEffects(p, {
        ...context,
        artifacts: [
          {
            ...artifact,
            polygon: [
              [0.2, 0.2],
              [0.3, 0.3],
              [0.4, 0.4],
            ],
          },
        ],
      }),
    ).toThrow()
    expect(() =>
      normalizeEffects(p, {
        ...context,
        artifacts: [{ ...artifact, bounds: { x: 0.8, y: 0.2, w: 0.6, h: 0.6 } }],
      }),
    ).toThrow()
  })
  it('resolves relative native media against the runtime origin, never a remote binding origin', () => {
    vi.stubGlobal('location', { origin: 'https://frontpage.example' })
    try {
      const ev = {
        ...evidence[0],
        modalities: ['video'],
        video: { url: '/native.webm', owner_url: binding.source_url, verified_native: true, cors_safe: true },
      }
      const value = {
        schema_version: 1,
        edition_id: 'candidate',
        effects: [{ kind: 'projection', artifact_id: artifact.id, binding_id: binding.id, evidence: ev }],
      }
      expect(() =>
        normalizeEffects(value, {
          ...context,
          bindings: [
            {
              ...binding,
              source_media_type: 'video',
              source_media_url: 'https://artist.example/native.webm',
            },
          ],
        }),
      ).toThrow()
      expect(
        normalizeEffects(value, {
          ...context,
          bindings: [
            {
              ...binding,
              source_media_type: 'video',
              source_media_url: 'https://frontpage.example/native.webm',
            },
          ],
        })?.effects,
      ).toHaveLength(1)
    } finally {
      vi.unstubAllGlobals()
    }
  })
  it('admits every direction only with its modality and never promotes generated still motion', () => {
    for (const kind of effectKinds) {
      const ev = {
        ...evidence[0],
        modalities: ['reflective', 'resonant', 'depth', 'fracture', 'touch', 'video'],
        video: { url: '/native.webm', owner_url: binding.source_url, verified_native: true, cors_safe: true },
      }
      const c = {
        ...context,
        bindings: [{ ...binding, source_media_type: 'video', source_media_url: '/native.webm' }],
      }
      const contract = {
        schema_version: 1,
        edition_id: 'candidate',
        effects: [{ kind, artifact_id: 'silver', binding_id: 'owner', evidence: ev }],
      }
      expect(normalizeEffects(contract, c)?.effects[0].kind).toBe(kind)
      if (['projection', 'castlight'].includes(kind)) {
        expect(() =>
          normalizeEffects(
            {
              ...contract,
              effects: [
                {
                  ...contract.effects[0],
                  evidence: { ...ev, video: { ...ev.video, verified_native: false } },
                },
              ],
            },
            c,
          ),
        ).toThrow()
        expect(() => normalizeEffects(contract, context)).toThrow()
      }
    }
  })
})
