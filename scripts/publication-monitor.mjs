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

async function main() {
  const diagnostic = process.argv.includes('--diagnostic')
  let manifest = null, error = null
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(`https://daily.nockgarden.com/editions/index.json?monitor=${Date.now()}`, { signal: AbortSignal.timeout(15000), headers: { 'Cache-Control': 'no-cache' } })
      if (!response.ok) throw new Error(`Manifest HTTP ${response.status}`)
      manifest = await response.json()
      break
    } catch (e) { error = e.message }
  }
  const result = { ...evaluatePublication(manifest, { deadline: process.env.DFE_PUBLICATION_DEADLINE || '07:00', expectedId: process.env.DFE_EXPECTED_EDITION_ID || null }), diagnostic, error: manifest ? null : error }
  // The edition's own identity is independent of index metadata. This is not
  // playback, image-fidelity, runtime-QA, or local machine heartbeat proof.
  if (result.status === 'published') {
    try {
      const response = await fetch(`https://daily.nockgarden.com/editions/${result.observed_id}/edition.json?monitor=${Date.now()}`, { signal: AbortSignal.timeout(15000) })
      if (!response.ok || (await response.json()).edition_id !== result.observed_id) throw new Error('Remote edition identity unavailable/mismatched')
      result.evidence = 'remote-manifest-and-edition'
    } catch (e) { result.status = 'unavailable'; result.error = e.message }
  }
  console.log(JSON.stringify(result, null, 2))
  if (process.env.GITHUB_STEP_SUMMARY) await fs.appendFile(process.env.GITHUB_STEP_SUMMARY, `## Publication monitor\n\n\`\`\`json\n${JSON.stringify(result, null, 2)}\n\`\`\`\n`)
  if (!['missed', 'unavailable'].includes(result.status) || diagnostic) return
  const repo = process.env.GITHUB_REPOSITORY
  if (!repo) throw new Error('GITHUB_REPOSITORY required for alerts')
  const title = `[Frontpage publication] ${result.expected_date}`
  const gh = args => execFileSync('gh', args, { encoding: 'utf8', timeout: 30000 })
  const issues = JSON.parse(gh(['issue', 'list', '--repo', repo, '--state', 'all', '--search', `${title} in:title`, '--json', 'number,title', '--limit', '100']))
  if (!issues.some(issue => issue.title === title)) {
    const url = gh(['issue', 'create', '--repo', repo, '--title', title, '--body', `Publication evidence missing after ${result.deadline} America/New_York.\n\nStart state UNKNOWN: no machine heartbeat exists. This does not prove the Mac failed to start.\n\n\`\`\`json\n${JSON.stringify(result, null, 2)}\n\`\`\`\n\nRun: https://github.com/${repo}/actions/runs/${process.env.GITHUB_RUN_ID}`]).trim()
    // Read back the exact newly created target before reporting delivery.
    console.log(gh(['issue', 'view', url, '--repo', repo, '--json', 'url,title,state']))
  }
  process.exitCode = 1 // Existing GitHub Actions notification channel as well.
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error); process.exitCode = 1 })
