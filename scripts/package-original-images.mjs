import fs from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { packageOriginalImages } from './lib/original-image-delivery.mjs'

// Deliberately opt-in; never refreshes a worktree, generates, fetches or publishes.
const { values } = parseArgs({ options: { edition: { type: 'string' }, 'run-dir': { type: 'string' } }, allowPositionals: false })
const editionId = values.edition
if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(editionId || '') || !values['run-dir']) {
  throw new Error('Usage: node scripts/package-original-images.mjs --edition <exact-id> --run-dir <original-complete-run>')
}
const root = process.cwd()
const editionDir = path.join(root, 'public/editions', editionId)
const bindingPath = path.join(editionDir, 'source-bindings.json')
// Reject linked package files before reading or replacing them.
for (const relative of ['public', 'public/editions', `public/editions/${editionId}`, `public/editions/${editionId}/edition.json`, `public/editions/${editionId}/source-bindings.json`]) {
  if (fs.lstatSync(path.join(root, relative)).isSymbolicLink()) throw new Error('Original image delivery: linked package')
}
const edition = JSON.parse(fs.readFileSync(path.join(editionDir, 'edition.json'), 'utf8'))
if (edition.edition_id !== editionId) throw new Error('Original image delivery: edition record mismatch')
const original = fs.readFileSync(bindingPath, 'utf8')
const packaged = await packageOriginalImages({ root, editionId, runDir: path.resolve(values['run-dir']), bindingSet: JSON.parse(original) })
if (fs.readFileSync(bindingPath, 'utf8') !== original) throw new Error('Original image delivery: bindings changed during packaging')
const temporary = `${bindingPath}.${process.pid}.tmp`
try {
  fs.writeFileSync(temporary, `${JSON.stringify(packaged, null, 2)}\n`, { flag: 'wx' })
  fs.renameSync(temporary, bindingPath)
} finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary) }
console.log(JSON.stringify({ edition_id: editionId, packaged_originals: packaged.bindings.length, status: 'ok' }))
