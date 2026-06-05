import { describe, expect, it } from 'vitest'

import {
  aestheticSignalScore,
  classifySource,
  isAllowedInspectedSource,
  isDirectRasterImageUrl,
  isLowValueVisualImage,
  selectBestVisualReference,
  selectContentSources,
  selectSourceCandidatesForInspection,
  sourceContentKey,
  sourceContentScore,
  sourceHasRenderableCardSurface,
} from '../../scripts/lib/source-selection-policy.mjs'

const baseSource = {
  url: 'https://example.com/story',
  source_url: 'https://example.com/story',
  final_url: 'https://example.com/story',
  note_score: 20,
  source_channel: 'chrome-bookmark',
  source_type: 'article',
  fetch_status: 'browser-harness',
  image_url: 'https://example.com/lead.jpg',
}

describe('source selection policy', () => {
  it('scores creative visual culture above infrastructure', () => {
    const art = aestheticSignalScore({
      url: 'https://example.com/gallery/animated-masks',
      note_title: 'surreal animation masks and album art',
      description: 'music video stills, collage, costume, visual archive',
      source_channel: 'chrome-bookmark',
    })
    const infra = aestheticSignalScore({
      url: 'https://github.com/acme/agent-framework',
      note_title: 'AI agent infra framework docs',
      description: 'API, quickstart, orchestration, tool calls, zod schemas',
      source_channel: 'chrome-bookmark',
    })

    expect(art).toBeGreaterThan(20)
    expect(infra).toBeLessThan(0)
    expect(art).toBeGreaterThan(infra + 30)
  })

  it('puts creative candidates ahead of infrastructure during source inspection', () => {
    const signalHarvest = {
      source_candidates: [
        { url: 'https://github.com/acme/agent-framework', source_channel: 'chrome-bookmark', note_score: 90, note_id: 'infra-a', note_title: 'AI agent orchestration API docs' },
        { url: 'https://spreadjam.com', source_channel: 'chrome-bookmark', note_score: 85, note_id: 'infra-b', note_title: 'AI SEO growth channel agents' },
        { url: 'https://www.youtube.com/watch?v=mask123', source_channel: 'youtube-like', note_score: 30, note_id: 'art-a', note_title: 'surreal claymation music video masks' },
        { url: 'https://publicdomainreview.org/collection/poster-collage', source_channel: 'chrome-bookmark', note_score: 28, note_id: 'art-b', note_title: 'poster collage visual archive' },
        { url: 'https://label.bandcamp.com/album/nocturne', source_channel: 'nts-like', note_score: 25, note_id: 'art-c', note_title: 'ambient album art and visualizer' },
      ],
    }

    expect(selectSourceCandidatesForInspection(signalHarvest, 3).map((source) => source.url)).toEqual([
      'https://www.youtube.com/watch?v=mask123',
      'https://label.bandcamp.com/album/nocturne',
      'https://publicdomainreview.org/collection/poster-collage',
    ])
  })

  it('classifies source URLs into runtime binding types', () => {
    expect(classifySource('https://www.youtube.com/watch?v=abc123')).toMatchObject({ source_type: 'youtube', window_type: 'video' })
    expect(classifySource('https://x.com/person/status/123')).toMatchObject({ source_type: 'tweet', window_type: 'social' })
    expect(classifySource('https://github.com/openai/codex')).toMatchObject({ source_type: 'github', window_type: 'web' })
  })

  it('rejects inspected sources that point at unavailable embeds or disallowed URLs', () => {
    expect(isAllowedInspectedSource(baseSource)).toBe(true)
    expect(isAllowedInspectedSource({ ...baseSource, youtube_embed_status: 'unavailable' })).toBe(false)
    expect(isAllowedInspectedSource({ ...baseSource, final_url: 'https://example.com/llm.txt' })).toBe(false)
  })

  it('filters low-value images while accepting direct raster media', () => {
    expect(isLowValueVisualImage('https://example.com/favicon.ico')).toBe(true)
    expect(isLowValueVisualImage('https://abs.twimg.com/profile_images/avatar.jpg')).toBe(true)
    expect(isLowValueVisualImage('https://scontent.cdninstagram.com/v/t51.82787-19/avatar.jpg?stp=dst-jpg_s100x100_tt6')).toBe(true)
    expect(isLowValueVisualImage('https://example.com/field-photo.jpg')).toBe(false)
    expect(isDirectRasterImageUrl('https://pbs.twimg.com/media/abc123?format=jpg&name=large')).toBe(true)
  })

  it('uses canonical source identity for duplicate prevention', () => {
    expect(sourceContentKey({ url: 'https://twitter.com/person/status/123?s=20' })).toBe('x.com/person/status/123')
    expect(sourceContentKey({
      url: 'https://t.co/short',
      final_url: 'https://www.youtube.com/watch?v=abc123&feature=share',
    })).toBe('youtube.com/watch/abc123')
  })

  it('selects renderable visual and native-media sources ahead of text-only sources', () => {
    const youtube = {
      ...baseSource,
      url: 'https://www.youtube.com/watch?v=abc123',
      source_url: 'https://www.youtube.com/watch?v=abc123',
      final_url: 'https://www.youtube.com/watch?v=abc123',
      source_type: 'youtube',
      source_channel: 'youtube-like',
      image_url: null,
    }
    const textOnly = {
      ...baseSource,
      url: 'https://example.com/text-only',
      source_url: 'https://example.com/text-only',
      final_url: 'https://example.com/text-only',
      image_url: null,
    }

    expect(sourceHasRenderableCardSurface(youtube)).toBe(true)
    expect(sourceHasRenderableCardSurface(textOnly)).toBe(false)
    expect(sourceContentScore(youtube)).toBeGreaterThan(0)
    expect(new Set(selectContentSources([textOnly, youtube, baseSource], { targetItems: 2 }).map((source) => source.url))).toEqual(new Set([
      baseSource.url,
      youtube.url,
    ]))
  })

  it('selects renderable creative content ahead of SaaS infrastructure surfaces', () => {
    const creative = {
      ...baseSource,
      url: 'https://label.bandcamp.com/album/nocturne',
      source_url: 'https://label.bandcamp.com/album/nocturne',
      final_url: 'https://label.bandcamp.com/album/nocturne',
      source_channel: 'nts-like',
      source_type: 'audio',
      note_score: 20,
      title: 'ambient album art and visualizer',
      image_url: 'https://f4.bcbits.com/img/a2618795326_5.jpg',
    }
    const infrastructure = {
      ...baseSource,
      url: 'https://spreadjam.com',
      source_url: 'https://spreadjam.com',
      final_url: 'https://spreadjam.com',
      source_channel: 'chrome-bookmark',
      source_type: 'article',
      note_score: 180,
      title: 'AI SEO growth channel agents',
      description: 'SaaS agent infrastructure for cold email and AI search visibility',
      image_url: 'https://spreadjam.com/og-image.png',
    }

    expect(selectContentSources([infrastructure, creative], { targetItems: 2 }).map((source) => source.url)[0]).toBe(creative.url)
  })

  it('keeps a tweet and its extracted media from becoming duplicate content cards', () => {
    const tweet = {
      ...baseSource,
      url: 'https://x.com/mamosdigital/status/2038660432471179433',
      source_url: 'https://x.com/mamosdigital/status/2038660432471179433',
      final_url: 'https://x.com/mamosdigital/status/2038660432471179433',
      source_type: 'tweet',
      source_channel: 'twitter-bookmark',
      note_id: 'tweet-a',
      title: '@mamosdigital: my game is for retro open world fans',
      image_url: null,
    }
    const extractedMedia = {
      ...baseSource,
      url: 'https://pbs.twimg.com/amplify_video_thumb/2038660307678011392/img/vW_abto9HcLH8vVZ.jpg',
      source_url: 'https://pbs.twimg.com/amplify_video_thumb/2038660307678011392/img/vW_abto9HcLH8vVZ.jpg',
      final_url: 'https://pbs.twimg.com/amplify_video_thumb/2038660307678011392/img/vW_abto9HcLH8vVZ.jpg',
      source_type: 'article',
      source_channel: 'twitter-bookmark',
      note_id: 'tweet-a',
      title: '@mamosdigital: my game is for retro open world fans',
      image_url: null,
    }
    const signalHarvest = {
      notes_selected: [{
        id: 'tweet-a',
        urls: [extractedMedia.url],
      }],
    }

    const selected = selectContentSources([extractedMedia, tweet], { targetItems: 2, signalHarvest })
    expect(selected.map((source) => source.url)).toEqual([tweet.url])
  })

  it('does not backfill content cards with recent source duplicates', () => {
    const fresh = {
      ...baseSource,
      url: 'https://example.com/fresh',
      source_url: 'https://example.com/fresh',
      final_url: 'https://example.com/fresh',
    }
    const recent = {
      ...baseSource,
      url: 'https://example.com/recent',
      source_url: 'https://example.com/recent',
      final_url: 'https://example.com/recent',
      note_score: 100,
    }
    const recentSourceKeys = new Set([sourceContentKey(recent)])

    const selected = selectContentSources([recent, fresh], {
      recentSourceKeys,
      targetItems: 2,
      maxItems: 2,
    })

    expect(selected.map((source) => source.url)).toEqual([fresh.url])
    expect(sourceContentScore(recent, recentSourceKeys)).toBe(Number.NEGATIVE_INFINITY)
  })

  it('uses non-duplicate NTS audio before duplicate social media during content selection', () => {
    const repeatedTweet = {
      ...baseSource,
      url: 'https://x.com/supertommy/status/2039044393173135802',
      source_url: 'https://x.com/supertommy/status/2039044393173135802',
      final_url: 'https://x.com/supertommy/status/2039044393173135802',
      source_type: 'tweet',
      source_channel: 'twitter-bookmark',
      note_id: 'tweet-a',
      image_url: 'https://pbs.twimg.com/amplify_video_thumb/2039042919613837312/img/5u-TiIX5JsL6l7hb.jpg',
    }
    const audio = {
      ...baseSource,
      url: 'https://feeo.bandcamp.com/track/requiem',
      source_url: 'https://feeo.bandcamp.com/track/requiem',
      final_url: 'https://feeo.bandcamp.com/track/requiem',
      source_type: 'audio',
      source_channel: 'nts-like',
      image_url: 'https://f4.bcbits.com/img/a2618795326_5.jpg',
    }
    const recentSourceKeys = new Set([sourceContentKey(repeatedTweet)])

    const selected = selectContentSources([repeatedTweet, audio], {
      recentSourceKeys,
      targetItems: 2,
      maxItems: 2,
    })

    expect(selected.map((source) => source.url)).toEqual([audio.url])
  })

  it('does not use raw Twitter CDN media as a primary content source', () => {
    const rawMedia = {
      ...baseSource,
      url: 'https://pbs.twimg.com/amplify_video_thumb/2039042919613837312/img/5u-TiIX5JsL6l7hb.jpg',
      source_url: 'https://pbs.twimg.com/amplify_video_thumb/2039042919613837312/img/5u-TiIX5JsL6l7hb.jpg',
      final_url: 'https://pbs.twimg.com/amplify_video_thumb/2039042919613837312/img/5u-TiIX5JsL6l7hb.jpg',
      source_channel: 'twitter-bookmark',
      source_type: 'article',
      image_url: null,
    }
    const audio = {
      ...baseSource,
      url: 'https://metronrecords.bandcamp.com/album/komachi',
      source_url: 'https://metronrecords.bandcamp.com/album/komachi',
      final_url: 'https://metronrecords.bandcamp.com/album/komachi',
      source_channel: 'nts-like',
      source_type: 'audio',
      image_url: 'https://f4.bcbits.com/img/a1113539546_5.jpg',
    }

    expect(sourceHasRenderableCardSurface(rawMedia)).toBe(false)
    expect(sourceContentScore(rawMedia)).toBe(Number.NEGATIVE_INFINITY)
    expect(selectContentSources([rawMedia, audio], { targetItems: 2, maxItems: 2 }).map((source) => source.url)).toEqual([audio.url])
  })

  it('prefers native tweet URLs over raw Twitter media during candidate inspection', () => {
    const signalHarvest = {
      source_candidates: [
        {
          url: 'https://pbs.twimg.com/amplify_video_thumb/2039042919613837312/img/5u-TiIX5JsL6l7hb.jpg',
          source_channel: 'twitter-bookmark',
          note_score: 20,
          note_id: 'tweet-a',
        },
        {
          url: 'https://x.com/supertommy/status/2039044393173135802',
          source_channel: 'twitter-bookmark',
          note_score: 20,
          note_id: 'tweet-a',
        },
      ],
    }

    expect(selectSourceCandidatesForInspection(signalHarvest, 1).map((source) => source.url)).toEqual([
      'https://x.com/supertommy/status/2039044393173135802',
    ])
  })

  it('keeps source candidate inspection channel-balanced and duplicate-aware', () => {
    const signalHarvest = {
      source_candidates: [
        { url: 'https://www.youtube.com/watch?v=abc123', source_channel: 'youtube-like', note_score: 10, note_id: 'a' },
        { url: 'https://artist.bandcamp.com/track/song', source_channel: 'nts-like', note_score: 9, note_id: 'b' },
        { url: 'https://example.com/gallery.jpg', source_channel: 'chrome-bookmark', note_score: 8, note_id: 'c' },
        { url: 'https://x.com/person/status/123', source_channel: 'twitter-bookmark', note_score: 7, note_id: 'd' },
        { url: 'https://example.com/llm.txt', source_channel: 'chrome-bookmark', note_score: 100, note_id: 'e' },
      ],
    }

    const selected = selectSourceCandidatesForInspection(signalHarvest, 4)
    expect(selected.map((source) => source.source_channel)).toEqual([
      'youtube-like',
      'nts-like',
      'chrome-bookmark',
      'twitter-bookmark',
    ])
    expect(selected.map((source) => source.url)).not.toContain('https://example.com/llm.txt')
  })

  it('keeps NTS Bandcamp fallbacks in the inspection set when YouTube candidates dominate', () => {
    const signalHarvest = {
      source_candidates: [
        ...Array.from({ length: 10 }, (_, index) => ({
          url: `https://www.youtube.com/watch?v=nts${index}`,
          source_channel: 'nts-like',
          note_score: 60,
          note_id: 'nts',
        })),
        {
          url: 'https://artist.bandcamp.com/track/quiet-song',
          source_channel: 'nts-like',
          note_score: 60,
          note_id: 'nts',
        },
        {
          url: 'https://another.bandcamp.com/album/quiet-album',
          source_channel: 'nts-like',
          note_score: 60,
          note_id: 'nts',
        },
      ],
    }

    const selected = selectSourceCandidatesForInspection(signalHarvest, 12).map((source) => source.url)
    expect(selected).toContain('https://artist.bandcamp.com/track/quiet-song')
    expect(selected).toContain('https://another.bandcamp.com/album/quiet-album')
  })

  it('allows distinct resolved NTS tracks from one source-map note to fill the content set', () => {
    const sources = Array.from({ length: 7 }, (_, index) => ({
      ...baseSource,
      url: `https://artist-${index}.bandcamp.com/track/song-${index}`,
      source_url: `https://artist-${index}.bandcamp.com/track/song-${index}`,
      final_url: `https://artist-${index}.bandcamp.com/track/song-${index}`,
      source_channel: 'nts-like',
      source_type: 'audio',
      note_id: 'nts-source-map',
      image_url: `https://f4.bcbits.com/img/a${index}_5.jpg`,
    }))

    expect(selectContentSources(sources, { targetItems: 7, maxItems: 7 })).toHaveLength(7)
  })

  it('allows a narrow day of distinct X bookmarks to reach the source-window floor', () => {
    const signalHarvest = {
      source_candidates: Array.from({ length: 7 }, (_, index) => ({
        url: `https://x.com/person${index}/status/${1000 + index}`,
        source_channel: 'twitter-bookmark',
        note_score: 50 - index,
        note_id: `tweet-${index}`,
        note_title: `visual tweet ${index}`,
      })),
    }
    const inspected = signalHarvest.source_candidates.map((candidate, index) => ({
      ...baseSource,
      ...candidate,
      source_url: candidate.url,
      final_url: candidate.url,
      source_type: 'tweet',
      image_url: `https://pbs.twimg.com/media/test${index}.jpg?name=orig`,
    }))

    expect(selectSourceCandidatesForInspection(signalHarvest, 7)).toHaveLength(7)
    expect(selectContentSources(inspected, { targetItems: 7, maxItems: 7 })).toHaveLength(7)
  })

  it('selects the strongest non-placeholder visual reference', () => {
    const best = selectBestVisualReference([
      { ...baseSource, url: 'https://example.com/favicon', image_url: 'https://example.com/favicon.ico' },
      { ...baseSource, url: 'https://nativegardendesigns.com/gallery', image_url: 'https://nativegardendesigns.com/meadow.jpg', note_title: 'Native garden photos' },
    ])

    expect(best.source.url).toBe('https://nativegardendesigns.com/gallery')
  })
})
