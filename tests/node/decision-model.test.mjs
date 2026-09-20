import { describe, expect, it } from 'vitest'

import {
  buildJevDecisionPayload,
  buildUnavailableJevDecision,
  callJevDecisionWithFallback,
  normalizeJevDecision,
  resolveJevApiKey,
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
      model: 'jev-latest',
      state: { source_url: 'https://example.com/source', image_url: 'https://example.com/image.jpg' },
      questions: {
        press_decision: {
          type: 'choice',
          instructions: 'Should this source anchor the edition?',
          criteria: {
            accept: null,
            reject: null,
            needs_review: null,
          },
        },
      },
    })
  })

  it('normalizes Jev-like choice probability responses into press decisions', () => {
    const normalized = normalizeJevDecision({
      answers: {
        press_decision: {
          type: 'choice',
          choice: 'reject',
          confidence: 0.91,
          probabilities: { reject: 0.91, accept: 0.04, needs_review: 0.05 },
        },
      },
    })

    expect(normalized).toEqual({
      schema_version: 1,
      model: 'jev',
      decision: 'reject',
      reason_code: 'jev_choice_reject',
      confidence: 0.91,
      evidence: ['Jev choice probability: {"reject":0.91,"accept":0.04,"needs_review":0.05}'],
      raw: {
        answers: {
          press_decision: {
            type: 'choice',
            choice: 'reject',
            confidence: 0.91,
            probabilities: { reject: 0.91, accept: 0.04, needs_review: 0.05 },
          },
        },
      },
    })
  })

  it('resolves Jev API keys from explicit env or an op secret reference without logging secret values', async () => {
    await expect(resolveJevApiKey({ env: { JEV_API_KEY: 'direct-key' } })).resolves.toBe('direct-key')
    await expect(resolveJevApiKey({
      env: { JEV_API_KEY_OP_REF: 'op://Dev Secrets/Jev API Credential/credential' },
      opRead: async (ref) => `secret-for:${ref}`,
    })).resolves.toBe('secret-for:op://Dev Secrets/Jev API Credential/credential')
  })

  it('turns Jev outages into a non-blocking deterministic-fallback decision with redacted evidence', async () => {
    const unavailable = buildUnavailableJevDecision(new Error('authorization timeout for op://Dev Secrets/Jev API Credential/credential'))
    expect(unavailable).toMatchObject({
      model: 'jev',
      decision: 'needs_review',
      reason_code: 'jev_unavailable_deterministic_fallback',
    })
    expect(unavailable.evidence.join(' ')).toContain('deterministic source gates remained active')
    expect(unavailable.evidence.join(' ')).not.toContain('Dev Secrets')

    await expect(callJevDecisionWithFallback({ question: 'Proceed?' }, {
      env: {
        JEV_API_URL: 'https://jev.example.test/decide',
        JEV_API_KEY_OP_REF: 'op://Dev Secrets/Jev API Credential/credential',
      },
      opRead: async () => {
        throw new Error('authorization timeout for op://Dev Secrets/Jev API Credential/credential')
      },
      fetchImpl: async () => {
        throw new Error('fetch should not run when op read fails')
      },
    })).resolves.toMatchObject({
      decision: 'needs_review',
      reason_code: 'jev_unavailable_deterministic_fallback',
    })
  })
})
