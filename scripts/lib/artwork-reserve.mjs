import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import path from 'node:path'
import dns from 'node:dns/promises'
import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { bookmarkCacheDir, runVaultWorker } from './bookmark-intake.mjs'
import { fetchVettedImage } from './fetch-vetted-image.mjs'

// A prepared reserve is a small set of owning bookmark notes that a prior normal
// bounded intake admitted. It stores provenance and observations only. It never
// confers admission: consumption revalidates notes, bytes, config and ledger,
// then the ordinary bounded acquisition/inspection/selection runs again.
const reservePolicyVersion = 'prepared-artwork-reserve-v1'
const minimumWorks = 6
const states = ['prepared', 'claimed', 'consumed', 'invalid']
const digest = value => createHash('sha256').update(value).digest('hex')
const hex64 = value => /^[a-f0-9]{64}$/.test(value || '')

export const defaultReserveDir = () => process.env.DFE_ARTWORK_RESERVE_DIR || path.join(path.dirname(bookmarkCacheDir()), 'artwork-reserve-v1')

export function ledgerFingerprint(recentSourceKeys = new Set()) {
  return digest(JSON.stringify([...recentSourceKeys].map(String).sort()))
}

async function fileDigest(file) {
  if (!file) return 'none'
  try { return digest(await fs.readFile(file)) } catch (error) { if (error.code === 'ENOENT') return 'missing'; throw error }
}

const scriptsDir = fileURLToPath(new URL('..', import.meta.url))
// Entry points of the reserve's intake/admission path (bookmark-vault-worker is
// spawned, not imported). Every module statically or dynamically imported from
// them, transitively, is part of the fingerprint.
const admissionEntries = ['lib/artwork-reserve.mjs', 'lib/signal-mining.mjs', 'lib/bookmark-intake.mjs', 'lib/bookmark-vault-worker.mjs', 'lib/source-research.mjs', 'lib/creative-artifact-inspection.mjs', 'pipeline/mine-signals.mjs', 'pipeline/research-sources.mjs']

export function admissionModuleFiles() {
  const seen = new Set()
  const visit = file => {
    if (seen.has(file) || !file.startsWith(scriptsDir) || !fsSync.existsSync(file)) return
    seen.add(file)
    const text = fsSync.readFileSync(file, 'utf8')
    for (const match of text.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)['"](\.{1,2}\/[^'"]+\.m?js)['"]/g)) visit(path.resolve(path.dirname(file), match[1]))
  }
  for (const entry of admissionEntries) visit(path.join(scriptsDir, entry))
  return [...seen].sort()
}

// Any change to an intake/admission module, the effective frontpage Hermes
// transport, model or press config invalidates a prepared set. Only digests
// (and the non-secret profile path) are retained, never config contents.
// HERMES_HOME must be explicit: inspection would otherwise run against the
// default Hermes profile, which the reserve never assumes.
export async function reserveConfigFingerprint({ model, inputRoot, frontpageConfigPath, env = process.env } = {}) {
  if (!env.HERMES_HOME) throw new Error('Prepared reserve requires an explicit frontpage HERMES_HOME; no default-profile fallback')
  const hermesHome = path.resolve(env.HERMES_HOME)
  const modules = admissionModuleFiles()
  const moduleDigests = await Promise.all(modules.map(async file => `${path.relative(scriptsDir, file)}:${await fileDigest(file)}`))
  const components = {
    policy: reservePolicyVersion,
    inspection_policy: 'creative-artifact-vision-v1-bookmark-1',
    model: model || null,
    input_root: inputRoot ? path.resolve(inputRoot) : null,
    frontpage_config_sha256: await fileDigest(frontpageConfigPath),
    hermes_home: hermesHome,
    transport_config_sha256: await fileDigest(path.join(hermesHome, 'config.yaml')),
    hermes_env_sha256: digest(JSON.stringify([env.HERMES_BIN, hermesHome, env.HERMES_MODEL, env.HERMES_PROVIDER])),
    admission_modules: modules.map(file => path.relative(scriptsDir, file)),
    admission_code_sha256: digest(moduleDigests.join('\n')),
  }
  return { config_sha256: digest(JSON.stringify(components)), components }
}

function identities(source) {
  return [source.url, source.source_url, source.final_url, source.resolved_url].filter(Boolean)
}

function verifiedProof(source, autoresearch) {
  return (autoresearch?.source_decisions || []).map(row => row.inspection).find(proof => proof
    && proof.status === 'verified' && proof.confidence === 'high'
    && identities(source).includes(proof.source_url) && proof.media_url === source.image_url && hex64(proof.capture_sha256))
}

async function stateDirs(reserveDir) {
  for (const state of [...states, 'tmp']) await fs.mkdir(path.join(reserveDir, state), { recursive: true })
}

async function listState(reserveDir, state) {
  try { return (await fs.readdir(path.join(reserveDir, state))).filter(name => name.endsWith('.json')).sort() } catch (error) { if (error.code === 'ENOENT') return []; throw error }
}

export async function reserveState(reserveDir) {
  return Object.fromEntries(await Promise.all(states.map(async state => [state, (await listState(reserveDir, state)).map(name => name.slice(0, -5))])))
}

async function writeAtomic(reserveDir, destination, value) {
  const temporary = path.join(reserveDir, 'tmp', `${randomUUID()}.tmp`)
  await fs.writeFile(temporary, typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n', { flag: 'wx' })
  await fs.rename(temporary, destination)
}

// The set rename is the state transition. Sidecars after it are best-effort:
// a failed sidecar is reported, never turned into a second transition attempt.
async function moveSet(reserveDir, file, state, note) {
  const destination = path.join(reserveDir, state, path.basename(file))
  await fs.rename(file, destination)
  let sidecarError = null
  try {
    try { await fs.rename(`${file}.claim`, `${destination}.claim`) } catch (error) { if (error.code !== 'ENOENT') throw error }
    await writeAtomic(reserveDir, `${destination}.${state === 'invalid' ? 'reason' : state}`, typeof note === 'string' ? `${new Date().toISOString()} ${note}\n` : note)
  } catch (error) { sidecarError = error.message }
  return { destination, sidecarError }
}

export async function writePreparedReserve({ reserveDir = defaultReserveDir(), signalHarvest, contentSources = [], autoresearch, fingerprints, now = Date.now(), ttlMs = 72 * 3600e3, runDir = null, ledgerSize = null, codeMatchesRef = false, codeRef = null }) {
  const unique = [...new Map(contentSources.map(source => [source.url, source])).values()]
  if (unique.length < minimumWorks) throw new Error(`Prepared reserve requires at least six admitted independent works; got ${unique.length}`)
  if (!hex64(fingerprints?.config_sha256) || !hex64(fingerprints?.ledger_sha256)) throw new Error('Prepared reserve requires config and ledger fingerprints')
  const notes = new Map()
  const sources = unique.map(source => {
    const proof = verifiedProof(source, autoresearch)
    if (!proof) throw new Error(`Prepared reserve requires a verified actual-media capture for ${source.url}`)
    const note = (signalHarvest?.notes_selected || []).find(candidate => (source.note_id && candidate.id === source.note_id) || (source.note_path && candidate.source_path === source.note_path))
    if (!note?.source_path || !hex64(note.metadata?.note_sha256)) throw new Error(`Prepared reserve requires exact owning-note provenance for ${source.url}`)
    const { text, ...stored } = note
    notes.set(note.id, stored)
    return {
      url: source.url, note_id: note.id, note_path: note.source_path, note_sha256: note.metadata.note_sha256,
      media_url: source.image_url, resolved_media_url: proof.resolved_media_url || null, capture_sha256: proof.capture_sha256, capture_path: proof.capture_path || null,
      observation: Object.fromEntries(['status', 'artifact_kind', 'confidence', 'observation'].map(key => [key, proof[key]])),
    }
  })
  await stateDirs(reserveDir)
  if ((await listState(reserveDir, 'prepared')).length) throw new Error('A reserve set is already prepared; consume, expire or invalidate it first')
  const setId = `${new Date(now).toISOString().replace(/[-:.]/g, '')}-${randomUUID().slice(0, 8)}`
  const set = {
    schema_version: 1, policy: reservePolicyVersion, set_id: setId,
    created_at: new Date(now).toISOString(), expires_at: new Date(now + ttlMs).toISOString(),
    input_root: path.resolve(signalHarvest.input_root), config_sha256: fingerprints.config_sha256, config_components: fingerprints.components || null,
    ledger_sha256: fingerprints.ledger_sha256, ledger_size: ledgerSize, prepared_run_dir: runDir,
    // Readiness requires admission code byte-identical to the deployed ref.
    code_matches_ref: codeMatchesRef === true, code_ref: codeRef,
    notes: [...notes.values()], sources,
  }
  const file = path.join(reserveDir, 'prepared', `${setId}.json`)
  await writeAtomic(reserveDir, file, set)
  return { file, set }
}

function processAlive(pid) {
  try { process.kill(pid, 0); return true } catch (error) { return error.code === 'EPERM' }
}

async function revalidate(set, { inputRoot, fingerprints, now, readNotes, fetchMediaSha }) {
  if (set.schema_version !== 1 || set.policy !== reservePolicyVersion) return 'unsupported reserve schema/policy'
  if (!(now < Date.parse(set.expires_at))) return `expired at ${set.expires_at}`
  if (path.resolve(inputRoot || '') !== set.input_root) return 'input root changed'
  if (set.config_sha256 !== fingerprints.config_sha256) return 'policy/config changed since preparation'
  if (set.ledger_sha256 !== fingerprints.ledger_sha256) return 'archive ledger changed since preparation'
  if (set.code_matches_ref !== true) return 'prepared from undeployed local code (diagnostic only)'
  const digests = await readNotes(set.input_root, set.notes.map(note => note.source_path))
  for (const note of set.notes) if (digests[note.source_path] !== note.metadata.note_sha256) return `owning note changed or missing: ${note.source_path}`
  for (const source of set.sources) {
    let fresh
    try { fresh = await fetchMediaSha(source.media_url) } catch (error) { return `media unavailable: ${source.media_url} (${error.message})` }
    if (fresh !== source.capture_sha256) return `media bytes changed: ${source.media_url}`
  }
  return null
}

// Operator/CLI audit under the owner: invalidate stale prepared sets with the
// production revalidation reason and leave valid sets prepared. It never claims
// or consumes, and never rewrites a set's recorded hashes.
export async function auditPreparedReserves({ reserveDir = defaultReserveDir(), inputRoot, fingerprints, now = Date.now(), isOwner = isPressOwner, readNotes = readVaultNoteDigests, fetchMediaSha = fetchMediaDigest }) {
  if (!(await isOwner())) throw new Error('Reserve audit requires the existing press owner')
  await stateDirs(reserveDir)
  const ready = [], invalidated = []
  for (const name of await listState(reserveDir, 'prepared')) {
    const file = path.join(reserveDir, 'prepared', name)
    let reason
    try { reason = await revalidate(JSON.parse(await fs.readFile(file, 'utf8')), { inputRoot, fingerprints, now, readNotes, fetchMediaSha }) }
    catch (error) { reason = `revalidation failed: ${error.message}` }
    if (!reason) { ready.push(name.slice(0, -5)); continue }
    await moveSet(reserveDir, file, 'invalid', reason)
    invalidated.push({ set_id: name.slice(0, -5), reason })
  }
  return { ready, invalidated }
}

export async function claimPreparedReserve({ reserveDir = defaultReserveDir(), inputRoot, fingerprints, now = Date.now(), runId = null, isOwner = isPressOwner, readNotes = readVaultNoteDigests, fetchMediaSha = fetchMediaDigest }) {
  if (!(await isOwner())) return { claim: null, reason: 'not running under the existing press owner', invalidated: [] }
  await stateDirs(reserveDir)
  const invalidated = []
  // Only the owner claims, so a claim whose recorded process is gone was
  // orphaned by a crash. Retire it as evidence; never hand it out twice.
  for (const name of await listState(reserveDir, 'claimed')) {
    const file = path.join(reserveDir, 'claimed', name)
    let record = null
    try { record = JSON.parse(await fs.readFile(`${file}.claim`, 'utf8')) } catch (error) { if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error }
    if (record && processAlive(record.pid)) continue
    // A claim is renamed into place before its sidecar is written; give that
    // in-flight window a minute before treating a sidecar-less claim as orphaned.
    if (!record && Date.now() - (await fs.stat(file)).ctimeMs < 60000) continue
    const reason = `orphaned claim by ${record?.run_id || 'unknown run'}; claimer ended before consume or invalidate`
    await moveSet(reserveDir, file, 'invalid', reason)
    invalidated.push({ set_id: name.slice(0, -5), reason })
  }
  for (const name of (await listState(reserveDir, 'prepared')).reverse()) {
    const file = path.join(reserveDir, 'claimed', name)
    try { await fs.rename(path.join(reserveDir, 'prepared', name), file) } catch (error) { if (error.code === 'ENOENT') continue; throw error }
    await writeAtomic(reserveDir, `${file}.claim`, { run_id: runId, pid: process.pid, claimed_at: new Date(now).toISOString() })
    let set, reason
    try {
      set = JSON.parse(await fs.readFile(file, 'utf8'))
      reason = await revalidate(set, { inputRoot, fingerprints, now, readNotes, fetchMediaSha })
    } catch (error) { reason = `revalidation failed: ${error.message}` }
    if (reason) {
      await moveSet(reserveDir, file, 'invalid', reason)
      invalidated.push({ set_id: name.slice(0, -5), reason })
      continue
    }
    return { claim: { file, set, run_id: runId }, notes: set.notes, invalidated }
  }
  return { claim: null, reason: 'no valid prepared reserve', invalidated }
}

// After ordinary admission: consume only when at least six distinct reserved
// works are admitted, every admitted source comes from the reserve, and fresh
// inspection bytes match preparation. Never throws once the set has moved.
export async function finalizeReserveClaim(claim, { contentSources = [], autoresearch = null, error = null } = {}) {
  const reserveDir = path.dirname(path.dirname(claim.file))
  const settle = async (state, note, extra = {}) => {
    const { destination, sidecarError } = await moveSet(reserveDir, claim.file, state, note)
    return { state, set_id: claim.set.set_id, file: destination, ...extra, ...(sidecarError ? { sidecar_error: sidecarError } : {}) }
  }
  const invalid = reason => settle('invalid', reason, { reason })
  if (error) return invalid(`admission failed: ${error.message}`)
  const matched = new Set()
  for (const source of contentSources) {
    const reserved = claim.set.sources.find(entry => identities(source).includes(entry.url) || (source.note_id && entry.note_id === source.note_id && entry.media_url === source.image_url))
    if (!reserved) return invalid(`admitted source outside reserve: ${source.url}`)
    const proof = verifiedProof(source, autoresearch)
    if (!proof || proof.capture_sha256 !== reserved.capture_sha256 || source.image_url !== reserved.media_url) return invalid(`media bytes changed at inspection: ${source.image_url}`)
    matched.add(reserved.url)
  }
  if (matched.size < minimumWorks) return invalid(`ordinary admission matched ${matched.size} distinct reserved works; six required`)
  return settle('consumed', { run_id: claim.run_id, consumed_at: new Date().toISOString(), admitted: contentSources.map(source => source.url) })
}

const noteDigestWorker = `
const fs = require('node:fs'), path = require('node:path'), { createHash } = require('node:crypto')
const { inputRoot, paths } = JSON.parse(fs.readFileSync(0, 'utf8'))
const out = {}
for (const relative of paths) {
  const full = path.join(inputRoot, relative)
  fs.writeSync(2, 'readFile ' + full + '\\n')
  try { out[relative] = createHash('sha256').update(fs.readFileSync(full, 'utf8')).digest('hex') } catch (e) { if (e.code !== 'ENOENT') throw e; out[relative] = null }
}
process.stdout.write(JSON.stringify(out))
`

// Exact owning-note reads in the same killable worker isolation as intake.
export async function readVaultNoteDigests(inputRoot, paths, { timeoutMs = 20000 } = {}) {
  for (const relative of paths) {
    if (typeof relative !== 'string' || path.isAbsolute(relative) || relative.split(/[\\/]/).includes('..') || !relative.endsWith('.md')) throw new Error(`Unsafe reserve note path: ${relative}`)
  }
  return runVaultWorker({ inputRoot, paths }, { timeoutMs, workerCode: noteDigestWorker })
}

async function fetchMediaDigest(url) {
  const { response, body } = await fetchVettedImage(url, { lookup: dns.lookup, timeoutMs: 8000, maxBytes: 8_000_000 })
  if (!response?.ok) throw new Error(`HTTP ${response?.status}`)
  return digest(body)
}

export function isPressOwner() {
  return new Promise(resolve => {
    const child = spawn('python3', [fileURLToPath(new URL('../press-owner.py', import.meta.url)), '--validate'], { stdio: 'ignore' })
    child.once('error', () => resolve(false))
    child.once('close', code => resolve(code === 0))
  })
}
