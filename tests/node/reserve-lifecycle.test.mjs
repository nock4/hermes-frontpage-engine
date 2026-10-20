import { it, expect } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import * as cron from '../../scripts/run-daily-publish-cron.mjs'
import { runPreparation } from '../../scripts/prepare-artwork-reserve.mjs'
import { acquireBoundedBookmarkSources } from '../../scripts/lib/source-research.mjs'

it.each(['absent', 'consumed'])('cron automatically prepares %s reserve before generation', async () => {
  const calls = []
  await cron.prepareCronReserve({ inputRoot: '/fixture', worktreeDir: '/detached', remote: 'origin', branch: 'main' }, {
    run: async (...args) => { calls.push(args); return { code: 0 } }, env: {},
  })
  expect(calls).toHaveLength(1)
  expect(calls[0][1]).toContain('scripts/prepare-artwork-reserve.mjs')
  expect(calls[0][2].cwd).toBe('/detached')
})
it.each([{ proofOnly: '/proof' }, { resumeCandidate: '/candidate' }, { inspirationOverridePath: '/override' }])('recovery/override bypass reserve intake: %j', async mode => {
  await cron.prepareCronReserve(mode, { run: async () => { throw new Error('must not spawn') }, env: {} })
})
it('preparation failure stops before a second fresh intake budget', async () => {
  await expect(cron.prepareCronReserve({}, { run: async () => ({ code: 2 }), env: {} })).rejects.toThrow(/reserve/i)
})

it('partial preparation advances bounded intake and retains proof under one aggregate budget', async () => {
  const root = await fs.mkdtemp(path.join(process.env.TMPDIR || 'tmp/', 'lifecycle-'))
  try {
    let mines = 0
    const seen = []
    const adapters = {
      acquire: async batch => batch,
      research: async () => ({ tool: 'deterministic-fallback', source_decisions: [] }),
      inspectRaw: async (sources, research, allowance) => ({ ...research, source_decisions: [...research.source_decisions, ...sources.slice(0, allowance).map(s => ({ url: s.url, inspection: { status: 'verified', confidence: 'high', source_url: s.url, media_url: s.image_url, capture_sha256: 'a'.repeat(64) } }))] }),
      select: (sources, research) => sources.filter(s => research.source_decisions.some(r => r.url === s.url && r.inspection?.status === 'verified')).slice(0, 6),
    }
    const deps = {
      completeLedger: async () => ({ keys: new Set(), ref: 'origin/main', ref_commit: 'abc' }),
      codeCheck: async () => ({ matches: true }), press: () => ({ inputRoot: root }),
      fingerprint: async () => ({ config_sha256: 'c'.repeat(64) }), audit: async () => ({ ready: [] }),
      mine: async (_p, _l, limits) => {
        seen.push(limits)
        const start = mines++ * 4
        const notes = Array.from({ length: 4 }, (_, i) => ({ id: `n${start+i}`, source_path: `n${start+i}.md`, metadata: { note_sha256: 'b'.repeat(64) } }))
        return { input_root: root, notes_selected: notes, source_candidates: notes.map(n => ({ url: `https://example.com/${n.id}`, image_url: `https://example.com/${n.id}.jpg`, note_id: n.id })), selection_policy: { bookmark_first: true, bookmark_intake: { notes_read: 12 } } }
      },
      acquire: (h, _p, _l, continuation) => acquireBoundedBookmarkSources(h, { ...continuation, candidates: h.source_candidates, runDir: root, adapters }),
    }
    const out = await runPreparation({ options: { reserveDir: path.join(root, 'reserve'), ttlHours: 72 }, runDir: root, deps })
    expect(out.status).toBe('prepared')
    expect(mines).toBe(2)
    expect(seen[0]).toMatchObject({ maxReads: 12, maxNotes: 6 })
    expect(out.budget).toMatchObject({ acquisitions: 8, inspections: 8, reads: 24 })
    const set = JSON.parse(await fs.readFile(out.reserve_file, 'utf8'))
    expect(set.sources.map(s => s.note_id)).toEqual(['n0', 'n1', 'n2', 'n3', 'n4', 'n5'])
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})

it('continuation retains evidence, skips duplicate candidates and never resets spend', async () => {
  const root = await fs.mkdtemp(path.join(process.env.TMPDIR || 'tmp/', 'bounded-'))
  try {
    const budget = { acquisitions: 18, inspections: 20 }
    const state = { inspected: [{ url: 'https://example.com/old' }], autoresearch: { source_decisions: [{ url: 'https://example.com/old', inspection: { status: 'verified' } }] }, attempted: ['example.com/old'] }
    const candidates = Array.from({ length: 12 }, (_, i) => ({ url: `https://example.com/${i}` }))
    const adapters = { acquire: async batch => batch, research: async () => ({ source_decisions: [] }), inspectRaw: async (s, r, n) => ({ ...r, source_decisions: [...r.source_decisions, ...s.slice(0,n).map(x => ({ url: x.url, inspection: { status: 'rejected' } }))] }), select: () => [] }
    const first = await acquireBoundedBookmarkSources({ source_candidates: candidates }, { candidates, runDir: root, budget, state, adapters })
    expect(first.inspected[0].url).toBe('https://example.com/old')
    expect(first.autoresearch.source_decisions[0].inspection.status).toBe('verified')
    expect(budget).toEqual({ acquisitions: 24, inspections: 24 })
    await acquireBoundedBookmarkSources({ source_candidates: candidates }, { candidates, runDir: root, budget, state, adapters })
    expect(budget).toEqual({ acquisitions: 24, inspections: 24 })
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})

it('empty continuation keeps admitted evidence and does not reacquire duplicates', async () => {
  const root = await fs.mkdtemp(path.join(process.env.TMPDIR || 'tmp/', 'empty-continuation-'))
  try {
    const budget = { acquisitions: 0, inspections: 0 }, state = {}
    const source = { url: 'https://example.com/work' }
    const adapters = { acquire: async b => b, research: async () => ({ source_decisions: [] }), inspectRaw: async (s, r) => ({ ...r, source_decisions: [...r.source_decisions, ...s.map(x => ({ url: x.url, inspection: { status: 'verified' } }))] }), select: s => s }
    const opts = { candidates: [source], runDir: root, budget, state, adapters }
    await acquireBoundedBookmarkSources({}, opts)
    const second = await acquireBoundedBookmarkSources({}, opts)
    expect(second.contentSources).toEqual([source])
    expect(budget).toEqual({ acquisitions: 1, inspections: 1 })
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})

it('exhausted preparation keeps partial evidence and stops at four small cursor batches', async () => {
  const root = await fs.mkdtemp(path.join(process.env.TMPDIR || 'tmp/', 'exhausted-prep-'))
  try {
    let mines = 0
    const budgets = []
    const deps = {
      completeLedger: async () => ({ keys: new Set(), ref: 'origin/main' }), codeCheck: async () => ({ matches: true }),
      press: () => ({}), fingerprint: async () => ({}), audit: async () => ({ ready: [] }),
      mine: async (_p, _l, limits) => { expect(limits).toEqual({ maxReads: 12, maxNotes: 6 }); mines++; return { notes_selected: [], source_candidates: [], selection_policy: { bookmark_first: true, bookmark_intake: { notes_read: 12 } } } },
      acquire: async (_h, _p, _l, { budget }) => { budgets.push(budget); budget.acquisitions += 6; budget.inspections += 2; return { contentSources: [{ url: 'partial' }], inspected: [], autoresearch: { source_decisions: [] }, audit: {} } },
    }
    const out = await runPreparation({ options: { reserveDir: path.join(root, 'reserve') }, runDir: root, deps })
    expect(out.status).toBe('insufficient')
    expect(mines).toBe(4)
    expect(new Set(budgets).size).toBe(1)
    expect(out.budget).toEqual({ acquisitions: 24, inspections: 8, reads: 48, nominations: 0 })
    const retained = JSON.parse(await fs.readFile(path.join(root, 'reserve-continuation.json'), 'utf8'))
    expect(retained.acquired.contentSources).toEqual([{ url: 'partial' }])
    expect(retained.budget).toEqual(out.budget)
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})
