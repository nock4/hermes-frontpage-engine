import { describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { buildSceneImagePrompt, generateScenePlate } from '../../scripts/lib/scene-generation.mjs'
import { buildSourceFidelityRecoveryPayload } from '../../scripts/pipeline/run-from-scratch-mode.mjs'

const payload = {
  scene_prompt: 'Recompose silver tubing and a raised hand. On hover or tap, reveal a source window. Add onset-puncture clusters.',
  source_image_fingerprints: [{
    image_url: 'https://example.com/musician.jpg', width: 480, height: 360,
    visual_summary: 'Monochrome musician photograph with raised hand and silver tubing.',
    preserve_cues: ['Raised hand and parallel silver tubing.'],
  }],
  source_audio_material: {
    audio_visual_briefs: [{ title: 'Music', brief: 'Thin low-end floor; sparse puncture marks; source-window marks: onset puncture cluster.' }],
  },
  effect_direction: {
    prompt_sentence: 'Build silver tubing glints and sparse puncture clusters. On hover, separate an edge.',
    source_window_mark_types: ['Localized onset-puncture clusters', 'hollow target rings', 'Interrupted tubing glints'],
    surface_language: ['Grain-bearing charcoal photographic fields'],
    motion_behavior: 'On hover or tap, a silver edge separates from its photographic mass.',
  },
  artifacts: [{ source_url: 'https://example.com/source' }],
}
const audit = {
  missing_critical_elements: ['Pale rectangular openings are missing.'],
  retained_critical_elements: ['Raised hand and parallel silver tubing.'],
  drift_risks: ['Small puncture-like circles become deliberately arranged interface-like geometry.'],
  forbidden_debug_marks: ['Lower-left patch: a hollow ring with lateral ticks at (122,766).'],
  blockers: ['forbidden generated debug marks'],
  rationale: 'Target geometry independently blocks release.',
}

describe('source-image still prompt boundary', () => {
  it('uses existing artwork edges instead of manufacturing interaction targets', () => {
    const before = structuredClone(payload)
    const prompt = buildSceneImagePrompt(payload)
    expect(prompt).not.toMatch(/source[- ]windows?|on hover|hover behavior|on tap|puncture/i)
    expect(prompt.split('ANCHORS\n')[1].split('No visible annotation')[0]).not.toMatch(/target|crosshair|reticle/i)
    expect(prompt).toContain('artwork-native')
    expect(prompt).toMatch(/invisible interaction.*later/i)
    expect(prompt).toContain('Interrupted tubing glints')
    expect(prompt).toContain('480x360')
    expect(prompt).toContain('No numbered or unnumbered registration targets')
    expect(payload).toEqual(before)
  })

  it('writes full diagnostics and runtime metadata before a blocked image adapter call', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'source-prompt-boundary-'))
    const recovery = buildSourceFidelityRecoveryPayload(payload, audit)
    try {
      await expect(generateScenePlate({ payload: recovery, imageBackend: 'hermes' }, dir, {
        runHermesImageCommand: async () => { throw new Error('test: image generation disabled') },
        sleep: async () => {},
      })).rejects.toThrow('test: image generation disabled')
      const saved = JSON.parse(await readFile(path.join(dir, 'scene-prompt-full.json'), 'utf8'))
      expect(saved.payload).toEqual(recovery)
      expect(saved.payload.source_fidelity_recovery_diagnostics).toEqual([audit])
      expect(saved.payload.effect_direction.motion_behavior).toContain('On hover or tap')
      expect(saved.compact_prompt).toBe(await readFile(path.join(dir, 'scene-prompt.txt'), 'utf8'))
      expect(saved.compact_prompt).not.toMatch(/puncture|on hover|source[- ]windows?/i)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it.each([false, true])('keeps full failed audits in recovery artifacts, not image instructions (overcopy=%s)', (overcopy) => {
    const failed = { ...audit, blockers: [...audit.blockers, ...(overcopy ? ['anchor copied without edition transformation'] : [])] }
    const recovery = buildSourceFidelityRecoveryPayload(payload, failed)
    expect(recovery.source_fidelity_recovery_diagnostics).toEqual([failed])
    const prompt = buildSceneImagePrompt(recovery)
    expect(prompt).not.toContain(audit.forbidden_debug_marks[0])
    expect(prompt).not.toContain(audit.drift_risks[0])
    expect(prompt).not.toMatch(/RECOVERY DIAGNOSTICS|puncture|on hover|source[- ]windows?/i)
    expect(prompt).toContain(audit.missing_critical_elements[0])
    expect(prompt).toContain(audit.retained_critical_elements[0])
    const next = buildSourceFidelityRecoveryPayload(recovery, audit, 2)
    expect(next.source_fidelity_recovery_diagnostics).toEqual([failed, audit])
    expect(failed.forbidden_debug_marks).toEqual(audit.forbidden_debug_marks)
  })
})
