import { MIN_SOURCE_WINDOWS, MAX_SOURCE_WINDOWS } from '../../src/lib/sourceWindowCountContract.mjs'

// This scheduler grants no admission itself. The production select callback
// applies archive, editorial, family and exact actual-media gates on every batch.
export async function acquireBookmarkArtwork({ candidates, batchSize = 1, target = MIN_SOURCE_WINDOWS, maxAcquisitions = 24, state = {} }, adapters) {
  const limit = Math.min(24, Math.max(0, maxAcquisitions))
  const width = Math.min(MAX_SOURCE_WINDOWS, Math.max(1, batchSize))
  let inspected = [...(state.inspected || [])], autoresearch = state.autoresearch || { source_decisions: [] }
  let contentSources = inspected.length ? adapters.select(inspected, autoresearch) : []
  let acquired = 0
  for (let offset = 0; contentSources.length < target && offset < Math.min(candidates.length, limit); offset += width) {
    const batch = candidates.slice(offset, Math.min(offset + width, limit))
    acquired += batch.length
    const sources = await adapters.acquire(batch)
    inspected.push(...sources)
    const text = await adapters.research(sources)
    autoresearch = { ...text, source_decisions: [...autoresearch.source_decisions, ...(text.source_decisions || []).map(({ inspection, ...decision }) => decision)] }
    autoresearch = await adapters.inspect(sources, autoresearch)
    Object.assign(state, { inspected, autoresearch })
    contentSources = adapters.select(inspected, autoresearch)
    if (contentSources.length >= target) break
  }
  return { inspected, autoresearch, contentSources, audit: { acquired, limit, batch_size: width, admitted: contentSources.length } }
}
