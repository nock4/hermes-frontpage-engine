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
export async function acquireBookmarkArtwork({ candidates, supportingCandidates = [], batchSize = 1, target = MIN_SOURCE_WINDOWS, desired = DESIRED_SOURCE_WINDOWS, maxAcquisitions = 24, state = {} }, adapters) {
  const limit = Math.min(24, Math.max(0, maxAcquisitions))
  const width = Math.min(MAX_SOURCE_WINDOWS, Math.max(1, batchSize))
  const goal = Math.min(MAX_SOURCE_WINDOWS, Math.max(target, desired))
  let inspected = [...(state.inspected || [])], autoresearch = state.autoresearch || { source_decisions: [] }
  let contentSources = inspected.length ? adapters.select(inspected, autoresearch) : []
  let acquired = 0
  let supportingAcquired = 0
  const step = async batch => {
    acquired += batch.length
    const sources = await adapters.acquire(batch)
    inspected.push(...sources)
    const text = await adapters.research(sources)
    autoresearch = { ...text, source_decisions: [...autoresearch.source_decisions, ...(text.source_decisions || []).map(({ inspection, ...decision }) => decision)] }
    autoresearch = await adapters.inspect(sources, autoresearch)
    Object.assign(state, { inspected, autoresearch })
    contentSources = adapters.select(inspected, autoresearch)
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
  const short = () => contentSources.length < goal || anchors() < target
  if (anchors() >= target && short() && acquired < limit) {
    const queue = interleaveByChannel([...candidates.slice(consumed), ...supportingCandidates])
    let offset = 0
    while (short() && offset < queue.length && acquired < limit) {
      const size = Math.min(Math.max(1, goal - contentSources.length), limit - acquired, MAX_SOURCE_WINDOWS)
      const batch = queue.slice(offset, offset + size)
      offset += batch.length
      supportingAcquired += batch.length
      supportingBatchSize = Math.max(supportingBatchSize, batch.length)
      await step(batch)
    }
  }
  return {
    inspected, autoresearch, contentSources,
    audit: {
      acquired, limit, batch_size: width, supporting_batch_size: supportingBatchSize,
      anchor_lane_acquired: acquired - supportingAcquired, supporting_lane_acquired: supportingAcquired,
      admitted: contentSources.length, anchor_eligible_admitted: anchors(), target: goal,
    },
  }
}
