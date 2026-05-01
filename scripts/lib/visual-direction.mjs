import fs from 'node:fs/promises'
import path from 'node:path'

import { openAiJson } from './openai-json.mjs'
import { domain, getSourceDisplayTitle } from './source-display.mjs'
import { getResearchContentSources } from './source-research.mjs'
import { sanitizeSourceText } from './source-text.mjs'
import { slugify, uniqueNonEmpty } from './string-utils.mjs'

const recentDiversityEditionCount = 6

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function slugBaseWithoutVersion(value) {
  return slugify(value).replace(/-v\d+$/i, '') || 'daily-edition'
}

function normalizeStringArray(value, fallback) {
  if (!Array.isArray(value)) return fallback
  const result = value.map((entry) => String(entry).trim()).filter(Boolean)
  return result.length ? result : fallback
}

const fallbackMotifStopwords = new Set([
  'a',
  'an',
  'and',
  'are',
  'artwork',
  'audio',
  'avoid',
  'channel',
  'channels',
  'collisions',
  'cover',
  'creative process',
  'demo',
  'embed',
  'good',
  'image',
  'images',
  'instantly',
  'known',
  'landing',
  'media',
  'page',
  'pages',
  'persistent',
  'public',
  'recognizable',
  'reliable',
  'sample',
  'signal',
  'signals',
  'source',
  'sources',
  'stable',
  'strong',
  'support',
  'surface',
  'surfaces',
  'text',
  'thumbnail',
  'track',
  'urls',
  'variant',
  'video',
  'anchor',
  'originality',
  'recombination',
])

function trimSourceCreatorSuffix(value) {
  return String(value || '')
    .replace(/,\s*by\s+.+$/i, '')
    .replace(/\s+by\s+.+$/i, '')
    .replace(/\s*\([^)]*edition[^)]*\)/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function isUsefulFallbackMotifTerm(term) {
  const normalized = String(term || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  if (!normalized || normalized.length < 4) return false
  if (/^\d+$/.test(normalized)) return false
  if (fallbackMotifStopwords.has(normalized)) return false
  if (/^(known good|public signal|sample urls|landing page|image surface)$/.test(normalized)) return false
  return true
}

export function selectFallbackMotifTerms(signalHarvest, limit = 8) {
  return uniqueNonEmpty(
    (signalHarvest?.motif_terms || [])
      .map((entry) => entry?.term)
      .filter(isUsefulFallbackMotifTerm),
  ).slice(0, limit)
}

function fallbackMotifPhrase(term) {
  const clean = String(term || '').replace(/-/g, ' ').trim()
  if (!clean) return ''
  if (/(dreamlike|ambient|electronic|textural|luminous|glow|bright|shadow|nocturnal|organ centered)/i.test(clean)) return `${clean} atmosphere`
  if (/(branching|labyrinth|geometry|structures|structure|logic|recursion|remix|recombination)/i.test(clean)) return `${clean} geometry`
  if (/(art|artwork|cover|poster|collage|ribbon|plaque|panel)/i.test(clean)) return `${clean} surfaces`
  return clean
}

function buildFallbackMaterialProfile(signalHarvest, researchField) {
  const motifTerms = selectFallbackMotifTerms(signalHarvest, 6)
  const visualReferenceTitle = trimSourceCreatorSuffix(getSourceDisplayTitle(researchField?.visual_reference, ''))
  const sourceTitles = getResearchContentSources(researchField)
    .slice(0, 3)
    .map((source) => trimSourceCreatorSuffix(getSourceDisplayTitle(source, '')))
    .filter(Boolean)

  return uniqueNonEmpty([
    visualReferenceTitle ? `${visualReferenceTitle} cover art` : '',
    ...motifTerms.slice(0, 4).map(fallbackMotifPhrase),
    ...sourceTitles.slice(0, 2).map((title) => `${title} sleeve imagery`),
  ]).slice(0, 5)
}

function inferVisualDirectionFallback(signalHarvest, researchField, recentEditions = []) {
  const motifTerms = selectFallbackMotifTerms(signalHarvest, 18)
  const textCorpus = [
    researchField.autoresearch?.synthesis,
    researchField.autoresearch?.edition_thesis,
    researchField.visual_reference?.description,
    researchField.visual_reference?.selection_reason,
    ...motifTerms,
    ...getResearchContentSources(researchField)
      .slice(0, 8)
      .flatMap((source) => [source.title, source.description, source.note_context]),
  ].filter(Boolean).join(' ').toLowerCase()

  const score = (terms) => terms.reduce((total, term) => total + (textCorpus.match(new RegExp(`\\b${term}\\b`, 'g')) || []).length, 0)
  const brightScore = score(['bright', 'sun', 'yellow', 'warm', 'color', 'chromatic', 'paint', 'floral', 'garden', 'glow'])
  const darkScore = score(['dark', 'night', 'charcoal', 'smoke', 'shadow', 'fog', 'black', 'nocturnal'])
  const hardEdgeScore = score(['grid', 'block', 'tile', 'panel', 'diagram', 'signal', 'poster', 'graphic', 'print'])
  const organicScore = score(['wave', 'cloud', 'petal', 'garden', 'field', 'body', 'drift', 'water', 'handmade'])
  const collageScore = score(['collage', 'scrap', 'archive', 'patch', 'assemblage', 'layer'])
  const gesturalScore = score(['gesture', 'paint', 'brush', 'scribble', 'smear', 'mark'])
  const denseScore = score(['dense', 'busy', 'crowd', 'cluster', 'maximal', 'stack'])
  const airyScore = score(['open', 'spare', 'quiet', 'empty', 'calm', 'breath'])
  const recentText = recentEditions.map((edition) => `${edition.title || ''} ${edition.scene_family || ''}`).join(' ').toLowerCase()
  const repeatedMinimal = /(minimal|quiet|gate|threshold|corridor|charcoal|shadow|fog)/.test(recentText)

  const brightnessProfile = brightScore > darkScore ? 'bright' : darkScore > brightScore + 1 ? 'low-key' : 'mixed'
  const densityProfile = denseScore > airyScore ? 'dense' : airyScore > denseScore ? 'airy' : 'balanced'
  const geometryProfile = hardEdgeScore > organicScore ? 'hard-edge' : organicScore > hardEdgeScore ? 'organic' : 'mixed'
  const compositionProfile = collageScore >= Math.max(gesturalScore, hardEdgeScore) && collageScore > 0
    ? 'collage'
    : gesturalScore > hardEdgeScore
      ? 'gestural'
      : hardEdgeScore > 0
        ? 'block-based'
        : 'distributed'
  const paletteProfile = brightnessProfile === 'bright'
    ? 'let the strongest source-image colors stay saturated and visible rather than muting them'
    : brightnessProfile === 'low-key'
      ? 'keep tonal contrast sourced from the material while preserving readable accents'
      : 'balance luminous accents with grounded neutrals drawn from the research set'
  const lightingProfile = brightnessProfile === 'bright'
    ? 'follow the source set toward even, open illumination unless the evidence clearly calls for drama'
    : 'derive the lighting from the strongest research imagery rather than imposing theatrical darkness'
  const negativeSpaceTarget = densityProfile === 'dense' ? 'let density expand where the sources support it; keep enough breathing room for interaction targets' : densityProfile === 'airy' ? 'preserve open breathing room where the source field feels spacious' : 'balance open space with clustered activity according to the source evidence'
  const materialProfile = buildFallbackMaterialProfile(signalHarvest, researchField)
  const avoidPatterns = uniqueNonEmpty([
    repeatedMinimal ? 'avoid repeating the recent minimal dark threshold/gate vocabulary unless the new research clearly reinforces it' : '',
    'avoid generic office-room, dashboard, or card-grid fallback staging',
  ])

  return {
    evidence_summary: researchField.autoresearch?.synthesis || researchField.autoresearch?.edition_thesis || 'Visual direction should be inferred from the saved-signal research set.',
    brightness_profile: brightnessProfile,
    density_profile: densityProfile,
    abstraction_profile: 'abstract',
    geometry_profile: geometryProfile,
    composition_profile: compositionProfile,
    palette_profile: paletteProfile,
    material_profile: materialProfile.length ? materialProfile : ['research-shaped surfaces', 'source-led color relationships'],
    lighting_profile: lightingProfile,
    negative_space_guidance: negativeSpaceTarget,
    anchor_strategy: 'derive anchor scale and loudness from the source field; some anchors can be bold islands while others remain embedded details',
    prompt_guardrails: uniqueNonEmpty([
      'derive composition, palette, density, and geometry from the supplied sources instead of a preset house style',
      'let the strongest visual reference influence spatial structure and color relationships, not just texture',
      repeatedMinimal ? 'break away from the recent dark sparse runs if the new source field allows it' : '',
    ]),
    avoid_patterns: avoidPatterns,
    scene_family_seed: slugBaseWithoutVersion(researchField.autoresearch?.edition_thesis || motifTerms.slice(0, 3).join(' ') || 'daily-source-field'),
    mood_phrase: `${brightnessProfile} ${compositionProfile} source field shaped by current research`,
    dominant_structure: densityProfile === 'dense' ? 'multiple clusters or panels if the evidence supports them' : 'one to three major structures if that best fits the evidence',
    material_limit: densityProfile === 'dense' ? 6 : densityProfile === 'airy' ? 4 : 5,
  }
}

export async function inferVisualDirection({ signalHarvest, researchField, apiKey, model, date, recentEditions = [] }, runDir) {
  const fallback = inferVisualDirectionFallback(signalHarvest, researchField, recentEditions)
  const request = {
    date,
    goal: 'Infer visual direction from the mined Obsidian signals, autoresearch synthesis, selected content sources, and visual reference. Do not impose a fixed house aesthetic. Let the evidence decide brightness, density, geometry, composition, and material language.',
    constraints: [
      'Treat aesthetic direction as evidence-derived, not preset-derived.',
      'Use the supplied visual reference to influence composition structure, geometry, color relationships, layering, density, and atmosphere when relevant.',
      'Avoid generic office-room, dashboard, and card-grid staging.',
      'Consider recent editions only as anti-repetition pressure, not as a style template to repeat.',
    ],
    expected_output_schema: {
      evidence_summary: 'string',
      brightness_profile: 'bright | mixed | low-key',
      density_profile: 'airy | balanced | dense',
      abstraction_profile: 'abstract | hybrid | representational',
      geometry_profile: 'hard-edge | organic | mixed',
      composition_profile: 'field-based | block-based | collage | distributed | gestural | stacked',
      palette_profile: 'plain-language palette guidance grounded in evidence',
      material_profile: ['3 to 6 source-led materials or surface cues'],
      lighting_profile: 'plain-language lighting guidance grounded in evidence',
      negative_space_guidance: 'how open or dense the page should feel, based on evidence',
      dominant_structure: 'plain-language description of how many major structures the composition should support',
      anchor_strategy: 'how source anchors should show up visibly in this specific visual world',
      prompt_guardrails: ['3 to 6 evidence-derived art-direction guardrails'],
      avoid_patterns: ['specific repeated patterns to avoid if recent editions overused them'],
      scene_family_seed: 'kebab-case seed inferred from the field, not a versioned slug',
      mood_phrase: 'short phrase describing the source-led visual mood',
      material_limit: 'integer from 4 to 6',
    },
    signal_summary: {
      motif_terms: signalHarvest.motif_terms.slice(0, 24),
      notes_selected: signalHarvest.notes_selected.slice(0, 16).map(({ text, urls, ...note }) => ({
        ...note,
        url_count: urls?.length || 0,
        excerpt: sanitizeSourceText(note.excerpt, '', 240),
      })),
    },
    autoresearch: {
      synthesis: researchField.autoresearch?.synthesis || null,
      edition_thesis: researchField.autoresearch?.edition_thesis || null,
      clusters: researchField.autoresearch?.clusters || [],
      rejected_patterns: researchField.autoresearch?.rejected_patterns || [],
    },
    visual_reference: researchField.visual_reference ? {
      title: getSourceDisplayTitle(researchField.visual_reference, 'Visual reference'),
      description: researchField.visual_reference.description || null,
      selection_reason: researchField.visual_reference.selection_reason || null,
      source_url: researchField.visual_reference.url || researchField.visual_reference.source_url || null,
      image_url: researchField.visual_reference.image_url || null,
    } : null,
    content_sources: getResearchContentSources(researchField).slice(0, 8).map((source) => ({
      title: getSourceDisplayTitle(source, 'Source'),
      description: sanitizeSourceText(source.description, '', 240),
      note_context: sanitizeSourceText(source.note_context, '', 180),
      source_type: source.source_type || null,
      domain: domain(source.url || source.final_url || '') || null,
      has_image: Boolean(source.image_url),
    })),
    recent_editions: recentEditions.slice(0, recentDiversityEditionCount).map((edition) => ({
      title: edition.title,
      scene_family: edition.scene_family,
      summary: edition.about_excerpt || null,
    })),
  }
  await writeJson(path.join(runDir, 'visual-direction-request.json'), request)

  try {
    const inferred = await openAiJson({
      apiKey,
      model,
      instructions: [
        'You infer art direction for a daily interactive image from research evidence.',
        'Do not impose a fixed house style.',
        'Ground every visual recommendation in the supplied signals, source summaries, and visual reference.',
        'Return strict JSON matching the requested schema.',
      ].join(' '),
      input: JSON.stringify(request, null, 2),
      maxOutputTokens: 3000,
    })
    const normalized = {
      ...fallback,
      ...inferred,
      material_profile: normalizeStringArray(inferred.material_profile, fallback.material_profile).slice(0, 6),
      prompt_guardrails: normalizeStringArray(inferred.prompt_guardrails, fallback.prompt_guardrails).slice(0, 6),
      avoid_patterns: normalizeStringArray(inferred.avoid_patterns, fallback.avoid_patterns).slice(0, 6),
      scene_family_seed: slugBaseWithoutVersion(inferred.scene_family_seed || fallback.scene_family_seed),
      material_limit: Math.max(4, Math.min(6, Number(inferred.material_limit) || fallback.material_limit || 5)),
      generated_at: new Date().toISOString(),
      tool: `OpenAI Responses API (${model})`,
    }
    await writeJson(path.join(runDir, 'visual-direction.json'), normalized)
    return normalized
  } catch (error) {
    const normalized = {
      ...fallback,
      generated_at: new Date().toISOString(),
      tool: `OpenAI Responses API (${model})`,
      status: 'fallback',
      error: error.message,
    }
    await writeJson(path.join(runDir, 'visual-direction.json'), normalized)
    return normalized
  }
}
