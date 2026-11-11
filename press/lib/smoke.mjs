// Smoke: prove the page would load. Runs the viewer's own loader and parsers
// against the stored files, so any package the browser would reject fails here.
// This is the only check that blocks an edition.

import sharp from 'sharp'

import { loadEditionPackage, loadManifest } from '../../src/lib/editionLoader.ts'
import { INDEX_KEY } from '../../shared/edition-index.js'

function storeFetch(store, overrides) {
  return async (input) => {
    const pathname = new URL(String(input), 'https://press.local').pathname
    const key = pathname.replace(/^\/+/, '')
    const body = overrides.has(key) ? overrides.get(key) : await store.get(key)
    if (!body) return new Response('not found', { status: 404, headers: { 'content-type': 'text/plain' } })
    return new Response(body, { status: 200, headers: { 'content-type': key.endsWith('.json') ? 'application/json' : 'application/octet-stream' } })
  }
}

// `index` is the manifest as readers will see it once the edition is live.
export async function smokeEdition({ store, editionId, index }) {
  const overrides = new Map([[INDEX_KEY, Buffer.from(JSON.stringify(index))]])
  const realFetch = globalThis.fetch
  globalThis.fetch = storeFetch(store, overrides)
  let loaded
  try {
    const manifest = await loadManifest()
    const item = manifest.editions.find((entry) => entry.edition_id === editionId)
    if (!item) throw new Error(`Manifest does not list ${editionId}`)
    if (manifest.current_edition_id !== editionId) throw new Error(`Manifest current edition is ${manifest.current_edition_id}, expected ${editionId}`)
    loaded = await loadEditionPackage(item.path)
  } finally {
    globalThis.fetch = realFetch
  }

  const assetKeys = [
    loaded.edition.plate_asset_path,
    ...loaded.artifactMap.artifacts.map((artifact) => artifact.mask_path),
    ...loaded.sourceBindings.bindings.map((binding) => binding.source_visual?.poster_asset_path),
    index.editions.find((entry) => entry.edition_id === editionId).preview_asset_path,
  ].filter(Boolean).map((assetPath) => assetPath.replace(/^\/+/, ''))
  for (const key of assetKeys) {
    const body = await store.get(key)
    if (!body) throw new Error(`Missing asset ${key}`)
    if (/\.(png|jpe?g|webp)$/i.test(key)) {
      const { width, height } = await sharp(body).metadata()
      if (!(width > 0 && height > 0)) throw new Error(`Asset ${key} is not a readable image`)
    }
  }
  return { artifacts: loaded.artifactMap.artifacts.length, bindings: loaded.sourceBindings.bindings.length, assets: assetKeys.length }
}

// After go-live: ask the public site what it is serving.
export async function smokeSite({ siteUrl, editionId, fetchImpl = fetch }) {
  const origin = siteUrl.replace(/\/+$/, '')
  const indexResponse = await fetchImpl(`${origin}/editions/index.json`, { signal: AbortSignal.timeout(20_000), headers: { 'cache-control': 'no-cache' } })
  if (!indexResponse.ok) throw new Error(`Site manifest HTTP ${indexResponse.status}`)
  const index = await indexResponse.json()
  if (index.current_edition_id !== editionId) throw new Error(`Site is serving ${index.current_edition_id}, expected ${editionId}`)
  for (const file of ['edition.json', 'assets/plate.png']) {
    const response = await fetchImpl(`${origin}/editions/${editionId}/${file}`, { signal: AbortSignal.timeout(30_000) })
    const type = response.headers.get('content-type') || ''
    if (!response.ok || type.includes('text/html')) throw new Error(`Site ${file} for ${editionId} returned ${response.status} ${type}`)
    await response.arrayBuffer()
  }
  const page = await fetchImpl(`${origin}/`, { signal: AbortSignal.timeout(20_000) })
  if (!page.ok) throw new Error(`Site home page HTTP ${page.status}`)
}
