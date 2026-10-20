import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { localPublicationDate } from './lib/cron-reliability.mjs'

export function evaluatePublication(manifest, { now = new Date(), deadline = '07:00', expectedId = null } = {}) {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(deadline)) throw new Error('Invalid publication deadline HH:mm')
  const expectedDate = localPublicationDate(now)
  const time = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now)
  const id = manifest?.current_edition_id
  const records = Array.isArray(manifest?.editions) ? manifest.editions : []
  const live = records.filter(entry => entry.is_live === true)
  const valid = typeof id === 'string' && /^\d{4}-\d{2}-\d{2}-[a-z0-9-]+-v\d+$/.test(id)
    && id.startsWith(`${expectedDate}-`) && (!expectedId || id === expectedId)
    && live.length === 1 && live[0].edition_id === id
    && records.filter(entry => entry.edition_id === id).length === 1
    && live[0].path === `/editions/${id}` && live[0].preview_asset_path === `/editions/${id}/assets/preview.png`
  return { expected_date: expectedDate, expected_id: expectedId, observed_id: id || null, deadline, timezone: 'America/New_York', status: valid ? 'published' : time < deadline ? 'before-deadline' : manifest ? 'missed' : 'unavailable', start_state: 'unknown-no-heartbeat', evidence: manifest ? 'remote-manifest' : 'remote-unavailable', checked_at: now.toISOString() }
}

const site = 'https://daily.nockgarden.com'
const requestHeaders = { 'Cache-Control': 'no-cache', 'User-Agent': 'DailyFrontpageCronRemoteVerify/1.0', Accept: 'application/json' }

async function fetchRemoteJson(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(15000), headers: requestHeaders })
  if (!response.ok) throw new Error(`HTTP ${response.status}; server=${response.headers.get('server') || 'unknown'}; body=${(await response.text()).slice(0, 500)}`)
  return response.json()
}

export async function checkPublication({ now = new Date(), deadline = '07:00', expectedId = null, fetchJson = fetchRemoteJson } = {}) {
  let manifest = null, error = null
  for (let attempt = 0; attempt < 3; attempt++) {
    try { manifest = await fetchJson(`${site}/editions/index.json?monitor=${now.getTime()}-${attempt}`); break } catch (e) { error = `Manifest ${e.message}` }
  }
  const result = { ...evaluatePublication(manifest, { now, deadline, expectedId }), error: manifest ? null : error }
  // The edition's own identity is independent of index metadata. This is not
  // playback, image-fidelity, runtime-QA, or local machine heartbeat proof.
  if (result.status === 'published') {
    try {
      if ((await fetchJson(`${site}/editions/${result.observed_id}/edition.json?monitor=${now.getTime()}`)).edition_id !== result.observed_id) throw new Error('Remote edition identity mismatched')
      result.evidence = 'remote-manifest-and-edition'
    } catch (e) {
      // A transient edition fetch failure is only an incident after the deadline.
      result.status = evaluatePublication(null, { now, deadline }).status === 'before-deadline' ? 'before-deadline' : 'unavailable'
      result.error = e.message
    }
  }
  return result
}

export const productionIssueTitle = date => `[Frontpage publication] ${date}`
export const diagnosticIssueTitle = date => `[Frontpage publication DIAGNOSTIC] ${date}`

// Every issue (open and closed, all pages; pull requests excluded) through the
// REST list API, not search: no index lag and no recency cap on dedup. Each
// request carries a unique nonce and no-cache so no cached page is reused.
let listNonce = 0
function exactTitleIssues(gh, repo, title) {
  return gh(['api', '--paginate', '-X', 'GET', `repos/${repo}/issues`, '-H', 'Cache-Control: no-cache',
    '-f', 'state=all', '-f', 'per_page=100', '-f', `monitor_nonce=${Date.now()}-${process.pid}-${++listNonce}`,
    '--jq', '.[] | select(.pull_request == null) | {number, title, state, url: .html_url}'])
    .split('\n').filter(line => line.trim()).map(line => JSON.parse(line))
    .filter(issue => issue.title === title).map(issue => ({ ...issue, state: String(issue.state).toUpperCase() }))
}

const sleepSync = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
export const defaultVisibility = { attempts: 8, delayMs: 1500 }

// The REST list lagged a fresh create in deployed run 39165196866, so a later
// reconcile duplicated the issue. Reading back the target by number does not
// prove the list is fresh: success requires the list itself to show exactly
// the written issue in its new state, within bounded waits, else fail closed.
function confirmListed(gh, repo, title, issue, { wait = sleepSync, visibility = defaultVisibility } = {}) {
  let last = []
  for (let attempt = 1; attempt <= visibility.attempts; attempt++) {
    last = exactTitleIssues(gh, repo, title)
    if (last.length === 1 && last[0].number === issue.number && last[0].state === issue.state) return { attempts: attempt }
    if (attempt < visibility.attempts) wait(visibility.delayMs)
  }
  throw new Error(`Issue #${issue.number} ${issue.state} not visible in exact-title list for ${title} after ${visibility.attempts} attempts; listed: ${JSON.stringify(last.map(({ number, state }) => ({ number, state })))}`)
}

// One exact-title issue per date. Open or reopen on a real miss, close only on
// full remote manifest+edition evidence. Duplicates fail closed.
export function reconcileIssue({ repo, title, result, gh, runUrl = null, diagnostic = false, wait, visibility, subject = 'Publication' }) {
  // Read back the exact target, then require list visibility before reporting delivery.
  const view = number => {
    const issue = JSON.parse(gh(['issue', 'view', String(number), '--repo', repo, '--json', 'number,title,state,url']))
    return { ...issue, list_visibility: confirmListed(gh, repo, title, issue, { wait, visibility }) }
  }
  const matches = exactTitleIssues(gh, repo, title)
  if (matches.length > 1) throw new Error(`Ambiguous exact-title issues for ${title}: ${matches.map(issue => issue.number).join(', ')}`)
  const [existing] = matches
  const evidence = `\`\`\`json\n${JSON.stringify(result, null, 2)}\n\`\`\`${runUrl ? `\n\nRun: ${runUrl}` : ''}`
  const label = diagnostic ? 'DIAGNOSTIC exercise (injected; not a production incident). ' : ''
  if (['missed', 'unavailable'].includes(result.status)) {
    if (!existing) {
      const url = gh(['issue', 'create', '--repo', repo, '--title', title, '--body', `${label}${subject} evidence missing after ${result.deadline} America/New_York.\n\nStart state UNKNOWN: no machine heartbeat exists. This does not prove the Mac failed to start.\n\n${evidence}`]).trim()
      return { action: 'created', issue: view(url) }
    }
    if (existing.state === 'OPEN') return { action: 'existing-open', issue: existing }
    gh(['issue', 'reopen', String(existing.number), '--repo', repo, '--comment', `${label}${subject} evidence missing again.\n\n${evidence}`])
    return { action: 'reopened', issue: view(existing.number) }
  }
  if (result.status === 'published' && result.evidence === 'remote-manifest-and-edition' && existing?.state === 'OPEN') {
    gh(['issue', 'close', String(existing.number), '--repo', repo, '--comment', `${label}Publication verified: ${result.observed_id} (remote manifest and exact edition identity).\n\n${evidence}`])
    return { action: 'closed', issue: view(existing.number) }
  }
  return { action: 'none', issue: existing || null }
}

// Exercises the production reconciliation against a DIAGNOSTIC-titled issue.
// Production titles are never passed here, so no false incident can be raised.
export function exerciseIssueReconciliation({ repo, gh, now = new Date(), runUrl = null, wait, visibility }) {
  const date = localPublicationDate(now)
  const title = diagnosticIssueTitle(date)
  if (title === productionIssueTitle(date)) throw new Error('Diagnostic title collides with production')
  const injected = { expected_date: date, deadline: '07:00', timezone: 'America/New_York', status: 'missed', start_state: 'unknown-no-heartbeat', evidence: 'injected-diagnostic', injected: true, diagnostic: true, checked_at: now.toISOString() }
  const first = reconcileIssue({ repo, title, result: injected, gh, runUrl, diagnostic: true, wait, visibility })
  const second = reconcileIssue({ repo, title, result: injected, gh, runUrl, diagnostic: true, wait, visibility })
  const exactTitleMatches = exactTitleIssues(gh, repo, title).length
  const close = reconcileIssue({ repo, title, result: { ...injected, status: 'published', evidence: 'remote-manifest-and-edition', observed_id: `${date}-diagnostic-exercise-v1` }, gh, runUrl, diagnostic: true, wait, visibility })
  const readback = JSON.parse(gh(['issue', 'view', String(close.issue?.number ?? first.issue.number), '--repo', repo, '--json', 'number,title,state,url']))
  // existing-open first: a previous exercise crashed before closing; still one issue.
  const ok = ['created', 'reopened', 'existing-open'].includes(first.action) && second.action === 'existing-open' && exactTitleMatches === 1
    && close.action === 'closed' && readback.title === title && readback.state === 'CLOSED'
  return { mode: 'exercise-issue', title, date, first, second, exact_title_matches: exactTitleMatches, close, readback, ok, recorded_at: new Date().toISOString() }
}

async function main() {
  const mode = process.argv.includes('--exercise-issue') ? 'exercise-issue' : process.argv.includes('--diagnostic') ? 'diagnostic' : 'production'
  const repo = process.env.GITHUB_REPOSITORY
  const runUrl = repo && process.env.GITHUB_RUN_ID ? `https://github.com/${repo}/actions/runs/${process.env.GITHUB_RUN_ID}` : null
  const gh = args => execFileSync('gh', args, { encoding: 'utf8', timeout: 30000 })
  const report = async value => {
    console.log(JSON.stringify(value, null, 2))
    if (process.env.DFE_MONITOR_EVIDENCE_PATH) await fs.writeFile(process.env.DFE_MONITOR_EVIDENCE_PATH, JSON.stringify(value, null, 2) + '\n')
    if (process.env.GITHUB_STEP_SUMMARY) await fs.appendFile(process.env.GITHUB_STEP_SUMMARY, `## Publication monitor (${mode})\n\n\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\`\n`)
  }
  if (mode === 'exercise-issue') {
    if (!repo) throw new Error('GITHUB_REPOSITORY required for the diagnostic issue exercise')
    const evidence = exerciseIssueReconciliation({ repo, gh, runUrl })
    await report(evidence)
    if (!evidence.ok) process.exitCode = 1
    return
  }
  const result = { ...await checkPublication({ deadline: process.env.DFE_PUBLICATION_DEADLINE || '07:00', expectedId: process.env.DFE_EXPECTED_EDITION_ID || null }), diagnostic: mode === 'diagnostic' }
  if (mode === 'diagnostic' || result.status === 'before-deadline') return report(result)
  if (!repo) throw new Error('GITHUB_REPOSITORY required for alerts')
  result.issue = reconcileIssue({ repo, title: productionIssueTitle(result.expected_date), result, gh, runUrl })
  await report(result)
  if (['missed', 'unavailable'].includes(result.status)) process.exitCode = 1 // Existing GitHub Actions notification channel as well.
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error); process.exitCode = 1 })
