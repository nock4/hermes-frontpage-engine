import { it, expect } from 'vitest'
import { evaluatePublication } from '../../scripts/publication-monitor.mjs'
it('uses Eastern deadline through winter, summer and DST changes', () => {
  for (const [before, after] of [['2026-10-18T10:59Z','2026-10-18T11:00Z'], ['2026-12-18T11:59Z','2026-12-18T12:00Z'], ['2026-03-08T10:59Z','2026-03-08T11:00Z'], ['2026-11-01T11:59Z','2026-11-01T12:00Z']]) {
    expect(evaluatePublication(null, { now: new Date(before) }).status).toBe('before-deadline')
    expect(evaluatePublication(null, { now: new Date(after) }).status).toBe('unavailable')
  }
})
it('requires exact current record/date, never claims machine start', () => {
  const now = new Date('2026-10-18T12:00Z')
  const id = '2026-10-18-art-v1'
  const manifest = { current_edition_id: id, editions: [{ edition_id: id, is_live: true, path: `/editions/${id}`, preview_asset_path: `/editions/${id}/assets/preview.png` }] }
  expect(evaluatePublication(manifest, { now }).status).toBe('published')
  expect(evaluatePublication({ ...manifest, current_edition_id: '2026-10-17-art-v1' }, { now }).status).toBe('missed')
  expect(evaluatePublication(manifest, { now }).start_state).toBe('unknown-no-heartbeat')
  expect(() => evaluatePublication(manifest, { now, deadline: '25:00' })).toThrow()
})

import { describe } from 'vitest'
import { checkPublication, reconcileIssue, exerciseIssueReconciliation, productionIssueTitle, diagnosticIssueTitle } from '../../scripts/publication-monitor.mjs'

const liveManifest = id => ({ current_edition_id: id, editions: [{ edition_id: id, is_live: true, path: `/editions/${id}`, preview_asset_path: `/editions/${id}/assets/preview.png` }] })

// In-memory gh stand-in: exact title list over open+closed, create/reopen/close/view.
function fakeGh(seed = []) {
  const issues = seed.map((issue, index) => ({ number: index + 1, url: `https://github.com/o/r/issues/${index + 1}`, ...issue }))
  const calls = []
  const gh = args => {
    calls.push(args)
    const [, verb] = args
    if (args[0] === 'api') {
      // Emulates `gh api --paginate ... --jq '.[] | select(.pull_request == null) | {...}'`: NDJSON over every page.
      if (!args.includes('--paginate')) throw new Error('issue listing must paginate')
      return issues.filter(issue => !issue.pull_request).map(({ number, title, state, url }) => JSON.stringify({ number, title, state: state.toLowerCase(), url })).join('\n') + '\n'
    }
    if (verb === 'list') throw new Error('capped gh issue list must not be used for dedup')
    if (verb === 'create') {
      const issue = { number: issues.length + 1, title: args[args.indexOf('--title') + 1], state: 'OPEN', body: args[args.indexOf('--body') + 1] }
      issue.url = `https://github.com/o/r/issues/${issue.number}`
      issues.push(issue)
      return `${issue.url}\n`
    }
    const issue = issues.find(entry => String(entry.number) === String(args[2]) || entry.url === args[2])
    if (verb === 'reopen') issue.state = 'OPEN'
    if (verb === 'close') issue.state = 'CLOSED'
    return JSON.stringify({ number: issue.number, title: issue.title, state: issue.state, url: issue.url })
  }
  return { gh, issues, calls }
}

describe('pre-deadline edition fetch failures', () => {
  it('does not alert before the deadline when today is listed but edition.json is temporarily unavailable', async () => {
    const id = '2026-12-18-art-v1'
    const fetchJson = async url => { if (url.includes('index.json')) return liveManifest(id); throw new Error('edition 503') }
    const early = await checkPublication({ now: new Date('2026-12-18T11:17Z'), fetchJson })
    expect(early.status).toBe('before-deadline')
    const late = await checkPublication({ now: new Date('2026-12-18T12:17Z'), fetchJson })
    expect(late.status).toBe('unavailable')
  })
})

describe('issue reconciliation', () => {
  const missed = { status: 'missed', expected_date: '2026-10-18', deadline: '07:00' }
  const published = { status: 'published', evidence: 'remote-manifest-and-edition', expected_date: '2026-10-18', observed_id: '2026-10-18-art-v1' }
  const title = productionIssueTitle('2026-10-18')
  it('creates once per exact date and never duplicates on repeated checks', () => {
    const f = fakeGh([{ title: '[Frontpage publication] 2026-10-18 follow-up', state: 'OPEN' }])
    expect(reconcileIssue({ repo: 'o/r', title, result: missed, gh: f.gh }).action).toBe('created')
    expect(reconcileIssue({ repo: 'o/r', title, result: missed, gh: f.gh }).action).toBe('existing-open')
    expect(f.issues.filter(issue => issue.title === title)).toHaveLength(1)
  })
  it('reopens a closed same-date issue for a later real miss instead of staying silent', () => {
    const f = fakeGh([{ title, state: 'CLOSED' }])
    const out = reconcileIssue({ repo: 'o/r', title, result: missed, gh: f.gh })
    expect(out.action).toBe('reopened')
    expect(out.issue.state).toBe('OPEN')
    expect(f.issues).toHaveLength(1)
  })
  it('closes the real incident once actual publication is healthy and reads it back', () => {
    const f = fakeGh([{ title, state: 'OPEN' }])
    const out = reconcileIssue({ repo: 'o/r', title, result: published, gh: f.gh })
    expect(out.action).toBe('closed')
    expect(out.issue).toMatchObject({ title, state: 'CLOSED' })
    expect(reconcileIssue({ repo: 'o/r', title, result: published, gh: f.gh }).action).toBe('none')
  })
  it('does not close an incident from manifest-only evidence or open one before the deadline', () => {
    const f = fakeGh([{ title, state: 'OPEN' }])
    expect(reconcileIssue({ repo: 'o/r', title, result: { ...published, evidence: 'remote-manifest' }, gh: f.gh }).action).toBe('none')
    expect(reconcileIssue({ repo: 'o/r', title: productionIssueTitle('2026-10-19'), result: { ...missed, status: 'before-deadline' }, gh: f.gh }).action).toBe('none')
    expect(f.issues).toHaveLength(1)
  })
  it('fails closed on ambiguous exact-title duplicates', () => {
    const f = fakeGh([{ title, state: 'OPEN' }, { title, state: 'CLOSED' }])
    expect(() => reconcileIssue({ repo: 'o/r', title, result: missed, gh: f.gh })).toThrow(/ambiguous/i)
  })
})

describe('diagnostic issue exercise', () => {
  it('uses a DIAGNOSTIC title, proves exact-date dedup twice, closes and reads back without touching production', () => {
    const production = productionIssueTitle('2026-10-18')
    const f = fakeGh([{ title: production, state: 'CLOSED' }])
    const evidence = exerciseIssueReconciliation({ repo: 'o/r', gh: f.gh, now: new Date('2026-10-18T16:00Z'), runUrl: 'https://example/run' })
    const title = diagnosticIssueTitle('2026-10-18')
    expect(title).toMatch(/DIAGNOSTIC/)
    expect(title).not.toBe(production)
    expect(evidence.title).toBe(title)
    expect(evidence.first.action).toBe('created')
    expect(evidence.second.action).toBe('existing-open')
    expect(evidence.exact_title_matches).toBe(1)
    expect(evidence.close.action).toBe('closed')
    expect(evidence.readback).toMatchObject({ title, state: 'CLOSED' })
    expect(evidence.ok).toBe(true)
    expect(f.issues.find(issue => issue.title === title).body).toMatch(/DIAGNOSTIC/)
    // Production issue for the same date was neither reopened nor commented.
    expect(f.issues.find(issue => issue.title === production).state).toBe('CLOSED')
    expect(f.calls.every(args => !args.includes(String(f.issues.find(issue => issue.title === production).number)))).toBe(true)
    // Re-running the exercise on the same date reopens the exact diagnostic issue rather than duplicating it.
    const again = exerciseIssueReconciliation({ repo: 'o/r', gh: f.gh, now: new Date('2026-10-18T17:00Z'), runUrl: 'https://example/run2' })
    expect(again.first.action).toBe('reopened')
    expect(f.issues.filter(issue => issue.title === title)).toHaveLength(1)
  })
})

import fsSync from 'node:fs'
it('keeps one monitor workflow whose manual default is read-only and exercise mode is explicit', () => {
  const dir = '.github/workflows'
  const monitors = fsSync.readdirSync(dir).filter(name => fsSync.readFileSync(`${dir}/${name}`, 'utf8').includes('publication-monitor.mjs'))
  expect(monitors).toEqual(['publication-deadline-monitor.yml'])
  const yml = fsSync.readFileSync(`${dir}/publication-deadline-monitor.yml`, 'utf8')
  expect(yml).toMatch(/default: diagnostic/)
  expect(yml).toMatch(/exercise-issue\) node scripts\/publication-monitor\.mjs --exercise-issue/)
  expect(yml).toMatch(/\*\) node scripts\/publication-monitor\.mjs --diagnostic/)
  expect(yml).toMatch(/inputs\.mode \|\| 'production'/)
})

describe('exhaustive exact-date dedup and exercise restart', () => {
  it('finds an exact-title issue beyond the first 200 issues and ignores pull requests', () => {
    const title = productionIssueTitle('2026-03-02')
    const seed = Array.from({ length: 450 }, (_, i) => ({ title: `Other ${i}`, state: 'CLOSED' }))
    seed[3] = { title, state: 'CLOSED' }
    seed[420] = { title: productionIssueTitle('2026-03-03'), state: 'OPEN', pull_request: {} }
    const f = fakeGh(seed)
    const out = reconcileIssue({ repo: 'o/r', title, result: { status: 'missed', expected_date: '2026-03-02', deadline: '07:00' }, gh: f.gh })
    expect(out.action).toBe('reopened')
    expect(f.issues).toHaveLength(450)
    expect(f.calls.some(args => args.includes('--limit'))).toBe(false)
  })
  it('accepts an exercise restart whose DIAGNOSTIC issue was left open by a crashed run', () => {
    const title = diagnosticIssueTitle('2026-10-18')
    const f = fakeGh([{ title, state: 'OPEN' }])
    const evidence = exerciseIssueReconciliation({ repo: 'o/r', gh: f.gh, now: new Date('2026-10-18T16:00Z') })
    expect(evidence.first.action).toBe('existing-open')
    expect(evidence.ok).toBe(true)
    expect(evidence.readback.state).toBe('CLOSED')
    expect(f.issues.filter(issue => issue.title === title)).toHaveLength(1)
  })
})
