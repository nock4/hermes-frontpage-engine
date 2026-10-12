import fs from 'node:fs'
import path from 'node:path'
import { assertPackagedOriginalImages } from './lib/original-image-delivery.mjs'

const root = process.cwd()
const editionsRoot = path.join(root, 'public', 'editions')
const manifest = JSON.parse(fs.readFileSync(path.join(editionsRoot, 'index.json'), 'utf8'))
const errors = []
const warnings = []

const MIN_UNIQUE_BOUND_URLS = 4
const MAX_REPEAT_PER_BOUND_URL = 2

function duplicates(values) {
  const counts = new Map()
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1)
  }
  return [...counts.entries()].filter(([, count]) => count > 1).map(([value]) => value)
}

for (const item of manifest.editions) {
  const base = path.join(root, 'public', item.path.replace(/^\//, ''))
  for (const file of ['edition.json', 'brief.json', 'artifact-map.json', 'source-bindings.json', 'ambiance.json', 'review.json']) {
    const full = path.join(base, file)
    if (!fs.existsSync(full)) errors.push(`Missing ${file} for ${item.edition_id}`)
  }

  const edition = JSON.parse(fs.readFileSync(path.join(base, 'edition.json'), 'utf8'))
  const artifactMap = JSON.parse(fs.readFileSync(path.join(base, 'artifact-map.json'), 'utf8'))
  const bindings = JSON.parse(fs.readFileSync(path.join(base, 'source-bindings.json'), 'utf8'))
  try { assertPackagedOriginalImages(bindings.bindings, { editionDir: base, editionId: item.edition_id }) }
  catch (error) { errors.push(`${item.edition_id}: ${error.message}`) }
  const enforceVariety = edition.date >= '2026-04-18'

  if (!fs.existsSync(path.join(root, 'public', edition.plate_asset_path.replace(/^\//, '')))) {
    errors.push(`Missing plate asset for ${item.edition_id}: ${edition.plate_asset_path}`)
  }

  const artifactIdList = artifactMap.artifacts.map((artifact) => artifact.id)
  const artifactIds = new Set(artifactIdList)
  for (const artifactId of duplicates(artifactIdList)) {
    errors.push(`Edition ${item.edition_id} has duplicate artifact id ${artifactId}`)
  }

  const bindingIdList = bindings.bindings.map((binding) => binding.id)
  const bindingIds = new Set(bindingIdList)
  for (const bindingId of duplicates(bindingIdList)) {
    errors.push(`Edition ${item.edition_id} has duplicate source binding id ${bindingId}`)
  }

  for (const binding of bindings.bindings) {
    if (!artifactIds.has(binding.artifact_id)) {
      errors.push(`Binding ${binding.id} references missing artifact ${binding.artifact_id}`)
    }
  }

  for (const artifact of artifactMap.artifacts) {
    for (const bindingId of artifact.source_binding_ids ?? []) {
      if (!bindingIds.has(bindingId)) {
        errors.push(`Artifact ${artifact.id} references missing source binding ${bindingId}`)
      }
    }
  }

  const boundUrls = bindings.bindings
    .map((binding) => binding.source_url)
    .filter((sourceUrl) => typeof sourceUrl === 'string' && sourceUrl.length > 0)

  const uniqueBoundUrls = new Set(boundUrls)
  if (boundUrls.length >= 6 && uniqueBoundUrls.size < MIN_UNIQUE_BOUND_URLS) {
    const issue = `Edition ${item.edition_id} has low source variety: ${uniqueBoundUrls.size} unique bound URLs across ${boundUrls.length} bindings`
    ;(enforceVariety ? errors : warnings).push(issue)
  }

  const boundUrlCounts = new Map()
  for (const sourceUrl of boundUrls) {
    boundUrlCounts.set(sourceUrl, (boundUrlCounts.get(sourceUrl) ?? 0) + 1)
  }

  for (const [sourceUrl, count] of boundUrlCounts.entries()) {
    if (count > MAX_REPEAT_PER_BOUND_URL) {
      const issue = `Edition ${item.edition_id} repeats ${sourceUrl} ${count} times (max ${MAX_REPEAT_PER_BOUND_URL})`
      ;(enforceVariety ? errors : warnings).push(issue)
    }
  }
}

if (warnings.length) {
  console.warn(warnings.join('\n'))
}

if (errors.length) {
  console.error(errors.join('\n'))
  process.exit(1)
}

console.log(JSON.stringify({ editions: manifest.editions.length, status: 'ok' }, null, 2))
