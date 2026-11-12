import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { independentReviewExpectation } from './independent-visual-review.mjs'
import { isDeepStrictEqual } from 'node:util'

// Compare existing filesystem identities, never rewrite retained evidence paths.
export async function sameExistingPath(a, b) {
  return typeof a === 'string' && typeof b === 'string' && await fs.realpath(a) === await fs.realpath(b)
}

// Follow only explicit, byte-bound replacement links. This normalizes old
// checkpoints without deleting them or letting failed candidates win by mtime.
export async function resolveReviewContinuation(summary, worktree) {
  if (!summary.review_continuation_state || summary.push_succeeded === true) return summary
  const state = JSON.parse(await fs.readFile(summary.review_continuation_state, 'utf8'))
  if (state.schema_version !== 1 || !await sameExistingPath(state.initial?.worktreeDir, worktree) || !await sameExistingPath(state.current?.worktreeDir, worktree) || !Number.isInteger(state.repairs) || state.repairs < 0 || state.repairs > 3) throw Error('Malformed review continuation owner state')
  let run = summary.latest_run_dir
  for (let i = 0; !await sameExistingPath(run, state.current.runDir) && i < 3; i++) {
    const link = JSON.parse(await fs.readFile(path.join(run, 'automatic-review-successor.json'), 'utf8'))
    const review = link.repair_kind === 'runtime-only' ? JSON.parse(await fs.readFile(path.join(run, 'independent-visual-review.json'), 'utf8')) : null
    const runtimeOnly = review?.verdict === 'BLOCK' && isDeepStrictEqual(review.binding, link.blocked_binding)
      && review.findings.some(row => row.clause_id === 'source-window-visual-acceptance' && row.status !== 'fulfilled')
      && review.findings.filter(row => row.clause_id !== 'source-window-visual-acceptance').every(row => row.status === 'fulfilled')
    if (link.disposition !== 'REPLACED_AFTER_BLOCK' || link.publication_authorized !== false || !await sameExistingPath(link.state_path, summary.review_continuation_state)
      || !await sameExistingPath(link.blocked_binding?.run_dir, run) || (!runtimeOnly && !state.blocked_plate_sha256.includes(link.blocked_binding.candidate_files['assets/plate.png']))
      || !await sameExistingPath(link.successor?.worktreeDir, worktree)) throw Error('Invalid explicit rejected-candidate successor')
    run = link.successor.runDir
    if (await sameExistingPath(run, state.current.runDir) && !isDeepStrictEqual(link.replacement_binding, independentReviewExpectation(state.current))) throw Error('Changed replacement candidate; preserve original BLOCK')
  }
  if (!await sameExistingPath(run, state.current.runDir)) throw Error('Review continuation successor chain missing or over hard limit')
  return { ...summary, latest_run_dir: state.current.runDir, local_edition_id: state.current.editionId }
}

const execFileAsync = promisify(execFile)

export function localPublicationDate(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}

export async function assertDiskHeadroom(target, { requiredBytes = 5 * 1024 ** 3, statfs = fs.statfs } = {}) {
  if (!Number.isSafeInteger(requiredBytes) || requiredBytes < 0) throw new Error('Invalid disk headroom requirement')
  let root = path.resolve(target)
  let stats
  for (;;) {
    try { stats = await statfs(root); break } catch (error) {
      if (error.code !== 'ENOENT' || root === path.dirname(root)) throw error
      root = path.dirname(root)
    }
  }
  const available = Number(stats.bavail) * Number(stats.bsize)
  if (!Number.isFinite(available) || available < requiredBytes) throw new Error(`Insufficient disk headroom: available=${available} required=${requiredBytes}; evidence retained`)
  return { available, requiredBytes }
}

export async function evidenceBytes(target) {
  let stat
  try { stat = await fs.lstat(target) } catch (error) { if (error.code === 'ENOENT') return 0; throw error }
  if (!stat.isDirectory()) return stat.size
  let bytes = stat.size
  for (const child of await fs.readdir(target)) bytes += await evidenceBytes(path.join(target, child))
  return bytes
}

function collapseRecoveryRecords(records) {
  // Collapse successive proof/recovery invocations of the exact same run.
  const groups = new Map()
  for (const record of records) {
    const s = record.summary
    const key = s.latest_run_dir || record.file
    const previous = groups.get(key)
    if (previous) {
      const p = previous.summary
      if ((p.local_edition_id && s.local_edition_id && p.local_edition_id !== s.local_edition_id)
        || (p.commit && s.commit && p.commit !== s.commit)) throw new Error('Conflicting recovery identity for the same retained run')
    }
    // A verified publication stays resolved: a later failed proof of the same
    // run (expired gh auth, CDN outage, newer edition live) cannot reopen it.
    const verified = r => r.summary.ok === true && r.summary.push_succeeded === true
    if (!previous || (verified(record) && !verified(previous))
      || (verified(record) === verified(previous) && String(s.updated_at || '') > String(previous.summary.updated_at || ''))) groups.set(key, record)
  }
  return [...groups.values()]
}

export function selectRecovery(records, expectedDate) {
  // Failures before any package or push (fetch/disk/discovery errors, or a
  // generation that never packaged) carry nothing to resume or prove. They stay
  // on disk as evidence but are not candidates, so they cannot block or multiply.
  const pending = collapseRecoveryRecords(records)
    .filter(({ summary: s }) => s.local_edition_id || s.push_succeeded === true)
    .filter(({ summary: s }) => s.ok !== true || s.local_edition_id?.startsWith(expectedDate))
    // A prior day's edition that was already pushed is published. Its failed
    // post-push proof cannot be repaired by today's press, so it stays on disk
    // as evidence but must not stop today's edition from being made.
    .filter(({ summary: s }) => !(s.push_succeeded === true && s.local_edition_id && !s.local_edition_id.startsWith(`${expectedDate}-`)))
  if (!pending.length) return {}
  if (pending.length !== 1) throw new Error('ambiguous recovery checkpoints; preserve evidence and reconcile explicitly')
  const { file, summary: s } = pending[0]
  if (!s.local_edition_id?.startsWith(`${expectedDate}-`)) throw new Error('Recovery date boundary or missing candidate identity; explicit operator recovery required')
  if (s.push_succeeded === true) {
    if (!/^[a-f0-9]{40}$/.test(s.commit || '')) throw new Error('Malformed pushed recovery identity')
    return { proofOnly: file }
  }
  if (!s.latest_run_dir || !s.worktree_dir) throw new Error('Missing exact candidate identity')
  return { resumeCandidate: file }
}

export async function discoverRecovery(directory, expectedDate, worktree, { verifyDescendant = async (ancestor, descendant) => {
  try {
    await execFileAsync('git', ['merge-base', '--is-ancestor', ancestor, descendant], { cwd: worktree, timeout: 10000 })
    return true
  } catch { return false }
} } = {}) {
  const records = []
  // Proof-only runs write beneath their own worktree. Read both exact stores
  // before refresh so an accepted recovery is not lost on the following day.
  const stores = new Set([path.resolve(directory), path.resolve(worktree, 'tmp/cron-checkpoints')])
  for (const store of stores) {
    let names
    try { names = await fs.readdir(store) } catch (error) { if (error.code === 'ENOENT') continue; throw error }
    for (const name of names.filter(name => name.endsWith('.json')).sort()) {
      let file = path.join(store, name)
      const bytes = await fs.readFile(file, 'utf8')
      const summary = JSON.parse(bytes)
      if (summary.push_succeeded !== true && !await sameExistingPath(summary.worktree_dir, worktree)) continue
      if (store !== path.resolve(directory)) {
        // Retain exact checkpoint bytes outside the disposable worktree before
        // refresh. Never overwrite another invocation with the same filename.
        await fs.mkdir(directory, { recursive: true })
        const retained = path.join(path.resolve(directory), name)
        try { await fs.writeFile(retained, bytes, { flag: 'wx' }) } catch (error) {
          if (error.code !== 'EEXIST') throw error
          if (await fs.readFile(retained, 'utf8') !== bytes) throw new Error('Conflicting retained checkpoint bytes')
        }
        file = retained
        if (records.some(r => r.file === file)) continue
      }
      if (!summary.local_edition_id && summary.latest_run_dir) {
        const root = path.join(path.resolve(worktree), 'tmp', 'daily-process-runs') + path.sep
        if (!summary.latest_run_dir.startsWith(root) || path.resolve(summary.latest_run_dir) !== summary.latest_run_dir) throw new Error('Unsafe candidate run identity')
        try {
          const pkg = JSON.parse(await fs.readFile(path.join(summary.latest_run_dir, 'edition-package-summary.json'), 'utf8'))
          summary.local_edition_id = pkg.edition_id
        } catch (error) { if (error.code !== 'ENOENT') throw error }
      }
      records.push({ file, summary })
    }
  }
  // A runtime-only repair may explicitly supersede its publication commit.
  // Require the exact retained parent, unchanged candidate identity and real
  // Git ancestry. Never infer supersession from timestamps or a matching date.
  const superseded = new Set()
  for (const repair of records) {
    const s = repair.summary
    if (!s.original_checkpoint || !s.original_publication_commit) continue
    const original = records.find(r => r.file === s.original_checkpoint)
    const p = original?.summary
    if (!p || !p.local_edition_id || p.local_edition_id !== s.local_edition_id
      || !p.latest_run_dir || p.latest_run_dir !== s.latest_run_dir
      || p.worktree_dir !== s.worktree_dir || p.push_succeeded !== true || s.push_succeeded !== true
      || p.commit !== s.original_publication_commit || p.commit === s.commit
      || !/^[a-f0-9]{40}$/.test(p.commit || '') || !/^[a-f0-9]{40}$/.test(s.commit || '')) continue
    if (await verifyDescendant(p.commit, s.commit)) superseded.add(original.file)
  }
  const eligible = records.filter(r => !superseded.has(r.file))
  // Read and reconcile both stores before touching disposable run paths. An
  // accepted exact-run proof can outlive refresh; obsolete failed invocations
  // must not reopen it. Do not collapse unresolved continuation records early:
  // each still needs its normal byte-bound successor/BLOCK validation.
  const completed = new Map(collapseRecoveryRecords(eligible)
    .filter(({ summary: s }) => s.ok === true && s.push_succeeded === true && s.remote_matches === true
      && /^[a-f0-9]{40}$/.test(s.commit || '') && /^\d{4}-\d{2}-\d{2}-[a-z0-9-]+-v\d+$/.test(s.local_edition_id || '')
      && s.latest_run_dir && s.worktree_dir)
    .map(r => [r.summary.latest_run_dir, r]))
  const normalized = []
  for (const record of eligible) {
    const accepted = completed.get(record.summary.latest_run_dir)
    if (accepted && accepted !== record) {
      if (record.summary.worktree_dir !== accepted.summary.worktree_dir) throw new Error('Conflicting recovery worktree identity for the same retained run')
      continue
    }
    normalized.push({ ...record, summary: await resolveReviewContinuation(record.summary, worktree) })
  }
  return selectRecovery(normalized, expectedDate)
}

export function publicationOutcome(summary, expectedDate) {
  const verified = summary.push_succeeded === true && summary.remote_matches === true
  const value = {
    schema_version: 1, expected_date: expectedDate,
    edition_id: summary.local_edition_id || null, commit: summary.commit || null,
    execution: summary.ok === true ? 'succeeded' : 'failed',
    publication: verified ? (summary.local_edition_id?.startsWith(`${expectedDate}-`) ? 'verified' : 'other-date') : 'unverified',
    scheduler_delivery: 'unknown', agent_delivery: 'unknown',
    checkpoint_path: summary.checkpoint_path, recorded_at: new Date().toISOString(),
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expectedDate) || (value.commit !== null && !/^[a-f0-9]{40}$/.test(value.commit)) || (verified && !/^\d{4}-\d{2}-\d{2}-[a-z0-9-]+-v\d+$/.test(value.edition_id || ''))) throw new Error('Invalid publication outcome schema')
  return value
}

export async function writePublicationOutcome(file, summary, expectedDate) {
  const outcome = publicationOutcome(summary, expectedDate)
  await fs.mkdir(path.dirname(file), { recursive: true })
  const temporary = `${file}.${randomUUID()}.tmp`
  await fs.writeFile(temporary, JSON.stringify(outcome, null, 2) + '\n', { flag: 'wx' })
  await fs.rename(temporary, file)
}

// Standalone `daily:process --publish` shares the cron's generation headroom
// guard; dry runs and existing-mode remaps are not gated here.
export async function assertPublishDiskHeadroom(options, root, { check = assertDiskHeadroom } = {}) {
  if (options.mode === 'existing' || options.publish !== true) return false
  await check(root, { requiredBytes: 5 * 1024 ** 3 })
  return true
}
