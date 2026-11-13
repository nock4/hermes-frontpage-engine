import { describe, expect, it } from 'vitest'
import { acquireBookmarkArtwork } from '../../scripts/lib/bookmark-artwork.mjs'

// Synthetic scheduler adapters: `select` stands in for the production admission
// callback. The scheduler itself must never grant admission.
function adapters(verified, log = { acquired: [], research: 0 }) {
  return {
    log,
    acquire: async batch => { log.acquired.push(...batch.map(row => row.url)); return batch.map(row => ({ ...row })) },
    research: async () => { log.research += 1; return { source_decisions: [] } },
    inspect: async (sources, research) => ({ ...research, source_decisions: [...research.source_decisions, ...sources.map(s => ({ url: s.url, inspection: { status: verified.has(s.url) ? 'verified' : 'ambiguous' } }))] }),
    select: (sources, research) => sources.filter(s => research.source_decisions.some(r => r.url === s.url && r.inspection?.status === 'verified')),
  }
}
const row = (url, source_channel) => ({ url, source_channel })
const tweets = Array.from({ length: 6 }, (_, i) => row(`https://x.com/a/status/${i}`, 'twitter-bookmark'))
const supporting = [
  ...Array.from({ length: 5 }, (_, i) => row(`https://www.youtube.com/watch?v=v${i}`, 'youtube-like')),
  ...Array.from({ length: 5 }, (_, i) => row(`https://l${i}.bandcamp.com/track/t`, 'nts-like')),
  ...Array.from({ length: 5 }, (_, i) => row(`https://www.artic.edu/artworks/${i}`, 'manual-curation')),
]

describe('bounded acquisition continues toward desired supporting windows after the anchor admits', () => {
  it('keeps gathering after the first admitted work and round-robins supporting channels toward six', async () => {
    const verified = new Set([tweets[1].url, ...supporting.map(r => r.url)])
    const a = adapters(verified)
    const result = await acquireBookmarkArtwork({ candidates: tweets, supportingCandidates: supporting }, a)
    // Fresh X lane until the first admission, then mixed supporting channels.
    expect(a.log.acquired.slice(0, 2)).toEqual([tweets[0].url, tweets[1].url])
    expect(result.contentSources).toHaveLength(6)
    const channels = result.contentSources.slice(1).map(r => r.source_channel)
    expect(new Set(channels)).toEqual(new Set(['youtube-like', 'nts-like', 'manual-curation']))
    expect(result.audit).toMatchObject({ admitted: 6, target: 6 })
    expect(a.log.acquired.length).toBeLessThanOrEqual(24)
  })

  it('never starts supporting acquisition before a fresh anchor-lane work admits', async () => {
    const a = adapters(new Set(supporting.map(r => r.url)))
    const result = await acquireBookmarkArtwork({ candidates: tweets, supportingCandidates: supporting }, a)
    expect(a.log.acquired).toEqual(tweets.map(r => r.url))
    expect(result.contentSources).toEqual([])
  })

  it('keeps a valid singleton when nothing else admits, within the unchanged 24-acquisition cap', async () => {
    const many = Array.from({ length: 40 }, (_, i) => row(`https://www.youtube.com/watch?v=x${i}`, 'youtube-like'))
    const a = adapters(new Set([tweets[0].url]))
    const result = await acquireBookmarkArtwork({ candidates: tweets, supportingCandidates: many }, a)
    expect(result.contentSources.map(r => r.url)).toEqual([tweets[0].url])
    expect(a.log.acquired).toHaveLength(24)
    // Supporting work is acquired in small batches, not one text-research call per URL.
    expect(a.log.research).toBeLessThan(24)
  })

  it('stops at the shared remaining allowance', async () => {
    const a = adapters(new Set([tweets[0].url]))
    await acquireBookmarkArtwork({ candidates: tweets, supportingCandidates: supporting, maxAcquisitions: 5 }, a)
    expect(a.log.acquired).toHaveLength(5)
  })
})
