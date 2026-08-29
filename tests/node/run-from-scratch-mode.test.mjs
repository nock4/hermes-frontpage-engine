import { describe, expect, it } from 'vitest'

import { buildSourceFidelityRecoveryPayload, historicalSourceKeyOptionsForRun } from '../../scripts/pipeline/run-from-scratch-mode.mjs'

describe('from-scratch source-fidelity recovery', () => {
  it('keeps the archive source ledger active for same-date publish runs by default', () => {
    expect(historicalSourceKeyOptionsForRun({ publish: true, date: '2026-08-28' }, {})).toEqual({})
    expect(historicalSourceKeyOptionsForRun({ publish: true, date: '2026-08-28' }, { DFE_EXCLUDE_SAME_DATE_SOURCE_LEDGER: '1' })).toEqual({
      excludeDates: ['2026-08-28'],
    })
  })

  it('feeds audit-missing source cues back into the recovery payload', () => {
    const payload = {
      scene_prompt: 'Oblique craft table with mint and magenta paper masses.',
      source_reference_preserve: ['Keep the diagonal two-object layout.'],
      negative_constraints: ['no dashboard cards'],
      source_image_fingerprints: [
        {
          image_url: 'https://assets.example/source.jpg',
          preserve_cues: ['large mint butterfly', 'smaller magenta butterfly'],
        },
      ],
    }
    const audit = {
      missing_critical_elements: [
        'handwritten curved and angled scribble marks are essentially gone',
        'bright crinkled candy wrappers attached to sticks are not preserved',
        'small layered flower badge on magenta wing is replaced by a tiny unrelated blue scrap',
      ],
      drift_risks: ['reads as a deconstructed material plate more than the original candy-card craft objects'],
      retained_critical_elements: ['mint and magenta paper butterfly colors'],
      blockers: ['vision verdict failed'],
    }

    const recovery = buildSourceFidelityRecoveryPayload(payload, audit, 2)

    expect(recovery).not.toBe(payload)
    expect(recovery.source_reference_preserve).toContain('Keep the diagonal two-object layout.')
    expect(recovery.source_reference_preserve).toContain('Recover missing source cue: handwritten curved and angled scribble marks are essentially gone')
    expect(recovery.source_reference_preserve).toContain('Recover missing source cue: bright crinkled candy wrappers attached to sticks are not preserved')
    expect(recovery.source_reference_preserve).toContain('Recover missing source cue: small layered flower badge on magenta wing is replaced by a tiny unrelated blue scrap')
    expect(recovery.source_reference_preserve).toContain('Keep retained source cue: mint and magenta paper butterfly colors')
    expect(recovery.negative_constraints).toContain('do not strip handmade details into generic torn-paper ambience')
    expect(recovery.scene_prompt).toMatch(/Source-fidelity recovery pass 2/)
    expect(recovery.scene_prompt).toMatch(/Visible details to restore:/)
  })
})
