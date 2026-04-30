import type { ArchiveRecord, EditionManifest, EditionManifestItem } from '../types/runtime'
import { selectEdition } from './editionLoader'

export type AppRoute =
  | { kind: 'edition'; edition: EditionManifestItem }
  | { kind: 'archive-index' }
  | { kind: 'archive-edition'; edition: EditionManifestItem }

const trimTrailingSlash = (pathname: string) => {
  if (pathname.length > 1 && pathname.endsWith('/')) return pathname.slice(0, -1)
  return pathname || '/'
}

const findEdition = (manifest: EditionManifest, value: string) =>
  manifest.editions.find((item) => item.slug === value || item.edition_id === value) ?? null

const resolveUrl = (value: string) => {
  try {
    return new URL(value, 'https://runtime.local')
  } catch {
    return new URL('/', 'https://runtime.local')
  }
}

export const parseAppRoute = (locationValue: string, manifest: EditionManifest): AppRoute => {
  const url = resolveUrl(locationValue)
  const normalizedPath = trimTrailingSlash(url.pathname)
  const archiveQuery = url.searchParams.get('archive')
  const editionQuery = url.searchParams.get('edition')

  if (archiveQuery) {
    const edition = findEdition(manifest, archiveQuery)
    if (edition) return { kind: 'archive-edition', edition }
    return { kind: 'archive-index' }
  }

  if (editionQuery) {
    const edition = findEdition(manifest, editionQuery)
    if (edition) return { kind: 'edition', edition }
  }

  if (normalizedPath === '/archive') {
    return { kind: 'archive-index' }
  }

  if (normalizedPath.startsWith('/archive/')) {
    const slug = decodeURIComponent(normalizedPath.replace('/archive/', '').split('/')[0] ?? '')
    const edition = findEdition(manifest, slug)
    if (edition) return { kind: 'archive-edition', edition }
    return { kind: 'archive-index' }
  }

  if (normalizedPath.startsWith('/editions/')) {
    const editionKey = decodeURIComponent(normalizedPath.replace('/editions/', '').split('/')[0] ?? '')
    const edition = findEdition(manifest, editionKey)
    if (edition) return { kind: 'edition', edition }
  }

  return { kind: 'edition', edition: selectEdition(manifest) }
}

export const buildArchiveHref = (slug: string) => `/archive/${slug}`

export const getEditionArchiveRecords = (manifest: EditionManifest): ArchiveRecord[] =>
  [...manifest.editions]
    .sort((a, b) => b.date.localeCompare(a.date))
    .map((edition) => ({
      ...edition,
      archive_href: buildArchiveHref(edition.slug),
    }))
