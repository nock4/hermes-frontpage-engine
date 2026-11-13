import { sourceKeysForBindings } from './recent-edition-context.mjs'
import { MaterialKeySet, SUPPORTING_REPEAT_COOLDOWN_DAYS } from './source-ledger.mjs'
import { canonicalizeSourceUrl } from './source-url-policy.mjs'

// First edition date checked by the anchor-new / supporting-cooldown archive
// rule. Earlier published editions are validated as-is, never rewritten.
export const SUPPORTING_REPEAT_POLICY_START = '2026-10-22'

function shiftDate(date, days) {
  const time = Date.parse(`${date}T00:00:00Z`)
  return Number.isFinite(time) ? new Date(time + days * 86_400_000).toISOString().slice(0, 10) : null
}

// `editions`: manifest order, newest first: [{ edition_id, date, bindings }].
// Anchor bindings (archive_role 'anchor', or any binding lacking a role) may
// not share material with ANY prior edition, same date included. Supporting
// bindings may not share material with a prior edition dated within the
// cooldown, nor with the immediately previous edition. One family per edition.
export function archiveSourceRepeatViolations(editions, { sourceContentKey, effectiveDate = SUPPORTING_REPEAT_POLICY_START, cooldownDays = SUPPORTING_REPEAT_COOLDOWN_DAYS } = {}) {
  const keysFor = binding => sourceKeysForBindings([binding], sourceContentKey)
  const editionKeys = editions.map(edition => new MaterialKeySet((edition.bindings || []).flatMap(keysFor)))
  const violations = []
  editions.forEach((edition, index) => {
    if (!edition.date || edition.date < effectiveDate) return
    const prior = editions.slice(index + 1).map((item, offset) => ({ item, keys: editionKeys[index + 1 + offset] }))
    const cutoff = shiftDate(edition.date, -cooldownDays)
    const own = new MaterialKeySet()
    for (const binding of edition.bindings || []) {
      const keys = keysFor(binding)
      if (keys.some(key => own.has(key))) violations.push(`Edition ${edition.edition_id} repeats one source family in two windows: ${binding.source_url}`)
      keys.forEach(key => own.add(key))
      const role = binding.archive_role === 'supporting' ? 'supporting' : 'anchor'
      const blocking = role === 'anchor'
        ? prior
        : prior.filter(({ item }, offset) => offset === 0 || !item.date || item.date >= cutoff)
      const hit = blocking.find(({ keys: priorKeys }) => keys.some(key => priorKeys.has(key)))
      if (hit) {
        violations.push(role === 'anchor'
          ? `Edition ${edition.edition_id} anchor/main artwork repeats archived material from ${hit.item.edition_id}: ${binding.source_url}`
          : `Edition ${edition.edition_id} supporting window repeats ${hit.item.edition_id} inside the ${cooldownDays}-day cooldown or previous edition: ${binding.source_url}`)
      }
    }
  })
  return violations
}

// Package-time role per bound source URL. The anchor is the researched anchor
// source, else the dominant plate source page, else the first (hero) binding.
// Exactly one binding is 'anchor'; the validator treats a missing role as
// anchor-strict, so an unmarked package can never loosen the rule.
export function archiveRolesForSourceUrls(sourceUrls, researchField = {}) {
  const anchorIdentities = [researchField?.anchor_research?.anchor_source, researchField?.selected_image_material?.[0] && { url: researchField.selected_image_material[0].page_url }]
  for (const source of anchorIdentities) {
    const identities = new MaterialKeySet([source?.url, source?.source_url, source?.final_url, source?.resolved_url]
      .filter(Boolean).map(canonicalizeSourceUrl))
    const index = identities.size ? sourceUrls.findIndex(url => identities.has(canonicalizeSourceUrl(url))) : -1
    if (index >= 0) return sourceUrls.map((_, position) => position === index ? 'anchor' : 'supporting')
  }
  return sourceUrls.map((_, position) => position === 0 ? 'anchor' : 'supporting')
}
