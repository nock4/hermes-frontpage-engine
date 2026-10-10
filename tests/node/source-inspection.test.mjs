import dns from 'node:dns/promises'
import { EventEmitter } from 'node:events'
import https from 'node:https'
import { Readable } from 'node:stream'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'

import {
  classifyYouTubeEmbedFrameText,
  inspectCandidateSource,
  inspectWithFetch,
  youtubeEmbedStatus,
} from '../../scripts/lib/source-inspection.mjs'

import { isAiToolingContentSource, isAutoresearchExcluded } from '../../scripts/lib/source-selection-policy.mjs'

const previousTestFetchMode = process.env.DFE_TEST_USE_GLOBAL_FETCH
process.env.DFE_TEST_USE_GLOBAL_FETCH = '1'

afterEach(() => {
  vi.unstubAllGlobals()
})

afterAll(() => {
  if (previousTestFetchMode === undefined) delete process.env.DFE_TEST_USE_GLOBAL_FETCH
  else process.env.DFE_TEST_USE_GLOBAL_FETCH = previousTestFetchMode
})

describe('source inspection', () => {
  it('retains pre-enrichment rejection and workflow evidence when metadata is replaced', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true, status: 200,
      text: async () => '<html><meta property="og:title" content="Beautiful colors"><meta property="og:description" content="Images"><meta property="og:image" content="/art.jpg"></html>',
    })))
    const candidate = { url: 'https://example.com/story', title: 'Deploy these skills using AI', description: 'pip install new-tool', autoresearch_role: 'reject' }
    const source = await inspectCandidateSource(candidate, { sourceTool: 'fetch' })
    expect(source.title).toBe('Beautiful colors')
    expect(isAiToolingContentSource(source)).toBe(true)
    expect(isAutoresearchExcluded(source)).toBe(true)
  })

  describe('bounded image health when the server ignores Range', () => {
    afterEach(() => {
      vi.restoreAllMocks()
      vi.unstubAllEnvs()
    })

    it.each([
      ['ordinary JPEG', 60_000, 'image/jpeg', true],
      ['JPEG at the byte ceiling', 8_000_000, 'image/jpeg', true],
      ['oversized JPEG', 8_000_001, 'image/jpeg', false],
      ['HTML masquerading as an image', 60_000, 'text/html', false],
      ['SVG', 60_000, 'image/svg+xml', false],
    ])('%s', async (label, byteLength, contentType, loadable) => {
      // Exercise the real vetted response reader: global-fetch test mode skips
      // byte enforcement and would make the Range regression pass incorrectly.
      vi.stubEnv('DFE_TEST_USE_GLOBAL_FETCH', '0')
      vi.spyOn(dns, 'lookup').mockResolvedValue([{ address: '93.184.216.34', family: 4 }])
      const imageUrl = `https://images.example.com/${encodeURIComponent(label)}.jpg`
      const imageResponse = Readable.from([Buffer.alloc(byteLength)])
      imageResponse.statusCode = 200
      imageResponse.headers = { 'content-type': contentType }
      const destroyImage = vi.spyOn(imageResponse, 'destroy')
      const requests = []
      vi.spyOn(https, 'request').mockImplementation((options, onResponse) => {
        const request = new EventEmitter()
        request.destroy = vi.fn((error) => queueMicrotask(() => request.emit('error', error)))
        request.end = () => queueMicrotask(() => {
          if (options.hostname === 'images.example.com') {
            onResponse(imageResponse)
          } else {
            const page = Readable.from([Buffer.from(`<meta property="og:title" content="Art study"><meta property="og:image" content="${imageUrl}">`)])
            page.statusCode = 200
            page.headers = { 'content-type': 'text/html' }
            onResponse(page)
          }
        })
        requests.push({ options, request })
        return request
      })

      const source = await inspectCandidateSource(
        { url: 'https://example.com/art-study', note_title: 'Art study' },
        { sourceTool: 'fetch' },
      )

      expect(source.fetch_status).toBe('fetch-ok')
      expect(source.image_url).toBe(loadable ? imageUrl : null)
      const imageRequest = requests.find(({ options }) => options.hostname === 'images.example.com')
      expect(imageRequest.options.headers.range).toBe('bytes=0-4095')
      const pinnedLookup = vi.fn()
      imageRequest.options.lookup('images.example.com', { all: true }, pinnedLookup)
      expect(pinnedLookup).toHaveBeenCalledWith(null, [{ address: '93.184.216.34', family: 4 }])
      if (byteLength > 8_000_000) {
        expect(destroyImage).toHaveBeenCalledWith(expect.objectContaining({ message: 'Response exceeded 8000000 bytes' }))
        expect(imageRequest.request.destroy).toHaveBeenCalledWith(expect.objectContaining({ message: 'Response exceeded 8000000 bytes' }))
      }
    })
  })

  it('retains fetched oEmbed attribution without trusting title, notes, or off-provider author URLs', async () => {
    const { youtubeCreatorAttribution } = await import('../../scripts/lib/source-inspection.mjs')
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ author_url: 'https://www.youtube.com/@RealUploader', author_name: 'not an identity key' }) })))
    const url = 'https://www.youtube.com/watch?v=creatorproof'
    await youtubeEmbedStatus(url, { verifyPlayback: false })
    expect(typeof youtubeCreatorAttribution).toBe('function')
    expect(youtubeCreatorAttribution(url)).toEqual({ provider: 'youtube', source_url: url, author_url: 'https://www.youtube.com/@RealUploader', evidence: 'oembed' })
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ author_url: 'https://evil.example/@RealUploader' }) })))
    const bad = 'https://www.youtube.com/watch?v=badcreatorproof'
    await youtubeEmbedStatus(bad, { verifyPlayback: false })
    expect(youtubeCreatorAttribution(bad)).toBeNull()
  })

  it('checks YouTube embeddability through oEmbed', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      headers: new Headers(),
    })))

    await expect(youtubeEmbedStatus('https://www.youtube.com/watch?v=abc123', { verifyPlayback: false })).resolves.toBeNull()
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('youtube.com/oembed'),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
  })

  it('marks YouTube videos unavailable when oEmbed fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      headers: new Headers(),
    })))

    await expect(youtubeEmbedStatus('https://www.youtube.com/watch?v=xyz789', { verifyPlayback: false })).resolves.toBe('unavailable')
  })

  it('classifies YouTube iframe text that means linkout-only playback', () => {
    expect(classifyYouTubeEmbedFrameText('Video unavailable\nWatch on YouTube')).toBe('unavailable')
    expect(classifyYouTubeEmbedFrameText('Watch video on YouTube\nError 153\nVideo player configuration error')).toBe('unavailable')
    expect(classifyYouTubeEmbedFrameText('A playable title\nChannel name\nWatch on')).toBeNull()
  })

  it('parses fetch fallback metadata from HTML', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => `
        <html>
          <head>
            <meta property="og:title" content="Encoded &amp; Title">
            <meta property="og:description" content="Readable source description">
            <meta property="og:image" content="/lead.jpg">
          </head>
        </html>
      `,
    })))

    const source = await inspectWithFetch(
      {
        url: 'https://example.com/story',
        note_title: 'Fallback note title',
      },
      'https://example.com/story',
      { source_type: 'article', window_type: 'web', kind: 'article' },
    )

    expect(source).toMatchObject({
      source_url: 'https://example.com/story',
      final_url: 'https://example.com/story',
      title: 'Encoded & Title',
      description: 'Readable source description',
      image_url: 'https://example.com/lead.jpg',
      fetch_status: 'fetch-ok',
    })
    expect(fetch).toHaveBeenCalledWith(
      'https://example.com/story',
      expect.objectContaining({ redirect: 'error', signal: expect.any(AbortSignal) }),
    )
  })

  it('extracts safe Bandcamp embed html from fetched album pages', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => `
        <html>
          <head>
            <meta property="og:title" content="Music For Four Guitars">
            <meta property="og:image" content="https://f4.bcbits.com/img/0038659416_38.jpg">
          </head>
          <body data-embed="{&quot;tralbum_param&quot;:{&quot;name&quot;:&quot;album&quot;,&quot;value&quot;:1257689164},&quot;embed_info&quot;:{&quot;public_embeddable&quot;:true}}"></body>
        </html>
      `,
    })))

    const source = await inspectWithFetch(
      {
        url: 'https://billorcutt.bandcamp.com/album/music-for-four-guitars',
        note_title: 'Bandcamp source',
      },
      'https://billorcutt.bandcamp.com/album/music-for-four-guitars',
      { source_type: 'audio', window_type: 'audio', kind: 'audio' },
    )

    expect(source.source_embed_html).toContain('https://bandcamp.com/EmbeddedPlayer/album=1257689164/')
    expect(source.source_embed_html).toContain('artwork=small')
  })

  it.each(['https://x.com/maker/status/12345', 'https://x.com/status/12345', 'https://x.com/i/web/status/12345'])('extracts tweet media through fxtwitter for %s', async (tweetUrl) => {
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      const href = String(url)
      if (href.includes('api.fxtwitter.com')) {
        return {
          ok: true,
          json: async () => ({
            tweet: {
              url: 'https://x.com/maker/status/12345',
              text: 'a moving source surface',
              author: { screen_name: 'maker' },
              media: {
                all: [{
                  type: 'video',
                  thumbnail_url: 'https://pbs.twimg.com/media/tweet-thumb.jpg',
                  variants: [
                    { url: 'https://video.twimg.com/ext_tw_video/low.mp4', bitrate: 256000 },
                    { url: 'https://video.twimg.com/ext_tw_video/high.mp4', bitrate: 2176000 },
                  ],
                }],
              },
            },
          }),
        }
      }

      return new Response(Buffer.from('image bytes'), { headers: { 'content-type': 'image/jpeg' } })
    }))

    const source = await inspectCandidateSource(
      { url: tweetUrl, note_title: 'Tweet with video' },
      { sourceTool: 'fetch', browserHarness: null },
    )

    expect(source).toMatchObject({
      source_type: 'tweet',
      media_type: 'video',
      media_url: 'https://video.twimg.com/ext_tw_video/high.mp4',
      image_url: 'https://pbs.twimg.com/media/tweet-thumb.jpg',
      fetch_status: 'fxtwitter-fetch-ok',
    })
  })

  it('returns a structured fetch error record instead of throwing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('network down')
    }))

    const source = await inspectWithFetch(
      {
        url: 'https://example.com/story',
        note_title: 'Fallback note title',
      },
      'https://example.com/story',
      { source_type: 'article', window_type: 'web', kind: 'article' },
    )

    expect(source).toMatchObject({
      title: 'Fallback note title',
      image_url: null,
      fetch_status: 'fetch-error: network down',
    })
  })

  it('keeps YouTube videos renderable when the watch page exceeds the HTML byte cap', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('Response exceeded 1000001 bytes')
    }))

    const source = await inspectWithFetch(
      {
        url: 'https://www.youtube.com/watch?v=CmrUK_26Xj0',
        note_title: 'Yuzuru Syogase ‎- 1983-85 (Full Cassette)',
      },
      'https://www.youtube.com/watch?v=CmrUK_26Xj0',
      { source_type: 'youtube', window_type: 'video', kind: 'video' },
    )

    expect(source).toMatchObject({
      title: 'Yuzuru Syogase ‎- 1983-85 (Full Cassette)',
      image_url: 'https://img.youtube.com/vi/CmrUK_26Xj0/hqdefault.jpg',
      fetch_status: expect.stringContaining('fetch-error-youtube-thumbnail-fallback:'),
    })
  })

  it('bounds whole source inspection so a hung fetch cannot stall source research', async () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))

    const source = await inspectCandidateSource(
      { url: 'https://example.com/hangs', note_title: 'Hung source' },
      { sourceTool: 'fetch', browserHarness: null, timeoutMs: 25 },
    )

    expect(source).toMatchObject({
      title: 'Hung source',
      image_url: null,
      fetch_status: expect.stringContaining('source-inspection-timeout:'),
      browser_error: expect.stringContaining('Source inspection timed out after 25ms'),
    })
  })
})
