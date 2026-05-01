import { describe, expect, it } from 'vitest'

import type { ArtifactRecord } from '../types/runtime'
import {
  getArtifactCenter,
  getArtifactInheritanceProfile,
  getArtifactSceneReactionMetrics,
} from './artifactScene'

const makeArtifact = (overrides: Partial<ArtifactRecord> = {}): ArtifactRecord => ({
  id: overrides.id ?? 'artifact-1',
  kind: overrides.kind ?? 'module',
  label: overrides.label ?? 'Artifact',
  artifact_type: overrides.artifact_type ?? 'paper-note',
  cluster_id: overrides.cluster_id ?? 'cluster-1',
  bounds: overrides.bounds ?? { x: 0.2, y: 0.3, w: 0.2, h: 0.1 },
  polygon: overrides.polygon ?? [[0.2, 0.3], [0.4, 0.3], [0.4, 0.4], [0.2, 0.4]],
  z_index: overrides.z_index ?? 2,
  source_binding_ids: overrides.source_binding_ids ?? [],
  geometry: overrides.geometry,
  mask_path: overrides.mask_path,
})

describe('artifactScene helpers', () => {
  it('calculates artifact centers from normalized bounds', () => {
    const center = getArtifactCenter(makeArtifact({ bounds: { x: 0.1, y: 0.25, w: 0.4, h: 0.2 } }))
    expect(center.x).toBeCloseTo(0.3)
    expect(center.y).toBeCloseTo(0.35)
  })

  it('classifies artifact inheritance profiles from artifact type language', () => {
    expect(getArtifactInheritanceProfile(makeArtifact({ artifact_type: 'paper-note' }))).toBe('paper')
    expect(getArtifactInheritanceProfile(makeArtifact({ artifact_type: 'glass-vial' }))).toBe('glass')
    expect(getArtifactInheritanceProfile(makeArtifact({ artifact_type: 'lamp-glow' }))).toBe('light')
    expect(getArtifactInheritanceProfile(makeArtifact({ artifact_type: 'plant-specimen' }))).toBe('living')
    expect(getArtifactInheritanceProfile(makeArtifact({ artifact_type: 'cabinet-drawer' }))).toBe('container')
    expect(getArtifactInheritanceProfile(makeArtifact({ artifact_type: 'screen-device' }))).toBe('device')
    expect(getArtifactInheritanceProfile(makeArtifact({ artifact_type: 'unknown-form' }))).toBe('neutral')
    expect(getArtifactInheritanceProfile(null)).toBe('neutral')
  })

  it('computes stronger scene reaction metrics for nearby artifacts', () => {
    const anchor = makeArtifact({ id: 'anchor', bounds: { x: 0.4, y: 0.4, w: 0.1, h: 0.1 } })
    const nearby = makeArtifact({ id: 'nearby', bounds: { x: 0.5, y: 0.42, w: 0.1, h: 0.1 } })

    const metrics = getArtifactSceneReactionMetrics(nearby, anchor)
    expect(metrics.tier).toBe(1)
    expect(metrics.unitX).toBeCloseTo(0.9805806757)
    expect(metrics.unitY).toBeCloseTo(0.1961161351)
    expect(metrics.strength).toBeCloseTo(0.8178921602)
  })

  it('drops scene reaction strength and tier as artifacts get farther away', () => {
    const anchor = makeArtifact({ id: 'anchor', bounds: { x: 0.1, y: 0.1, w: 0.1, h: 0.1 } })
    const far = makeArtifact({ id: 'far', bounds: { x: 0.75, y: 0.7, w: 0.08, h: 0.08 } })

    const metrics = getArtifactSceneReactionMetrics(far, anchor)
    expect(metrics.tier).toBe(3)
    expect(metrics.strength).toBe(0.2)
    expect(metrics.unitX).toBeGreaterThan(0)
    expect(metrics.unitY).toBeGreaterThan(0)
  })
})
