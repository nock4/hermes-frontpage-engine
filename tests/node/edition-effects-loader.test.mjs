import { it, expect, vi, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import { loadEditionPackage } from '../../src/lib/editionLoader'
afterEach(() => vi.unstubAllGlobals())
it('loads optional experiences through the actual edition loader without changing archive bytes', async () => {
  const manifest = JSON.parse(await fs.readFile('public/editions/index.json', 'utf8'))
  const base = manifest.editions.find((e) => e.edition_id === manifest.current_edition_id).path
  const edition = JSON.parse(await fs.readFile(`public${base}/edition.json`, 'utf8'))
  const map = JSON.parse(await fs.readFile(`public${base}/artifact-map.json`, 'utf8'))
  const bindings = JSON.parse(await fs.readFile(`public${base}/source-bindings.json`, 'utf8'))
  const a = map.artifacts[0],
    b = bindings.bindings.find((b) => b.artifact_id === a.id)
  const effect = {
    kind: 'resonance',
    artifact_id: a.id,
    binding_id: b.id,
    evidence: {
      artifact_id: a.id,
      binding_id: b.id,
      material: 'metal',
      observation: 'SYNTHETIC QA admission',
      modalities: ['resonant'],
    },
  }
  vi.stubGlobal('location', {
    origin: 'https://frontpage.example',
    search: '?qaEffects=1&effectReview=resonance',
  })
  const requests = []
  vi.stubGlobal('fetch', async (url, options) => {
    requests.push([url, options])
    if (url === `${base}/effects.json`)
      return new Response(
        JSON.stringify({ schema_version: 1, edition_id: edition.edition_id, effects: [effect] }),
        { headers: { 'Content-Type': 'application/json' } },
      )
    try {
      return new Response(await fs.readFile(`public${url}`), {
        headers: { 'Content-Type': url.endsWith('.json') ? 'application/json' : 'image/png' },
      })
    } catch {
      return new Response('', { status: 404 })
    }
  })
  expect((await loadEditionPackage(base)).effects?.effects[0]).toEqual(effect)
  expect(requests.find(([url]) => url === `${base}/effects.json`)[1]?.headers?.['X-DFE-Effects-Review']).toBe(
    'qaEffects=1&effectReview=resonance',
  )
})
