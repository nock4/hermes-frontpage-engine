import { getSourceWindowDescriptor } from './sourceWindowContent'
import type { EditionManifest, EditionManifestItem, SourceBindingRecord } from '../types/runtime'
import { sanitizeSourceImageUrl, sanitizeSourceUrl } from './sourceUrl'

interface RuntimeWarmupPlan {
  packageUrls: string[]
  imageUrls: string[]
  preconnectOrigins: string[]
}

const EDITION_PACKAGE_PRELOAD_FILES = [
  'edition.json',
  'brief.json',
  'artifact-map.json',
  'source-bindings.json',
  'ambiance.json',
  'review.json',
  'geometry-kit.json',
] as const

const HEAD_WARMUP_ATTR = 'data-runtime-warmup'
const DEFAULT_IMAGE_PRELOAD_LIMIT = 6

const toHttpUrl = (value: string | null | undefined, kind: 'source' | 'image' = 'image') => {
  const sanitized = kind === 'source' ? sanitizeSourceUrl(value) : sanitizeSourceImageUrl(value)
  if (!sanitized) return null

  try {
    return new URL(sanitized)
  } catch {
    return null
  }
}

const normalizeOrigin = (value: string | null | undefined) => {
  const url = toHttpUrl(value)
  return url ? url.origin : null
}

const pushUnique = (values: string[], seen: Set<string>, next: string | null | undefined) => {
  if (!next || seen.has(next)) return
  seen.add(next)
  values.push(next)
}

export const selectEditionForPath = (manifest: EditionManifest, pathname: string): EditionManifestItem => {
  const archiveMatch = pathname.match(/^\/archive\/([^/]+)$/)
  if (archiveMatch) {
    const slug = decodeURIComponent(archiveMatch[1] ?? '')
    const archiveEdition = manifest.editions.find((item) => item.slug === slug || item.edition_id === slug)
    if (archiveEdition) return archiveEdition
  }

  return manifest.editions.find((item) => item.edition_id === manifest.current_edition_id) ?? manifest.editions[0]
}

export const collectEditionPackageUrls = (basePath: string) =>
  EDITION_PACKAGE_PRELOAD_FILES.map((file) => `${basePath}/${file}`)

export const collectWarmImageUrls = (bindings: SourceBindingRecord[], limit = DEFAULT_IMAGE_PRELOAD_LIMIT) => {
  const urls: string[] = []
  const seen = new Set<string>()

  for (const binding of bindings) {
    if (urls.length >= limit) break
    const sourceImageUrl = toHttpUrl(binding.source_image_url, 'image')?.toString()
    if (!sourceImageUrl || seen.has(sourceImageUrl)) continue
    seen.add(sourceImageUrl)
    urls.push(sourceImageUrl)
  }

  return urls
}

export const collectEditionPreconnectOrigins = (bindings: SourceBindingRecord[]) => {
  const origins: string[] = []
  const seen = new Set<string>()

  for (const binding of bindings) {
    const descriptor = getSourceWindowDescriptor(binding)

    pushUnique(origins, seen, normalizeOrigin(toHttpUrl(binding.source_url, 'source')?.toString()))
    pushUnique(origins, seen, normalizeOrigin(toHttpUrl(binding.source_image_url, 'image')?.toString()))

    if (descriptor.kind === 'youtube-embed') {
      pushUnique(origins, seen, 'https://www.youtube.com')
      pushUnique(origins, seen, 'https://i.ytimg.com')
      continue
    }

    if (descriptor.kind === 'tweet-embed') {
      pushUnique(origins, seen, 'https://platform.twitter.com')
      pushUnique(origins, seen, 'https://syndication.twitter.com')
      continue
    }

    if (descriptor.kind === 'soundcloud-embed') {
      pushUnique(origins, seen, normalizeOrigin(descriptor.embedUrl))
    }
  }

  return origins
}

export const buildRuntimeWarmupPlan = (input: {
  editionPath: string
  plateAssetPath?: string | null
  bindings?: SourceBindingRecord[]
  imageLimit?: number
}): RuntimeWarmupPlan => ({
  packageUrls: collectEditionPackageUrls(input.editionPath),
  imageUrls: [
    ...(input.plateAssetPath ? [input.plateAssetPath] : []),
    ...collectWarmImageUrls(input.bindings ?? [], input.imageLimit),
  ],
  preconnectOrigins: collectEditionPreconnectOrigins(input.bindings ?? []),
})

const removeManagedWarmupNodes = (scope: string) => {
  document.head.querySelectorAll(`[${HEAD_WARMUP_ATTR}="${scope}"]`).forEach((node) => node.remove())
}

const ensureLink = (scope: string, attrs: Record<string, string>) => {
  const rel = attrs.rel
  const href = attrs.href
  if (!rel || !href) return

  const existing = document.head.querySelector<HTMLLinkElement>(`link[rel="${CSS.escape(rel)}"][href="${CSS.escape(href)}"]`)
  if (existing) return

  const link = document.createElement('link')
  link.setAttribute(HEAD_WARMUP_ATTR, scope)
  for (const [key, value] of Object.entries(attrs)) {
    link.setAttribute(key, value)
  }
  document.head.appendChild(link)
}

export const syncRuntimeWarmupLinks = (scope: string, plan: RuntimeWarmupPlan) => {
  removeManagedWarmupNodes(scope)

  for (const origin of plan.preconnectOrigins) {
    ensureLink(scope, { rel: 'preconnect', href: origin, crossorigin: 'anonymous' })

    const dnsPrefetchHref = `//${new URL(origin).host}`
    ensureLink(scope, { rel: 'dns-prefetch', href: dnsPrefetchHref })
  }

  for (const url of plan.packageUrls) {
    ensureLink(scope, {
      rel: 'preload',
      href: url,
      as: 'fetch',
      crossorigin: 'anonymous',
      fetchpriority: 'high',
    })
  }

  for (const url of plan.imageUrls) {
    ensureLink(scope, {
      rel: 'preload',
      href: url,
      as: 'image',
      fetchpriority: 'high',
    })
  }
}
