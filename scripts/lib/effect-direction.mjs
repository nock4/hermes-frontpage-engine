import { uniqueNonEmpty } from './string-utils.mjs'

const effectCatalog = [
  {
    effect_family: 'glass-condensation',
    terms: ['rain', 'rainy', 'wet', 'water', 'glass', 'window', 'condensation', 'fogged', 'droplet', 'reflective', 'reflection'],
    surface_language: ['fogged glass', 'droplet trails', 'wet reflection film', 'finger-cleared haze'],
    source_window_mark_types: ['wiped apertures', 'condensation halos', 'edge beads', 'clear-swipe trails'],
    prompt_sentence: 'Source windows appear as wiped condensation marks, condensation halos, edge beads, and clear-swipe trails in fogged glass, not torn paper, poster paste, or ripped collage.',
  },
  {
    effect_family: 'audio-light-leak',
    terms: ['music', 'club', 'radio', 'bass', 'drum', 'beat', 'sound', 'audio', 'mix', 'dj', 'nightlife'],
    surface_language: ['smoke veils', 'lens bloom', 'bass-pressure ridges', 'spectral light leaks'],
    source_window_mark_types: ['bass ridges', 'spectral veils', 'onset punctures', 'silence slits'],
    prompt_sentence: 'Source windows appear as bass ridges, spectral veils, onset punctures, and silence slits inside smoke and lens bloom, not torn paper, poster paste, or ripped collage.',
  },
  {
    effect_family: 'textile-pressure',
    terms: ['fashion', 'fabric', 'textile', 'garment', 'cloth', 'thread', 'woven', 'stitch', 'body', 'dress'],
    surface_language: ['woven fiber pressure', 'pulled thread paths', 'hem shadows', 'translucent cloth folds'],
    source_window_mark_types: ['thread pulls', 'hem notches', 'pressure folds', 'weave gaps'],
    prompt_sentence: 'Source windows appear as thread pulls, hem notches, pressure folds, and weave gaps in textile surfaces, not torn paper, poster paste, or ripped collage.',
  },
  {
    effect_family: 'screen-burn-tile',
    terms: ['game', 'pixel', 'sprite', 'screen', 'scanline', 'tile', 'grid', 'console', 'crt', 'interface'],
    surface_language: ['phosphor glow', 'scanline burn', 'tile breaks', 'sprite ghosting'],
    source_window_mark_types: ['tile breaks', 'sprite ghosts', 'scanline burns', 'collision notches'],
    prompt_sentence: 'Source windows appear as tile breaks, sprite ghosts, scanline burns, and collision notches in a screen-burn field, not torn paper, poster paste, or ripped collage.',
  },
  {
    effect_family: 'film-contact-burn',
    terms: ['film', 'photo', 'photography', 'camera', 'archive', 'contact', 'negative', 'exposure', 'analog'],
    surface_language: ['contact-sheet stock', 'exposure burn', 'dust flecks', 'sprocket shadows'],
    source_window_mark_types: ['exposure leaks', 'sprocket shadows', 'dust apertures', 'crop scars'],
    prompt_sentence: 'Source windows appear as exposure leaks, sprocket shadows, dust apertures, and crop scars in contact-film material, not torn paper, poster paste, or ripped collage.',
  },
  {
    effect_family: 'pigment-repair',
    terms: ['paint', 'painting', 'illustration', 'ink', 'brush', 'pigment', 'zine', 'comic', 'drawing', 'poster'],
    surface_language: ['pigment cracks', 'overpaint repairs', 'ink blooms', 'registration slips'],
    source_window_mark_types: ['pigment cracks', 'overpaint scars', 'ink blooms', 'registration slips'],
    prompt_sentence: 'Source windows appear as pigment cracks, overpaint scars, ink blooms, and registration slips in the printed/painted surface, not torn paper, poster paste, or ripped collage.',
  },
  {
    effect_family: 'architectural-threshold',
    terms: ['architecture', 'section', 'map', 'civic', 'building', 'room', 'threshold', 'corridor', 'street', 'strata'],
    surface_language: ['section-cut shadow', 'threshold bands', 'strata edges', 'conduit slots'],
    source_window_mark_types: ['shadow slots', 'threshold bands', 'section notches', 'strata cuts'],
    prompt_sentence: 'Source windows appear as shadow slots, threshold bands, section notches, and strata cuts in architectural material, not torn paper, poster paste, or ripped collage.',
  },
  {
    effect_family: 'object-wear',
    terms: ['object', 'product', 'ceramic', 'metal', 'chrome', 'plastic', 'enamel', 'package', 'macro', 'surface'],
    surface_language: ['gloss defects', 'enamel chips', 'contact dents', 'metal burrs'],
    source_window_mark_types: ['enamel chips', 'contact dents', 'gloss defects', 'edge burrs'],
    prompt_sentence: 'Source windows appear as enamel chips, contact dents, gloss defects, and edge burrs on object surfaces, not torn paper, poster paste, or ripped collage.',
  },
  {
    effect_family: 'torn-paper',
    terms: ['torn', 'ripped', 'paper', 'paste', 'collage', 'scrap', 'poster wall', 'layered poster'],
    surface_language: ['pasted paper depth', 'print fibers', 'scraped paste', 'rough poster edges'],
    source_window_mark_types: ['torn corners', 'paste seams', 'scraped windows', 'paper-fiber apertures'],
    prompt_sentence: 'Source windows appear as torn corners, paste seams, scraped windows, and paper-fiber apertures in a poster surface.',
  },
]

const tornPaperPenaltyPattern = /\b(torn|ripped|paper|poster wall|paste|collage|scrap|sleeve|tear|ripping)\b/g

function flattenText(value) {
  if (value == null) return []
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return [String(value)]
  if (Array.isArray(value)) return value.flatMap(flattenText)
  if (typeof value === 'object') return Object.values(value).flatMap(flattenText)
  return []
}

function scoreTerms(corpus, terms) {
  return terms.reduce((total, term) => {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const matches = corpus.match(new RegExp(`\\b${escaped}\\b`, 'gi')) || []
    return total + matches.length
  }, 0)
}

function recentTornPaperPressure(recentEditions = []) {
  const recentText = recentEditions.map((edition) => [
    edition?.title,
    edition?.scene_family,
    edition?.slug,
    edition?.visual_summary,
    edition?.about_excerpt,
    edition?.summary,
  ].filter(Boolean).join(' ')).join(' ').toLowerCase()
  return (recentText.match(tornPaperPenaltyPattern) || []).length
}

function sourceBasisForFamily(researchField, family, corpus) {
  const autoresearch = researchField?.autoresearch || {}
  return uniqueNonEmpty([
    autoresearch.aesthetic_thesis,
    autoresearch.edition_thesis,
    ...(autoresearch.visual_motifs || []),
    ...(autoresearch.capture_notes || []),
    ...(autoresearch.source_decisions || []).map((decision) => decision?.why),
    ...(researchField?.selected_image_material || []).map((candidate) => candidate?.visual_reason || candidate?.caption),
    ...(researchField?.source_image_fingerprints || []).flatMap((fingerprint) => [
      ...(fingerprint?.surface_cues || []),
      ...(fingerprint?.composition_moves || []),
      fingerprint?.visual_reason,
    ]),
  ]).filter((entry) => {
    const text = String(entry).toLowerCase()
    return family.terms.some((term) => text.includes(term)) || corpus.includes(text.slice(0, 24))
  }).slice(0, 4)
}

function withSharedAvoids(family, recentPenalty) {
  return uniqueNonEmpty([
    ...(family.effect_family === 'torn-paper' ? [] : ['torn paper', 'poster paste', 'ripped collage']),
    recentPenalty >= 2 ? 'ripped collage' : '',
    recentPenalty >= 2 ? 'torn poster wall' : '',
  ])
}

export function inferEffectDirectionFromResearch(researchField = {}, recentEditions = []) {
  const corpus = flattenText({
    autoresearch: researchField?.autoresearch,
    selected_image_material: researchField?.selected_image_material,
    source_image_fingerprints: researchField?.source_image_fingerprints,
    source_audio_material: researchField?.source_audio_material,
    visual_reference: researchField?.visual_reference,
    content_sources: researchField?.content_sources,
  }).join(' ').toLowerCase()
  const recentPenalty = recentTornPaperPressure(recentEditions)
  const scored = effectCatalog.map((family) => {
    let score = scoreTerms(corpus, family.terms)
    if (family.effect_family === 'torn-paper' && recentPenalty >= 2) score -= recentPenalty * 2
    return { family, score }
  }).sort((left, right) => right.score - left.score)
  const selected = scored.find((entry) => entry.score > 0)?.family || effectCatalog.find((family) => family.effect_family === 'object-wear')
  const family = selected.effect_family === 'torn-paper' && recentPenalty >= 2
    ? effectCatalog.find((entry) => entry.effect_family === 'pigment-repair')
    : selected

  return {
    effect_family: family.effect_family,
    effect_confidence: scored[0]?.score >= 4 ? 'high' : scored[0]?.score >= 2 ? 'medium' : 'low',
    source_basis: sourceBasisForFamily(researchField, family, corpus),
    surface_language: family.surface_language,
    source_window_mark_types: family.source_window_mark_types,
    avoid_effects: withSharedAvoids(family, recentPenalty),
    recent_effect_penalty: recentPenalty >= 2 ? ['torn-paper'] : [],
    motion_behavior: family.effect_family === 'glass-condensation'
      ? 'slow fog bloom around active marks'
      : 'subtle source-shaped drift around active marks',
    prompt_sentence: family.effect_family === 'torn-paper' && recentPenalty < 2
      ? `${family.prompt_sentence} Use this only because the source field itself asks for paper or poster material.`
      : family.prompt_sentence,
  }
}
