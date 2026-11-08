// Local operator-attested independent review, NOT authenticated identity or model voting.
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { isDeepStrictEqual } from 'node:util'
import { parseUniqueKeyJson } from './strict-json.mjs'

const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const filename = 'independent-visual-review.json'
const policy = 'independent-final-candidate-v1'
const fail = message => { throw new Error(`independent visual review: ${message}`) }
const text = value => typeof value === 'string' && value.trim().length > 0
function safeJson(bytes) {
  const value = parseUniqueKeyJson(String(bytes))
  const walk = item => {
    if (!item || typeof item !== 'object') return
    for (const key of Object.keys(item)) {
      if (['__proto__', 'prototype', 'constructor'].includes(key)) fail('unsafe JSON key')
      walk(item[key])
    }
  }
  walk(value)
  return value
}
function keys(value, expected) {
  if (!value || Array.isArray(value) || !isDeepStrictEqual(Object.keys(value).sort(), [...expected].sort())) fail('malformed review schema')
}
function retainedFile(runDir, name) {
  if (!text(name) || path.isAbsolute(name) || name.includes('\\') || name.split('/').some(p => !p || p === '.' || p === '..')) fail('unsafe evidence reference')
  const root = fs.realpathSync(runDir)
  const file = path.join(root, name)
  if (!fs.realpathSync(file).startsWith(root + path.sep) || !fs.statSync(file).isFile()) fail('unsafe evidence target')
  return fs.readFileSync(file)
}
export function independentReviewExpectation({ worktreeDir, runDir, editionId, staged = false }) {
  if (!runDir || !/^[a-zA-Z0-9][a-zA-Z0-9._-]+$/.test(editionId || '')) fail('exact retained candidate identity required')
  const run = fs.realpathSync(runDir)
  const read = name => staged
    ? execFileSync('git', ['show', `:public/editions/${editionId}/${name}`], { cwd: worktreeDir, maxBuffer: 64 * 1024 * 1024 })
    : fs.readFileSync(path.join(worktreeDir, 'public/editions', editionId, name))
  const summary = safeJson(retainedFile(run, 'edition-package-summary.json'))
  if (summary.edition_id !== editionId || fs.realpathSync(summary.edition_dir) !== fs.realpathSync(path.join(worktreeDir, 'public/editions', editionId))) fail('retained package mismatch')
  const payloadBytes = retainedFile(run, 'daily-generation-payload.json')
  const files = Object.fromEntries(candidateNames.map(name => [name, hash(read(name))]))
  return bindingFromBytes(payloadBytes, files, run, editionId)
}
const candidateNames = ['edition.json', 'artifact-map.json', 'source-bindings.json', 'assets/plate.png', 'assets/preview.png']
function bindingFromBytes(payloadBytes, files, run, editionId) {
  const payload = safeJson(payloadBytes)
  const source = payload.source_image_fingerprints?.find(entry => entry?.image_url)
  const mode = source ? 'source-image' : 'skipped-no-valid-dominant-source-image'
  if (payload.source_contract?.mode !== mode) fail('source applicability mismatch')
  const contract = payload.source_contract
  const clauses = source ? contract.must_transform : []
  if (!Array.isArray(clauses) || (source && !clauses.length) || clauses.some(c => !text(c))) fail('invalid complete source contract')
  const required = [
    { clause_id: 'plate-visual-acceptance', clause: 'Accept the complete final plate: source identity, original transformation, composition and no debug marks.' },
    { clause_id: 'source-window-visual-acceptance', clause: 'Accept final desktop/mobile opened source surfaces: readable, unclipped, real media, no live debug chrome.' },
    ...clauses.map((clause, i) => ({ clause_id: `transform-${i + 1}-${hash(clause).slice(0, 16)}`, clause })),
  ]
  return {
    policy_revision: policy, stage: 'final-packaged-candidate-after-full-qa',
    primary_policy_revision: 'pre-map-visible-integration-v1', primary_stage: 'pre-mapping-plate-visual',
    run_dir: run, edition_id: editionId, payload_sha256: hash(payloadBytes),
    source_mode: mode, source_image_url: source?.image_url ?? null,
    source_owner: { artifact_source_urls: payload.artifacts?.map(a => a.source_url), lineage_source_url: payload.lineage?.source_url ?? null, fingerprint_page_url: source?.page_url ?? null },
    source_contract: contract, candidate_files: files, required_clauses: required,
  }
}
function assertDisposition(runDir) {
  const file = path.join(runDir, 'CANDIDATE-DISPOSITION.json')
  if (fs.existsSync(file)) {
    const value = safeJson(fs.readFileSync(file))
    if (value.disposition !== 'PASS' || value.publication_authorized !== true) fail('canonical disposition BLOCK; preserve adverse findings')
  }
}
function validateReport(report, expected, runDir, { allowBlock = false } = {}) {
  keys(report, ['schema_version', 'binding', 'reviewer', 'verdict', 'findings', 'adverse_findings', 'evidence', 'source_snapshot'])
  if (report.schema_version !== 1 || !isDeepStrictEqual(report.binding, expected)) fail('missing/stale exact candidate binding (run/source/contract/policy/stage/bytes)')
  keys(report.reviewer, ['kind', 'id', 'delegation_id', 'session_id'])
  if (!['human', 'subagent'].includes(report.reviewer.kind) || !['id', 'delegation_id', 'session_id'].every(k => text(report.reviewer[k]))) fail('external reviewer provenance required; primary model is not independent')
  if (!['PASS', 'BLOCK'].includes(report.verdict)) fail('explicit PASS or BLOCK required')
  if (!Array.isArray(report.findings) || report.findings.length !== expected.required_clauses.length) fail('complete ordered findings required')
  let negative = false
  report.findings.forEach((row, i) => {
    keys(row, ['clause_id', 'clause', 'status', 'visible_evidence', 'context', 'reason'])
    const required = expected.required_clauses[i]
    if (row.clause_id !== required.clause_id || row.clause !== required.clause || !['fulfilled', 'failed', 'uncertain'].includes(row.status) || !['visible_evidence', 'context', 'reason'].every(k => text(row[k]))) fail('malformed, reordered or contradictory findings')
    if (row.status !== 'fulfilled') negative = true
  })
  if (!Array.isArray(report.adverse_findings) || report.adverse_findings.some(v => !text(v))) fail('adverse findings must be retained')
  if (report.verdict === 'PASS' && (negative || report.adverse_findings.length)) fail('PASS contradicts adverse/failed/uncertain findings')
  if (!Array.isArray(report.evidence) || !report.evidence.length) fail('retained independent evidence required')
  const seen = new Set()
  for (const ref of report.evidence) {
    keys(ref, ['path', 'sha256', 'role'])
    if (!text(ref.role) || seen.has(ref.path) || ref.path === filename) fail('invalid/conflicting evidence')
    seen.add(ref.path)
    const bytes = retainedFile(runDir, ref.path)
    if (!bytes.length || hash(bytes) !== ref.sha256) fail('missing/changed independent evidence bytes')
  }
  keys(report.source_snapshot, ['path', 'sha256', 'unavailable_reason'])
  const snapshot = report.source_snapshot
  if (snapshot.path !== null) {
    if (snapshot.unavailable_reason !== null || hash(retainedFile(runDir, snapshot.path)) !== snapshot.sha256) fail('source snapshot hash mismatch')
  } else if (snapshot.sha256 !== null || !text(snapshot.unavailable_reason)) fail('source-byte unavailability reason required; never invent source proof')
  if (!allowBlock && report.verdict !== 'PASS') fail('BLOCK; primary PASS cannot override independent disposition')
  return report
}
export function assertIndependentVisualReview(options) {
  try {
    assertDisposition(options.runDir)
    const expected = independentReviewExpectation(options)
    return validateReport(safeJson(retainedFile(options.runDir, filename)), expected, options.runDir)
  } catch (error) {
    if (error.message.startsWith('independent visual review:')) throw error
    fail(`missing/invalid retained review: ${error.message}`)
  }
}
export function recordIndependentVisualReview(options, reportPath) {
  const expected = independentReviewExpectation(options)
  // BLOCK is durable too. No replacement or primary re-audit can erase it.
  const report = validateReport(safeJson(fs.readFileSync(reportPath)), expected, options.runDir, { allowBlock: true })
  assertDisposition(options.runDir)
  fs.writeFileSync(path.join(options.runDir, filename), JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
  return report
}

// Delivery-only durable snapshot. This API cannot authorize a new commit or registration.
export function archiveIndependentVisualReview(options, archiveDir) {
  const report = assertIndependentVisualReview(options)
  fs.mkdirSync(archiveDir, { recursive: false, mode: 0o700 })
  const copy = (relative, bytes) => {
    const file = path.join(archiveDir, relative)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, bytes, { flag: 'wx', mode: 0o600 })
  }
  const refs = new Set([filename, 'daily-generation-payload.json', ...report.evidence.map(ref => ref.path)])
  if (report.source_snapshot.path !== null) refs.add(report.source_snapshot.path)
  if (fs.existsSync(path.join(options.runDir, 'CANDIDATE-DISPOSITION.json'))) refs.add('CANDIDATE-DISPOSITION.json')
  for (const name of refs) copy(`run/${name}`, retainedFile(options.runDir, name))
  for (const name of candidateNames) copy(`candidate/${name}`, fs.readFileSync(path.join(options.worktreeDir, 'public/editions', options.editionId, name)))
  assertArchivedIndependentVisualReview(archiveDir, options.editionId)
  return archiveDir
}
export function assertArchivedIndependentVisualReview(archiveDir, editionId) {
  const run = path.join(archiveDir, 'run')
  assertDisposition(run)
  const report = safeJson(retainedFile(run, filename))
  const files = Object.fromEntries(candidateNames.map(name => [name, hash(retainedFile(path.join(archiveDir, 'candidate'), name))]))
  const expected = bindingFromBytes(retainedFile(run, 'daily-generation-payload.json'), files, report.binding.run_dir, editionId)
  return validateReport(report, expected, run)
}
