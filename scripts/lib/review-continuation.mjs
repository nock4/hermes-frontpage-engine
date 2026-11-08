// Bounded continuation inside the EXISTING press owner. No daemon/queue/job.
import fs from 'node:fs/promises'
import path from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { createHash, randomUUID } from 'node:crypto'
import { ensureAutomaticReview } from './automatic-visual-review.mjs'
import { independentReviewExpectation } from './independent-visual-review.mjs'

async function read(file) { return JSON.parse(await fs.readFile(file, 'utf8')) }
async function save(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true })
  const temporary = `${file}.${randomUUID()}.tmp`
  const handle = await fs.open(temporary, 'wx', 0o600)
  try { await handle.writeFile(JSON.stringify(value, null, 2)); await handle.sync() } finally { await handle.close() }
  await fs.rename(temporary, file)
}
const digest = bytes => createHash('sha256').update(bytes).digest('hex')
async function snapshotManifest(root) {
  if (!(await fs.lstat(root)).isDirectory()) throw Error('Rejected snapshot root must be a directory, not a symlink')
  const manifest = {}
  async function walk(directory) {
    for (const name of (await fs.readdir(directory)).sort()) {
      const file = path.join(directory, name), relative = path.relative(root, file)
      const stat = await fs.lstat(file)
      if (stat.isSymbolicLink()) throw Error('Rejected snapshot symlink forbidden')
      if (stat.isDirectory()) { manifest[relative] = { directory: true }; await walk(file) }
      else if (stat.isFile()) manifest[relative] = { sha256: digest(await fs.readFile(file)) }
      else throw Error('Rejected snapshot special file forbidden')
    }
  }
  await walk(root)
  return manifest
}
async function completeSnapshot(candidate, snapshot) {
  const source = path.join(candidate.worktreeDir, 'public/editions', candidate.editionId)
  const target = path.join(candidate.runDir, 'rejected-package')
  if (snapshot.source !== source || snapshot.target !== target || !snapshot.manifest || !['charged', 'ready'].includes(snapshot.phase)) throw Error('Rejected snapshot intent mismatch')
  // Only direct children of the exact retained package/run are admissible.
  if (path.dirname(source) !== path.join(candidate.worktreeDir, 'public/editions') || await fs.realpath(path.dirname(source)) !== path.join(await fs.realpath(candidate.worktreeDir), 'public/editions')) throw Error('Rejected snapshot source escapes candidate')
  if (await fs.realpath(path.dirname(target)) !== await fs.realpath(candidate.runDir)) throw Error('Rejected snapshot target escapes run')
  try { await fs.mkdir(target) } catch (error) { if (error.code !== 'EEXIST') throw error }
  if (!(await fs.lstat(target)).isDirectory()) throw Error('Rejected snapshot target symlink/type mismatch')
  for (const [relative, expected] of Object.entries(snapshot.manifest)) {
    if (path.isAbsolute(relative) || relative.split(/[\\/]/).some(p => !p || p === '..' || p === '.')) throw Error('Rejected snapshot manifest traversal')
    const file = path.join(target, relative)
    let stat
    try { stat = await fs.lstat(file) } catch (error) { if (error.code !== 'ENOENT') throw error }
    if (stat?.isSymbolicLink()) throw Error('Rejected snapshot symlink mismatch')
    if (expected.directory) {
      if (!stat) await fs.mkdir(file)
      else if (!stat.isDirectory()) throw Error('Rejected snapshot directory mismatch')
    } else {
      if (!stat) {
        // Missing bytes may be copied only from the frozen source, never from a
        // regenerated active package. Existing adverse evidence is never written.
        const original = path.join(source, relative)
        if (await fs.realpath(original) !== path.join(await fs.realpath(candidate.worktreeDir), 'public/editions', candidate.editionId, relative)) throw Error('Rejected snapshot source escapes candidate')
        if (!(await fs.lstat(original)).isFile() || digest(await fs.readFile(original)) !== expected.sha256) throw Error('Rejected snapshot source mismatch')
        await fs.copyFile(original, file, 1)
      } else if (!stat.isFile()) throw Error('Rejected snapshot file type mismatch')
      if (digest(await fs.readFile(file)) !== expected.sha256) throw Error('Rejected snapshot byte mismatch')
    }
  }
  if (!isDeepStrictEqual(await snapshotManifest(target), snapshot.manifest)) throw Error('Rejected snapshot manifest mismatch')
}
async function runtimeRevision(root) {
  const hash = createHash('sha256')
  const walk = async directory => {
    let entries
    try { entries = await fs.readdir(directory, { withFileTypes: true }) } catch (error) { if (error.code === 'ENOENT') return; throw error }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(directory, entry.name)
      if (entry.isDirectory()) await walk(file)
      else if (entry.isFile()) { hash.update(path.relative(root, file)); hash.update(await fs.readFile(file)) }
    }
  }
  await walk(path.join(root, 'src'))
  return hash.digest('hex')
}
export async function continueReviewedPublication(initial, { statePath, prepare, review, repair, publish, checkpoint = async () => {} }) {
  let state
  try { state = await read(statePath) } catch (error) { if (error.code !== 'ENOENT') throw error }
  if (!state) {
    state = { schema_version: 1, initial, current: initial, repairs: 0, blocked_plate_sha256: [], pending_repair: null }
    await save(statePath, state)
  }
  if (state.initial.worktreeDir !== initial.worktreeDir || ![state.initial.runDir, state.current.runDir].includes(initial.runDir)) throw Error('Conflicting day review owner/candidate; do not reset the aggregate budget')
  if (state.published) return { ...state.published, candidate: state.current }
  for (;;) {
    if (state.pending_runtime) {
      const revision = await runtimeRevision(initial.worktreeDir)
      if (revision === state.pending_runtime.runtime_sha256) throw Object.assign(Error('Runtime repair is unchanged; existing owner must fix the actual opened-source defect, never regenerate the plate or request another vote'), { code: 'REVIEW_RUNTIME_REPAIR', action: state.pending_runtime.action })
      const pending = state.pending_runtime
      const next = { ...state.current, runDir: pending.next_run_dir }
      await fs.mkdir(next.runDir, { recursive: true, mode: 0o700 })
      for (const name of ['daily-generation-payload.json', 'edition-package-summary.json', 'source-research.json', 'signal-harvest.json', 'bookmark-acquisition.json', 'source-intake-snapshot.json', 'source-fidelity-audit.json']) {
        try { await fs.copyFile(path.join(state.current.runDir, name), path.join(next.runDir, name), 1) } catch (error) { if (!['EEXIST', 'ENOENT'].includes(error.code)) throw error }
      }
      const payloadPath = path.join(next.runDir, 'daily-generation-payload.json')
      const payload = await read(payloadPath)
      payload.independent_runtime_repair = { rejected_run_dir: state.current.runDir, previous_runtime_sha256: pending.runtime_sha256, runtime_sha256: revision, critique: pending.action }
      await save(payloadPath, payload)
      const replacement = independentReviewExpectation(next)
      if (replacement.candidate_files['assets/plate.png'] !== pending.action.binding.candidate_files['assets/plate.png']) throw Error('Runtime-only repair unexpectedly changed the preserved good plate')
      await save(path.join(state.current.runDir, 'automatic-review-successor.json'), { disposition: 'REPLACED_AFTER_BLOCK', repair_kind: 'runtime-only', publication_authorized: false, successor: next, blocked_binding: pending.action.binding, replacement_binding: replacement, state_path: statePath })
      state.current = next; state.pending_runtime = null
      await save(statePath, state)
    }
    if (state.pending_repair) {
      const pending = state.pending_repair
      await completeSnapshot(state.current, pending.snapshot)
      if (pending.snapshot.phase !== 'ready') { pending.snapshot.phase = 'ready'; await save(statePath, state) }
      await checkpoint('independent-review-repair', state.current, pending.action)
      const replacement = await repair(state.current, pending.action, pending.next_run_dir)
      if (replacement.runDir !== pending.next_run_dir || replacement.worktreeDir !== initial.worktreeDir) throw Error('Repair must use the exact retained new run in the existing worktree')
      const nextBinding = independentReviewExpectation(replacement)
      if (state.blocked_plate_sha256.includes(nextBinding.candidate_files['assets/plate.png'])) throw Error('Unchanged rejected plate cannot be rerolled or relabelled toward PASS')
      const previous = pending.action.binding
      if (!isDeepStrictEqual(previous.source_owner, nextBinding.source_owner) || !isDeepStrictEqual(previous.source_contract, nextBinding.source_contract)) throw Error('Same-source repair changed owner/mandatory contract; requires separately admitted unused-source replacement under the original budget')
      await save(path.join(state.current.runDir, 'automatic-review-successor.json'), { disposition: 'REPLACED_AFTER_BLOCK', publication_authorized: false, successor: replacement, blocked_binding: previous, replacement_binding: nextBinding, state_path: statePath })
      state.current = replacement; state.pending_repair = null
      await save(statePath, state)
    }
    await checkpoint('qa-publish', state.current)
    await prepare(state.current)
    const binding = independentReviewExpectation(state.current)
    if (state.blocked_plate_sha256.includes(binding.candidate_files['assets/plate.png'])) throw Error('Unchanged rejected plate cannot be reviewed in another run')
    await checkpoint('independent-review', state.current)
    try {
      await ensureAutomaticReview(state.current, { ...(review ? { review } : {}) })
    } catch (error) {
      if (error.code !== 'INDEPENDENT_REVIEW_RECOVERY') throw error
      if (error.action.findings.some(row => row.status === 'uncertain')) {
        await checkpoint('independent-review-evidence-blocked', state.current, error.action)
        throw Object.assign(Error('Independent evidence is uncertain/unavailable; existing owner must repair exact evidence or resolve the real external dependency, never generate to evade uncertainty'), { code: 'REVIEW_EVIDENCE_BLOCKER', action: error.action })
      }
      // Charge BEFORE any generation/provider I/O. Restart never resets the cap.
      if (state.repairs >= 3) { await save(statePath, state); throw Error('Independent review hard repair limit exhausted (3); action/evidence retained, no publication authorized') }
      const sourceWindowFailure = error.action.findings.some(row => row.clause_id === 'source-window-visual-acceptance' && row.status !== 'fulfilled')
      const plateFailure = error.action.findings.some(row => row.clause_id !== 'source-window-visual-acceptance' && row.status !== 'fulfilled')
      state.repairs++
      if (sourceWindowFailure && !plateFailure) {
        state.pending_runtime = { action: error.action, runtime_sha256: await runtimeRevision(initial.worktreeDir), next_run_dir: `${state.initial.runDir}-runtime-repair-${state.repairs}` }
        await save(statePath, state)
        await checkpoint('independent-review-runtime-repair', state.current, error.action)
        throw Object.assign(Error('Opened-source/runtime repair required by existing press owner; preserve good plate, repair actual code then rerun same checkpoint; new independent review follows automatically'), { code: 'REVIEW_RUNTIME_REPAIR', action: error.action })
      }
      state.blocked_plate_sha256.push(binding.candidate_files['assets/plate.png'])
      const nextRunDir = `${state.initial.runDir}-review-repair-${state.repairs}`
      // Freeze expected bytes, then persist the charge/intent BEFORE snapshot
      // writes or adapter I/O. A restart completes only missing verified files.
      const source = path.join(state.current.worktreeDir, 'public/editions', state.current.editionId)
      state.pending_repair = { next_run_dir: nextRunDir, action: error.action, snapshot: {
        source, target: path.join(state.current.runDir, 'rejected-package'), phase: 'charged', manifest: await snapshotManifest(source),
      } }
      await save(statePath, state)
      continue
    }
    await checkpoint('commit-publish', state.current)
    const result = await publish(state.current)
    state.published = result
    await save(statePath, state)
    return { ...result, candidate: state.current }
  }
}
