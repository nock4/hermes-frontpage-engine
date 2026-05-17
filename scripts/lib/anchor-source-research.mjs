import { fetchWithTimeout } from './fetch-with-timeout.mjs'
import { getSourceDisplayTitle } from './source-display.mjs'
import { extractUrls, hostnameForUrl, isAllowedSourceUrl, youtubeId } from './source-url-policy.mjs'
import {
  isLowValueVisualImage,
  sourceContentKey,
  sourceContentScore,
  sourceHasRenderableCardSurface,
} from './source-selection-policy.mjs'
import { sanitizeSourceText } from './source-text.mjs'
import { uniqueNonEmpty } from './string-utils.mjs'

const MAX_DERIVED_SEARCH_QUERIES = 8
const MAX_DERIVED_CANDIDATES = 30
const MAX_IMAGE_CANDIDATES = 24

function decodeHtml(value) {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
}

function stripHtml(value) {
  return decodeHtml(String(value || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim())
}

function absoluteUrl(value, base) {
  if (!value) return null
  try {
    return new URL(value, base).toString()
  } catch {
    return null
  }
}

function keywordTerms(text, maxTerms = 8) {
  const stop = new Set('about after again also amp and are because been being between from have into more most that the their them then there these this those through with without your you youtube watch video latest official guide source daily frontpage'.split(' '))
  const counts = new Map()
  for (const token of String(text || '').toLowerCase().match(/[a-z0-9][a-z0-9-]{2,}/g) || []) {
    if (stop.has(token) || /^\d+$/.test(token)) continue
    counts.set(token, (counts.get(token) || 0) + 1)
  }
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, maxTerms)
    .map(([term]) => term)
}

function sourceText(source) {
  return [
    getSourceDisplayTitle(source, source?.title || source?.note_title || ''),
    source?.description,
    source?.visible_text,
    source?.note_title,
    source?.note_excerpt,
  ].filter(Boolean).join(' ')
}

function looksLikeProfileOrUtility(source) {
  const text = sourceText(source).toLowerCase()
  const url = String(source?.url || source?.source_url || '').toLowerCase()
  return /\b(contact us|privacy policy|terms of service|sign up|log in|profile page|followers|following)\b/.test(text)
    || /\/(contact|about|privacy|terms|login|signin|signup)\/?(?:$|[?#])/.test(url)
    || /instagram\.com\/[^/]+\/?(?:$|[?#])/.test(url)
    || /x\.com\/[^/]+\/?(?:$|[?#])/.test(url)
}

export function selectAnchorSource(evidenceSources, { recentSourceKeys = new Set(), signalHarvest = null } = {}) {
  const ranked = [...(evidenceSources || [])]
    .filter((source) => source?.url && !recentSourceKeys.has(sourceContentKey(source)))
    .map((source) => {
      let score = sourceContentScore(source, recentSourceKeys)
      const text = sourceText(source)
      if (sourceHasRenderableCardSurface(source, signalHarvest)) score += 30
      if (source.image_url && !isLowValueVisualImage(source.image_url)) score += 14
      if (youtubeId(source.url) || youtubeId(source.final_url)) score += 18
      if (text.length > 500) score += 10
      if (extractUrls(text).length) score += 6
      if (/(farm|garden|archive|museum|map|diagram|field|material|image|artist|research|algorithm|infrastructure|land|plant|city|video|project)/i.test(text)) score += 8
      if (looksLikeProfileOrUtility(source)) score -= 80
      return { source, score }
    })
    .filter((entry) => Number.isFinite(entry.score))
    .sort((left, right) => right.score - left.score)

  const winner = ranked[0]?.source || null
  if (!winner) return null
  return {
    ...winner,
    anchor_selection_score: ranked[0].score,
    anchor_selection_reason: 'Highest scoring saved-signal source for renderability, richness, freshness, and research depth.',
    anchor_alternates: ranked.slice(1, 6).map(({ source, score }) => ({
      url: source.url,
      title: getSourceDisplayTitle(source, source.title || source.note_title || source.url),
      score,
    })),
  }
}

async function fetchHtml(url) {
  try {
    const response = await fetchWithTimeout(url, {
      headers: {
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'user-agent': 'daily-frontpage-engine-anchor-research/0.1',
      },
      redirect: 'follow',
    }, 9000)
    const contentType = response.headers.get('content-type') || ''
    if (!response.ok || !contentType.toLowerCase().includes('text/html')) return null
    return await response.text()
  } catch {
    return null
  }
}

function extractOutboundLinks(html, baseUrl, limit = 60) {
  const links = []
  const regex = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi
  let match
  while ((match = regex.exec(html || ''))) {
    const url = absoluteUrl(decodeHtml(match[1]), baseUrl)
    if (!url || !isAllowedSourceUrl(url)) continue
    const host = hostnameForUrl(url)
    if (!host || host === hostnameForUrl(baseUrl)) continue
    links.push({ url, label: stripHtml(match[2]).slice(0, 160) })
    if (links.length >= limit) break
  }
  return links
}

function extractImageCandidatesFromHtml(html, baseUrl, { lineage = 'direct_link', query = null, visualReason = 'Image found while researching the anchor source.' } = {}) {
  const candidates = []
  const metaRegexes = [
    /<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]+content=["']([^"']+)["'][^>]*>/gi,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image(?::secure_url)?["'][^>]*>/gi,
    /<meta[^>]+name=["']twitter:image(?::src)?["'][^>]+content=["']([^"']+)["'][^>]*>/gi,
  ]
  for (const regex of metaRegexes) {
    let match
    while ((match = regex.exec(html || ''))) {
      const imageUrl = absoluteUrl(decodeHtml(match[1]), baseUrl)
      if (imageUrl && !isLowValueVisualImage(imageUrl)) {
        candidates.push({ page_url: baseUrl, image_url: imageUrl, title: '', caption: '', lineage, query, visual_reason: visualReason, license_or_rights: null, width: null, height: null })
      }
    }
  }

  const imgRegex = /<img\b([^>]+)>/gi
  let imgMatch
  while ((imgMatch = imgRegex.exec(html || ''))) {
    const attrs = imgMatch[1]
    const src = attrs.match(/\bsrc=["']([^"']+)["']/i)?.[1]
    const srcset = attrs.match(/\bsrcset=["']([^"']+)["']/i)?.[1]
    const alt = attrs.match(/\balt=["']([^"']*)["']/i)?.[1]
    const width = Number(attrs.match(/\bwidth=["']?(\d+)/i)?.[1]) || null
    const height = Number(attrs.match(/\bheight=["']?(\d+)/i)?.[1]) || null
    const srcsetBest = srcset?.split(',').map((part) => part.trim().split(/\s+/)[0]).filter(Boolean).at(-1)
    const imageUrl = absoluteUrl(decodeHtml(srcsetBest || src), baseUrl)
    if (!imageUrl || isLowValueVisualImage(imageUrl)) continue
    candidates.push({
      page_url: baseUrl,
      image_url: imageUrl,
      title: '',
      caption: decodeHtml(alt || ''),
      lineage,
      query,
      visual_reason: visualReason,
      license_or_rights: null,
      width,
      height,
    })
  }
  return candidates
}

function buildAnchorQueries(anchor, terms) {
  const title = getSourceDisplayTitle(anchor, anchor.title || anchor.note_title || '').replace(/["“”]/g, '')
  const quotedTitle = title ? `"${title.slice(0, 80)}"` : ''
  const termString = terms.slice(0, 5).join(' ')
  return uniqueNonEmpty([
    quotedTitle,
    `${termString} official source`,
    `${termString} images archive`,
    `${termString} diagram map`,
    `${termString} museum archive`,
    `${termString} github screenshots assets`,
    `${title} related project`,
    `${title} images`,
  ]).slice(0, MAX_DERIVED_SEARCH_QUERIES)
}

async function searchDuckDuckGo(query, limit = 8) {
  const url = `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`
  const html = await fetchHtml(url)
  if (!html) return []
  const results = []
  const regex = /<a[^>]+class=["'][^"']*result__a[^"']*["'][^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi
  let match
  while ((match = regex.exec(html))) {
    let resultUrl = decodeHtml(match[1])
    try {
      const parsed = new URL(resultUrl, 'https://duckduckgo.com')
      const uddg = parsed.searchParams.get('uddg')
      if (uddg) resultUrl = uddg
    } catch {}
    if (!isAllowedSourceUrl(resultUrl)) continue
    results.push({ url: resultUrl, title: stripHtml(match[2]), query })
    if (results.length >= limit) break
  }
  return results
}

function candidateFromUrl(url, anchor, { reason, lineage, query = null, title = '' } = {}) {
  return {
    url,
    note_id: anchor.note_id || `anchor-derived-${sourceContentKey(anchor)}`,
    note_title: title || `Anchor-derived source for ${getSourceDisplayTitle(anchor, anchor.title || anchor.url)}`,
    note_path: anchor.note_path,
    note_date: anchor.note_date,
    note_score: Math.max(50, Number(anchor.note_score || 0) - 4),
    source_channel: 'anchor-derived',
    anchor_url: anchor.url,
    source_lineage: lineage || 'anchor_research',
    source_reason: reason || 'Derived from the selected anchor source.',
    source_query: query,
  }
}

export async function buildAnchorResearch(anchor, { runDate = null } = {}) {
  const text = sourceText(anchor)
  const terms = keywordTerms(text, 10)
  const html = await fetchHtml(anchor.final_url || anchor.source_url || anchor.url)
  const outboundLinks = html ? extractOutboundLinks(html, anchor.final_url || anchor.url, 80) : []
  const pageImages = html ? extractImageCandidatesFromHtml(html, anchor.final_url || anchor.url, {
    lineage: 'direct_link',
    visualReason: 'Image surfaced directly on the selected anchor page.',
  }) : []
  const videoId = youtubeId(anchor.url) || youtubeId(anchor.final_url)
  const thumbnail = videoId ? [{
    page_url: anchor.url,
    image_url: `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`,
    title: getSourceDisplayTitle(anchor, anchor.title || anchor.note_title || 'YouTube thumbnail'),
    caption: 'YouTube thumbnail for the selected anchor video.',
    lineage: 'video_thumbnail',
    query: null,
    visual_reason: 'Primary video thumbnail for the anchor source.',
    license_or_rights: null,
    width: null,
    height: null,
  }] : []
  const searchQueries = buildAnchorQueries(anchor, terms)
  return {
    generated_at: new Date().toISOString(),
    research_mode: 'single-anchor-derived-pool',
    run_date: runDate,
    anchor_source: {
      url: anchor.url,
      final_url: anchor.final_url,
      title: getSourceDisplayTitle(anchor, anchor.title || anchor.note_title || anchor.url),
      source_channel: anchor.source_channel,
      source_type: anchor.source_type,
      note_id: anchor.note_id,
      note_path: anchor.note_path,
      why_selected: anchor.anchor_selection_reason || 'Selected as the strongest saved-signal anchor.',
      selection_score: anchor.anchor_selection_score || null,
      alternates: anchor.anchor_alternates || [],
    },
    anchor_research: {
      summary: sanitizeSourceText(text, '', 900),
      thesis: `A focused source field grown from ${getSourceDisplayTitle(anchor, anchor.title || anchor.note_title || anchor.url)}.`,
      entities: terms,
      places: terms.filter((term) => /(detroit|maryland|michigan|city|farm|garden|island|land)/i.test(term)),
      people_orgs: outboundLinks.map((link) => hostnameForUrl(link.url)).filter(Boolean).slice(0, 12),
      outbound_links: outboundLinks,
      visual_motifs: terms.filter((term) => /(farm|garden|map|diagram|city|plant|field|sheep|solar|carbon|archive|image|grid|algorithm|interface|material)/i.test(term)),
      image_search_queries: searchQueries.filter((query) => /image|archive|diagram|map|screenshot|asset/i.test(query)),
      search_queries: searchQueries,
      open_questions: [],
    },
    direct_image_candidates: [...thumbnail, ...pageImages],
  }
}

export async function discoverDerivedSourceCandidates(anchorResearch, anchor, { maxCandidates = MAX_DERIVED_CANDIDATES, recentSourceKeys = new Set() } = {}) {
  const candidates = []
  const seen = new Set([sourceContentKey(anchor)])
  const add = (candidate) => {
    const key = sourceContentKey(candidate)
    if (!key || seen.has(key) || recentSourceKeys.has(key)) return
    if (!isAllowedSourceUrl(candidate.url)) return
    seen.add(key)
    candidates.push(candidate)
  }

  for (const link of anchorResearch.anchor_research.outbound_links || []) {
    add(candidateFromUrl(link.url, anchor, {
      title: link.label,
      lineage: 'direct_link',
      reason: `Direct outbound link from anchor page: ${link.label || hostnameForUrl(link.url)}`,
    }))
    if (candidates.length >= maxCandidates) return candidates
  }

  for (const query of (anchorResearch.anchor_research.search_queries || []).slice(0, MAX_DERIVED_SEARCH_QUERIES)) {
    const results = await searchDuckDuckGo(query, 8)
    for (const result of results) {
      add(candidateFromUrl(result.url, anchor, {
        title: result.title,
        lineage: /image|archive|diagram|map/i.test(query) ? 'archive_reference' : 'entity_search',
        query,
        reason: `Search result connected to anchor query: ${query}`,
      }))
      if (candidates.length >= maxCandidates) return candidates
    }
  }
  return candidates
}

function scoreImageCandidate(candidate, anchorResearch) {
  const text = `${candidate.title || ''} ${candidate.caption || ''} ${candidate.image_url || ''} ${candidate.page_url || ''} ${candidate.visual_reason || ''}`.toLowerCase()
  const motifs = new Set([...(anchorResearch.anchor_research.visual_motifs || []), ...(anchorResearch.anchor_research.entities || [])].map((term) => String(term).toLowerCase()))
  let score = 0
  if (candidate.image_url && !isLowValueVisualImage(candidate.image_url)) score += 20
  if (/\.(png|jpe?g|webp|avif)(?:$|[?#])/.test(candidate.image_url || '')) score += 8
  if (candidate.width && candidate.height) score += Math.min(12, Math.round(Math.log10(candidate.width * candidate.height) * 2))
  if (['archive_reference', 'repo_asset', 'map_diagram', 'video_thumbnail', 'direct_link'].includes(candidate.lineage)) score += 8
  for (const motif of motifs) if (motif && text.includes(motif)) score += 2
  if (/logo|favicon|avatar|profile|icon|sprite|wordmark|placeholder|pixel\.png/.test(text)) score -= 30
  if (/map|diagram|plate|archive|field|garden|farm|screenshot|asset|photo|image|scan|object|museum|commons|iiif/.test(text)) score += 10
  return score
}

export async function discoverImageSourceMaterial(anchorResearch, derivedCandidates = [], { maxCandidates = MAX_IMAGE_CANDIDATES, maxSelected = 8 } = {}) {
  const imageCandidates = [...(anchorResearch.direct_image_candidates || [])]
  const pagesToInspect = uniqueNonEmpty([
    ...(derivedCandidates || []).slice(0, 12).map((candidate) => candidate.url),
    ...(anchorResearch.anchor_research.outbound_links || []).slice(0, 8).map((link) => link.url),
  ]).slice(0, 16)

  for (const pageUrl of pagesToInspect) {
    if (imageCandidates.length >= maxCandidates) break
    const html = await fetchHtml(pageUrl)
    if (!html) continue
    imageCandidates.push(...extractImageCandidatesFromHtml(html, pageUrl, {
      lineage: /github\.com/.test(pageUrl) ? 'repo_asset' : 'visual_reference',
      visualReason: 'Image found on a page derived from the anchor research.',
    }))
  }

  for (const query of (anchorResearch.anchor_research.image_search_queries || []).slice(0, 4)) {
    if (imageCandidates.length >= maxCandidates) break
    const results = await searchDuckDuckGo(query, 5)
    for (const result of results) {
      imageCandidates.push({
        page_url: result.url,
        image_url: '',
        title: result.title,
        caption: '',
        lineage: 'image_search',
        query,
        visual_reason: `Image-oriented page candidate from query: ${query}`,
        license_or_rights: null,
        width: null,
        height: null,
      })
    }
  }

  const seenImages = new Set()
  const deduped = imageCandidates
    .filter((candidate) => candidate?.image_url && !isLowValueVisualImage(candidate.image_url))
    .filter((candidate) => {
      const key = candidate.image_url.toLowerCase()
      if (seenImages.has(key)) return false
      seenImages.add(key)
      return true
    })
    .map((candidate) => ({ ...candidate, score: scoreImageCandidate(candidate, anchorResearch) }))
    .sort((left, right) => right.score - left.score)

  return {
    image_source_candidates: deduped.slice(0, maxCandidates),
    selected_image_material: deduped.slice(0, maxSelected),
  }
}
