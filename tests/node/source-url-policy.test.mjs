import { describe, expect, it } from 'vitest'

import {
  canonicalizeSourceUrl,
  extractUrls,
  hostnameForUrl,
  isAllowedSourceUrl,
  isBandcampStreamingSourceUrl,
  isPreferredNtsStreamingSourceUrl,
  isSoundCloudStreamingSourceUrl,
  isYouTubeSearchLocatorUrl,
  isYouTubeThumbnailUrl,
  isYouTubeVideoUrl,
  ntsStreamingSourceRank,
  youtubeId,
} from '../../scripts/lib/source-url-policy.mjs'

describe('source URL policy', () => {
  it('extracts and cleans http URLs from text', () => {
    expect(extractUrls('see (https://example.com/story?x=1&amp;y=2), and https://bad.local/a')).toEqual([
      'https://example.com/story?x=1&y=2',
      'https://bad.local/a',
    ])
  })

  it('rejects local, document, NTS page, and thumbnail URLs', () => {
    expect(isAllowedSourceUrl('https://example.com/story')).toBe(true)
    expect(isAllowedSourceUrl('http://localhost:3000/story')).toBe(false)
    expect(isAllowedSourceUrl('http://localhost./story')).toBe(false)
    expect(isAllowedSourceUrl('http://127.0.0.1/story')).toBe(false)
    expect(isAllowedSourceUrl('http://0.0.0.0/story')).toBe(false)
    expect(isAllowedSourceUrl('http://169.254.169.254/latest/meta-data')).toBe(false)
    expect(isAllowedSourceUrl('http://192.168.1.10/story')).toBe(false)
    expect(isAllowedSourceUrl('http://172.16.0.5/story')).toBe(false)
    expect(isAllowedSourceUrl('http://100.64.0.1/story')).toBe(false)
    expect(isAllowedSourceUrl('http://198.18.0.1/story')).toBe(false)
    expect(isAllowedSourceUrl('http://[::1]/story')).toBe(false)
    expect(isAllowedSourceUrl('http://[::ffff:127.0.0.1]/story')).toBe(false)
    expect(isAllowedSourceUrl('http://[::ffff:c0a8:010a]/story')).toBe(false)
    expect(isAllowedSourceUrl('http://2130706433/story')).toBe(false)
    expect(isAllowedSourceUrl('http://0177.0.0.1/story')).toBe(false)
    expect(isAllowedSourceUrl('http://0x7f.0.0.1/story')).toBe(false)
    expect(isAllowedSourceUrl('http://127.1/story')).toBe(false)
    expect(isAllowedSourceUrl('http://[fc00::1]/story')).toBe(false)
    expect(isAllowedSourceUrl('https://example.com/llm.txt')).toBe(false)
    expect(isAllowedSourceUrl('https://nts.live/shows/example')).toBe(false)
    expect(isAllowedSourceUrl('https://nts.live./shows/example')).toBe(false)
    expect(isAllowedSourceUrl('https://img.youtube.com/vi/abc123/hqdefault.jpg')).toBe(false)
  })

  it('classifies playable YouTube URLs without accepting thumbnail URLs as sources', () => {
    expect(youtubeId('https://youtu.be/abc123')).toBe('abc123')
    expect(youtubeId('https://www.youtube.com/watch?v=abc123')).toBe('abc123')
    expect(isYouTubeVideoUrl('https://www.youtube.com/shorts/abc123')).toBe(true)
    expect(isYouTubeThumbnailUrl('https://i.ytimg.com/vi/abc123/hqdefault.jpg')).toBe(true)
    expect(isYouTubeVideoUrl('https://i.ytimg.com/vi/abc123/hqdefault.jpg')).toBe(false)
  })

  it('keeps NTS resolved streaming source preference explicit', () => {
    expect(isYouTubeSearchLocatorUrl('https://www.youtube.com/results?search_query=track')).toBe(true)
    expect(isPreferredNtsStreamingSourceUrl('https://www.youtube.com/watch?v=abc123')).toBe(true)
    expect(isBandcampStreamingSourceUrl('https://artist.bandcamp.com/track/song')).toBe(true)
    expect(isSoundCloudStreamingSourceUrl('https://soundcloud.com/artist/song')).toBe(true)
    expect(isPreferredNtsStreamingSourceUrl('https://soundcloud.com/search?q=song')).toBe(false)
    expect(ntsStreamingSourceRank('https://www.youtube.com/watch?v=abc123')).toBeLessThan(ntsStreamingSourceRank('https://artist.bandcamp.com/track/song'))
  })

  it('canonicalizes source identity for duplicate prevention', () => {
    expect(hostnameForUrl('https://www.Example.com/path')).toBe('example.com')
    expect(canonicalizeSourceUrl('https://twitter.com/person/status/123?s=20')).toBe('x.com/person/status/123')
    expect(canonicalizeSourceUrl('https://img.youtube.com/vi/abc123/hqdefault.jpg')).toBe('youtube.com/watch/abc123')
    expect(canonicalizeSourceUrl('https://www.youtube.com/watch?v=abc123&feature=share')).toBe('youtube.com/watch/abc123')
    expect(canonicalizeSourceUrl('https://pbs.twimg.com/media/HHP5cUjW0AA71LA.jpg?name=orig')).toBe('pbs.twimg.com/media/hhp5cujw0aa71la.jpg')
    expect(canonicalizeSourceUrl('https://pbs.twimg.com/media/HHP5cUjW0AA71LA.jpg:large')).toBe('pbs.twimg.com/media/hhp5cujw0aa71la.jpg')
  })
})
