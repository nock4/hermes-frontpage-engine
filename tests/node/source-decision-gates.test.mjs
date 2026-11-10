import { describe, expect, it } from 'vitest'

import {
  buildSourceDecisionAudit,
  decideAnchorEligibility,
  decideVisualAnchorAction,
} from '../../scripts/lib/source-decision-gates.mjs'
import { sourceContentKey } from '../../scripts/lib/source-selection-policy.mjs'
import { inspectedDecision } from '../fixtures/creative-inspection.mjs'
import { buildPromotedVisualAnchorMaterial } from '../../scripts/lib/source-research.mjs'

import { nov10Anchor } from '../fixtures/nov10-anchor.mjs'

it('admits the exact inspected Nov10 singleton without lexical visual cues', () => {
  const autoresearch = { source_decisions: [inspectedDecision(nov10Anchor)] }
  expect(decideAnchorEligibility({ anchorSource: nov10Anchor, autoresearch }))
    .toMatchObject({ decision: 'accept', reason_code: 'verified_creative_artifact' })
})

it.each(['reject', 'supporting', 'inspection-rejected', 'spent-image', 'spent-source', 'tooling', 'documentation'])('verified pixels cannot override earlier anchor gates: %s', mode => {
  const anchorSource = { ...nov10Anchor }
  if (mode === 'tooling') anchorSource.description = 'Hermes Agent auxiliary models prompt workflow'
  if (mode === 'documentation') anchorSource.url = 'https://component.gallery/'
  const positive = inspectedDecision(anchorSource)
  const autoresearch = { source_decisions: [positive] }
  if (['reject', 'supporting'].includes(mode)) autoresearch.source_decisions.push({ url: anchorSource.url, role: mode })
  if (mode === 'inspection-rejected') {
    const negative = inspectedDecision(anchorSource)
    negative.inspection.status = 'rejected'
    autoresearch.source_decisions.push(negative)
  }
  const recentSourceKeys = mode === 'spent-image' ? recentKeysFor(anchorSource.image_url)
    : mode === 'spent-source' ? recentKeysFor(anchorSource.url) : new Set()
  expect(decideAnchorEligibility({ anchorSource, autoresearch, recentSourceKeys }).decision).toBe('reject')
})

it.each(['medium', 'medium-role', 'ambiguous', 'no-positive', 'wrong-media', 'wrong-owner', 'missing-capture'])('does not replace missing affirmative exact-pixel proof with metadata: %s', mode => {
  const proof = inspectedDecision(nov10Anchor)
  if (mode === 'medium') proof.inspection.confidence = 'medium'
  if (mode === 'medium-role') proof.confidence = 'medium'
  if (mode === 'ambiguous') proof.inspection.status = 'ambiguous'
  if (mode === 'wrong-media') proof.inspection.media_url = 'https://example.com/other.jpg'
  if (mode === 'wrong-owner') proof.inspection.source_url = 'https://example.com/other'
  if (mode === 'missing-capture') proof.inspection.capture_sha256 = ''
  const autoresearch = { source_decisions: mode === 'no-positive' ? [] : [proof] }
  expect(decideAnchorEligibility({ anchorSource: nov10Anchor, autoresearch }))
    .toMatchObject({ decision: 'needs_review', reason_code: 'fresh_but_weak_visual_material' })
})

const spentImageUrl = 'https://pbs.twimg.com/card_img/2097854880991825931/snYFSs2-?format=webp&name=medium'
const freshImageUrl = 'https://i.guim.co.uk/img/media/fresh/master/833.jpg?width=1200'

function recentKeysFor(...urls) {
  return new Set(urls.map((url) => sourceContentKey({ url, source_url: url })))
}

describe('source decision gates', () => {
  it('keeps rejected creative inspection binding across parent aliases and image promotion', () => {
    const parent = { url: 'https://x.com/0xGoodfuture/status/2013663158624223682', title: 'Photo artwork avatar', image_url: freshImageUrl }
    const rejected = inspectedDecision(parent)
    rejected.inspection.status = 'rejected'
    rejected.inspection.artifact_kind = 'product'
    const autoresearch = { source_decisions: [{ url: parent.url, role: 'content' }, rejected] }
    const alias = 'https://twitter.com/i/status/2013663158624223682'
    const raster = { url: freshImageUrl, image_url: freshImageUrl, page_url: alias, title: 'Painting' }
    expect(decideAnchorEligibility({ anchorSource: { ...parent, url: alias }, autoresearch }))
      .toMatchObject({ decision: 'reject', reason_code: 'creative_inspection_rejected_anchor' })
    expect(buildPromotedVisualAnchorMaterial(raster, { autoresearch })).toBeNull()
    // Independently owned artwork may be promoted, but cannot rehabilitate the tweet.
    const artwork = { ...raster, url: 'https://artist.example/painting', page_url: 'https://artist.example/painting' }
    autoresearch.source_decisions.push(inspectedDecision(artwork))
    expect(buildPromotedVisualAnchorMaterial(artwork, { autoresearch })?.candidate.page_url).toBe(artwork.page_url)
    expect(decideAnchorEligibility({ anchorSource: parent, autoresearch }).decision).toBe('reject')
  })
  it('rejects documentation UI even with an image and gallery wording', () => {
    expect(decideAnchorEligibility({ anchorSource: {
      url: 'https://component.gallery/', title: 'Component Gallery', image_url: freshImageUrl,
    } })).toMatchObject({ decision: 'reject', reason_code: 'documentation_ui_material' })
  })

  it('does not count an unverified proposed visual anchor as a successful promotion', () => {
    expect(decideVisualAnchorAction({
      sourceImageMode: 'skipped-no-valid-dominant-source-image',
      promotedVisualAnchor: { reason: 'proposed before vision' },
    })).toMatchObject({ decision: 'block_and_rerun', reason_code: 'unverified_visual_anchor' })
  })

  it('reports a verified promoted visual anchor separately from thesis-anchor media', () => {
    expect(decideVisualAnchorAction({
      sourceImageMode: 'dominant-source-image',
      promotedVisualAnchor: { reason: 'fresh artwork passed vision' },
    })).toMatchObject({ decision: 'promote_visual_anchor', reason_code: 'fresh_promoted_visual_anchor' })
  })
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
