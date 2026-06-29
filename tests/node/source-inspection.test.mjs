import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  classifyYouTubeEmbedFrameText,
  inspectCandidateSource,
  inspectWithFetch,
  youtubeEmbedStatus,
} from '../../scripts/lib/source-inspection.mjs'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('source inspection', () => {
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

  it('extracts tweet video media plus thumbnail through fxtwitter', async () => {
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

      return {
        ok: true,
        headers: new Headers({ 'content-type': 'image/jpeg' }),
      }
    }))

    const source = await inspectCandidateSource(
      { url: 'https://x.com/maker/status/12345', note_title: 'Tweet with video' },
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
})
