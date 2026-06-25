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

  it('penalizes repeated flat material-scan grammar and records the anti-repeat directive', () => {
    const posture = selectPlatePosture({
      date: '2026-06-25',
      runId: 'flat-pressure-test',
      recentEditions: [
        { title: 'Tan sleeve scan', scene_family: 'material macro', visual_summary: 'shallow macro cardboard sleeve paper grain seam aperture glint notch quiet scan' },
        { title: 'Quiet object slab', scene_family: 'poster crop', visual_summary: 'side-lit object slab material surface texture sleeve seam aperture paper scan' },
      ],
    })

    const materialMacro = posture.candidate_weights.find((entry) => entry.plate_posture === 'material macro')
    const diagrammatic = posture.candidate_weights.find((entry) => entry.plate_posture === 'diagrammatic section')
    const wildcard = posture.candidate_weights.find((entry) => entry.plate_posture === 'wildcard rupture')

    expect(posture.recent_flat_surface_pressure).toBeGreaterThanOrEqual(10)
    expect(posture.look_avoidance_directive).toContain('Break that grammar')
    expect(posture.formal_risk).toBeTruthy()
    expect(materialMacro.effective_weight).toBeLessThan(2)
    expect(diagrammatic.effective_weight).toBeGreaterThan(diagrammatic.base_weight)
    expect(wildcard.effective_weight).toBeGreaterThan(wildcard.base_weight)
  })

  it('hard-rotates into disruptive postures when flat-surface pressure is very high', () => {
    const posture = selectPlatePosture({
      date: '2026-06-26',
      runId: 'hard-flat-pressure-test',
      recentEditions: [
        { title: 'Cardboard sleeve scan', scene_family: 'material macro', visual_summary: 'macro material surface texture slab paper cardboard sleeve scan shallow side-lit grain seam aperture glint notch quiet' },
        { title: 'Flat paper aperture', scene_family: 'source-led balanced', visual_summary: 'paper sleeve scan shallow macro surface seam aperture glint notch pinlight quiet material texture slab' },
        { title: 'Cream source plate', scene_family: 'material macro', visual_summary: 'flat cardboard surface paper sleeve seam aperture notch glint shallow scan quiet' },
      ],
    })

    expect(posture.recent_flat_surface_pressure).toBeGreaterThanOrEqual(16)
    expect(posture.hard_anti_flatness_rotation).toBe(true)
    expect(['wildcard rupture', 'diagrammatic section', 'poster wall']).toContain(posture.plate_posture)
    expect(posture.reason).toContain('Hard anti-flatness rotation')
  })
})
