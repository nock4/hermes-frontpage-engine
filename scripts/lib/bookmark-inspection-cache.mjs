import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'

const digest = value => createHash('sha256').update(value).digest('hex')
function valid(value) {
  return ['verified', 'ambiguous', 'rejected'].includes(value?.status)
    && ['high', 'medium', 'low'].includes(value.confidence)
    && ['artwork', 'game', 'animation', 'music', 'performance', 'film', 'photography', 'textile', 'product', 'unknown'].includes(value.artifact_kind)
    && typeof value.observation === 'string' && value.observation.trim().length > 0
}

// Called only AFTER a fresh vetted network fetch and capture. A URL hit alone
// never proves unchanged pixels. Bump policy version when inspector rules change.
export async function cachedArtifactObservation({ cacheDir, bytes, sourceUrl, imageUrl, mediaUrl = null, context, model, transportConfigPath, mime, resolvedMediaUrl }, inspect) {
  if (!Buffer.isBuffer(bytes) || !bytes.length) throw new Error('Actual-media bytes required')
  let transportConfig = null
  if (transportConfigPath) {
    try { transportConfig = digest(await fs.readFile(transportConfigPath)) }
    catch { cacheDir = null } // Unknown transport configuration cannot reuse proof.
  }
  const key = digest(JSON.stringify({ policy: 'creative-artifact-vision-v1-bookmark-1', sourceUrl, imageUrl, mediaUrl, context, model, transportConfig, mime, resolvedMediaUrl, transport: [process.env.HERMES_BIN, process.env.HERMES_HOME, process.env.HERMES_MODEL, process.env.HERMES_PROVIDER], sha256: digest(bytes) }))
  const file = cacheDir && path.join(cacheDir, 'inspections', `${key}.json`)
  if (file) {
    try {
      const saved = JSON.parse(await fs.readFile(file, 'utf8'))
      if (saved.key === key && valid(saved.observation) && Date.now() - saved.created_at < 30 * 86400000) return { ...saved.observation, cache_hit: true }
    } catch (e) { if (e.code !== 'ENOENT' && !(e instanceof SyntaxError)) throw e }
  }
  const raw = await inspect()
  if (!valid(raw)) throw new Error('Invalid actual-media observation')
  const observation = Object.fromEntries(['status', 'confidence', 'artifact_kind', 'observation'].map(k => [k, raw[k]]))
  if (file) {
    await fs.mkdir(path.dirname(file), { recursive: true })
    const temp = `${file}.${process.pid}.tmp`
    await fs.writeFile(temp, JSON.stringify({ key, created_at: Date.now(), observation }))
    await fs.rename(temp, file)
  }
  return { ...observation, cache_hit: false }
}
