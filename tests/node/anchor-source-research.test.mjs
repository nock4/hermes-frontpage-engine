import { describe, expect, it } from 'vitest'

import { selectAnchorSource } from '../../scripts/lib/anchor-source-research.mjs'

describe('anchor-source-research', () => {
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
