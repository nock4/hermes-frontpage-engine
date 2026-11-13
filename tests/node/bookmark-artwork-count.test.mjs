import { it, expect } from 'vitest'
import { acquireBookmarkArtwork } from '../../scripts/lib/bookmark-artwork.mjs'

const adapters = acquired => ({
  acquire: async batch => { acquired.push(...batch); return batch.map(id => ({ id })) },
  research: async () => ({ source_decisions: [] }),
  inspect: async (sources, research) => ({ ...research, source_decisions: [...research.source_decisions, ...sources.map(s => ({ id: s.id, inspection: { status: s.id === 1 ? 'verified' : 'rejected' } }))] }),
  select: (sources, research) => sources.filter(s => research.source_decisions.some(r => r.id === s.id && r.inspection?.status === 'verified')),
})

// Reserve preparation keeps the one-work stop by passing desired: 1.
it('stops paid acquisition at the first independently admitted pixel-verified work when only one is desired', async () => {
  const acquired = []
  const result = await acquireBookmarkArtwork({ candidates: [0, 1, 2, 3], desired: 1 }, adapters(acquired))
  expect(acquired).toEqual([0, 1])
  expect(result.contentSources).toEqual([{ id: 1 }])
})

// Superseded 2026-11-13 for ordinary runs: after the anchor admits, keep
// gathering supporting windows toward six instead of stopping at the first.
it('continues past the first admitted work toward the desired count by default, still admitting only verified works', async () => {
  const acquired = []
  const result = await acquireBookmarkArtwork({ candidates: [0, 1, 2, 3] }, adapters(acquired))
  expect(acquired).toEqual([0, 1, 2, 3])
  expect(result.contentSources).toEqual([{ id: 1 }])
})
