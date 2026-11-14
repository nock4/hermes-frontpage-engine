// Archive material ledger with two strictness levels (Nick, 2026-11-13:
// "the main artwork should stay new while the supporting windows repeat").
//
// - The ledger itself (Set membership) is the FULL published archive, any age,
//   any role, same date included. Every anchor / dominant-plate / visual
//   reference check keeps using it unchanged.
// - `supportingBlocked` is the subset that supporting windows may not reuse:
//   material from any edition dated within the cooldown (default 30 days,
//   inclusive of the run date and later) plus the immediately previous edition.
//   A former anchor may return as a SUPPORTING window after cooldown, never as
//   an anchor.
// A plain Set (or a ledger built without a run date) stays fully strict.
export const SUPPORTING_REPEAT_COOLDOWN_DAYS = 30

const tweetStatusId = key => String(key || '').match(/^(?:https?:\/\/)?(?:www\.|mobile\.)?(?:x|twitter)\.com\/(?:[^/]+|i\/web)\/status\/(\d+)/i)?.[1]
  || String(key || '').match(/^tweet:(\d+)$/)?.[1]
  || null

// Membership is family-aware for X/Twitter: one status ID is one material
// family regardless of username, i/web routes or twitter.com spelling.
export class MaterialKeySet extends Set {
  constructor(keys = []) {
    super()
    this.tweetIds = new Set()
    for (const key of keys) this.add(key)
  }

  add(key) {
    const id = tweetStatusId(key)
    if (id && this.tweetIds) this.tweetIds.add(id)
    return super.add(key)
  }

  has(key) {
    if (super.has(key)) return true
    const id = tweetStatusId(key)
    return Boolean(id && this.tweetIds?.has(id))
  }
}

class SourceLedger extends MaterialKeySet {
  constructor(archiveKeys = [], supportingBlockedKeys = archiveKeys, policy = null) {
    super(archiveKeys)
    this.supportingBlocked = new MaterialKeySet(supportingBlockedKeys)
    this.policy = policy
  }
}

// NTS track family: a saved track's primary URL plus its saved same-track
// fallback(s) are ONE material family. Every archive check (anchor ledger and
// supporting cooldown) must look at all of them, so a track already published
// via one URL cannot return through its sibling URL.
export function sourceTrackFamilyUrls(source = {}) {
  return [source?.nts_track_family, source?.supporting_fallback_of, ...(source?.fallback_urls || []), ...(source?.track_family_urls || [])]
    .filter(Boolean)
}

// Keys a SUPPORTING window must avoid. Strict fallback for plain Sets.
export function supportingLedger(recentSourceKeys) {
  return recentSourceKeys?.supportingBlocked instanceof Set ? recentSourceKeys.supportingBlocked : (recentSourceKeys || new Set())
}

function shiftDate(date, days) {
  const time = Date.parse(`${date}T00:00:00Z`)
  if (!Number.isFinite(time)) return null
  return new Date(time + days * 86_400_000).toISOString().slice(0, 10)
}

// `editions` in manifest order (newest first): [{ edition_id, date, keys }].
export function buildSourceLedger(editions, { date = null, cooldownDays = SUPPORTING_REPEAT_COOLDOWN_DAYS } = {}) {
  const all = editions.flatMap(edition => edition.keys)
  const cutoff = date ? shiftDate(date, -Math.max(0, Number(cooldownDays) || 0)) : null
  if (!cutoff) return new SourceLedger(all, all, { mode: 'strict', run_date: date || null, cooldown_days: cooldownDays })
  const previous = editions.find(edition => edition.date && edition.date <= date) || null
  const blocked = editions.filter(edition => !edition.date || edition.date >= cutoff || edition === previous)
  return new SourceLedger(all, blocked.flatMap(edition => edition.keys), {
    mode: 'anchor-archive-supporting-cooldown',
    run_date: date,
    cooldown_days: cooldownDays,
    cooldown_cutoff: cutoff,
    previous_edition_id: previous?.edition_id || null,
    supporting_blocked_edition_ids: blocked.map(edition => edition.edition_id),
  })
}
