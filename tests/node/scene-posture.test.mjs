import { describe, expect, it } from 'vitest'

import { selectPlatePosture, supportedPlatePostures } from '../../scripts/lib/scene-posture.mjs'

describe('scene posture selection', () => {
  it('supports manual minimal/abstract variety overrides', () => {
    const posture = selectPlatePosture({
      date: '2026-06-07',
      runId: 'test-run',
      options: {
        platePosture: 'minimal-field',
        densityTarget: 'airy',
        abstractionTarget: 'high',
        minimalityTarget: 'high',
      },
    })

    expect(posture.plate_posture).toBe('minimal field')
    expect(posture.density_target).toBe('airy')
    expect(posture.abstraction_target).toBe('high')
    expect(posture.minimality_target).toBe('high')
    expect(posture.manual_override).toBe(true)
    expect(posture.anchor_strategy_bias).toContain('apertures')
  })

  it('downweights recently overused postures while keeping candidates visible for audit', () => {
    const posture = selectPlatePosture({
      date: '2026-06-07',
      runId: 'test-run',
      recentEditions: [
        { title: 'Quiet threshold', scene_family: 'minimal corridor', visual_summary: 'sparse negative space pinlight ambient fog' },
        { title: 'Pinlight gate', scene_family: 'negative-space-threshold', visual_summary: 'minimal quiet corridor' },
      ],
    })

    const minimalWeight = posture.candidate_weights.find((entry) => entry.plate_posture === 'minimal field')
    const balancedWeight = posture.candidate_weights.find((entry) => entry.plate_posture === 'source-led balanced')
    expect(supportedPlatePostures()).toContain(posture.plate_posture)
    expect(minimalWeight.recent_pressure).toBeGreaterThan(0)
    expect(minimalWeight.effective_weight).toBeLessThan(minimalWeight.base_weight)
    expect(balancedWeight.effective_weight).toBeGreaterThan(0)
  })
})
