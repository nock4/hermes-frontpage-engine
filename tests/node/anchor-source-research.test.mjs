import { describe, expect, it } from 'vitest'

import { buildAnchorQueries, selectAnchorSource } from '../../scripts/lib/anchor-source-research.mjs'

describe('anchor-source-research', () => {
  it('selects a creative anchor over high-score infrastructure', () => {
    const anchor = selectAnchorSource([
      {
        url: 'https://github.com/wespreadjam/jam-nodes',
        source_channel: 'chrome-bookmark',
        source_type: 'github',
        title: 'Jam nodes agent framework',
        description: 'Extensible workflow node framework, Zod schemas, automation pipeline, API docs',
        note_score: 180,
        image_url: 'https://opengraph.githubassets.com/repo.png',
        fetch_status: 'fetch-ok',
      },
      {
        url: 'https://www.youtube.com/watch?v=mask123',
        source_channel: 'youtube-like',
        source_type: 'youtube',
        title: 'surreal claymation music video masks',
        description: 'animated masks, costume gestures, music video stills, handmade visual world',
        note_score: 35,
        fetch_status: 'fetch-ok',
      },
    ])

    expect(anchor.url).toBe('https://www.youtube.com/watch?v=mask123')
  })

  it('puts recent saved artwork ahead of AI-assistant expansion yield', () => {
    const anchor = selectAnchorSource([
      {
        url: 'https://x.com/gill_works/status/2073869404182585683',
        source_channel: 'twitter-bookmark',
        source_type: 'tweet',
        title: '@gill_works: I gave Fable my project from last year and it just knocked it out of the park',
        description: 'AI assistant, prompt guide, Claude Fable, agent workflow, benchmark screenshots, related URLs '.repeat(8),
        note_score: 95,
        image_url: 'https://pbs.twimg.com/card_img/fable.jpg',
        fetch_status: 'fetch-ok',
      },
      {
        url: 'https://x.com/compositioning/status/2077410985493606481',
        source_channel: 'twitter-bookmark',
        source_type: 'tweet',
        title: '@compositioning: Drawings by Jans Muskee (2014-2025)',
        description: 'artist drawings artwork gallery image surface linework',
        note_score: 65,
        image_url: 'https://pbs.twimg.com/media/jans-muskee.jpg',
        fetch_status: 'fetch-ok',
      },
    ])

    expect(anchor.url).toBe('https://x.com/compositioning/status/2077410985493606481')
    expect(anchor.anchor_selection_lane).toBe('artwork-first')
    expect(anchor.anchor_selection_reason).toMatch(/Artwork-first anchor lane/)
    expect(anchor.anchor_alternates[0].lane).toBe('ai-tooling-penalized')
  })

  it('builds aesthetic expansion queries from the anchor', () => {
    const queries = buildAnchorQueries({ title: 'surreal claymation music video masks' }, ['claymation', 'mask', 'ambient'])
    const joined = queries.join(' ')

    expect(joined).toMatch(/works|artist|visual archive|music video|genre|scene|album art|animation|screenshots/)
    expect(joined).not.toMatch(/github screenshots assets/)
  })

  it('selects a rich renderable anchor over weak profile pages', () => {
    const anchor = selectAnchorSource([
      {
        url: 'https://x.com/BoysClubWorld',
        source_channel: 'twitter-bookmark',
        source_type: 'webpage',
        title: 'Boys Club profile page',
        description: 'Followers following profile page',
      },
      {
        url: 'https://www.nga.gov/collection/art-object-page.46665.html',
        source_channel: 'obsidian',
        source_type: 'article',
        title: 'National Gallery artwork record',
        description: 'Museum archive image material object field palette painting collection '.repeat(20),
        image_url: 'https://www.nga.gov/image.jpg',
        fetch_status: 'fetch-ok',
      },
    ])

    expect(anchor.url).toBe('https://www.nga.gov/collection/art-object-page.46665.html')
    expect(anchor.anchor_selection_score).toBeGreaterThan(0)
  })
})
