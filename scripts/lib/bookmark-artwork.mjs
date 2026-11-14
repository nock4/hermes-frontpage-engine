import { MIN_SOURCE_WINDOWS, DESIRED_SOURCE_WINDOWS, MAX_SOURCE_WINDOWS } from '../../src/lib/sourceWindowCountContract.mjs'

// Round-robin by channel so one platform cannot fill the supporting lane.
function interleaveByChannel(rows) {
  const lanes = new Map()
  for (const row of rows) {
    const channel = row?.source_channel || 'unknown'
    if (!lanes.has(channel)) lanes.set(channel, [])
    lanes.get(channel).push(row)
  }
  const queues = [...lanes.values()]
  const out = []
  for (let index = 0; out.length < rows.length; index += 1) {
    for (const queue of queues) if (index < queue.length) out.push(queue[index])
  }
  return out
}

// NTS track family: a supporting candidate's primary URL plus its saved
// same-track fallback. At most one window per family, ever.
const trackFamily = source => source?.nts_track_family || null
function onePerTrackFamily(sources) {
  const seen = new Set()
  return sources.filter(source => {
    const family = trackFamily(source)
    if (!family) return true
    if (seen.has(family)) return false
    seen.add(family)
    return true
  })
}

// This scheduler grants no admission itself. The production select callback
// applies archive, editorial, family and exact actual-media gates on every batch.
//
// Phase 1 (anchor lane): single-candidate steps over fresh owning works until
// `target` (one) ANCHOR-ELIGIBLE work admits. `adapters.anchorEligible` judges
// that against the full archive ledger: a work admitted only as a supporting
// window (e.g. fresh post id, long-archived media) neither ends this phase nor
// opens the supporting lane. Supporting acquisition never starts before that.
// Phase 2 (supporting lane): remaining anchor-lane works plus supporting
// candidates, interleaved by channel, in small batches toward `desired` (six);
// it also continues while no anchor-eligible work remains selected.
// Both phases share one `maxAcquisitions` allowance (at most 24). Fewer real
// windows is valid; nothing here pads or splits sources.
// Supporting fallback: when a supporting candidate carrying `fallback_urls`
// (an NTS row's saved Previous source) fails acquisition, capture or
// actual-media admission, its first fallback URL is tried ONCE as the same
// candidate (same row lineage, `supporting_fallback_of` = primary), charged to
// the same shared allowance. Never for anchor-lane candidates, never after the
// primary admits, never chained.
export async function acquireBookmarkArtwork({ candidates, supportingCandidates = [], batchSize = 1, target = MIN_SOURCE_WINDOWS, desired = DESIRED_SOURCE_WINDOWS, maxAcquisitions = 24, state = {} }, adapters) {
  const limit = Math.min(24, Math.max(0, maxAcquisitions))
  const width = Math.min(MAX_SOURCE_WINDOWS, Math.max(1, batchSize))
  const goal = Math.min(MAX_SOURCE_WINDOWS, Math.max(target, desired))
  let inspected = [...(state.inspected || [])], autoresearch = state.autoresearch || { source_decisions: [] }
  const select = (sources, research) => onePerTrackFamily(adapters.select(sources, research))
  let contentSources = inspected.length ? select(inspected, autoresearch) : []
  let acquired = 0
  let supportingAcquired = 0
  const attemptedFallbackSet = new Set()
  // Actual-media admission of an acquired source (independent of final
  // selection caps). Production passes the creative-evidence predicate.
  const admitted = adapters.admitted || ((source, research) => (research?.source_decisions || []).some(row => row.url === source.url
    && row.inspection?.status === 'verified' && row.inspection?.confidence === 'high'))
  let lastSources = []
  const step = async batch => {
    for (const candidate of batch) if (candidate.supporting_fallback_of) attemptedFallbackSet.add(candidate)
    acquired += batch.length
    const sources = await adapters.acquire(batch)
    lastSources = sources
    inspected.push(...sources)
    const text = await adapters.research(sources)
    autoresearch = { ...text, source_decisions: [...autoresearch.source_decisions, ...(text.source_decisions || []).map(({ inspection, ...decision }) => decision)] }
    autoresearch = await adapters.inspect(sources, autoresearch)
    Object.assign(state, { inspected, autoresearch })
    contentSources = select(inspected, autoresearch)
  }
  const anchorEligible = adapters.anchorEligible || (() => true)
  const anchors = () => contentSources.filter(source => anchorEligible(source, autoresearch)).length
  let consumed = 0
  while (anchors() < target && consumed < candidates.length && acquired < limit) {
    const batch = candidates.slice(consumed, consumed + Math.min(width, limit - acquired))
    consumed += batch.length
    await step(batch)
  }
  let supportingBatchSize = 0
  const fallbacks = []
  const short = () => contentSources.length < goal || anchors() < target
  if (anchors() >= target && short() && acquired < limit) {
    // A primary carrying a saved fallback names its track family up front, so
    // its acquired source and any later fallback share one family key.
    const supporting = supportingCandidates.map(candidate => candidate?.fallback_urls?.length && !candidate.nts_track_family
      ? { ...candidate, nts_track_family: candidate.url } : candidate)
    const supportingSet = new Set(supporting)
    const queue = interleaveByChannel([...candidates.slice(consumed), ...supporting])
    let offset = 0
    while (short() && offset < queue.length && acquired < limit) {
      const size = Math.min(Math.max(1, goal - contentSources.length), limit - acquired, MAX_SOURCE_WINDOWS)
      const batch = queue.slice(offset, offset + size)
      offset += batch.length
      supportingAcquired += batch.length
      supportingBatchSize = Math.max(supportingBatchSize, batch.length)
      await step(batch)
      // Failed supporting primaries with a saved fallback retry next, before
      // the rest of the queue; the loop's limit/short checks still apply.
      const retries = batch.filter(candidate => supportingSet.has(candidate) && candidate.fallback_urls?.length)
        .filter(candidate => !contentSources.some(source => trackFamily(source) === (candidate.nts_track_family || candidate.url)))
        // Only a real failure (no source, or not admitted) earns the fallback;
        // an admitted primary dropped by selection caps does not.
        .filter(candidate => !lastSources.some(source => [source.url, source.source_url].includes(candidate.url) && admitted(source, autoresearch)))
        .map(candidate => {
          const { fallback_urls: [fallbackUrl], ...rest } = candidate
          return { ...rest, url: fallbackUrl, nts_track_family: candidate.nts_track_family || candidate.url, supporting_fallback_of: candidate.url }
        })
      queue.splice(offset, 0, ...retries)
      fallbacks.push(...retries)
    }
  }
  const attemptedFallbacks = fallbacks.filter(candidate => attemptedFallbackSet.has(candidate))
  const fallbackReport = attemptedFallbacks.map(candidate => ({ primary_url: candidate.supporting_fallback_of, fallback_url: candidate.url, admitted: contentSources.some(source => source.url === candidate.url && source.supporting_fallback_of) }))
  return {
    inspected, autoresearch, contentSources,
    audit: {
      acquired, limit, batch_size: width, supporting_batch_size: supportingBatchSize,
      anchor_lane_acquired: acquired - supportingAcquired, supporting_lane_acquired: supportingAcquired,
      admitted: contentSources.length, anchor_eligible_admitted: anchors(), target: goal,
      supporting_fallbacks_attempted: attemptedFallbacks.length,
      supporting_fallbacks_used: fallbackReport.filter(row => row.admitted).length,
      supporting_fallbacks: fallbackReport,
    },
  }
}
