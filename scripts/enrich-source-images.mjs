import fs from 'node:fs'
import dns from 'node:dns/promises'
import path from 'node:path'

import { resolveFetchableHtmlUrl, resolveFetchableImageUrl } from './lib/source-image-network-policy.mjs'

const root = process.cwd()
const editionsRoot = path.join(root, 'public', 'editions')
const manifest = JSON.parse(fs.readFileSync(path.join(editionsRoot, 'index.json'), 'utf8'))

const htmlCache = new Map()
const imageHealthCache = new Map()

const parseUrl = (value) => {
  if (!value) return null

  try {
    return new URL(value)
  } catch {
    return null
  }
}

const isLowValuePreviewImage = (imageUrl) => {
  if (!imageUrl) return true
  let lower = imageUrl.toLowerCase()
  try {
    const parsed = new URL(imageUrl)
    lower = `${parsed.hostname}${parsed.pathname}`.toLowerCase()
  } catch {
    lower = imageUrl.toLowerCase()
  }

  return /\.svg(?:$|[?#])/.test(lower)
    || /\.ico(?:$|[?#])/.test(lower)
    || lower.includes('abs.twimg.com')
    || lower.includes('favicon')
    || lower.includes('apple-touch-icon')
    || lower.includes('site-icon')
    || lower.includes('wordmark')
    || lower.includes('profile_images')
    || lower.includes('profile_pic')
    || lower.includes('profile-picture')
    || lower.includes('/profile/')
    || lower.includes('s100x100')
    || lower.includes('templatethumbnail')
    || lower.includes('static/images/x.png')
    || lower.includes('abs.twimg.com/emoji/')
    || lower.includes('/logo')
    || /(?:^|[/_\-.])icon(?:[/_\-.]|$)/.test(lower)
}

const isWebLikeBinding = (binding) => {
  if (!binding?.source_url) return false
  return binding.window_type === 'web' || binding.source_type === 'article' || binding.source_type === 'web' || binding.source_type === 'concept-note'
}

const getYouTubeThumbnail = (sourceUrl) => {
  const url = parseUrl(sourceUrl)
  if (!url) return null

  const hostname = url.hostname.replace(/^www\./, '')
  let videoId = null
  const pathParts = url.pathname.split('/').filter(Boolean)
  const isYouTubeHost = hostname === 'youtube.com' || hostname === 'm.youtube.com' || hostname === 'music.youtube.com' || hostname === 'youtube-nocookie.com'
  if (hostname === 'youtu.be') videoId = pathParts[0]?.trim() ?? null
  if (isYouTubeHost && url.pathname === '/watch') videoId = url.searchParams.get('v')?.trim() ?? null
  if (isYouTubeHost && ['embed', 'shorts', 'live', 'v'].includes(pathParts[0] ?? '')) videoId = pathParts[1]?.trim() ?? null
  if (!videoId) return null
  return {
    imageUrl: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
    imageAlt: 'YouTube thumbnail',
    provenance: 'youtube-thumbnail',
  }
}

const getGitHubPreview = (sourceUrl) => {
  const url = parseUrl(sourceUrl)
  if (!url) return null

  const hostname = url.hostname.replace(/^www\./, '')
  if (hostname !== 'github.com') return null
  const trimmedPath = url.pathname.replace(/^\//, '').replace(/\/$/, '')
  if (!trimmedPath) return null
  return {
    imageUrl: `https://opengraph.githubassets.com/1/${trimmedPath}`,
    imageAlt: 'GitHub preview image',
    provenance: 'github-opengraph',
  }
}

const toAbsoluteUrl = (candidate, pageUrl) => {
  if (!candidate) return null
  try {
    return new URL(candidate.replace(/&amp;/g, '&'), pageUrl).toString()
  } catch {
    return null
  }
}

const isLoadablePreviewImage = async (imageUrl) => {
  if (!imageUrl || isLowValuePreviewImage(imageUrl)) return false
  if (imageHealthCache.has(imageUrl)) return imageHealthCache.get(imageUrl)

  const fetchableImageUrl = await resolveFetchableImageUrl(imageUrl, { lookup: dns.lookup })
  if (!fetchableImageUrl) {
    imageHealthCache.set(imageUrl, false)
    return false
  }

  try {
    const response = await fetch(fetchableImageUrl, {
      headers: {
        'user-agent': 'Mozilla/5.0 (compatible; Hermes/1.0; +https://hermes.local)',
        accept: 'image/avif,image/webp,image/png,image/jpeg,image/*,*/*;q=0.5',
        range: 'bytes=0-4095',
      },
      redirect: 'error',
      signal: AbortSignal.timeout(8000),
    })
    const contentType = response.headers.get('content-type') ?? ''
    const isLoadable = response.ok && (!contentType || contentType.toLowerCase().startsWith('image/'))
    imageHealthCache.set(imageUrl, isLoadable)
    return isLoadable
  } catch {
    imageHealthCache.set(imageUrl, false)
    return false
  }
}

const extractMetaImage = (html, pageUrl) => {
  const patterns = [
    /<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]+content=["']([^"']+)["'][^>]*>/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image(?::secure_url)?["'][^>]*>/i,
    /<meta[^>]+name=["']twitter:image(?::src)?["'][^>]+content=["']([^"']+)["'][^>]*>/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image(?::src)?["'][^>]*>/i,
    /<meta[^>]+itemprop=["']image["'][^>]+content=["']([^"']+)["'][^>]*>/i,
  ]

  for (const pattern of patterns) {
    const match = html.match(pattern)
    const absolute = toAbsoluteUrl(match?.[1], pageUrl)
    if (absolute) return absolute
  }

  return null
}

const extractFirstImage = (html, pageUrl) => {
  const imagePattern = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi
  for (const match of html.matchAll(imagePattern)) {
    const absolute = toAbsoluteUrl(match[1], pageUrl)
    if (!absolute) continue
    if (absolute.startsWith('data:')) continue
    if (isLowValuePreviewImage(absolute)) continue
    return absolute
  }
  return null
}

const extractIconImage = (html, pageUrl) => {
  const iconPattern = /<link[^>]+rel=["'](?:apple-touch-icon|icon|shortcut icon)["'][^>]+href=["']([^"']+)["'][^>]*>/gi
  for (const match of html.matchAll(iconPattern)) {
    const absolute = toAbsoluteUrl(match[1], pageUrl)
    if (absolute && !isLowValuePreviewImage(absolute)) return absolute
  }
  return null
}

const fetchHtml = async (sourceUrl) => {
  const fetchableUrl = await resolveFetchableHtmlUrl(sourceUrl, { lookup: dns.lookup })
  if (!fetchableUrl) return null
  if (htmlCache.has(fetchableUrl)) return htmlCache.get(fetchableUrl)
  try {
    const response = await fetch(fetchableUrl, {
      headers: {
        'user-agent': 'Mozilla/5.0 (compatible; Hermes/1.0; +https://hermes.local)',
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      },
      redirect: 'error',
      signal: AbortSignal.timeout(8000),
    })
    const contentType = response.headers.get('content-type') ?? ''
    if (!response.ok || !contentType.includes('text/html')) {
      htmlCache.set(fetchableUrl, null)
      return null
    }
    const html = await response.text()
    if (html.length > 1_000_000) {
      htmlCache.set(fetchableUrl, null)
      return null
    }
    htmlCache.set(fetchableUrl, html)
    return html
  } catch {
    htmlCache.set(fetchableUrl, null)
    return null
  }
}

const getHomeFallbackUrl = (sourceUrl) => {
  const url = parseUrl(sourceUrl)
  if (!url) return null
  return `${url.protocol}//${url.hostname}/`
}

const getOriginFavicon = (sourceUrl) => {
  const url = parseUrl(sourceUrl)
  if (!url) return null
  return `${url.protocol}//${url.hostname}/favicon.ico`
}

const getGenericPreview = async (sourceUrl) => {
  const candidateUrls = [sourceUrl]
  const homeFallbackUrl = getHomeFallbackUrl(sourceUrl)
  if (homeFallbackUrl && homeFallbackUrl !== sourceUrl) candidateUrls.push(homeFallbackUrl)

  for (const candidateUrl of candidateUrls) {
    const html = await fetchHtml(candidateUrl)
    if (!html) continue

    const imageCandidates = [
      extractMetaImage(html, candidateUrl),
      extractFirstImage(html, candidateUrl),
      extractIconImage(html, candidateUrl),
    ].filter(Boolean)

    for (const imageUrl of imageCandidates) {
      if (isLowValuePreviewImage(imageUrl)) continue
      if (!await isLoadablePreviewImage(imageUrl)) continue

      return {
        imageUrl,
        imageAlt: 'Source preview image',
        provenance: 'html-image',
      }
    }
  }

  const faviconUrl = getOriginFavicon(sourceUrl)
  if (faviconUrl && !isLowValuePreviewImage(faviconUrl)) {
    return {
      imageUrl: faviconUrl,
      imageAlt: 'Site icon',
      provenance: 'origin-favicon',
    }
  }

  return null
}

const getBandcampPreview = async (sourceUrl) => {
  const url = parseUrl(sourceUrl)
  if (!url) return null

  const hostname = url.hostname.replace(/^www\./, '')
  if (hostname === 'bandcamp.com' || !hostname.endsWith('.bandcamp.com')) return null
  const homepageUrl = `${url.protocol}//${url.hostname}/`
  const html = await fetchHtml(homepageUrl)
  if (!html) return null
  const imageUrl = extractMetaImage(html, homepageUrl) || extractFirstImage(html, homepageUrl) || extractIconImage(html, homepageUrl)
  if (!imageUrl) return null
  return {
    imageUrl,
    imageAlt: 'Bandcamp artist image',
    provenance: 'bandcamp-home',
  }
}

const shouldRefreshSourceImage = async (binding) => {
  const currentImage = binding?.source_image_url?.trim()
  if (!currentImage) return true
  if (isLowValuePreviewImage(currentImage)) return true
  if (currentImage.includes('/assets/source-previews/') && /(?:-page\.png|page\.png)$/i.test(currentImage)) return true
  if (!await isLoadablePreviewImage(currentImage)) return true
  return false
}

const shouldClearSourceImage = async (binding) => {
  const currentImage = binding?.source_image_url?.trim()
  if (!currentImage) return false
  if (isLowValuePreviewImage(currentImage)) return true
  if (currentImage.includes('/assets/source-previews/') && /(?:-page\.png|page\.png)$/i.test(currentImage)) return true
  if (!await isLoadablePreviewImage(currentImage)) return true
  return false
}

const enrichBinding = async (binding) => {
  if (!binding?.source_url || !await shouldRefreshSourceImage(binding)) return null
  const sourceUrl = binding.source_url
  const enrichmentCandidates = [
    getYouTubeThumbnail(sourceUrl),
    getGitHubPreview(sourceUrl),
    await getBandcampPreview(sourceUrl),
    await getGenericPreview(sourceUrl),
  ].filter(Boolean)

  for (const enrichment of enrichmentCandidates) {
    if (await isLoadablePreviewImage(enrichment.imageUrl)) return enrichment
  }

  if (await shouldClearSourceImage(binding)) return { clearImage: true }
  return null
}

let updatedBindings = 0
const updatedEditions = []

for (const item of manifest.editions) {
  const sourceBindingsPath = path.join(root, 'public', item.path.replace(/^\//, ''), 'source-bindings.json')
  const sourceBindings = JSON.parse(fs.readFileSync(sourceBindingsPath, 'utf8'))
  let editionTouched = false

  for (const binding of sourceBindings.bindings) {
    const enrichment = await enrichBinding(binding)
    if (!enrichment) continue
    if (enrichment.clearImage) {
      delete binding.source_image_url
      delete binding.source_image_alt
    } else {
      binding.source_image_url = enrichment.imageUrl
      binding.source_image_alt = binding.source_image_alt || enrichment.imageAlt
    }
    updatedBindings += 1
    editionTouched = true
  }

  if (editionTouched) {
    fs.writeFileSync(sourceBindingsPath, `${JSON.stringify(sourceBindings, null, 2)}\n`)
    updatedEditions.push(item.edition_id)
  }
}

console.log(JSON.stringify({ updatedBindings, updatedEditions }, null, 2))
