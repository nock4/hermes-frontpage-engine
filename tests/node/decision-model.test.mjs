import { describe, expect, it } from 'vitest'

import {
  buildJevDecisionPayload,
  normalizeJevDecision,
  shouldUseJevDecisionModel,
} from '../../scripts/lib/decision-model.mjs'

describe('decision model adapter', () => {
  it('stays disabled unless explicitly configured for Jev', () => {
    expect(shouldUseJevDecisionModel({ DFE_DECISION_MODEL: 'rules' })).toBe(false)
    expect(shouldUseJevDecisionModel({ DFE_DECISION_MODEL: 'jev' })).toBe(true)
  })

  it('builds typed Jev payloads for source decision gates', () => {
    const payload = buildJevDecisionPayload({
      question: 'Should this source anchor the edition?',
      choices: ['accept', 'reject', 'needs_review'],
      state: { source_url: 'https://example.com/source', image_url: 'https://example.com/image.jpg' },
    })

    expect(payload).toMatchObject({
      primitive: 'Choice',
      question: 'Should this source anchor the edition?',
      choices: ['accept', 'reject', 'needs_review'],
    })
    expect(payload.state.source_url).toBe('https://example.com/source')
  })

  it('normalizes Jev-like choice probability responses into press decisions', () => {
    const normalized = normalizeJevDecision({
      choice: 'reject',
      probability: 0.91,
      reason_code: 'spent_material_family',
      evidence: ['image_url matched archive ledger'],
    })

    expect(normalized).toEqual({
      schema_version: 1,
      model: 'jev',
      decision: 'reject',
      reason_code: 'spent_material_family',
      confidence: 0.91,
      evidence: ['image_url matched archive ledger'],
      raw: {
        choice: 'reject',
        probability: 0.91,
        reason_code: 'spent_material_family',
        evidence: ['image_url matched archive ledger'],
      },
    })
  })
})
