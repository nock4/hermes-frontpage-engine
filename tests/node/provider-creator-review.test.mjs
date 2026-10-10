import { afterEach, expect, it, vi } from 'vitest'
const { launch } = vi.hoisted(() => ({ launch: vi.fn(async () => { throw new Error('No browser in regression test') }) }))
vi.mock('playwright', () => ({ chromium: { launch } }))
import { schedulingOwner } from '../../scripts/lib/provider-creator.mjs'
import { youtubeEmbedStatus, youtubeCreatorAttribution } from '../../scripts/lib/source-inspection.mjs'

const source = (url, attributedUrl = url, author = '@Uploader') => ({ url, creator_attribution: {
  provider: 'youtube', source_url: attributedUrl, author_url: `https://www.youtube.com/${author}`, evidence: 'oembed',
} })
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.clearAllMocks() })

it('rejects attribution for a different case-sensitive video ID', () => {
  expect(schedulingOwner(source('https://www.youtube.com/watch?v=AbCdEfGhIJK', 'https://www.youtube.com/watch?v=abcdefghijk'))).toBe('youtube.com')
})
it('recognizes the same case-sensitive ID across trusted YouTube aliases', () => {
  expect(schedulingOwner(source('https://youtu.be/AbCdEfGhIJK', 'https://music.youtube.com/watch?v=AbCdEfGhIJK'))).toBe('https://www.youtube.com/@uploader')
})
it('rejects malformed video IDs and lookalike hosts', () => {
  for (const url of ['https://www.youtube.com/watch?v=bad%2Fid', 'https://evil.youtube.com/watch?v=AbCdEfGhIJK', 'https://www.youtube.com/watch?v=']) {
    expect(schedulingOwner(source(url))).not.toContain('/@')
  }
})
it('normalizes handle casing without collapsing channel ID casing', () => {
  const url = 'https://www.youtube.com/watch?v=AbCdEfGhIJK'
  expect(schedulingOwner(source(url, url, '@Uploader'))).toBe(schedulingOwner(source(url, url, '@uploader')))
  expect(schedulingOwner(source(url, url, 'channel/UCAbCdEfGhIjKlMnOpQrStUv'))).not.toBe(schedulingOwner(source(url, url, 'channel/UCabcdefghijklmnopqrstuv')))
})
it('bounds stalled metadata consumption, cancels its body, and continues playback verification', async () => {
  vi.useFakeTimers()
  let cancelled = false
  const response = new Response(new ReadableStream({ cancel() { cancelled = true } }))
  vi.stubGlobal('fetch', vi.fn(async () => response))
  const url = 'https://www.youtube.com/watch?v=StAlLeDbOdY'
  let finished = false
  const result = youtubeEmbedStatus(url).then(status => { finished = true; return status })
  await vi.advanceTimersByTimeAsync(6000)
  expect(finished).toBe(true)
  expect(await result).toBeNull()
  expect(cancelled).toBe(true)
  expect(launch).toHaveBeenCalledOnce()
  expect(youtubeCreatorAttribution(url)).toBeNull()
})
