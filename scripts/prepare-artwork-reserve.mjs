// Source-only preparation of the small prepared artwork reserve. Runs one normal
// bounded metadata indexing / 24 nominations, stopping at the first verified work, and the
// ordinary actual-media admission against the real vault and inspectors, then
// stops. It never composes a brief, generates or buys a plate, or publishes.
import fs from 'node:fs/promises'
import { MIN_SOURCE_WINDOWS, DESIRED_SOURCE_WINDOWS } from '../src/lib/sourceWindowCountContract.mjs'
import fsSync from 'node:fs'
import path from 'node:path'
import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { parseArgs as parsePressArgs } from './lib/cli-options.mjs'
import { mineSignals as realMineSignals } from './lib/signal-mining.mjs'
import { acquireBoundedBookmarkSources, inspectSourceCandidates as realInspectSourceCandidates } from './lib/source-research.mjs'
import { requireOpenAiKey } from './lib/runtime-env.mjs'
import { getHistoricalSourceKeys, loadManifest } from './lib/recent-edition-context.mjs'
import { assertEditorialBindings, sourceContentKey } from './lib/source-selection-policy.mjs'
import { localPublicationDate } from './lib/cron-reliability.mjs'
import {
  admissionModuleFiles, auditPreparedReserves, claimPreparedReserve, defaultReserveDir, finalizeReserveClaim,
  isPressOwner, ledgerFingerprint, reserveConfigFingerprint, reserveState, writePreparedReserve,
} from './lib/artwork-reserve.mjs'
import { createMineSignalsStep } from './pipeline/mine-signals.mjs'
import { createResearchSourcesStep } from './pipeline/research-sources.mjs'

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const defaultVaultRoot = '/Users/nickgeorge-studio/Documents/nicks-mind-map'
const git = async args => (await promisify(execFile)('git', args, { cwd: root, timeout: 60000, maxBuffer: 64 * 1024 * 1024, encoding: 'buffer' })).stdout

export function parseArgs(argv) {
  const options = { inputRoot: process.env.DFE_RESERVE_INPUT_ROOT || defaultVaultRoot, reserveDir: null, ttlHours: 72, remote: 'origin', branch: 'main', auditOnly: false, allowLocalCode: false, proveConsumption: false }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    const value = () => { const next = argv[++index]; if (!next || next.startsWith('--')) throw new Error(`Missing value for ${arg}`); return next }
    if (arg === '--input-root') options.inputRoot = value()
    else if (arg === '--reserve-dir') options.reserveDir = path.resolve(value())
    else if (arg === '--remote') options.remote = value()
    else if (arg === '--branch') options.branch = value()
    else if (arg === '--ttl-hours') options.ttlHours = Number(value())
    else if (arg === '--audit-only') options.auditOnly = true
    else if (arg === '--prove-consumption') options.proveConsumption = true
    else if (arg === '--allow-local-code') options.allowLocalCode = true
    else if (arg === '--help') {
      console.log('Usage: node scripts/prepare-artwork-reserve.mjs [--input-root <vault>] [--reserve-dir <dir>] [--ttl-hours <n>] [--audit-only] [--prove-consumption] [--allow-local-code --reserve-dir <diagnostic dir>]')
      process.exit(0)
    } else throw new Error(`Unknown option: ${arg}`)
  }
  if (!Number.isFinite(options.ttlHours) || options.ttlHours <= 0 || options.ttlHours > 168) throw new Error('--ttl-hours must be within (0, 168]')
  // Undeployed-code sets are diagnostics; keep them out of the production reserve.
  if (options.allowLocalCode && (!options.reserveDir || options.reserveDir === path.resolve(defaultReserveDir()))) throw new Error('--allow-local-code requires a separate diagnostic --reserve-dir')
  return options
}

// The press runs admission from a clean origin/main worktree. A set is only
// deployable when every admission module here is byte-identical to that ref
// (untracked or missing-at-ref modules count as mismatches).
export async function compareAdmissionCode(ref, { readRef = rel => git(['show', `${ref}:${rel}`]).catch(() => null) } = {}) {
  const mismatched = []
  for (const file of admissionModuleFiles()) {
    const rel = path.relative(root, file)
    const [local, deployed] = await Promise.all([fs.readFile(file), readRef(rel)])
    if (!deployed || !Buffer.from(deployed).equals(local)) mismatched.push(rel)
  }
  return { ref, matches: mismatched.length === 0, mismatched }
}

// The reserve must be fingerprinted against the complete archive the press
// will see: origin/main's manifest and every edition's source bindings.
async function completeLedger({ remote, branch }) {
  await git(['fetch', remote, branch, '--quiet'])
  const ref = `${remote}/${branch}`
  const drift = await promisify(execFile)('git', ['diff', '--quiet', ref, '--', 'public/editions/index.json', ':(glob)public/editions/*/source-bindings.json'], { cwd: root }).then(() => false, error => error.code === 1 ? true : Promise.reject(error))
  if (drift) throw new Error(`Local archive ledger differs from ${ref}; update the primary checkout before preparing`)
  const manifest = loadManifest({ root, fsSync })
  const missing = manifest.editions.filter(item => !fsSync.existsSync(path.join(root, 'public', item.path.replace(/^\//, ''), 'source-bindings.json')))
  if (missing.length) throw new Error(`Archive ledger incomplete: ${missing.length} editions lack source-bindings.json`)
  const keys = getHistoricalSourceKeys({ root, fsSync, sourceContentKey })
  return { keys, ref, ref_commit: (await git(['rev-parse', ref])).toString().trim(), editions: manifest.editions.length, current_edition_id: manifest.current_edition_id }
}

// Proof on a scratch COPY of a ready set: the integrated normal mine and research
// steps (claim, revalidation, ordinary bounded admission, finalize) and then the
// finalMedia binding and capture-digest assertions. No fresh fallback, no brief,
// no plate. The real prepared set is never claimed or consumed.
export async function proveReserveConsumption({ setFile, runDir, root: projectRoot = root, options, recentSourceKeys, apiKey = null, mineSignals = realMineSignals, inspectSourceCandidates = realInspectSourceCandidates, claimDeps = {} }) {
  const scratch = path.join(runDir, 'scratch-reserve')
  await fs.mkdir(path.join(scratch, 'prepared'), { recursive: true })
  await fs.copyFile(setFile, path.join(scratch, 'prepared', path.basename(setFile)))
  const set = JSON.parse(await fs.readFile(setFile, 'utf8'))
  const context = {}
  const stepOptions = { ...options, inputMode: 'obsidian-allowlist', publish: true }
  const reserve = { claim: args => claimPreparedReserve({ ...args, ...claimDeps }), finalize: finalizeReserveClaim }
  const mine = createMineSignalsStep({ options: stepOptions, context, recentDiversityAvoidTerms: [], recentSourceKeys, root: projectRoot, runDir, mineSignals, reserve, reserveDir: scratch })
  await mine.run()
  if (!context.preparedReserveClaimResult?.claimed) throw new Error(`Proof could not claim the scratch copy: ${context.preparedReserveClaimResult?.error || context.preparedReserveClaimResult?.invalidated?.[0]?.reason || context.preparedReserveClaimResult?.reason}`)
  context.remineWithoutReserve = async () => { throw new Error(`Reserve not consumed in proof: ${context.preparedReserveOutcome?.reason || context.preparedReserveOutcome?.error || context.preparedReserveOutcome?.state}`) }
  const research = createResearchSourcesStep({ apiKey, context, options: stepOptions, recentSourceKeys, root: projectRoot, runDir, inspectSourceCandidates })
  await research.run()
  const field = context.researchField
  // Same per-binding finalMedia check the press applies before commit, minus
  // packaging (no edition exists): verified proof plus capture bytes on disk.
  const bindings = field.content_sources.map(source => ({ source_url: source.url, source_image_url: source.image_url }))
  assertEditorialBindings(bindings, field, context.signalHarvest, { finalMedia: true, minimum: MIN_SOURCE_WINDOWS })
  const captureDigests = field.content_sources.map(source => {
    const proof = (field.autoresearch?.source_decisions || []).map(row => row.inspection).find(p => p?.source_url === source.url && p.media_url === source.image_url && p.status === 'verified')
    const reserved = set.sources.find(entry => entry.url === source.url || (entry.note_id === source.note_id && entry.media_url === source.image_url))
    if (!proof || proof.capture_sha256 !== reserved?.capture_sha256) throw new Error(`Capture digest mismatch for ${source.url}`)
    return { url: source.url, capture_sha256: proof.capture_sha256 }
  })
  return { set_id: set.set_id, outcome: context.preparedReserveOutcome.state, admitted: bindings.length, final_media_bindings: bindings.length, capture_digests: captureDigests, scratch_reserve: scratch, scratch_state: await reserveState(scratch) }
}

export async function runPreparation({ options, runDir, deps }) {
  const reserveDir = options.reserveDir || defaultReserveDir()
  const out = { reserve_dir: reserveDir, reserve_state_before: await reserveState(reserveDir) }
  const ledger = await deps.completeLedger(options)
  out.ledger = { ref: ledger.ref, ref_commit: ledger.ref_commit, editions: ledger.editions, current_edition_id: ledger.current_edition_id, keys: ledger.keys.size, sha256: ledgerFingerprint(ledger.keys) }
  const code = await deps.codeCheck(ledger.ref)
  out.code = code
  out.readiness = code.matches ? 'deployed-code' : 'local-diagnostic-not-deployed'
  if (!code.matches && !options.allowLocalCode) return { ...out, status: 'blocked-undeployed-code', error: `Admission code differs from ${ledger.ref}: ${code.mismatched.join(', ')}` }
  const press = deps.press()
  const fingerprints = { ...await deps.fingerprint(press), ledger_sha256: ledgerFingerprint(ledger.keys) }
  // Production revalidation of existing sets: stale ones are retired with their
  // reason (hashes untouched), valid ones stay prepared and are never consumed.
  out.audit = await deps.audit({ reserveDir, inputRoot: press.inputRoot, fingerprints })
  if (options.proveConsumption) {
    if (!out.audit.ready.length) return { ...out, status: 'no-ready-set' }
    out.proof = await deps.prove({ setFile: path.join(reserveDir, 'prepared', `${out.audit.ready[0]}.json`), press, ledger, fingerprints })
    return { ...out, status: 'consumption-proven' }
  }
  if (options.auditOnly) return { ...out, status: 'audited' }
  if (out.audit.ready.length) return { ...out, status: 'ready', ready: out.audit.ready }
  // Four small cursor advances, not four full intake budgets. Keep the owning
  // notes and exact actual-media observations together throughout admission.
  const budget = { acquisitions: 0, inspections: 0, reads: 0, nominations: 0 }
  const state = {}
  let harvest, acquired
  out.batches = []
  for (let batch = 0; batch < 4 && budget.acquisitions < 24 && budget.inspections < 24; batch++) {
    const next = await deps.mine(press, ledger, { maxReads: 12, maxNotes: DESIRED_SOURCE_WINDOWS })
    budget.reads += next.selection_policy?.bookmark_intake?.notes_read ?? 12
    budget.nominations += next.notes_selected.length
    harvest = harvest ? { ...next,
      notes_selected: [...new Map([...harvest.notes_selected, ...next.notes_selected].map(n => [n.id, n])).values()],
      source_candidates: [...new Map([...harvest.source_candidates, ...next.source_candidates].map(s => [sourceContentKey(s), s])).values()],
    } : next
    if (next.selection_policy && !next.selection_policy.bookmark_first) throw new Error('Normal bounded bookmark intake was not used')
    acquired = await deps.acquire(harvest, press, ledger, { budget, state })
    out.batches.push({ batch: batch + 1, budget: { ...budget }, admitted: acquired.contentSources.length })
    await fs.mkdir(runDir, { recursive: true })
    await fs.writeFile(path.join(runDir, 'reserve-continuation.json'), JSON.stringify({ budget, batches: out.batches, signal_harvest: harvest, acquired }, null, 2) + '\n')
    if (acquired.contentSources.length >= MIN_SOURCE_WINDOWS || budget.nominations >= 24) break
  }
  out.budget = budget
  out.intake = { notes_selected: harvest.notes_selected.length, source_candidates: harvest.source_candidates.length, bookmark_intake: harvest.selection_policy?.bookmark_intake || null }
  if (harvest.selection_policy && !harvest.selection_policy.bookmark_first) throw new Error('Normal bounded bookmark intake was not used')

  const attempts = (acquired.autoresearch?.source_decisions || []).filter(row => row.inspection)
  out.admission = { ...acquired.audit, inspected_sources: acquired.inspected.length, inspection_attempts: attempts.length,
    inspection_statuses: attempts.reduce((counts, row) => { const key = row.inspection.error ? 'error' : row.inspection.status; return { ...counts, [key]: (counts[key] || 0) + 1 } }, {}),
    inspection_errors: attempts.filter(row => row.inspection.error).map(row => ({ url: row.url, error: String(row.inspection.error).slice(0, 300) })),
    cache_hits: attempts.filter(row => row.inspection.cache_hit).length, admitted: acquired.contentSources.map(source => source.url) }
  if (acquired.contentSources.length < MIN_SOURCE_WINDOWS) return { ...out, status: 'insufficient' }
  const { file, set } = await writePreparedReserve({ reserveDir, signalHarvest: harvest, contentSources: acquired.contentSources, autoresearch: acquired.autoresearch, fingerprints,
    ttlMs: options.ttlHours * 3600e3, runDir, ledgerSize: ledger.keys.size, codeMatchesRef: code.matches, codeRef: `${ledger.ref}@${ledger.ref_commit}` })
  return { ...out, status: 'prepared', reserve_file: file, set_id: set.set_id, expires_at: set.expires_at, works: set.sources.length }
}

async function main() {
  const argv = process.argv.slice(2)
  // Share the press's single kernel owner: never prepare during a live press.
  if (!(await isPressOwner())) {
    const child = spawn('python3', [path.join(root, 'scripts', 'press-owner.py'), '--', process.execPath, fileURLToPath(import.meta.url), ...argv], { stdio: 'inherit' })
    child.once('close', code => { process.exitCode = code ?? 1 })
    return
  }
  const options = parseArgs(argv)
  const runId = `${new Date().toISOString().replace(/[-:.]/g, '')}-${process.pid}`
  const runDir = path.join(root, 'tmp', 'artwork-reserve-runs', runId)
  await fs.mkdir(runDir, { recursive: true })
  const diagnostics = { schema_version: 2, mode: 'source-only', run_id: runId, run_dir: runDir, press_run_id: process.env.DFE_PRESS_RUN_ID || null,
    image_generation: 'not-invoked', brief_generation: 'not-invoked', status: 'started', started_at: new Date().toISOString() }
  const { key: apiKey } = requireOpenAiKey({ root, required: false })
  // Same option resolution as the press (model, config path).
  const press = () => parsePressArgs(['--input-mode', 'obsidian-allowlist', '--input-root', options.inputRoot, '--date', localPublicationDate()])
  try {
    Object.assign(diagnostics, await runPreparation({ options, runDir, deps: {
      completeLedger,
      codeCheck: ref => compareAdmissionCode(ref),
      press,
      fingerprint: p => reserveConfigFingerprint({ model: p.model, inputRoot: p.inputRoot, frontpageConfigPath: p.configPath }),
      audit: args => auditPreparedReserves(args),
      mine: (p, ledger, limits) => realMineSignals({ inputMode: 'obsidian-allowlist', inputRoot: p.inputRoot, date: p.date, maxNotes: limits.maxNotes, bookmarkMaxReads: limits.maxReads, bookmarkFirst: true, recentSourceKeys: ledger.keys, inspirationOverride: null }, runDir),
      acquire: (harvest, p, ledger, continuation) => acquireBoundedBookmarkSources(harvest, { runDir, apiKey, model: p.model, date: p.date, recentSourceKeys: ledger.keys, ...continuation }),
      prove: ({ setFile, press: p, ledger }) => proveReserveConsumption({ setFile, runDir: path.join(runDir, 'consumption-proof'), options: p, recentSourceKeys: ledger.keys, apiKey }),
    } }))
    if (diagnostics.status === 'insufficient') process.exitCode = 2
    else if (['blocked-undeployed-code', 'no-ready-set'].includes(diagnostics.status)) process.exitCode = 1
  } catch (error) {
    diagnostics.status = 'blocked'
    diagnostics.error = error.message
    process.exitCode = 1
  } finally {
    diagnostics.finished_at = new Date().toISOString()
    diagnostics.reserve_state_after = await reserveState(options.reserveDir || defaultReserveDir()).catch(() => null)
    await fs.writeFile(path.join(runDir, 'reserve-diagnostics.json'), JSON.stringify(diagnostics, null, 2) + '\n')
    console.log(JSON.stringify(diagnostics, null, 2))
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1 })
