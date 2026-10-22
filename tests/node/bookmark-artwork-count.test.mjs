import { it, expect } from 'vitest'
import { acquireBookmarkArtwork } from '../../scripts/lib/bookmark-artwork.mjs'

it('stops paid acquisition at the first independently admitted pixel-verified work', async () => {
  const acquired = []
  const result = await acquireBookmarkArtwork({ candidates: [0, 1, 2, 3] }, {
    acquire: async batch => { acquired.push(...batch); return batch.map(id => ({ id })) },
    research: async () => ({ source_decisions: [] }),
    inspect: async (sources, research) => ({ ...research, source_decisions: [...research.source_decisions, ...sources.map(s => ({ id: s.id, inspection: { status: s.id === 1 ? 'verified' : 'rejected' } }))] }),
    select: (sources, research) => sources.filter(s => research.source_decisions.some(r => r.id === s.id && r.inspection?.status === 'verified')),
  })
  expect(acquired).toEqual([0, 1])
  expect(result.contentSources).toEqual([{ id: 1 }])
})
