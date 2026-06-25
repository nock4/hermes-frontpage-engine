import crypto from 'node:crypto'

const postureCatalog = [
  {
    plate_posture: 'source-led balanced',
    weight: 34,
    density_target: 'balanced',
    abstraction_target: 'medium',
    minimality_target: 'low',
    literalness_limit: 'representational allowed when source evidence supports it',
    anchor_strategy_bias: 'mix hero-scale source-bearing forms with smaller seams, marks, and apertures',
    negative_space_bias: 'balanced open space and clustered source activity',
    formal_risk: 'let one source become a large spatial event, not only a surface detail',
  },
  {
    plate_posture: 'minimal field',
    weight: 16,
    density_target: 'airy',
    abstraction_target: 'medium-high',
    minimality_target: 'high',
    literalness_limit: 'no literal prop inventory; only sparse source-bearing marks and material interruptions',
    anchor_strategy_bias: 'one or two quiet hero-scale source marks plus smaller apertures, hairline seams, edge notches, glints, pinholes, and legible source marks',
    negative_space_bias: 'large uninterrupted fields with source marks placed on edges, cuts, and small surface repairs',
    formal_risk: 'protect one severe empty field or one lone oversized interruption',
  },
  {
    plate_posture: 'abstract system',
    weight: 16,
    density_target: 'balanced',
    abstraction_target: 'high',
    minimality_target: 'medium',
    literalness_limit: 'no literal scene; translate sources into marks, fields, stripes, nodes, folds, and discontinuities',
    anchor_strategy_bias: 'distinct abstract marks with clear hit surfaces: stripes, apertures, nodes, tile breaks, scrapes, and folded edges',
    negative_space_bias: 'negative space should separate anchor marks so the interface remains readable',
    formal_risk: 'make the system visibly non-decorative: a rupture, orbit, cutaway, impossible scale shift, or rule-break in the field',
  },
  {
    plate_posture: 'material macro',
    weight: 12,
    density_target: 'balanced',
    abstraction_target: 'medium',
    minimality_target: 'medium',
    literalness_limit: 'avoid room-scale prop inventories; use close material surfaces instead',
    anchor_strategy_bias: 'source anchors appear as cuts, labels, embedded media grains, glossy defects, texture seams, and object-edge apertures',
    negative_space_bias: 'one or two large surfaces can carry most of the plate',
    formal_risk: 'avoid polite flat scans; use extreme scale, collision, occlusion, or flash if material macro repeats recently',
  },
  {
    plate_posture: 'diagrammatic section',
    weight: 10,
    density_target: 'balanced',
    abstraction_target: 'medium',
    minimality_target: 'medium',
    literalness_limit: 'diagram logic without readable text, UI labels, or literal data dashboard cards',
    anchor_strategy_bias: 'source anchors sit on section cuts, blocks, conduits, strata, notches, and visible edge surfaces',
    negative_space_bias: 'clear bands and sections with enough room for hover/tap targets',
    formal_risk: 'turn one source into a spatial cutaway, exploded section, tunnel, vessel, or public-scale diagram object',
  },
  {
    plate_posture: 'poster wall',
    weight: 8,
    density_target: 'dense',
    abstraction_target: 'medium',
    minimality_target: 'low',
    literalness_limit: 'no web-card collage; use torn print layers, cropped surfaces, and source-media residue',
    anchor_strategy_bias: 'anchors are torn corners, pasted fragments, image edges, scratches, stains, and overlapped poster seams',
    negative_space_bias: 'density may rise, but leave several readable windows of calm around anchors',
    formal_risk: 'allow loud image fragments, scale jumps, torn silhouettes, and uneven poster depth rather than a tidy card wall',
  },
  {
    plate_posture: 'wildcard rupture',
    weight: 4,
    density_target: 'source-dependent',
    abstraction_target: 'high',
    minimality_target: 'source-dependent',
    literalness_limit: 'make one surprising formal move; avoid the default coherent room/world if sources allow it',
    anchor_strategy_bias: 'one giant surface or rupture carries multiple source marks; the rest are edge marks or quiet apertures',
    negative_space_bias: 'let the gamble be visibly different from recent editions while preserving real source anchors',
    formal_risk: 'one mandatory gamble: impossible scale, single giant object, split horizon, flood, procession, void, x-ray cutaway, or violent crop',
  },
]

const supportedPostures = postureCatalog.map((entry) => entry.plate_posture)
const supportedDensities = ['airy', 'balanced', 'dense', 'source-dependent']
const supportedAbstractions = ['low', 'medium', 'medium-high', 'high', 'source-dependent']
const supportedMinimality = ['low', 'medium', 'high', 'source-dependent']

function hashUnit(seed) {
  const digest = crypto.createHash('sha1').update(seed).digest()
  return digest.readUInt32BE(0) / 0xffffffff
}

function tokenizeRecent(recentEditions = []) {
  return recentEditions.map((edition) => `${edition.title || ''} ${edition.scene_family || ''} ${edition.slug || ''} ${edition.visual_summary || ''}`).join(' ').toLowerCase()
}

function recentPosturePressure(recentText, posture) {
  const tests = {
    'minimal field': /(minimal|negative space|sparse|quiet|threshold|corridor|pinlight|ambient|fog|empty)/g,
    'abstract system': /(abstract|system|field|particle|stripe|node|signal|grid|diagram)/g,
    'material macro': /(macro|material|surface|texture|slab|fabric|glass|paper|vellum|metal|grain)/g,
    'diagrammatic section': /(section|diagram|architectural|strata|plan|blueprint|conduit|cutaway|block)/g,
    'poster wall': /(poster|wall|print|torn|collage|archive|scrap|paste|layer)/g,
    'source-led balanced': /(balanced|world|scene|civic|room|stage|field)/g,
    'wildcard rupture': /(rupture|wildcard|strange|giant|monochrome|single object)/g,
  }
  const matches = recentText.match(tests[posture] || new RegExp(`\\b${posture.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}\\b`, 'g')) || []
  return matches.length
}


function recentFlatSurfacePressure(recentText) {
  const flatSurfaceMatches = recentText.match(/(macro|material|surface|texture|slab|paper|cardboard|sleeve|scan|scanned|overhead|shallow|side-lit|grain|seam|aperture|glint|notch|pinlight|quiet)/g) || []
  return flatSurfaceMatches.length
}

function chooseWeighted(entries, seed) {
  const total = entries.reduce((sum, entry) => sum + Math.max(0, entry.effectiveWeight), 0)
  if (total <= 0) return entries[0]
  let pick = hashUnit(seed) * total
  for (const entry of entries) {
    pick -= Math.max(0, entry.effectiveWeight)
    if (pick <= 0) return entry
  }
  return entries.at(-1)
}

function normalizeOverride(value, supported, label) {
  if (value == null || value === '') return null
  const normalized = String(value).trim().toLowerCase().replace(/[_-]+/g, ' ')
  if (!supported.includes(normalized)) {
    throw new Error(`Expected ${label} to be one of ${supported.join(', ')}. Received: ${value}`)
  }
  return normalized
}

export function supportedPlatePostures() {
  return [...supportedPostures]
}

export function selectPlatePosture({
  date,
  runId,
  recentEditions = [],
  options = {},
  sampleMode = false,
  inspirationOverride = null,
} = {}) {
  const recentText = tokenizeRecent(recentEditions)
  const flatSurfacePressure = sampleMode ? 0 : recentFlatSurfacePressure(recentText)
  const forcedPosture = normalizeOverride(options.platePosture, supportedPostures, '--plate-posture')
  const forcedDensity = normalizeOverride(options.densityTarget, supportedDensities, '--density-target')
  const forcedAbstraction = normalizeOverride(options.abstractionTarget, supportedAbstractions, '--abstraction-target')
  const forcedMinimality = normalizeOverride(options.minimalityTarget, supportedMinimality, '--minimality-target')

  const overrideText = `${inspirationOverride?.title || ''} ${inspirationOverride?.note || ''} ${(inspirationOverride?.bias || []).join(' ')}`.toLowerCase()
  const textualBias = {
    minimal: /(minimal|sparse|negative space|empty|quiet|pinlight)/.test(overrideText),
    abstract: /(abstract|nonliteral|field|system|marks|stripes|nodes)/.test(overrideText),
    dense: /(dense|maximal|collage|poster|wall|cluster)/.test(overrideText),
  }

  const candidates = postureCatalog.map((entry) => {
    const recentPressure = sampleMode ? 0 : recentPosturePressure(recentText, entry.plate_posture)
    let effectiveWeight = entry.weight / (1 + recentPressure * 0.85)
    if (flatSurfacePressure >= 10 && ['material macro', 'minimal field', 'source-led balanced'].includes(entry.plate_posture)) effectiveWeight *= 0.45
    if (flatSurfacePressure >= 10 && ['wildcard rupture', 'diagrammatic section', 'poster wall'].includes(entry.plate_posture)) effectiveWeight *= 2.1
    if (textualBias.minimal && entry.plate_posture === 'minimal field') effectiveWeight *= 3
    if (textualBias.abstract && entry.plate_posture === 'abstract system') effectiveWeight *= 3
    if (textualBias.dense && entry.plate_posture === 'poster wall') effectiveWeight *= 2.5
    return { ...entry, recent_pressure: recentPressure, effectiveWeight: Number(effectiveWeight.toFixed(3)) }
  })

  const selected = forcedPosture
    ? candidates.find((entry) => entry.plate_posture === forcedPosture)
    : chooseWeighted(candidates, `${date || ''}:${runId || ''}:${recentText}:${overrideText}`)

  const posture = {
    ...selected,
    density_target: forcedDensity || selected.density_target,
    abstraction_target: forcedAbstraction || selected.abstraction_target,
    minimality_target: forcedMinimality || selected.minimality_target,
    manual_override: Boolean(forcedPosture || forcedDensity || forcedAbstraction || forcedMinimality),
    selection_seed: `${date || ''}:${runId || ''}`,
    recent_flat_surface_pressure: flatSurfacePressure,
    look_avoidance_directive: flatSurfacePressure >= 10
      ? 'Recent editions overused flat material scans, sleeve/cardboard surfaces, shallow macro, quiet apertures, seams, glints, and notches. Break that grammar unless the source field absolutely requires it: use depth, scale violence, spatial event, weather, procession, cutaway, object collision, horizon, or loud source-media fragments while keeping real source anchors.'
      : 'No strong repeated flat-surface penalty detected.',
    reason: forcedPosture
      ? `Manual plate posture override: ${forcedPosture}`
      : sampleMode
        ? 'Sample mode uses deterministic posture selection without recent-edition pressure.'
        : 'Weighted selection with recent-edition and flat-surface pressure; overused postures and camera/material grammars are downweighted while minimal/abstract/dense override language can upweight matching modes.',
    candidate_weights: candidates.map(({ plate_posture, weight, recent_pressure, effectiveWeight }) => ({
      plate_posture,
      base_weight: weight,
      recent_pressure,
      effective_weight: effectiveWeight,
    })),
  }

  delete posture.weight
  delete posture.effectiveWeight
  delete posture.recent_pressure
  return posture
}
