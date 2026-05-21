import fs from 'node:fs/promises'
import path from 'node:path'

import { findVisualReference, inspectCandidateSource } from './source-inspection.mjs'
import {
  buildAnchorResearch,
  discoverDerivedSourceCandidates,
  discoverImageSourceMaterial,
  selectAnchorSource,
} from './anchor-source-research.mjs'
import { buildInspirationOverrideVisualReference } from './inspiration-override.mjs'
import { openAiJson } from './openai-json.mjs'
import { getSourceDisplayTitle } from './source-display.mjs'
import { sanitizeSourceText } from './source-text.mjs'
import { canonicalizeSourceUrl } from './source-url-policy.mjs'
import {
  isAllowedInspectedSource,
  isLowValueVisualImage,
  selectContentSources,
  selectSourceCandidatesForInspection,
  sourceContentKey,
  sourceContentScore,
  sourceHasRenderableCardSurface,
  visualReferenceScore,
} from './source-selection-policy.mjs'
import { uniqueNonEmpty } from './string-utils.mjs'

const root = process.cwd()
const minContentItems = 6
const targetContentItems = 9
const maxContentItems = 10
const autoresearchCandidateMultiplier = 4
const maxAutoresearchCandidates = 40

function isSingleAnchorResearchEnabled() {
  return process.env.DFE_SINGLE_ANCHOR_RESEARCH !== '0'
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

export function getResearchContentSources(researchField) {
  return Array.isArray(researchField.content_sources) && researchField.content_sources.length
    ? researchField.content_sources
    : selectContentSources(researchField.sources || [])
}

function noteLookupForSignalHarvest(signalHarvest) {
  const lookup = new Map()
  for (const note of signalHarvest?.notes_selected || []) {
    for (const key of [note.id, note.path, note.title].filter(Boolean)) lookup.set(key, note)
  }
  return lookup
}

function researchEvidenceForSource(source, index, { recentSourceKeys = new Set(), noteLookup = new Map() } = {}) {
  const note = noteLookup.get(source.note_id) || noteLookup.get(source.note_path) || noteLookup.get(source.note_title) || null
  return {
    id: `source-${index + 1}`,
    url: source.url,
    final_url: source.final_url,
    canonical_key: sourceContentKey(source),
    title: getSourceDisplayTitle(source, source.note_title || source.url),
    description: sanitizeSourceText(source.description, '', 650),
    visible_text: sanitizeSourceText(source.visible_text, '', 700),
    image_url: source.image_url || null,
    youtube_embed_status: source.youtube_embed_status || null,
    source_channel: source.source_channel,
    source_type: source.source_type,
    note_title: source.note_title,
    note_date: source.note_date,
    note_excerpt: sanitizeSourceText(note?.excerpt, '', 600),
    renderable_surface: sourceHasRenderableCardSurface(source, { notes_selected: note ? [note] : [] }),
    recent_duplicate: recentSourceKeys.has(sourceContentKey(source)),
    evidence_score: Math.round(sourceContentScore(source, recentSourceKeys)),
  }
}

function buildResearchSourceLookup(sources) {
  const lookup = new Map()
  for (const source of sources || []) {
    const aliases = [
      source.url,
      source.source_url,
      source.final_url,
      sourceContentKey(source),
      canonicalizeSourceUrl(source.url),
      canonicalizeSourceUrl(source.source_url),
      canonicalizeSourceUrl(source.final_url),
    ].filter(Boolean)
    for (const alias of aliases) {
      if (!lookup.has(alias)) lookup.set(alias, source)
    }
  }
  return lookup
}

function lookupResearchSource(lookup, value) {
  if (!value) return null
  return lookup.get(value) || lookup.get(canonicalizeSourceUrl(value)) || null
}

function selectedUrlsFromAutoresearch(autoresearch) {
  const urls = []
  for (const url of autoresearch?.selected_content_urls || []) urls.push(url)
  for (const decision of autoresearch?.source_decisions || []) {
    if (['content', 'visual_reference'].includes(decision?.role)) urls.push(decision.url)
  }
  for (const url of autoresearch?.visual_reference_urls || []) urls.push(url)
  return uniqueNonEmpty(urls)
}

function normalizeAutoresearchSelection(autoresearch, evidenceSources, {
  maxSources,
  recentSourceKeys = new Set(),
  signalHarvest = null,
} = {}) {
  const lookup = buildResearchSourceLookup(evidenceSources)
  const selected = []
  const seen = new Set()
  const seenTwitterNotes = new Set()
  const addSource = (source) => {
    if (!source || selected.length >= maxSources) return
    const key = sourceContentKey(source)
    if (!key || seen.has(key)) return
    if (recentSourceKeys.has(key)) return
    if (source.source_channel === 'twitter-bookmark') {
      const twitterNoteKey = source.note_id || source.note_title || source.note_path
      if (twitterNoteKey && seenTwitterNotes.has(twitterNoteKey)) return
      if (twitterNoteKey) seenTwitterNotes.add(twitterNoteKey)
    }
    seen.add(key)
    selected.push(source)
  }

  for (const url of selectedUrlsFromAutoresearch(autoresearch)) {
    addSource(lookupResearchSource(lookup, url))
  }

  const deterministicContent = selectContentSources(evidenceSources, {
    recentSourceKeys,
    maxItems: maxSources,
    targetItems: Math.min(targetContentItems, maxSources),
    signalHarvest,
  })
  for (const source of deterministicContent) addSource(source)

  const rankedFallback = [...evidenceSources]
    .map((source) => ({ source, score: sourceContentScore(source, recentSourceKeys) }))
    .filter((entry) => Number.isFinite(entry.score))
    .sort((left, right) => right.score - left.score)
  for (const { source } of rankedFallback) addSource(source)

  return selected.slice(0, maxSources)
}

async function collectFetchEvidenceForAutoresearch(candidates, { recentSourceKeys, signalHarvest, runDir }) {
  const inspected = []
  for (const candidate of candidates) {
    const source = await inspectCandidateSource(candidate, { sourceTool: 'fetch', browserHarness: null })
    if (!source || !isAllowedInspectedSource(source)) continue
    inspected.push(source)
  }

  const noteLookup = noteLookupForSignalHarvest(signalHarvest)
  const evidence = inspected.map((source, index) => researchEvidenceForSource(source, index, {
    recentSourceKeys,
    noteLookup,
  }))
  await writeJson(path.join(runDir, 'source-candidate-evidence.json'), {
    generated_at: new Date().toISOString(),
    tool: 'Node fetch + DNS-aware source policy',
    candidate_count: candidates.length,
    evidence_count: evidence.length,
    evidence,
  })
  return inspected
}

async function runSourceAutoresearch({
  signalHarvest,
  evidenceSources,
  apiKey,
  model,
  date,
  maxSources,
  recentSourceKeys = new Set(),
  inspirationOverride = null,
}, runDir) {
  const noteLookup = noteLookupForSignalHarvest(signalHarvest)
  const evidence = evidenceSources.map((source, index) => researchEvidenceForSource(source, index, {
    recentSourceKeys,
    noteLookup,
  }))
  const request = {
    date,
    workflow: 'llm-wiki-inspired autoresearch: read all candidate source evidence first, cluster the field, synthesize a thesis, choose sources with provenance, then hand only selected URLs to browser capture.',
    hard_rules: [
      'Use only URLs present in candidate_sources. Do not invent outside URLs.',
      'Public content must come only from recent saved-signal channels: Twitter bookmarks, YouTube likes, NTS resolved streaming sources, and Chrome bookmarks.',
      'Never select local files, text documents, NTS pages, unresolved search locators, or URLs that are not in the candidate list.',
      `Select ${minContentItems} to ${maxContentItems} content URLs when enough suitable sources exist; ${targetContentItems} is ideal.`,
      'Avoid duplicates by story, source page, resolved media, redirect target, video, post, or image.',
      'Prefer variety across channel, source type, domain, and note cluster.',
      'Prefer source material that can render as title plus real image, direct image, tweet media, or native YouTube embed.',
      'For NTS-derived rows, prefer YouTube streaming sources, then Bandcamp, then SoundCloud.',
      'Choose artistic or material-rich raster visual references over technical diagrams, logos, docs chrome, favicons, icons, and placeholder images.',
      inspirationOverride
        ? 'A temporary inspiration image override is attached. Treat it as the strongest aesthetic steering signal for today, but still choose public content URLs only from candidate_sources.'
        : null,
    ].filter(Boolean),
    expected_output_schema: {
      research_question: 'string',
      synthesis: 'plain-language paragraph describing what the sources collectively suggest',
      edition_thesis: 'short visual/editorial thesis for today',
      clusters: [{ label: 'string', takeaway: 'string', urls: ['candidate URL strings'] }],
      source_decisions: [{ url: 'candidate URL string', role: 'content | visual_reference | supporting | reject', why: 'string', confidence: 'high | medium | low' }],
      selected_content_urls: ['7 to 10 candidate URL strings'],
      visual_reference_urls: ['1 to 3 candidate URL strings with likely strong real imagery'],
      capture_notes: ['what browser-harness should verify or capture after research'],
      rejected_patterns: ['duplicate or low-value patterns avoided'],
    },
    signal_summary: {
      notes_selected: signalHarvest.notes_selected.slice(0, 30).map(({ text, urls, ...note }) => ({
        ...note,
        url_count: urls?.length || 0,
        excerpt: sanitizeSourceText(note.excerpt, '', 500),
      })),
      motif_terms: signalHarvest.motif_terms.slice(0, 30),
    },
    manual_inspiration_override: inspirationOverride ? {
      title: inspirationOverride.title,
      note: inspirationOverride.note,
      source: inspirationOverride.source,
      source_url: inspirationOverride.source_url,
      prompt_bias_terms: inspirationOverride.prompt_bias_terms,
    } : null,
    candidate_sources: evidence,
  }
  await writeJson(path.join(runDir, 'source-autoresearch-request.json'), request)

  try {
    const responseInput = inspirationOverride?.image_data_url
      ? [
          {
            role: 'user',
            content: [
              { type: 'input_text', text: JSON.stringify(request, null, 2) },
              { type: 'input_image', image_url: inspirationOverride.image_data_url },
            ],
          },
        ]
      : JSON.stringify(request, null, 2)
    const result = await openAiJson({
      apiKey,
      model,
      instructions: [
        'You are the source-research editor for a daily interactive artwork.',
        'Think like an autoresearch pass, not a metadata scraper: orient to all evidence, cluster it, identify the strongest through-line, select a varied source set, and preserve provenance.',
        'Return strict JSON matching the requested schema. Do not include Markdown.',
      ].join(' '),
      input: responseInput,
      maxOutputTokens: 6000,
    })
    const normalized = {
      ...result,
      generated_at: new Date().toISOString(),
      tool: 'Hermes structured JSON',
      workflow: request.workflow,
      candidate_count: evidence.length,
    }
    await writeJson(path.join(runDir, 'source-autoresearch.json'), normalized)
    return normalized
  } catch (error) {
    const fallback = {
      generated_at: new Date().toISOString(),
      tool: 'Hermes structured JSON',
      workflow: request.workflow,
      status: 'fallback',
      error: error.message,
      research_question: `What recent saved signals should shape the ${date} edition?`,
      synthesis: 'The model autoresearch pass failed, so the runner fell back to deterministic channel-balanced source ranking.',
      edition_thesis: 'A varied saved-signal field selected by source quality, renderability, recency, and channel balance.',
      clusters: [],
      source_decisions: [],
      selected_content_urls: selectContentSources(evidenceSources, {
        recentSourceKeys,
        maxItems: Math.min(maxSources, maxContentItems),
        targetItems: Math.min(targetContentItems, maxSources),
        signalHarvest,
      }).map((source) => source.url),
      visual_reference_urls: evidenceSources
        .filter((source) => source.image_url && !isLowValueVisualImage(source.image_url))
        .sort((left, right) => visualReferenceScore(right, recentSourceKeys) - visualReferenceScore(left, recentSourceKeys))
        .slice(0, 3)
        .map((source) => source.url),
      capture_notes: ['Fallback mode: browser-harness should verify selected media surfaces and source images.'],
      rejected_patterns: ['recent duplicates', 'low-value technical preview images', 'non-renderable source URLs'],
      candidate_count: evidence.length,
    }
    await writeJson(path.join(runDir, 'source-autoresearch.json'), fallback)
    return fallback
  }
}

async function captureAutoresearchedSources(selectedSources, { sourceTool, browserHarness, maxSources }) {
  const captured = []
  const seen = new Set()

  for (const candidate of selectedSources) {
    if (captured.length >= maxSources) break
    const key = sourceContentKey(candidate)
    if (!key || seen.has(key)) continue
    seen.add(key)
    const source = await inspectCandidateSource(candidate, { sourceTool, browserHarness })
    if (!source || !isAllowedInspectedSource(source)) continue
    captured.push(source)
  }

  return captured
}

export async function inspectSourceCandidates(signalHarvest, {
  maxSources,
  runDir,
  sourceTool,
  browserHarness,
  recentSourceKeys = new Set(),
  apiKey,
  model,
  date,
  inspirationOverride = null,
}) {
  const candidateLimit = Math.max(maxSources, Math.min(maxSources * autoresearchCandidateMultiplier, maxAutoresearchCandidates))
  const candidates = selectSourceCandidatesForInspection(signalHarvest, candidateLimit, { recentSourceKeys })
  const fetchEvidence = await collectFetchEvidenceForAutoresearch(candidates, {
    recentSourceKeys,
    signalHarvest,
    runDir,
  })

  let researchMode = 'single-anchor-derived-pool'
  let anchorResearch = null
  let derivedCandidates = []
  let imageSourceMaterial = { image_source_candidates: [], selected_image_material: [] }
  let autoresearch = null
  let inspected = []

  const anchorSource = isSingleAnchorResearchEnabled()
    ? selectAnchorSource(fetchEvidence, { recentSourceKeys, signalHarvest })
    : null
  if (anchorSource) {
    anchorResearch = await buildAnchorResearch(anchorSource, { runDate: date })
    await writeJson(path.join(runDir, 'anchor-research.json'), anchorResearch)

    derivedCandidates = await discoverDerivedSourceCandidates(anchorResearch, anchorSource, {
      maxCandidates: Math.max(maxSources * 3, 24),
      recentSourceKeys,
    })
    imageSourceMaterial = await discoverImageSourceMaterial(anchorResearch, derivedCandidates, {
      maxCandidates: 32,
      maxSelected: 8,
    })
    await writeJson(path.join(runDir, 'image-source-material.json'), imageSourceMaterial)

    const singleAnchorCaptureSet = [anchorSource, ...derivedCandidates]
    inspected = await captureAutoresearchedSources(singleAnchorCaptureSet, {
      sourceTool,
      browserHarness,
      maxSources: Math.max(maxSources * 2, minContentItems + 6),
    })

    autoresearch = {
      generated_at: new Date().toISOString(),
      tool: 'single-anchor-derived-pool',
      workflow: 'Select one saved-signal anchor, deep-research it, discover derived supporting sources and image source material, then capture a coherent source pool around that anchor.',
      research_question: `What source field grows out of ${anchorResearch.anchor_source.title}?`,
      synthesis: anchorResearch.anchor_research.summary,
      edition_thesis: anchorResearch.anchor_research.thesis,
      clusters: [{
        label: 'Anchor-derived source field',
        takeaway: anchorResearch.anchor_research.thesis,
        urls: [anchorSource.url, ...derivedCandidates.slice(0, 10).map((candidate) => candidate.url)],
      }],
      source_decisions: [
        { url: anchorSource.url, role: 'content', why: anchorResearch.anchor_source.why_selected, confidence: 'high' },
        ...derivedCandidates.slice(0, 18).map((candidate) => ({
          url: candidate.url,
          role: 'content',
          why: candidate.source_reason || 'Derived from the selected anchor source.',
          confidence: 'medium',
        })),
      ],
      selected_content_urls: [anchorSource.url, ...derivedCandidates.map((candidate) => candidate.url)].slice(0, Math.max(maxSources * 2, minContentItems + 6)),
      visual_reference_urls: imageSourceMaterial.selected_image_material.map((candidate) => candidate.page_url || candidate.image_url).slice(0, 8),
      capture_notes: [
        'Single-anchor mode: use the saved-signal anchor as the editorial root and derive supporting source windows from its linked/search context.',
        'Use selected_image_material as visual source material for the image generation step; do not treat generic logos or profile images as art direction.',
      ],
      rejected_patterns: ['login-gated profile pages', 'contact pages', 'logos/favicons/placeholders', 'recent duplicates', 'sources with no lineage back to the anchor'],
      candidate_count: fetchEvidence.length,
      derived_candidate_count: derivedCandidates.length,
      selected_image_material_count: imageSourceMaterial.selected_image_material.length,
    }
    await writeJson(path.join(runDir, 'source-autoresearch.json'), autoresearch)
  }

  let contentSources = selectContentSources(inspected, { recentSourceKeys, signalHarvest })

  if (contentSources.length < minContentItems) {
    researchMode = anchorSource ? 'single-anchor-derived-pool-fallback-autoresearch' : 'fallback-autoresearch'
    autoresearch = await runSourceAutoresearch({
      signalHarvest,
      evidenceSources: fetchEvidence,
      apiKey,
      model,
      date,
      maxSources,
      recentSourceKeys,
      inspirationOverride,
    }, runDir)
    const selectedForCapture = normalizeAutoresearchSelection(autoresearch, fetchEvidence, {
      maxSources,
      recentSourceKeys,
      signalHarvest,
    })
    inspected = await captureAutoresearchedSources(selectedForCapture, {
      sourceTool,
      browserHarness,
      maxSources,
    })
    contentSources = selectContentSources(inspected, { recentSourceKeys, signalHarvest })
  }

  if (contentSources.length < minContentItems) {
    const capturedKeys = new Set(inspected.map(sourceContentKey))
    const fillCandidates = fetchEvidence
      .filter((source) => !capturedKeys.has(sourceContentKey(source)))
      .map((source) => ({
        source,
        renderable: sourceHasRenderableCardSurface(source, signalHarvest),
        score: sourceContentScore(source, recentSourceKeys),
      }))
      .filter((entry) => Number.isFinite(entry.score))
      .sort((left, right) => {
        if (left.renderable !== right.renderable) return left.renderable ? -1 : 1
        return right.score - left.score
      })
      .map((entry) => entry.source)

    for (const candidate of fillCandidates) {
      if (contentSources.length >= minContentItems) break
      const added = await captureAutoresearchedSources([candidate], {
        sourceTool,
        browserHarness,
        maxSources: 1,
      })
      inspected.push(...added)
      contentSources = selectContentSources(inspected, { recentSourceKeys, signalHarvest })
    }
  }

  const discoveredVisualReference = await findVisualReference(signalHarvest, inspected, { sourceTool, browserHarness, recentSourceKeys })
  const imageMaterialReference = imageSourceMaterial.selected_image_material[0]
    ? {
        url: imageSourceMaterial.selected_image_material[0].page_url || imageSourceMaterial.selected_image_material[0].image_url,
        source_url: imageSourceMaterial.selected_image_material[0].page_url || imageSourceMaterial.selected_image_material[0].image_url,
        final_url: imageSourceMaterial.selected_image_material[0].page_url || imageSourceMaterial.selected_image_material[0].image_url,
        title: imageSourceMaterial.selected_image_material[0].title || imageSourceMaterial.selected_image_material[0].caption || 'Anchor image source material',
        description: imageSourceMaterial.selected_image_material[0].visual_reason || '',
        image_url: imageSourceMaterial.selected_image_material[0].image_url,
        selection_reason: 'Top image source material discovered from single-anchor deep research.',
        visual_reference_score: imageSourceMaterial.selected_image_material[0].score || null,
      }
    : null
  const visualReference = inspirationOverride
    ? buildInspirationOverrideVisualReference(inspirationOverride, { fallback: imageMaterialReference || discoveredVisualReference })
    : imageMaterialReference || discoveredVisualReference

  const researchField = {
    generated_at: new Date().toISOString(),
    research_mode: researchMode,
    single_anchor_research_enabled: isSingleAnchorResearchEnabled(),
    source_research_tool: researchMode.startsWith('single-anchor') ? 'single-anchor deep source research' : 'Hermes structured JSON autoresearch over Node fetch evidence',
    source_capture_tool: sourceTool,
    browser_harness: sourceTool === 'browser-harness' ? browserHarness : null,
    autoresearch,
    anchor_research: anchorResearch,
    anchor_research_path: anchorResearch ? path.join(runDir, 'anchor-research.json') : null,
    derived_source_count: derivedCandidates.length,
    derived_source_candidates: derivedCandidates,
    image_source_candidates: imageSourceMaterial.image_source_candidates,
    selected_image_material: imageSourceMaterial.selected_image_material,
    fetch_evidence_count: fetchEvidence.length,
    source_count: inspected.length,
    manual_inspiration_override: inspirationOverride ? {
      title: inspirationOverride.title,
      note: inspirationOverride.note,
      source: inspirationOverride.source,
      source_url: inspirationOverride.source_url,
      prompt_bias_terms: inspirationOverride.prompt_bias_terms,
      received_at: inspirationOverride.received_at,
      manifest_path: inspirationOverride.override_path,
    } : null,
    discovered_visual_reference: discoveredVisualReference,
    visual_reference: visualReference,
    content_source_count: contentSources.length,
    content_sources: contentSources,
    sources: inspected,
  }

  await writeJson(path.join(runDir, 'source-research.json'), researchField)
  if (contentSources.length < minContentItems) {
    throw new Error(`Source research produced ${contentSources.length} non-duplicate renderable content sources; expected at least ${minContentItems}. See ${path.relative(root, path.join(runDir, 'source-research.json'))}.`)
  }
  return researchField
}
