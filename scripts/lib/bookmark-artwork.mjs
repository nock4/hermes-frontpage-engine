// This scheduler grants no admission itself. The production select callback
// applies archive, editorial, family and exact actual-media gates on every batch.
export async function acquireBookmarkArtwork({ candidates, batchSize = 6, target = 6, maxAcquisitions = 24 }, adapters) {
  const limit = Math.min(24, Math.max(0, maxAcquisitions))
  const width = Math.min(10, Math.max(1, batchSize))
  let inspected = [], autoresearch = { source_decisions: [] }, contentSources = []
  let acquired = 0
  for (let offset = 0; offset < Math.min(candidates.length, limit); offset += width) {
    const batch = candidates.slice(offset, Math.min(offset + width, limit))
    acquired += batch.length
    const sources = await adapters.acquire(batch)
    inspected.push(...sources)
    const text = await adapters.research(sources)
    autoresearch = { ...text, source_decisions: [...autoresearch.source_decisions, ...(text.source_decisions || []).map(({ inspection, ...decision }) => decision)] }
    autoresearch = await adapters.inspect(sources, autoresearch)
    contentSources = adapters.select(inspected, autoresearch)
    if (contentSources.length >= target) break
  }
  return { inspected, autoresearch, contentSources, audit: { acquired, limit, batch_size: width, admitted: contentSources.length } }
}
