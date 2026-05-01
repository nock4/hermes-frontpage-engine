import crypto from 'node:crypto'
import path from 'node:path'

export function loadManifest({ root, fsSync }) {
  const manifestPath = path.join(root, 'public', 'editions', 'index.json')
  return JSON.parse(fsSync.readFileSync(manifestPath, 'utf8'))
}

function readJsonSyncIfExists(filePath, { fsSync }) {
  try {
    return JSON.parse(fsSync.readFileSync(filePath, 'utf8'))
  } catch {
    return null
  }
}

export function getRecentEditionSummaries({ root, fsSync, sourceContentKey, limit = 6 }) {
  const manifest = loadManifest({ root, fsSync })
  return manifest.editions.slice(0, limit).map((item) => {
    const editionDir = path.join(root, 'public', item.path.replace(/^\//, ''))
    const edition = readJsonSyncIfExists(path.join(editionDir, 'edition.json'), { fsSync })
    const brief = readJsonSyncIfExists(path.join(editionDir, 'brief.json'), { fsSync })
    const sourceBindings = readJsonSyncIfExists(path.join(editionDir, 'source-bindings.json'), { fsSync })
    const sourceKeys = (sourceBindings?.bindings || [])
      .map((binding) => sourceContentKey({
        url: binding.source_url,
        source_url: binding.source_url,
        final_url: binding.resolved_url,
      }))
      .filter(Boolean)

    return {
      edition_id: item.edition_id,
      title: edition?.title || item.title,
      scene_family: edition?.scene_family || brief?.scene_family || '',
      slug: item.slug,
      source_keys: [...new Set(sourceKeys)],
      visual_summary: brief?.scene_prompt || brief?.summary || '',
    }
  })
}

export function getRecentSourceKeys(recentEditions) {
  return new Set(recentEditions.flatMap((edition) => edition.source_keys || []))
}

export function getRecentDiversityAvoidTerms(recentEditions, limit = 16) {
  const stop = new Set([
    'daily', 'edition', 'frontpage', 'source', 'window', 'generated', 'scene', 'world',
    'image', 'quiet', 'ambient', 'soft', 'hidden', 'signal',
  ])
  const counts = new Map()
  const text = recentEditions
    .map((edition) => `${edition.title} ${edition.scene_family} ${edition.slug} ${edition.visual_summary}`)
    .join(' ')
    .toLowerCase()

  for (const token of text.match(/[a-z][a-z0-9-]{3,}/g) || []) {
    const normalized = token.replace(/-v\d+$/i, '')
    if (stop.has(normalized)) continue
    counts.set(normalized, (counts.get(normalized) || 0) + 1)
  }

  return [...counts.entries()]
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([term]) => term)
}

export function chooseDiversityDirective(recentEditions, runId) {
  const recentText = recentEditions.map((edition) => `${edition.title} ${edition.scene_family} ${edition.visual_summary}`).join(' ').toLowerCase()
  const directives = [
    'Favor an outdoor, civic, weather-shaped, or landscape-scale world if the sources allow it.',
    'Favor a theatrical, procession-like, or room-as-stage composition if the sources allow it.',
    'Favor a workshop, tool, craft, or material-transformation world if it is not already dominant in recent editions.',
    'Favor an astronomical, nocturnal, optical, or observatory-like world if the sources allow it.',
    'Favor a living field, garden, habitat, or botanical study world if the sources allow it.',
    'Favor an architectural threshold, corridor, facade, or public interior rather than a cabinet of objects.',
  ]
  const hash = crypto.createHash('sha1').update(`${runId}:${recentText}`).digest()
  let directive = directives[hash[0] % directives.length]

  if (/(roller|print|chapel|cipher|hidden marks|splatter canvas)/.test(recentText)) {
    directive += ' Recent editions already used roller/print/chapel imagery; do not make another printmaking chapel, roller room, cipher chapel, or splatter-canvas archive.'
  }
  if (/(conservatory|greenhouse|garden|field shrine)/.test(recentText)) {
    directive += ' Recent editions already used conservatory/greenhouse/garden imagery; avoid another glasshouse unless the source field demands it.'
  }
  if (/(threshold|corridor|passage|gate|public interior|negative space|pinlight|fog|ambient)/.test(recentText)) {
    directive += ' Recent editions have leaned heavily on minimal thresholds, corridors, gates, pinlights, fog, and ambient negative-space interiors; deliberately seek a different spatial premise, object language, palette, and source mix.'
  }
  return directive
}
