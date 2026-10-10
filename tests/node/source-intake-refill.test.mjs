import { describe, expect, it } from 'vitest'
import {
  selectSourceCandidatesForInspection, selectContentSources, sourceContentKey,
} from '../../scripts/lib/source-selection-policy.mjs'

const candidate = (url, extra = {}) => ({
  url, note_id: 'collection', note_title: 'Saved reading', note_path: 'collection.md',
  source_channel: 'saved-link', note_score: 120, ...extra,
})
const owners = (hosts = ['alpha.test', 'beta.test', 'gamma.test', 'delta.test', 'epsilon.test', 'zeta.test']) =>
  hosts.map(host => candidate(`https://${host}/work`))
const select = (sources, cap = sources.length, options) =>
  selectSourceCandidatesForInspection({ source_candidates: sources }, cap, options)
const urls = sources => sources.map(source => source.url)

// URL-only fixtures exercise fetch membership, not pixel/creative eligibility.
describe('vacant intake refill for owning pages in saved collections', () => {
  it.each([
    ['alpha.test', 'beta.test', 'gamma.test', 'delta.test', 'epsilon.test', 'zeta.test'],
    ['one.invalid', 'two.invalid', 'three.invalid', 'four.invalid', 'five.invalid', 'six.invalid'],
  ])('refills distinct owners symmetrically (%s)', (...hosts) => {
    const shared = owners(hosts)
    const independent = shared.map((source, i) => ({ ...source, note_id: `note-${i}`, note_path: `note-${i}.md` }))
    expect(urls(select(shared))).toEqual(urls(select(independent)))
    expect(select(shared)).toHaveLength(6)
    expect(new Set(select(shared).map(sourceContentKey)).size).toBe(6)
  })

  it('preserves the protected chrome-bookmark allowance before refilling', () => {
    const sources = owners().map(source => ({ ...source, source_channel: 'chrome-bookmark' }))
    expect(select(sources, 4)).toEqual(sources.slice(0, 4))
    expect(select(sources, 6)).toEqual(sources)
  })

  it('accounts for newly added owner aliases and media in later refill slots', () => {
    const seed = owners().slice(0, 3)
    const owner = candidate('https://new-owner.test/work', {
      resolved_url: 'https://resolved.test/work', image_url: 'https://opaque.test/picture',
    })
    const aliases = [candidate(owner.resolved_url), candidate(owner.image_url)]
    expect(select([...seed, owner, ...aliases], 10)).toEqual([...seed, owner])
  })

  it('preserves the original diversity prefix and never replaces a full field', () => {
    const shared = owners()
    const other = candidate('https://separate.test/work', { note_id: 'other' })
    const sources = [...shared, other]
    const prefix = [shared[0], other, shared[1], shared[2]]
    expect(select(sources, 4)).toEqual(prefix)
    expect(select(sources, 7)).toEqual([...prefix, ...shared.slice(3)])
    expect(select(sources, 5)).toEqual([...prefix, shared[3]])
    expect(select(sources, 0)).toEqual([])
  })

  it('retains a three-per-owner-domain bound after crossing the saved-note limit', () => {
    const seed = owners().slice(0, 3)
    const sameDomain = Array.from({ length: 5 }, (_, i) => candidate(`https://seventh.test/work-${i}`))
    expect(select([...seed, ...sameDomain], 8)).toEqual([...seed, ...sameDomain.slice(0, 3)])
    expect(select(sameDomain, 8)).toHaveLength(3)
  })

  it('does not spend new slots on canonical or cross-host redirect aliases', () => {
    const seed = owners().slice(0, 3)
    seed[0] = { ...seed[0], final_url: 'https://redirected.test/work' }
    const aliases = [
      candidate('https://redirected.test/work'),
      candidate('https://short.test/work', { final_url: seed[1].url }),
      candidate('https://alias.test/work', { source_url: seed[2].url }),
      candidate(`${seed[0].url}?utm_source=saved`),
    ]
    const fresh = owners().slice(3)
    expect(select([...seed, ...aliases, ...fresh], 12)).toEqual([...seed, ...fresh])
  })

  it('does not promote raw attachments or parent aliases from a post into refill families', () => {
    const post = candidate('https://x.com/reader/status/123', { source_channel: 'twitter-bookmark' })
    const attachments = ['https://pbs.twimg.com/media/one.jpg', 'https://pbs.twimg.com/media/two.jpg', 'https://pbs.twimg.com/media/three.jpg']
      .map(url => candidate(url, { source_channel: 'twitter-bookmark', parent_source: post, page_url: post.url }))
    const initial = select([post, ...attachments], 10)
    expect(initial).toHaveLength(4) // existing channel allowance is not globally removed
    const inspected = initial.map(source => ({ ...source, source_type: source === post ? 'tweet' : 'article', image_url: attachments[0].url }))
    expect(selectContentSources(inspected)).toEqual([inspected[0]])
    const seed = owners().slice(0, 3)
    const media = ['https://cdn.test/one.png', 'https://cdn.test/two.gif', 'https://cdn.test/three.mp4', 'https://cdn.test/four.mp3', 'https://cdn.test/five.svg', 'https://cdn.test/six.pdf']
      .map(url => candidate(url, { note_score: 0 }))
    const parentAlias = candidate('https://cdn.test/opaque', { parent_source: seed[0], page_url: seed[0].url })
    expect(select([...seed, parentAlias, ...media], 20)).toEqual(seed)
  })

  it('keeps archive exclusion and creative admission independent of refill', () => {
    const seed = owners().slice(0, 3)
    const fresh = candidate('https://fresh.test/work')
    const archived = candidate('https://spent.test/work')
    const alias = candidate('https://fresh-alias.test/work', { final_url: archived.url })
    const unsafe = candidate('http://127.0.0.1/work')
    const admin = candidate('https://form.test/signup')
    const recentSourceKeys = new Set([sourceContentKey(archived)])
    const shared = select([...seed, fresh, archived, alias, unsafe, admin], 20, { recentSourceKeys })
    expect(shared).toContain(fresh)
    expect(shared).not.toContain(archived)
    expect(shared).not.toContain(alias)
    expect(shared).not.toContain(unsafe)
    // Independent notes may still fetch archive records under legacy allowRecent;
    // neither route may admit them, or confer creativity just by fetching a page.
    const separate = select([...seed, fresh, archived, alias, unsafe, admin].map((s, i) => ({ ...s, note_id: `separate-${i}` })), 20, { recentSourceKeys })
    const surfaces = records => records.map(s => ({ ...s, image_url: `https://images.test/${new URL(s.url).hostname}.jpg` }))
    for (const records of [shared, separate]) {
      expect(selectContentSources(surfaces(records), { recentSourceKeys }).some(s => [archived.url, alias.url, unsafe.url].includes(s.url))).toBe(false)
      expect(selectContentSources(surfaces(records), { recentSourceKeys, autoresearch: { source_decisions: [] } })).toEqual([])
    }
  })
})
