import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'

import { assertOriginalImageContract, originalImageMime, ORIGINAL_IMAGE_MAX_BYTES } from '../../src/lib/originalImageContract.mjs'

function noLinks(base, target) {
  const relative = path.relative(base, target)
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Original image delivery: path escape')
  for (const part of ['', ...relative.split(path.sep)]) {
    base = path.join(base, part)
    if (fs.existsSync(base) && fs.lstatSync(base).isSymbolicLink()) throw new Error('Original image delivery: symlink')
  }
}
function boundedBytes(file) {
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW)
  try {
    const stat = fs.fstatSync(fd)
    if (!stat.isFile() || stat.size <= 0 || stat.size > ORIGINAL_IMAGE_MAX_BYTES) throw new Error('Original image delivery: invalid byte size')
    const bytes = Buffer.alloc(stat.size)
    let offset = 0
    while (offset < bytes.length) {
      const read = fs.readSync(fd, bytes, offset, bytes.length - offset, offset)
      if (!read) throw new Error('Original image delivery: truncated capture')
      offset += read
    }
    if (fs.fstatSync(fd).size !== stat.size) throw new Error('Original image delivery: changed capture')
    return bytes
  } finally { fs.closeSync(fd) }
}
const digest = bytes => createHash('sha256').update(bytes).digest('hex')

// Safe for archive validation without access to the private run. Publication
// additionally joins this record to the original research proof in finalMedia.
export function assertPackagedOriginalImages(bindings, { editionDir, editionId } = {}) {
  for (const binding of bindings) {
    if (binding.source_image_delivery === undefined) continue
    const d = assertOriginalImageContract(binding, editionId)
    if (!editionDir || path.basename(editionDir) !== editionId) throw new Error('Original image delivery: missing edition context')
    const file = path.join(editionDir, 'assets/source-originals', path.basename(d.asset_path))
    noLinks(path.resolve(editionDir, '../..'), file)
    const bytes = boundedBytes(file)
    if (bytes.length !== d.byte_length || digest(bytes) !== d.capture_sha256 || originalImageMime(bytes) !== d.mime_type) {
      throw new Error('Original image delivery: packaged integrity mismatch')
    }
  }
}

// Explicit same-candidate packaging only. No fetch, image editing, eligibility
// stamps, inferred aliases or modifications to the private inspection records.
// A relocated complete run is supported by resolving its content-addressed
// capture basename inside that run, never by reading the stale absolute path.
export async function packageOriginalImages({ root, editionId, runDir, bindingSet, minimum = 6 }) {
  // Keep the synchronous publication validator independent of editorial policy.
  const { assertEditorialBindings, hasCreativeArtifactEvidence } = await import('./source-selection-policy.mjs')
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(editionId || '')) throw new Error('Original image delivery: invalid edition')
  const read = name => {
    const file = path.resolve(runDir, name)
    noLinks(path.resolve(runDir), file)
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  }
  const summary = read('edition-package-summary.json')
  if (summary.edition_id !== editionId || bindingSet.source_binding_set_id !== `bindings-${editionId}`) throw new Error('Original image delivery: same-run edition mismatch')
  if (!Array.isArray(bindingSet.bindings) || bindingSet.bindings.length > 10) throw new Error('Original image delivery: binding limit')
  const research = read('source-research.json'), harvest = read('signal-harvest.json'), inspections = read('creative-inspections.json')
  assertEditorialBindings(bindingSet.bindings, research, harvest, { minimum })
  const editionDir = path.resolve(root, 'public/editions', editionId)
  noLinks(path.resolve(root), editionDir)
  const pending = []
  const bindings = bindingSet.bindings.map(binding => {
    const media = binding.source_image_url || (binding.source_media_type === 'image' ? binding.source_media_url : undefined)
    const candidates = (research.autoresearch?.source_decisions || []).filter(decision =>
      decision.url === binding.source_url && decision.inspection?.source_url === binding.source_url
      && hasCreativeArtifactEvidence({ url: binding.source_url, image_url: media }, { source_decisions: [decision] }, harvest)
      && (!binding.source_media_url || binding.source_media_url === (['video', 'audio'].includes(binding.source_media_type)
        ? decision.inspection.representative_media_url : decision.inspection.media_url)))
    if (candidates.length !== 1) throw new Error('Original image delivery: exact owner/media proof missing or ambiguous')
    const proof = candidates[0].inspection
    if (!inspections.some(row => row.url === binding.source_url && isDeepStrictEqual(row.inspection, proof))) throw new Error('Original image delivery: unrecorded inspection')
    const name = path.basename(proof.capture_path)
    if (path.basename(path.dirname(proof.capture_path)) !== 'creative-inspections'
      || !new RegExp(`^${proof.capture_sha256}\\.(png|jpeg|gif|webp)$`).test(name)) throw new Error('Original image delivery: invalid capture path')
    const capture = path.resolve(runDir, 'creative-inspections', name)
    noLinks(path.resolve(runDir), capture)
    const bytes = boundedBytes(capture)
    if (digest(bytes) !== proof.capture_sha256) throw new Error('Original image delivery: capture integrity mismatch')
    const mime = originalImageMime(bytes)
    if (name !== `${proof.capture_sha256}.${mime.split('/')[1]}`) throw new Error('Original image delivery: capture MIME mismatch')
    const record = { version: 1, kind: 'attested-full-original', edition_id: editionId, source_url: binding.source_url,
      media_url: media, capture_sha256: proof.capture_sha256, mime_type: mime, byte_length: bytes.length,
      asset_path: `/editions/${editionId}/assets/source-originals/${name}` }
    const result = { ...binding, source_image_delivery: record }
    assertOriginalImageContract(result, editionId)
    const file = path.join(editionDir, 'assets/source-originals', name)
    noLinks(editionDir, file)
    if (fs.existsSync(file) && !boundedBytes(file).equals(bytes)) throw new Error('Original image delivery: existing asset differs')
    pending.push({ file, bytes })
    return result
  })
  // All captures and destinations must pass before any materialization.
  for (const { file, bytes } of pending) {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    noLinks(editionDir, file)
    if (!fs.existsSync(file)) fs.writeFileSync(file, bytes, { flag: 'wx' })
  }
  assertPackagedOriginalImages(bindings, { editionDir, editionId })
  return { ...bindingSet, bindings }
}
