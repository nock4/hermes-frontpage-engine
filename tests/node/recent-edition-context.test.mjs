import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { getHistoricalSourceKeys, getRecentEditionSummaries } from '../../scripts/lib/recent-edition-context.mjs'
import { sourceContentKey } from '../../scripts/lib/source-selection-policy.mjs'

let tmpRoot = null

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function seedEdition(root, editionId, bindings) {
  writeJson(path.join(root, 'public', 'editions', editionId, 'edition.json'), {
    title: editionId,
  })
  writeJson(path.join(root, 'public', 'editions', editionId, 'source-bindings.json'), {
    bindings,
  })
}

describe('recent-edition-context', () => {
  afterEach(() => {
    if (tmpRoot) fs.rmSync(tmpRoot, { recursive: true, force: true })
    tmpRoot = null
  })

  it('carries source media/image URLs into duplicate suppression keys', () => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'frontpage-recent-context-'))
    writeJson(path.join(tmpRoot, 'public', 'editions', 'index.json'), {
      editions: [
        { edition_id: 'today', title: 'today', slug: 'today', path: '/editions/today' },
      ],
    })
    seedEdition(tmpRoot, 'today', [{
      source_url: 'https://x.com/example/status/1',
      resolved_url: 'https://x.com/example/status/1?s=20',
      source_image_url: 'https://pbs.twimg.com/media/reused.jpg?name=orig',
      source_media_url: 'https://video.twimg.com/ext_tw_video/reused.mp4?tag=12',
    }])

    const [summary] = getRecentEditionSummaries({ root: tmpRoot, fsSync: fs, sourceContentKey, limit: 1 })

    expect(summary.source_keys).toContain(sourceContentKey({ url: 'https://x.com/example/status/1' }))
    expect(summary.source_keys).toContain(sourceContentKey({ url: 'https://pbs.twimg.com/media/reused.jpg?name=orig' }))
    expect(summary.source_keys).toContain(sourceContentKey({ url: 'https://video.twimg.com/ext_tw_video/reused.mp4?tag=12' }))
  })

  it('builds the used-material ledger from the whole published archive, not only the recent diversity window', () => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'frontpage-historical-context-'))
    writeJson(path.join(tmpRoot, 'public', 'editions', 'index.json'), {
      editions: [
        { edition_id: 'newer', title: 'newer', slug: 'newer', path: '/editions/newer' },
        { edition_id: 'older', title: 'older', slug: 'older', path: '/editions/older' },
      ],
    })
    seedEdition(tmpRoot, 'newer', [{ source_url: 'https://fresh.example/source' }])
    seedEdition(tmpRoot, 'older', [{
      source_url: 'https://archive.example/old-anchor',
      source_image_url: 'https://cdn.example/old-anchor.jpg',
    }])

    const keys = getHistoricalSourceKeys({ root: tmpRoot, fsSync: fs, sourceContentKey })

    expect(keys.has(sourceContentKey({ url: 'https://fresh.example/source' }))).toBe(true)
    expect(keys.has(sourceContentKey({ url: 'https://archive.example/old-anchor' }))).toBe(true)
    expect(keys.has(sourceContentKey({ url: 'https://cdn.example/old-anchor.jpg' }))).toBe(true)
  })
})
