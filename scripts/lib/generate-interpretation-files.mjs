import fs from 'node:fs/promises'
import path from 'node:path'

import { generateInterpretation } from '../../src/lib/generateInterpretation.ts'

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'))
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

async function writeJson(filePath, value) {
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

async function readOptionalJson(filePath) {
  return (await pathExists(filePath)) ? readJson(filePath) : null
}

async function findLatestTmpArtifact(repoRoot, editionSlug, filename) {
  const generationsRoot = path.join(repoRoot, 'tmp', 'automated-mask-generations')
  if (!(await pathExists(generationsRoot))) return null

  const batches = await fs.readdir(generationsRoot)
  const sorted = batches.sort().reverse()
  for (const batch of sorted) {
    const candidatePath = path.join(generationsRoot, batch, editionSlug, filename)
    if (await pathExists(candidatePath)) return readJson(candidatePath)
  }
  return null
}

export async function generateInterpretationFiles({ repoRoot = process.cwd() } = {}) {
  const editionsRoot = path.join(repoRoot, 'public', 'editions')
  const manifest = await readJson(path.join(editionsRoot, 'index.json'))

  let generated = 0
  let skipped = 0

  for (const item of manifest.editions) {
    const editionBase = path.join(repoRoot, 'public', item.path.replace(/^\//, ''))

    try {
      const [edition, brief, artifactMap, sourceBindings, analysis, geometryKit, candidatePack, existingInterpretation] = await Promise.all([
        readJson(path.join(editionBase, 'edition.json')),
        readJson(path.join(editionBase, 'brief.json')),
        readJson(path.join(editionBase, 'artifact-map.json')),
        readJson(path.join(editionBase, 'source-bindings.json')),
        readOptionalJson(path.join(editionBase, 'analysis.json')),
        readOptionalJson(path.join(editionBase, 'geometry-kit.json')),
        findLatestTmpArtifact(repoRoot, item.edition_id, 'candidate-pack.json'),
        readOptionalJson(path.join(editionBase, 'interpretation.json')),
      ])

      const interpretation = generateInterpretation({
        edition,
        brief,
        artifactMap,
        sourceBindings,
        motifTags: item.motif_tags,
        analysis,
        geometryKit,
        candidatePack,
        plateReadTimestamp: existingInterpretation?.plate_read_timestamp,
      })

      await writeJson(path.join(editionBase, 'interpretation.json'), interpretation)
      generated += 1
    } catch {
      skipped += 1
    }
  }

  return { generated, skipped, total: manifest.editions.length }
}
