import { describe, expect, it } from 'vitest'
import type { EditionManifest } from '../types/runtime'
import { buildArchiveHref, getEditionArchiveRecords, parseAppRoute } from './router'

const manifest: EditionManifest = {
  current_edition_id: '2026-04-17-herbarium-bed-v1',
  editions: [
    {
      edition_id: '2026-04-17-herbarium-bed-v1',
      date: '2026-04-17',
      slug: 'herbarium-bed-v1',
      title: 'Herbarium Bed',
      path: '/editions/2026-04-17-herbarium-bed-v1',
      scene_family: 'herbarium-bed',
      motif_tags: ['botany', 'archive'],
      preview_asset_path: '/editions/2026-04-17-herbarium-bed-v1/assets/plate.jpg',
      is_live: true,
    },
    {
      edition_id: '2026-04-16-night-observatory-v1',
      date: '2026-04-16',
      slug: 'night-observatory-v1',
      title: 'Night Observatory',
      path: '/editions/2026-04-16-night-observatory-v1',
      scene_family: 'night-observatory',
      motif_tags: ['astral'],
      preview_asset_path: '/editions/2026-04-16-night-observatory-v1/assets/plate.jpg',
      is_live: false,
    },
  ],
}

describe('parseAppRoute', () => {
  it('returns current edition for root route', () => {
    const route = parseAppRoute('/', manifest)
    expect(route.kind).toBe('edition')
    if (route.kind !== 'edition') throw new Error('expected edition route')
    expect(route.edition.slug).toBe('herbarium-bed-v1')
  })

  it('returns direct edition route when edition id is in pathname', () => {
    const route = parseAppRoute('/editions/2026-04-16-night-observatory-v1', manifest)
    expect(route.kind).toBe('edition')
    if (route.kind !== 'edition') throw new Error('expected edition route')
    expect(route.edition.slug).toBe('night-observatory-v1')
  })

  it('returns direct edition route when edition is provided as a query parameter', () => {
    const route = parseAppRoute('/?edition=night-observatory-v1', manifest)
    expect(route.kind).toBe('edition')
    if (route.kind !== 'edition') throw new Error('expected edition route')
    expect(route.edition.slug).toBe('night-observatory-v1')
  })

  it('returns archive index for /archive', () => {
    const route = parseAppRoute('/archive', manifest)
    expect(route).toEqual({ kind: 'archive-index' })
  })

  it('returns archive edition when slug is in pathname', () => {
    const route = parseAppRoute('/archive/night-observatory-v1', manifest)
    expect(route.kind).toBe('archive-edition')
    if (route.kind !== 'archive-edition') throw new Error('expected archive edition route')
    expect(route.edition.slug).toBe('night-observatory-v1')
  })

  it('returns archive edition when archive slug is provided as a query parameter', () => {
    const route = parseAppRoute('/?archive=night-observatory-v1', manifest)
    expect(route.kind).toBe('archive-edition')
    if (route.kind !== 'archive-edition') throw new Error('expected archive edition route')
    expect(route.edition.slug).toBe('night-observatory-v1')
  })
})

describe('archive helpers', () => {
  it('builds archive hrefs from slugs', () => {
    expect(buildArchiveHref('night-observatory-v1')).toBe('/archive/night-observatory-v1')
  })

  it('sorts archive records newest first and preserves live marker', () => {
    const records = getEditionArchiveRecords(manifest)
    expect(records.map((record) => record.slug)).toEqual(['herbarium-bed-v1', 'night-observatory-v1'])
    expect(records[0].is_live).toBe(true)
  })
})
