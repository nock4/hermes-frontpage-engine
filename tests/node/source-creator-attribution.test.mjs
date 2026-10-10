import { it, expect, vi, afterEach } from 'vitest'
vi.mock('playwright', () => ({ chromium: { launch: async () => { throw new Error('No playback browser in source attribution test') } } }))
import { inspectCandidateSource } from '../../scripts/lib/source-inspection.mjs'
import { schedulingOwner } from '../../scripts/lib/provider-creator.mjs'

it('does not retain invented provider attribution when inspection times out', async () => {
  vi.stubEnv('DFE_TEST_USE_GLOBAL_FETCH', '1')
  vi.stubGlobal('fetch', vi.fn(async () => new Promise(() => {})))
  const url = 'https://www.youtube.com/watch?v=timeoutattribution'
  const source = await inspectCandidateSource({ url, creator_attribution: {
    provider: 'youtube', source_url: url, author_url: 'https://www.youtube.com/@Invented', evidence: 'oembed',
  } }, { sourceTool: 'fetch', timeoutMs: 1 })
  expect(source.fetch_status).toContain('source-inspection-timeout')
  expect(source.creator_attribution).toBeNull()
  expect(schedulingOwner(source)).toBe('youtube.com')
})
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })
it('stamps only fetched attribution on the normalized source, replacing caller claims', async () => {
  vi.stubEnv('DFE_TEST_USE_GLOBAL_FETCH', '1')
  vi.stubGlobal('fetch', vi.fn(async url => String(url).includes('/oembed?')
    ? new Response(JSON.stringify({author_url:'https://www.youtube.com/@FetchedUploader'}), {headers:{'content-type':'application/json'}})
    : new Response('<html><meta property="og:title" content="A quiet evening"></html>', {headers:{'content-type':'text/html'}})))
  const url='https://www.youtube.com/watch?v=attributionintegration'
  const source=await inspectCandidateSource({url,creator_attribution:{provider:'youtube',source_url:url,author_url:'https://www.youtube.com/@Invented',evidence:'oembed'}},{sourceTool:'fetch'})
  expect(source.creator_attribution).toEqual({provider:'youtube',source_url:url,author_url:'https://www.youtube.com/@FetchedUploader',evidence:'oembed'})
  expect(source.editorial_evidence[0].creator_attribution.author_url).toContain('Invented')
})
