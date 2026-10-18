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
// staleLists: after each write, the next N list calls return the pre-write
// snapshot (the REST list lag seen in deployed run 39165196866).
function fakeGh(seed = [], { staleLists = 0 } = {}) {
  const issues = seed.map((issue, index) => ({ number: index + 1, url: `https://github.com/o/r/issues/${index + 1}`, ...issue }))
  const calls = []
  let snapshot = null, staleRemaining = 0
  const gh = args => {
    calls.push(args)
    const [, verb] = args
    if (args[0] === 'api') {
      // Emulates `gh api --paginate ... --jq '.[] | select(.pull_request == null) | {...}'`: NDJSON over every page.
      if (!args.includes('--paginate')) throw new Error('issue listing must paginate')
      const listed = staleRemaining > 0 ? (staleRemaining--, snapshot) : issues
      return listed.filter(issue => !issue.pull_request).map(({ number, title, state, url }) => JSON.stringify({ number, title, state: state.toLowerCase(), url })).join('\n') + '\n'
    }
    if (['create', 'reopen', 'close'].includes(verb) && staleLists > 0 && staleRemaining === 0) {
      snapshot = issues.map(issue => ({ ...issue }))
      staleRemaining = staleLists
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

describe('stale REST list after writes (deployed run 39165196866)', () => {
  const title = diagnosticIssueTitle('2026-10-18')
  const now = new Date('2026-10-18T16:00Z')
  const waits = []
  const wait = ms => waits.push(ms)
  it('creates exactly once and closes the same issue when the list briefly lags each write', () => {
    waits.length = 0
    const f = fakeGh([], { staleLists: 2 })
    const evidence = exerciseIssueReconciliation({ repo: 'o/r', gh: f.gh, now, wait })
    expect(f.calls.filter(args => args[1] === 'create')).toHaveLength(1)
    expect(f.issues.filter(issue => issue.title === title)).toHaveLength(1)
    expect(evidence.first.action).toBe('created')
    expect(evidence.second.action).toBe('existing-open')
    expect(evidence.exact_title_matches).toBe(1)
    expect(evidence.close).toMatchObject({ action: 'closed', issue: { number: 1, state: 'CLOSED' } })
    expect(evidence.ok).toBe(true)
    expect(waits.length).toBeGreaterThan(0)
  })
  it('confirms list visibility after reopen and close too', () => {
    waits.length = 0
    const f = fakeGh([{ title, state: 'CLOSED' }], { staleLists: 1 })
    const reopened = reconcileIssue({ repo: 'o/r', title, result: { status: 'missed', deadline: '07:00' }, gh: f.gh, wait })
    expect(reopened.action).toBe('reopened')
    expect(waits).toHaveLength(1)
    const closed = reconcileIssue({ repo: 'o/r', title, result: { status: 'published', evidence: 'remote-manifest-and-edition', observed_id: 'x' }, gh: f.gh, wait })
    expect(closed.action).toBe('closed')
    expect(waits).toHaveLength(2)
  })
  it('fails closed after bounded waits when the write never becomes list-visible', () => {
    waits.length = 0
    const f = fakeGh([], { staleLists: 1000 })
    expect(() => reconcileIssue({ repo: 'o/r', title, result: { status: 'missed', deadline: '07:00' }, gh: f.gh, wait, visibility: { attempts: 4, delayMs: 10 } })).toThrow(/not visible/i)
    expect(waits).toEqual([10, 10, 10])
    expect(f.calls.filter(args => args[1] === 'create')).toHaveLength(1)
  })
  it('fails closed if the list shows the wrong exact-title issue instead of the written one', () => {
    const f = fakeGh([])
    let lists = 0
    // First list is empty (create #1); afterwards the list only ever shows some other #9.
    const gh = args => args[0] === 'api' ? (lists++ ? JSON.stringify({ number: 9, title, state: 'open', url: 'u' }) + '\n' : '') : f.gh(args)
    expect(() => reconcileIssue({ repo: 'o/r', title, result: { status: 'missed', deadline: '07:00' }, gh, wait: () => {}, visibility: { attempts: 2, delayMs: 1 } })).toThrow(/#1 OPEN not visible.*"number":9/)
    expect(f.calls.filter(args => args[1] === 'create')).toHaveLength(1)
  })
  it('lists with a cache-busting nonce and no-cache header, unique per request', () => {
    const f = fakeGh([])
    reconcileIssue({ repo: 'o/r', title, result: { status: 'missed', deadline: '07:00' }, gh: f.gh, wait })
    const lists = f.calls.filter(args => args[0] === 'api')
    expect(lists.length).toBeGreaterThanOrEqual(2)
    for (const args of lists) {
      expect(args).toContain('--paginate')
      expect(args[args.indexOf('-H') + 1]).toBe('Cache-Control: no-cache')
      expect(args.some(arg => /^monitor_nonce=\S+$/.test(arg))).toBe(true)
    }
    const nonces = lists.map(args => args.find(arg => arg.startsWith('monitor_nonce=')))
    expect(new Set(nonces).size).toBe(nonces.length)
  })
  it('real re-exercise reuses closed issue #2 and ignores renamed duplicate #3 without touching production', () => {
    waits.length = 0
    const f = fakeGh([
      { title: productionIssueTitle('2026-10-18'), state: 'CLOSED' },
      { title, state: 'CLOSED' },
      { title: `${title} duplicate evidence (run 39165196866)`, state: 'CLOSED' },
    ], { staleLists: 1 })
    const evidence = exerciseIssueReconciliation({ repo: 'o/r', gh: f.gh, now, wait })
    expect(evidence.first).toMatchObject({ action: 'reopened', issue: { number: 2 } })
    expect(evidence.close).toMatchObject({ action: 'closed', issue: { number: 2, state: 'CLOSED' } })
    expect(evidence.ok).toBe(true)
    expect(f.calls.filter(args => args[1] === 'create')).toHaveLength(0)
    expect(f.calls.some(args => args[0] === 'issue' && ['1', '3'].includes(args[2]))).toBe(false)
    expect(f.issues.map(issue => issue.state)).toEqual(['CLOSED', 'CLOSED', 'CLOSED'])
  })
})
