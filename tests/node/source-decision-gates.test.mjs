import { describe, expect, it } from 'vitest'

import {
  buildSourceDecisionAudit,
  decideAnchorEligibility,
  decideVisualAnchorAction,
} from '../../scripts/lib/source-decision-gates.mjs'
import { sourceContentKey } from '../../scripts/lib/source-selection-policy.mjs'

const spentImageUrl = 'https://pbs.twimg.com/card_img/2097854880991825931/snYFSs2-?format=webp&name=medium'
const freshImageUrl = 'https://i.guim.co.uk/img/media/fresh/master/833.jpg?width=1200'

function recentKeysFor(...urls) {
  return new Set(urls.map((url) => sourceContentKey({ url, source_url: url })))
}

describe('source decision gates', () => {
  it('rejects an anchor whose attached image is already in the archive ledger', () => {
    const decision = decideAnchorEligibility({
      anchorSource: {
        url: 'https://x.com/ystrickler/status/2036847086277214214',
        title: '@ystrickler A-Corp card',
        image_url: spentImageUrl,
      },
      recentSourceKeys: recentKeysFor(spentImageUrl),
    })

    expect(decision).toMatchObject({
      decision: 'reject',
      reason_code: 'spent_material_family',
      confidence: 0.97,
    })
    expect(decision.evidence).toContain('anchor image_url is already in the archive material ledger')
  })

  it('rejects auxiliary-model / Hermes Agent visual references', () => {
    const decision = decideAnchorEligibility({
      anchorSource: {
        url: 'https://www.youtube.com/watch?v=NoF-YajElIM',
        title: '@Teknium: Tip of the day: Learn about Auxiliary Models and save big money with Hermes Agent',
        image_url: 'https://img.youtube.com/vi/NoF-YajElIM/hqdefault.jpg',
      },
      recentSourceKeys: new Set(),
    })

    expect(decision).toMatchObject({
      decision: 'reject',
      reason_code: 'ai_tooling_or_auxiliary_models',
    })
  })

  it('accepts a fresh image-led anchor with material cues', () => {
    const decision = decideAnchorEligibility({
      anchorSource: {
        url: 'https://www.theguardian.com/us-news/2017/apr/11/detroit-michigan-500-dollar-house-rust-belt-america',
        title: 'Buying a $500 House in Detroit: bidding on the soul of my city',
        description: 'Detroit house, cart, illustration, neighborhood, material surface',
        image_url: freshImageUrl,
      },
      recentSourceKeys: new Set(),
    })

    expect(decision).toMatchObject({
      decision: 'accept',
      reason_code: 'fresh_image_led_material',
    })
  })

  it('blocks when the thesis anchor image is spent and no promoted visual anchor is available', () => {
    const decision = decideVisualAnchorAction({
      anchorDecision: {
        decision: 'reject',
        reason_code: 'spent_material_family',
        confidence: 0.97,
      },
      sourceImageMode: 'skipped-no-valid-dominant-source-image',
      promotedVisualAnchor: null,
      exactAnchorBlocker: null,
    })

    expect(decision).toMatchObject({
      decision: 'block_and_rerun',
      reason_code: 'spent_anchor_without_fresh_visual_anchor',
    })
  })

  it('writes an audit with hard blockers for rejected anchor and visual action', () => {
    const audit = buildSourceDecisionAudit({
      anchorDecision: {
        decision: 'reject',
        reason_code: 'spent_material_family',
        confidence: 0.97,
        evidence: ['anchor image_url is already in the archive material ledger'],
      },
      visualAnchorDecision: {
        decision: 'block_and_rerun',
        reason_code: 'spent_anchor_without_fresh_visual_anchor',
        confidence: 0.96,
        evidence: ['source-image mode is skipped'],
      },
      jevDecision: null,
    })

    expect(audit.status).toBe('blocked')
    expect(audit.hard_blockers.map((blocker) => blocker.reason_code)).toEqual([
      'spent_material_family',
      'spent_anchor_without_fresh_visual_anchor',
    ])
  })
})
