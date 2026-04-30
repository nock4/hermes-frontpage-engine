import { describe, expect, it } from 'vitest'

import type { EditionManifest, SourceBindingRecord } from '../types/runtime'
import {
  buildRuntimeWarmupPlan,
  collectEditionPackageUrls,
  collectEditionPreconnectOrigins,
  collectWarmImageUrls,
  selectEditionForPath,
} from './runtimeWarmup'

const manifest: EditionManifest = {
  current_edition_id: 'ed-current',
  editions: [
    {
      edition_id: 'ed-current',
      date: '2026-04-18',
      slug: 'signal-greenhouse-bench-v1',
      title: 'Signal Greenhouse Bench',
      path: '/editions/2026-04-18-signal-greenhouse-bench-v1',
      scene_family: 'signal-greenhouse-bench',
      motif_tags: ['signal'],
      preview_asset_path: '/editions/2026-04-18-signal-greenhouse-bench-v1/assets/plate.jpg',
      is_live: true,
    },
    {
      edition_id: 'ed-archive',
      date: '2026-04-17',
      slug: 'night-observatory-v1',
      title: 'Night Observatory',
      path: '/editions/2026-04-16-night-observatory-v1',
      scene_family: 'night-observatory',
      motif_tags: ['night'],
      preview_asset_path: '/editions/2026-04-16-night-observatory-v1/assets/plate.jpg',
      is_live: false,
    },
  ],
}

const baseBinding: SourceBindingRecord = {
  id: 'binding-1',
  artifact_id: 'artifact-1',
  source_type: 'article',
  source_url: 'https://example.com/story',
  window_type: 'web',
  hover_behavior: 'preview',
  click_behavior: 'pin-open',
  playback_persistence: false,
  fallback_type: 'rich-preview',
  title: 'Example binding',
  kicker: 'Scene detail',
  excerpt: 'Example excerpt',
}

describe('runtimeWarmup', () => {
  it('selects the current edition for root paths and archive editions for archive paths', () => {
    expect(selectEditionForPath(manifest, '/').edition_id).toBe('ed-current')
    expect(selectEditionForPath(manifest, '/archive/night-observatory-v1').edition_id).toBe('ed-archive')
  })

  it('builds edition package preload urls', () => {
    expect(collectEditionPackageUrls('/editions/test')).toEqual([
      '/editions/test/edition.json',
      '/editions/test/brief.json',
      '/editions/test/artifact-map.json',
      '/editions/test/source-bindings.json',
      '/editions/test/ambiance.json',
      '/editions/test/review.json',
      '/editions/test/geometry-kit.json',
    ])
  })

  it('dedupes and limits warm image urls', () => {
    const urls = collectWarmImageUrls([
      { ...baseBinding, source_image_url: 'https://images.example.com/a.jpg' },
      { ...baseBinding, id: 'binding-2', source_image_url: 'https://images.example.com/a.jpg' },
      { ...baseBinding, id: 'binding-3', source_image_url: 'https://images.example.com/b.jpg' },
    ], 1)

    expect(urls).toEqual(['https://images.example.com/a.jpg'])
  })

  it('skips private-host image warmups', () => {
    const urls = collectWarmImageUrls([
      { ...baseBinding, source_image_url: 'http://127.0.0.1:8080/private.jpg' },
      { ...baseBinding, id: 'binding-2', source_image_url: 'https://images.example.com/public.jpg' },
    ])

    expect(urls).toEqual(['https://images.example.com/public.jpg'])
  })

  it('collects only the origins needed for the current edition source mix', () => {
    const origins = collectEditionPreconnectOrigins([
      {
        ...baseBinding,
        id: 'youtube-1',
        source_type: 'youtube',
        source_url: 'https://www.youtube.com/watch?v=XUbG8jboh4M',
        window_type: 'video',
        source_image_url: 'https://img.youtube.com/vi/XUbG8jboh4M/hqdefault.jpg',
      },
      {
        ...baseBinding,
        id: 'tweet-1',
        source_type: 'social',
        source_url: 'https://x.com/garrytan/status/2044479509874020852',
        window_type: 'social',
        source_image_url: 'https://abs.twimg.com/emoji/v2/svg/26a0.svg',
      },
      {
        ...baseBinding,
        id: 'article-1',
        source_url: 'https://algofolk.substack.com/p/example',
        source_image_url: 'https://substackcdn.com/image/fetch/example.jpg',
      },
      {
        ...baseBinding,
        id: 'private-1',
        source_url: 'http://localhost:3000/story',
        source_image_url: 'http://127.0.0.1:8080/private.jpg',
      },
    ])

    expect(origins).toEqual([
      'https://www.youtube.com',
      'https://img.youtube.com',
      'https://i.ytimg.com',
      'https://x.com',
      'https://abs.twimg.com',
      'https://platform.twitter.com',
      'https://syndication.twitter.com',
      'https://algofolk.substack.com',
      'https://substackcdn.com',
    ])
  })

  it('builds a warmup plan for package json, plate asset, and first-screen images', () => {
    const plan = buildRuntimeWarmupPlan({
      editionPath: '/editions/test',
      plateAssetPath: '/editions/test/assets/plate.jpg',
      bindings: [
        { ...baseBinding, source_image_url: 'https://images.example.com/a.jpg' },
        { ...baseBinding, id: 'binding-2', source_image_url: 'https://images.example.com/b.jpg' },
      ],
    })

    expect(plan.packageUrls).toContain('/editions/test/source-bindings.json')
    expect(plan.imageUrls).toEqual([
      '/editions/test/assets/plate.jpg',
      'https://images.example.com/a.jpg',
      'https://images.example.com/b.jpg',
    ])
  })
})
