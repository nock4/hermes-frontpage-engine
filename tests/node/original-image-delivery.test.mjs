import { afterEach, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import * as delivery from '../../scripts/lib/original-image-delivery.mjs'
import { inspectedDecision } from '../fixtures/creative-inspection.mjs'
import { assertEditorialBindings } from '../../scripts/lib/source-selection-policy.mjs'

const dirs = []
afterEach(() => dirs.splice(0).forEach(dir => fs.rmSync(dir, { recursive: true, force: true })))
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'original-delivery-')); dirs.push(root)
  const editionId = '2026-10-12-paint-gives-way-to-air-v1'
  const editionDir = path.join(root, 'public/editions', editionId)
  const runDir = path.join(root, 'run')
  fs.mkdirSync(path.join(runDir, 'creative-inspections'), { recursive: true })
  fs.mkdirSync(editionDir, { recursive: true })
  const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64')
  const hash = createHash('sha256').update(bytes).digest('hex')
  const source = { url: 'https://artist.example/work', image_url: 'https://artist.example/original.png' }
  const decision = inspectedDecision(source)
  Object.assign(decision.inspection, { capture_sha256: hash, capture_path: path.join(runDir, 'creative-inspections', `${hash}.png`) })
  fs.writeFileSync(decision.inspection.capture_path, bytes)
  const research = { sources: [source], autoresearch: { source_decisions: [decision] } }
  const bindings = { source_binding_set_id: `bindings-${editionId}`, bindings: [{ source_url: source.url, source_image_url: source.image_url, source_media_url: source.image_url, source_media_type: 'image' }] }
  const write = (name, value) => fs.writeFileSync(path.join(runDir, name), JSON.stringify(value))
  write('edition-package-summary.json', { edition_id: editionId })
  write('source-research.json', research); write('signal-harvest.json', {})
  write('creative-inspections.json', [decision])
  return { root, editionId, editionDir, runDir, bytes, hash, research, bindings, decision, write }
}

it('packages only exact inspected bytes without changing remote identity or source attribution', async () => {
  const f = fixture(); const before = structuredClone(f.bindings)
  const result = await delivery.packageOriginalImages({ ...f, bindingSet: f.bindings, minimum: 1 })
  expect(f.bindings).toEqual(before)
  const b = result.bindings[0]
  expect(b.source_image_url).toBe(before.bindings[0].source_image_url)
  expect(b.source_media_url).toBe(before.bindings[0].source_media_url)
  expect(b.source_image_delivery).toMatchObject({ version: 1, kind: 'attested-full-original', edition_id: f.editionId, source_url: b.source_url, media_url: b.source_image_url, capture_sha256: f.hash })
  expect(fs.readFileSync(path.join(f.root, 'public', b.source_image_delivery.asset_path))).toEqual(f.bytes)
  expect(() => assertEditorialBindings(result.bindings, f.research, null, { minimum: 1, finalMedia: true, editionDir: f.editionDir, editionId: f.editionId })).not.toThrow()
  fs.writeFileSync(path.join(f.root, 'public', b.source_image_delivery.asset_path), 'unrelated crop')
  expect(() => assertEditorialBindings(result.bindings, f.research, null, { minimum: 1, finalMedia: true, editionDir: f.editionDir, editionId: f.editionId })).toThrow(/delivery|integrity/i)
})

it.each(['wrong-edition', 'wrong-owner', 'alias', 'changed-capture', 'unrecorded', 'rejected', 'placeholder', 'symlink', 'oversized'])('rejects %s before materialization', async attack => {
  const f = fixture()
  if (attack === 'wrong-edition') f.write('edition-package-summary.json', { edition_id: 'other' })
  if (attack === 'wrong-owner') f.bindings.bindings[0].source_url = 'https://artist.example/other'
  if (attack === 'alias') f.bindings.bindings[0].source_image_url += '?alias=1'
  if (attack === 'changed-capture') fs.writeFileSync(f.decision.inspection.capture_path, 'crop')
  if (attack === 'unrecorded') f.write('creative-inspections.json', [])
  if (attack === 'rejected') { f.research.autoresearch.source_decisions[0].inspection.status = 'rejected'; f.write('source-research.json', f.research) }
  if (attack === 'placeholder' || attack === 'oversized') {
    const bytes = attack === 'placeholder' ? Buffer.from('<svg>source image unavailable</svg>') : Buffer.alloc(8_000_001)
    const hash = createHash('sha256').update(bytes).digest('hex')
    Object.assign(f.decision.inspection, { capture_sha256: hash, capture_path: path.join(f.runDir, 'creative-inspections', `${hash}.png`) })
    fs.writeFileSync(f.decision.inspection.capture_path, bytes)
    f.write('source-research.json', f.research); f.write('creative-inspections.json', [f.decision])
  }
  if (attack === 'symlink') { const p = f.decision.inspection.capture_path; fs.renameSync(p, `${p}.outside`); fs.symlinkSync(`${p}.outside`, p) }
  await expect(delivery.packageOriginalImages({ ...f, bindingSet: f.bindings, minimum: 1 })).rejects.toThrow()
  expect(fs.existsSync(path.join(f.editionDir, 'assets/source-originals'))).toBe(false)
})

it.each(['../escape.png', '/editions/other/assets/source-originals/x.png', '//evil.example/a.png', '/editions/%2e%2e/a.png', 'data:image/svg+xml,x'])('rejects unsafe packaged path %s', async assetPath => {
  const f = fixture()
  const result = await delivery.packageOriginalImages({ ...f, bindingSet: f.bindings, minimum: 1 })
  result.bindings[0].source_image_delivery.asset_path = assetPath
  expect(() => delivery.assertPackagedOriginalImages(result.bindings, f)).toThrow()
})

it('rejects symlink output directories and refuses delivery without package context', async () => {
  const f = fixture()
  fs.mkdirSync(path.join(f.editionDir, 'assets'))
  fs.symlinkSync(f.runDir, path.join(f.editionDir, 'assets/source-originals'))
  await expect(delivery.packageOriginalImages({ ...f, bindingSet: f.bindings, minimum: 1 })).rejects.toThrow()
})

it('explicit packaging command preserves remote identities and leaves run records untouched', () => {
  const f = fixture()
  // Exercise the real six-source floor, not a CLI minimum override.
  const source = f.research.sources[0], decision = f.decision, binding = f.bindings.bindings[0]
  f.research.sources = Array.from({ length: 6 }, (_, i) => ({ ...source, url: `${source.url}/${i}` }))
  f.research.autoresearch.source_decisions = f.research.sources.map(s => ({ ...decision, url: s.url, inspection: { ...decision.inspection, source_url: s.url } }))
  f.bindings.bindings = f.research.sources.map(s => ({ ...binding, source_url: s.url }))
  f.write('source-research.json', f.research); f.write('creative-inspections.json', f.research.autoresearch.source_decisions)
  const file = path.join(f.editionDir, 'source-bindings.json')
  fs.writeFileSync(file, JSON.stringify(f.bindings))
  fs.writeFileSync(path.join(f.editionDir, 'edition.json'), JSON.stringify({ edition_id: f.editionId }))
  const before = fs.readFileSync(path.join(f.runDir, 'source-research.json'))
  const command = path.resolve('scripts/package-original-images.mjs')
  const result = spawnSync(process.execPath, [command, '--edition', f.editionId, '--run-dir', f.runDir], { cwd: f.root, encoding: 'utf8' })
  expect(result.status, result.stderr).toBe(0)
  const packaged = JSON.parse(fs.readFileSync(file))
  expect(packaged.bindings.every(b => b.source_image_delivery?.capture_sha256 === f.hash)).toBe(true)
  expect(packaged.bindings.map(b => b.source_image_url)).toEqual(f.bindings.bindings.map(b => b.source_image_url))
  expect(fs.readFileSync(path.join(f.runDir, 'source-research.json'))).toEqual(before)
})

it('rejects symlinked run attestations before packaging', async () => {
  const f = fixture()
  const file = path.join(f.runDir, 'source-research.json')
  fs.renameSync(file, `${file}.outside`); fs.symlinkSync(`${file}.outside`, file)
  await expect(delivery.packageOriginalImages({ ...f, bindingSet: f.bindings, minimum: 1 })).rejects.toThrow(/symlink/)
})

it('rechecks packaged bytes on every validation rather than caching a digest', async () => {
  const f = fixture()
  const result = await delivery.packageOriginalImages({ ...f, bindingSet: f.bindings, minimum: 1 })
  delivery.assertPackagedOriginalImages(result.bindings, f)
  const file = path.join(f.root, 'public', result.bindings[0].source_image_delivery.asset_path)
  const changed = Buffer.from(f.bytes); changed[changed.length - 1] ^= 1
  fs.writeFileSync(file, changed)
  expect(() => delivery.assertPackagedOriginalImages(result.bindings, f)).toThrow(/integrity/)
})
