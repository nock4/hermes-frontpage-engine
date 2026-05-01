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

  it('dedupes same-day reruns within the same scene family and keeps the highest available rerun', () => {
    const records = getEditionArchiveRecords({
      current_edition_id: '2026-04-30-minimal-signal-field-v7',
      editions: [
        {
          edition_id: '2026-04-30-minimal-signal-field-v5',
          date: '2026-04-30',
          slug: 'minimal-signal-field-v5',
          title: 'Signal Field',
          path: '/editions/2026-04-30-minimal-signal-field-v5',
          scene_family: 'minimal-signal-field',
          motif_tags: ['signal'],
          preview_asset_path: '/editions/2026-04-30-minimal-signal-field-v5/assets/preview.png',
          is_live: false,
        },
        {
          edition_id: '2026-04-30-minimal-signal-field-v7',
          date: '2026-04-30',
          slug: 'minimal-signal-field-v7',
          title: 'Signal Field',
          path: '/editions/2026-04-30-minimal-signal-field-v7',
          scene_family: 'minimal-signal-field',
          motif_tags: ['signal'],
          preview_asset_path: '/editions/2026-04-30-minimal-signal-field-v7/assets/preview.png',
          is_live: true,
        },
        {
          edition_id: '2026-04-28-ash-procession-flare-v1',
          date: '2026-04-28',
          slug: 'ash-procession-flare-v1',
          title: 'The Ash Procession Flare',
          path: '/editions/2026-04-28-ash-procession-flare-v1',
          scene_family: 'ash-procession-flare',
          motif_tags: ['ash'],
          preview_asset_path: '/editions/2026-04-28-ash-procession-flare-v1/assets/preview.png',
          is_live: false,
        },
      ],
    })

    expect(records.map((record) => record.slug)).toEqual(['minimal-signal-field-v7', 'ash-procession-flare-v1'])
    expect(records[0].is_live).toBe(true)
  })

  it('preserves newest-first date ordering even when an older edition is live', () => {
    const records = getEditionArchiveRecords({
      current_edition_id: '2026-04-29-live-edition-v1',
      editions: [
        {
          edition_id: '2026-04-29-live-edition-v1',
          date: '2026-04-29',
          slug: 'live-edition-v1',
          title: 'Live Edition',
          path: '/editions/2026-04-29-live-edition-v1',
          scene_family: 'live-edition',
          motif_tags: ['live'],
          preview_asset_path: '/editions/2026-04-29-live-edition-v1/assets/preview.png',
          is_live: true,
        },
        {
          edition_id: '2026-04-30-newer-edition-v1',
          date: '2026-04-30',
          slug: 'newer-edition-v1',
          title: 'Newer Edition',
          path: '/editions/2026-04-30-newer-edition-v1',
          scene_family: 'newer-edition',
          motif_tags: ['newer'],
          preview_asset_path: '/editions/2026-04-30-newer-edition-v1/assets/preview.png',
          is_live: false,
        },
      ],
    })

    expect(records.map((record) => record.slug)).toEqual(['newer-edition-v1', 'live-edition-v1'])
  })

  it('prefers the highest numeric rerun version when deduping same-day editions', () => {
    const records = getEditionArchiveRecords({
      current_edition_id: '2026-04-30-minimal-signal-field-v10',
      editions: [
        {
          edition_id: '2026-04-30-minimal-signal-field-v9',
          date: '2026-04-30',
          slug: 'minimal-signal-field-v9',
          title: 'Signal Field',
          path: '/editions/2026-04-30-minimal-signal-field-v9',
          scene_family: 'minimal-signal-field',
          motif_tags: ['signal'],
          preview_asset_path: '/editions/2026-04-30-minimal-signal-field-v9/assets/preview.png',
          is_live: true,
        },
        {
          edition_id: '2026-04-30-minimal-signal-field-v10',
          date: '2026-04-30',
          slug: 'minimal-signal-field-v10',
          title: 'Signal Field',
          path: '/editions/2026-04-30-minimal-signal-field-v10',
          scene_family: 'minimal-signal-field',
          motif_tags: ['signal'],
          preview_asset_path: '/editions/2026-04-30-minimal-signal-field-v10/assets/preview.png',
          is_live: false,
        },
      ],
    })

    expect(records.map((record) => record.slug)).toEqual(['minimal-signal-field-v10'])
  })
})
