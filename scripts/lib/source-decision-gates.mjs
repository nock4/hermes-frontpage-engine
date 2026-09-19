import fs from 'node:fs/promises'
import path from 'node:path'

import { isAiToolingContentSource, sourceContentKey } from './source-selection-policy.mjs'
import { canonicalizeSourceUrl } from './source-url-policy.mjs'

const SOURCE_DECISION_SCHEMA_VERSION = 1

function evidenceList(items = []) {
  return [...new Set(items.filter(Boolean))]
}

function sourceUrls(source = {}) {
  return [source.url, source.source_url, source.final_url, source.image_url, source.source_image_url, source.source_media_url]
    .filter(Boolean)
}

function sourceHasRecentUrlOrImage(source = {}, recentSourceKeys = new Set()) {
  return sourceUrls(source).some((url) => {
    const canonical = canonicalizeSourceUrl(url)
    const contentKey = sourceContentKey({ url, source_url: url, final_url: url })
    return recentSourceKeys.has(canonical) || recentSourceKeys.has(contentKey)
  })
}

function sourceImageSpent(source = {}, recentSourceKeys = new Set()) {
  const imageUrls = [source.image_url, source.source_image_url, source.source_media_url]
    .filter(Boolean)
  return imageUrls.some((url) => {
    const canonical = canonicalizeSourceUrl(url)
    const contentKey = sourceContentKey({ url, source_url: url, final_url: url })
    return recentSourceKeys.has(canonical) || recentSourceKeys.has(contentKey)
  })
}

function looksImageLed(source = {}) {
  const text = [source.title, source.description, source.visible_text, source.note_title, source.note_excerpt, source.url, source.image_url]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
  return Boolean(source.image_url || source.source_image_url || source.source_media_url)
    && /(art|artist|illustration|image|photo|photography|poster|painting|drawing|gallery|archive|film|video|game|music|detroit|house|cart|surface|material|visual)/.test(text)
}

function decision({ decision, reason_code: reasonCode, confidence, evidence = [] }) {
  return {
    schema_version: SOURCE_DECISION_SCHEMA_VERSION,
    decision,
    reason_code: reasonCode,
    confidence,
    evidence: evidenceList(evidence),
  }
}

export function decideAnchorEligibility({ anchorSource = null, recentSourceKeys = new Set() } = {}) {
  if (!anchorSource) {
    return decision({
      decision: 'reject',
      reason_code: 'missing_anchor_source',
      confidence: 1,
      evidence: ['no anchor source was selected'],
    })
  }

  if (sourceImageSpent(anchorSource, recentSourceKeys)) {
    return decision({
      decision: 'reject',
      reason_code: 'spent_material_family',
      confidence: 0.97,
      evidence: [
        'anchor image_url is already in the archive material ledger',
        anchorSource.image_url || anchorSource.source_image_url || anchorSource.source_media_url || null,
      ],
    })
  }

  if (sourceHasRecentUrlOrImage(anchorSource, recentSourceKeys)) {
    return decision({
      decision: 'reject',
      reason_code: 'spent_source_url',
      confidence: 0.96,
      evidence: ['anchor URL or resolved URL is already in the archive material ledger'],
    })
  }

  if (isAiToolingContentSource(anchorSource)) {
    return decision({
      decision: 'reject',
      reason_code: 'ai_tooling_or_auxiliary_models',
      confidence: 0.94,
      evidence: ['anchor matches AI/tooling, Hermes Agent, auxiliary-model, prompt, model, agent, or infrastructure patterns'],
    })
  }

  if (looksImageLed(anchorSource)) {
    return decision({
      decision: 'accept',
      reason_code: 'fresh_image_led_material',
      confidence: 0.86,
      evidence: ['anchor has fresh image-bearing material and source text with visual/material cues'],
    })
  }

  return decision({
    decision: 'needs_review',
    reason_code: 'fresh_but_weak_visual_material',
    confidence: 0.58,
    evidence: ['anchor is not spent or tooling, but visual fertility is not obvious'],
  })
}

export function decideVisualAnchorAction({
  anchorDecision = null,
  sourceImageMode = null,
  promotedVisualAnchor = null,
  exactAnchorBlocker = null,
} = {}) {
  if (exactAnchorBlocker) {
    return decision({
      decision: 'block_and_rerun',
      reason_code: 'exact_anchor_material_blocked',
      confidence: 0.99,
      evidence: [exactAnchorBlocker.reason || 'exact anchor source material blocker is present'],
    })
  }

  if (sourceImageMode === 'dominant-source-image') {
    return decision({
      decision: 'use_thesis_anchor_image',
      reason_code: 'valid_dominant_source_image',
      confidence: 0.86,
      evidence: ['a dominant source image survived screening and fingerprinting'],
    })
  }

  if (promotedVisualAnchor) {
    return decision({
      decision: 'promote_visual_anchor',
      reason_code: 'fresh_promoted_visual_anchor',
      confidence: 0.82,
      evidence: [promotedVisualAnchor.reason || 'a nearby fresh image-bearing source was promoted'],
    })
  }

  if (anchorDecision?.decision === 'reject' && anchorDecision.reason_code === 'spent_material_family') {
    return decision({
      decision: 'block_and_rerun',
      reason_code: 'spent_anchor_without_fresh_visual_anchor',
      confidence: 0.96,
      evidence: ['source-image mode is skipped', 'rejected thesis anchor had spent material and no fresh promoted visual anchor'],
    })
  }

  if (anchorDecision?.decision === 'reject') {
    return decision({
      decision: 'block_and_rerun',
      reason_code: 'rejected_anchor_without_valid_source_image',
      confidence: 0.9,
      evidence: [`anchor was rejected: ${anchorDecision.reason_code}`],
    })
  }

  return decision({
    decision: 'needs_review',
    reason_code: 'no_valid_dominant_source_image',
    confidence: 0.66,
    evidence: ['no dominant source image survived and no promoted visual anchor was selected'],
  })
}

export function buildSourceDecisionAudit({ anchorDecision, visualAnchorDecision, jevDecision = null } = {}) {
  const decisions = [anchorDecision, visualAnchorDecision, jevDecision].filter(Boolean)
  const hardBlockers = decisions.filter((item) => item.decision === 'reject' || item.decision === 'block_and_rerun')
  return {
    schema_version: SOURCE_DECISION_SCHEMA_VERSION,
    generated_at: new Date().toISOString(),
    status: hardBlockers.length ? 'blocked' : 'ok',
    hard_blockers: hardBlockers,
    decisions,
  }
}

export async function writeSourceDecisionAudit(runDir, audit) {
  const filePath = path.join(runDir, 'source-decision-audit.json')
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, `${JSON.stringify(audit, null, 2)}\n`, 'utf8')
  return filePath
}
