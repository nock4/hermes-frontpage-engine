import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import {
  claimPreparedReserve, finalizeReserveClaim, ledgerFingerprint, reserveConfigFingerprint,
  writePreparedReserve, readVaultNoteDigests, reserveState, auditPreparedReserves, admissionModuleFiles,
} from '../../scripts/lib/artwork-reserve.mjs'
import { acquireBoundedBookmarkSources } from '../../scripts/lib/source-research.mjs'
import { mineSignals } from '../../scripts/lib/signal-mining.mjs'
import { createMineSignalsStep } from '../../scripts/pipeline/mine-signals.mjs'
import { createResearchSourcesStep } from '../../scripts/pipeline/research-sources.mjs'

const sha = value => createHash('sha256').update(value).digest('hex')
const NOW = Date.parse('2026-10-18T20:00:00Z')
let root, reserveDir, vault

function harvestFixture(count = 6) {
  const notes = Array.from({ length: count }, (_, i) => ({
    id: `note${i}`, source_channel: 'twitter-bookmark', title: `Artwork ${i}`, note_date: '2026-10-01',
    excerpt: `# Artwork ${i}\nhttps://x.com/artist${i}/status/${1000 + i}\n`, urls: [`https://x.com/artist${i}/status/${1000 + i}`],
    source_path: `Inbox/tweets/${i}.md`, path: `Inbox/tweets/${i}.md`, score: 0,
    metadata: { adapter: 'bookmark-first', note_sha256: sha(`# Artwork ${i}\nhttps://x.com/artist${i}/status/${1000 + i}\n`), attached_media_urls: [] },
  }))
  return { input_root: vault, notes_selected: notes, source_candidates: notes.map(n => ({ url: n.urls[0], note_id: n.id, note_path: n.source_path, source_channel: 'twitter-bookmark' })) }
}
function admitted(harvest, mediaFor = i => `media-${i}`) {
  const contentSources = harvest.notes_selected.map((n, i) => ({ url: n.urls[0], note_id: n.id, note_path: n.source_path, source_channel: 'twitter-bookmark', image_url: `https://pbs.twimg.com/media/${i}.jpg` }))
  const autoresearch = { source_decisions: contentSources.map((s, i) => ({ url: s.url, role: 'content', confidence: 'high', inspection: {
    version: 1, inspector: 'creative-artifact-vision', status: 'verified', confidence: 'high', artifact_kind: 'artwork', observation: `A painting ${i}`,
    source_url: s.url, media_url: s.image_url, resolved_media_url: s.image_url, capture_sha256: sha(mediaFor(i)), capture_path: `/run/creative-inspections/${i}.jpg` } })) }
  return { contentSources, autoresearch }
}
const fingerprints = (over = {}) => ({ config_sha256: 'c'.repeat(64), ledger_sha256: ledgerFingerprint(new Set(['x.com/old/status/1'])), ...over })
const deps = (over = {}) => ({
  isOwner: async () => true,
  readNotes: async (_root, paths) => Object.fromEntries(paths.map(p => [p, sha(`# Artwork ${p.match(/(\d+)\.md/)[1]}\nhttps://x.com/artist${p.match(/(\d+)\.md/)[1]}/status/${1000 + Number(p.match(/(\d+)\.md/)[1])}\n`)])),
  fetchMediaSha: async url => sha(`media-${url.match(/media\/(\d+)/)[1]}`),
  ...over,
})
async function prepare(over = {}) {
  const harvest = harvestFixture()
  const { contentSources, autoresearch } = admitted(harvest)
  return writePreparedReserve({ reserveDir, signalHarvest: harvest, contentSources, autoresearch, fingerprints: fingerprints(), now: NOW, ttlMs: 72 * 3600e3, runDir: '/run', codeMatchesRef: true, codeRef: 'origin/main@abc', ...over })
}
const claim = (over = {}) => claimPreparedReserve({ reserveDir, inputRoot: vault, fingerprints: fingerprints(), now: NOW + 3600e3, runId: 'run-1', ...deps(), ...over })

// Hermetic: the reserve requires an explicit frontpage HERMES_HOME, which a
// developer shell may or may not export. Pin it per test and restore after.
let savedHermesHome
beforeEach(async () => {
  await fs.mkdir(path.resolve(process.env.TMPDIR || 'tmp/'), { recursive: true })
  root = await fs.mkdtemp(path.join(path.resolve(process.env.TMPDIR || 'tmp/'), 'reserve-test-'))
  reserveDir = path.join(root, 'reserve'); vault = path.join(root, 'vault')
  savedHermesHome = process.env.HERMES_HOME
  process.env.HERMES_HOME = path.join(root, 'hermes-frontpage')
})
afterEach(async () => {
  if (savedHermesHome === undefined) delete process.env.HERMES_HOME; else process.env.HERMES_HOME = savedHermesHome
  await fs.rm(root, { recursive: true, force: true })
})

describe('prepared artwork reserve preparation', () => {
  it('persists owning-note, media and capture provenance with observations, not admission stamps', async () => {
    const { set, file } = await prepare()
    expect(path.dirname(file)).toBe(path.join(reserveDir, 'prepared'))
    expect(set.sources).toHaveLength(6)
    expect(set.sources[0]).toMatchObject({ note_id: 'note0', note_path: 'Inbox/tweets/0.md', media_url: 'https://pbs.twimg.com/media/0.jpg', capture_sha256: sha('media-0'), observation: { status: 'verified', artifact_kind: 'artwork' } })
    expect(set.notes.map(n => n.metadata.note_sha256)).toEqual(harvestFixture().notes_selected.map(n => n.metadata.note_sha256))
    expect(JSON.stringify(set)).not.toMatch(/"inspector"|"role"|"version":1,/)
    expect(set.expires_at).toBe(new Date(NOW + 72 * 3600e3).toISOString())
  })
  it('refuses to fabricate a reserve below six real independently verified works', async () => {
    const harvest = harvestFixture(5)
    await expect(writePreparedReserve({ reserveDir, signalHarvest: harvest, ...admitted(harvest), fingerprints: fingerprints(), now: NOW })).rejects.toThrow(/six/)
    const full = harvestFixture()
    const bad = admitted(full)
    bad.autoresearch.source_decisions[2].inspection.status = 'ambiguous'
    await expect(writePreparedReserve({ reserveDir, signalHarvest: full, ...bad, fingerprints: fingerprints(), now: NOW })).rejects.toThrow(/verified/)
    await expect(fs.readdir(path.join(reserveDir, 'prepared'))).rejects.toThrow()
  })
  it('keeps the reserve small: one prepared set at a time', async () => {
    await prepare()
    await expect(prepare()).rejects.toThrow(/already prepared/)
  })
})

describe('prepared artwork reserve consumption', () => {
  it('claims atomically once, revalidates notes and fresh media bytes, then consumes', async () => {
    const { set } = await prepare()
    const [a, b] = await Promise.all([claim(), claim({ runId: 'run-2' })])
    const winners = [a, b].filter(result => result.claim)
    expect(winners).toHaveLength(1)
    expect(winners[0].notes.map(n => n.id)).toEqual(set.notes.map(n => n.id))
    expect((await reserveState(reserveDir)).claimed).toEqual([set.set_id])
    const { contentSources, autoresearch } = admitted(harvestFixture())
    expect(await finalizeReserveClaim(winners[0].claim, { contentSources, autoresearch })).toMatchObject({ state: 'consumed' })
    expect(await reserveState(reserveDir)).toMatchObject({ prepared: [], claimed: [], consumed: [set.set_id] })
    expect((await claim({ runId: 'run-3' })).claim).toBeNull()
  })
  for (const [name, over, reason] of [
    ['expired', { now: NOW + 73 * 3600e3 }, /expired/],
    ['changed config', { fingerprints: fingerprints({ config_sha256: 'd'.repeat(64) }) }, /config/],
    ['changed archive ledger', { fingerprints: fingerprints({ ledger_sha256: ledgerFingerprint(new Set(['x.com/old/status/1', 'x.com/new/status/2'])) }) }, /ledger/],
    ['changed owning note', { readNotes: async (_r, paths) => Object.fromEntries(paths.map(p => [p, 'f'.repeat(64)])) }, /note/],
    ['missing owning note', { readNotes: async (_r, paths) => Object.fromEntries(paths.map(p => [p, null])) }, /note/],
    ['changed media bytes', { fetchMediaSha: async url => url.includes('/3.jpg') ? sha('different') : sha(`media-${url.match(/media\/(\d+)/)[1]}`) }, /media/],
    ['unavailable media', { fetchMediaSha: async () => { throw new Error('HTTP 404') } }, /media/],
    ['different vault', { inputRoot: '/elsewhere' }, /input root/],
  ]) {
    it(`invalidates on ${name} and retains the set as evidence`, async () => {
      const { set } = await prepare()
      const result = await claim(over)
      expect(result.claim).toBeNull()
      expect(result.invalidated[0].reason).toMatch(reason)
      const state = await reserveState(reserveDir)
      expect(state).toMatchObject({ prepared: [], claimed: [], invalid: [set.set_id] })
      expect(JSON.parse(await fs.readFile(path.join(reserveDir, 'invalid', `${set.set_id}.json`), 'utf8')).set_id).toBe(set.set_id)
      expect(await fs.readFile(path.join(reserveDir, 'invalid', `${set.set_id}.json.reason`), 'utf8')).toMatch(reason)
    })
  }
  it('never claims outside the existing press owner', async () => {
    const { set } = await prepare()
    expect((await claim({ isOwner: async () => false })).reason).toMatch(/owner/)
    expect((await reserveState(reserveDir)).prepared).toEqual([set.set_id])
  })
  it('retires a crash-orphaned claim instead of reusing it', async () => {
    const { set } = await prepare()
    const crashed = await claim()
    expect(crashed.claim).toBeTruthy()
    // Simulate the claiming press dying: its recorded pid no longer exists.
    const sidecar = `${crashed.claim.file}.claim`
    await fs.writeFile(sidecar, JSON.stringify({ ...JSON.parse(await fs.readFile(sidecar, 'utf8')), pid: 2 ** 22 + 7 }))
    const after = await claim({ runId: 'run-after-crash' })
    expect(after.claim).toBeNull()
    expect(await reserveState(reserveDir)).toMatchObject({ claimed: [], invalid: [set.set_id] })
    expect(await fs.readFile(path.join(reserveDir, 'invalid', `${set.set_id}.json.reason`), 'utf8')).toMatch(/orphaned/)
  })
  it('invalidates instead of consuming when admission fails or fresh inspection bytes differ', async () => {
    await prepare()
    const first = await claim()
    expect(await finalizeReserveClaim(first.claim, { error: new Error('Source research produced 4') })).toMatchObject({ state: 'invalid' })
    await prepare()
    const second = await claim({ runId: 'run-2' })
    const { contentSources, autoresearch } = admitted(harvestFixture(), i => i === 1 ? 'changed' : `media-${i}`)
    const out = await finalizeReserveClaim(second.claim, { contentSources, autoresearch })
    expect(out).toMatchObject({ state: 'invalid' })
    expect(out.reason).toMatch(/media/)
  })
})

describe('fingerprints and vault reads', () => {
  it('fingerprints the complete ledger order-independently and policy/config contents', async () => {
    expect(ledgerFingerprint(new Set(['b', 'a']))).toBe(ledgerFingerprint(new Set(['a', 'b'])))
    expect(ledgerFingerprint(new Set(['a']))).not.toBe(ledgerFingerprint(new Set(['a', 'b'])))
    const config = path.join(root, 'frontpage.json')
    await fs.writeFile(config, '{"openai_model":"m"}')
    const a = await reserveConfigFingerprint({ model: 'm', inputRoot: vault, frontpageConfigPath: config, env: { HERMES_HOME: root } })
    expect(a.config_sha256).toMatch(/^[a-f0-9]{64}$/)
    expect((await reserveConfigFingerprint({ model: 'other', inputRoot: vault, frontpageConfigPath: config, env: { HERMES_HOME: root } })).config_sha256).not.toBe(a.config_sha256)
    await fs.writeFile(config, '{"openai_model":"n"}')
    expect((await reserveConfigFingerprint({ model: 'm', inputRoot: vault, frontpageConfigPath: config, env: { HERMES_HOME: root } })).config_sha256).not.toBe(a.config_sha256)
    expect(JSON.stringify(a.components)).not.toMatch(/openai_model/)
  })
  it('reads exact owning-note digests in an isolated worker and rejects unsafe paths', async () => {
    await fs.mkdir(path.join(vault, 'Inbox/tweets'), { recursive: true })
    await fs.writeFile(path.join(vault, 'Inbox/tweets/0.md'), 'hello')
    expect(await readVaultNoteDigests(vault, ['Inbox/tweets/0.md', 'Inbox/tweets/missing.md'])).toEqual({ 'Inbox/tweets/0.md': sha('hello'), 'Inbox/tweets/missing.md': null })
    await expect(readVaultNoteDigests(vault, ['../escape.md'])).rejects.toThrow(/unsafe/i)
  })
})

describe('normal press integration', () => {
  it('feeds a claimed reserve through ordinary bounded intake without advancing the bookmark cursor', async () => {
    await prepare()
    const { claim: claimed, notes } = await claim()
    const cacheDir = path.join(root, 'bookmark-cache')
    const h = await mineSignals({ inputMode: 'obsidian-allowlist', inputRoot: vault, date: '2026-10-19', maxNotes: 1209, bookmarkFirst: true, bookmarkCacheDir: cacheDir, preparedReserve: { claim: claimed, notes } }, path.join(root, 'run'))
    expect(h.selection_policy.bookmark_first).toBe(true)
    expect(h.selection_policy.prepared_reserve).toMatchObject({ set_id: claimed.set.set_id })
    expect(h.source_candidates.map(c => c.note_path)).toEqual(notes.map(n => n.source_path))
    await expect(fs.access(cacheDir)).rejects.toThrow()
  })
  it('ignores the reserve for explicit overrides and sample/manifest runs', async () => {
    await prepare()
    let claims = 0
    const step = options => createMineSignalsStep({ options, context: { inspirationOverride: options.override || null }, recentDiversityAvoidTerms: [], recentSourceKeys: new Set(), root, runDir: path.join(root, 'run'),
      mineSignals: async args => ({ notes_selected: [], source_candidates: [], notes_scanned: 0, args }), reserve: { claim: async () => { claims++; return { claim: null } } } })
    await step({ inputMode: 'manifest', publish: true }).run()
    await step({ inputMode: 'obsidian-allowlist', publish: true, override: { active: true, source_url: 'https://x.com/a/status/1' } }).run()
    await step({ inputMode: 'obsidian-allowlist', publish: false }).run()
    expect(claims).toBe(0)
    await step({ inputMode: 'obsidian-allowlist', publish: true }).run()
    expect(claims).toBe(1)
  })
  it('consumes after ordinary admission, or invalidates and falls back to fresh bounded intake', async () => {
    const finalize = []
    const harvests = []
    const context = {}
    const options = { inputMode: 'obsidian-allowlist', publish: true, maxSources: 6, model: 'm', date: '2026-10-19' }
    const mine = createMineSignalsStep({ options, context, recentDiversityAvoidTerms: [], recentSourceKeys: new Set(), root, runDir: path.join(root, 'run'),
      mineSignals: async args => { harvests.push(args.preparedReserve ? 'reserve' : 'fresh'); return { notes_selected: [], source_candidates: [], notes_scanned: 0, selection_policy: { prepared_reserve: args.preparedReserve ? { set_id: 's' } : undefined } } },
      reserve: { claim: async () => ({ claim: { set: { set_id: 's' } }, notes: [] }), finalize: async (claimed, outcome) => { finalize.push(outcome.error ? 'invalid' : 'consumed'); return { state: outcome.error ? 'invalid' : 'consumed' } } } })
    await mine.run()
    let calls = 0
    const research = createResearchSourcesStep({ apiKey: null, context, options, recentSourceKeys: new Set(), root, runDir: path.join(root, 'run'),
      inspectSourceCandidates: async harvest => { calls++; if (harvest.selection_policy.prepared_reserve) throw new Error('Source research produced 4'); return { content_sources: [], autoresearch: {}, content_source_count: 6 } } })
    await research.run()
    expect(harvests).toEqual(['reserve', 'fresh'])
    expect(finalize).toEqual(['invalid'])
    expect(calls).toBe(2)
    expect(context.preparedReserveOutcome).toMatchObject({ state: 'invalid' })
  })
})

describe('review fixes: fingerprint scope and code provenance', () => {
  it('hashes every module reachable from intake/admission and the explicit frontpage transport, never a default profile', async () => {
    const files = admissionModuleFiles().map(file => path.relative(path.resolve('scripts'), file))
    for (const name of ['lib/source-research.mjs', 'lib/signal-mining.mjs', 'lib/bookmark-intake.mjs', 'lib/bookmark-vault-worker.mjs', 'lib/source-url-policy.mjs', 'lib/fetch-vetted-image.mjs', 'lib/source-selection-policy.mjs', 'lib/creative-artifact-inspection.mjs', 'lib/openai-json.mjs', 'lib/artwork-reserve.mjs', 'pipeline/mine-signals.mjs', 'pipeline/research-sources.mjs']) expect(files).toContain(name)
    expect(files.every(name => !name.startsWith('..'))).toBe(true)
    await expect(reserveConfigFingerprint({ model: 'm', inputRoot: vault, env: {} })).rejects.toThrow(/HERMES_HOME/)
    await fs.mkdir(path.join(root, 'frontpage'), { recursive: true })
    await fs.writeFile(path.join(root, 'frontpage', 'config.yaml'), 'model: a')
    const a = await reserveConfigFingerprint({ model: 'm', inputRoot: vault, env: { HERMES_HOME: path.join(root, 'frontpage') } })
    expect(a.components.hermes_home).toBe(path.join(root, 'frontpage'))
    expect(a.components.admission_modules).toEqual(files)
    await fs.writeFile(path.join(root, 'frontpage', 'config.yaml'), 'model: b')
    expect((await reserveConfigFingerprint({ model: 'm', inputRoot: vault, env: { HERMES_HOME: path.join(root, 'frontpage') } })).config_sha256).not.toBe(a.config_sha256)
  })
  it('refuses to hand out a set prepared from undeployed local code', async () => {
    const { set } = await prepare({ codeMatchesRef: false })
    const result = await claim()
    expect(result.claim).toBeNull()
    expect(result.invalidated[0].reason).toMatch(/undeployed/)
    expect((await reserveState(reserveDir)).invalid).toEqual([set.set_id])
  })
})

describe('review fixes: audit without consuming', () => {
  it('keeps a ready set prepared, invalidates stale sets with the production reason and never rewrites their hashes', async () => {
    const { set, file } = await prepare()
    const before = await fs.readFile(file, 'utf8')
    const ready = await auditPreparedReserves({ reserveDir, inputRoot: vault, fingerprints: fingerprints(), now: NOW + 3600e3, ...deps() })
    expect(ready).toMatchObject({ ready: [set.set_id], invalidated: [] })
    expect(await reserveState(reserveDir)).toMatchObject({ prepared: [set.set_id], claimed: [], consumed: [] })
    expect(await fs.readFile(file, 'utf8')).toBe(before)
    const stale = await auditPreparedReserves({ reserveDir, inputRoot: vault, fingerprints: fingerprints({ config_sha256: 'e'.repeat(64) }), now: NOW + 3600e3, ...deps() })
    expect(stale.ready).toEqual([])
    expect(stale.invalidated[0].reason).toMatch(/policy\/config changed/)
    expect(await fs.readFile(path.join(reserveDir, 'invalid', `${set.set_id}.json`), 'utf8')).toBe(before)
    expect(await reserveState(reserveDir)).toMatchObject({ prepared: [], consumed: [], invalid: [set.set_id] })
  })
  it('requires the press owner to audit', async () => {
    await prepare()
    await expect(auditPreparedReserves({ reserveDir, inputRoot: vault, fingerprints: fingerprints(), ...deps({ isOwner: async () => false }) })).rejects.toThrow(/owner/)
  })
})

describe('review fixes: finalize robustness and distinct works', () => {
  it('reports consumed when the move succeeded but the sidecar write failed, and never throws after the move', async () => {
    await prepare()
    const { claim: claimed } = await claim()
    await fs.rm(path.join(reserveDir, 'tmp'), { recursive: true })
    await fs.writeFile(path.join(reserveDir, 'tmp'), 'not a directory')
    const out = await finalizeReserveClaim(claimed, admitted(harvestFixture()))
    expect(out.state).toBe('consumed')
    expect(out.sidecar_error).toBeTruthy()
    expect((await reserveState(reserveDir)).consumed).toEqual([claimed.set.set_id])
  })
  it('requires six distinct matched reserved works, not six sources matching fewer entries', async () => {
    await prepare()
    const { claim: claimed } = await claim()
    const { contentSources, autoresearch } = admitted(harvestFixture())
    // Two admitted sources resolving to the same reserved work (alias via note_id + media).
    contentSources[5] = { ...contentSources[0], url: 'https://twitter.com/artist0/status/1000', note_id: 'note0' }
    autoresearch.source_decisions[5].inspection = { ...autoresearch.source_decisions[0].inspection, source_url: contentSources[5].url }
    const out = await finalizeReserveClaim(claimed, { contentSources, autoresearch })
    expect(out.state).toBe('invalid')
    expect(out.reason).toMatch(/distinct/)
  })
})

describe('review fixes: bounded budget across reserve attempt and fallback', () => {
  const adapters = (inspectionsPerBatch = 6) => ({
    acquire: async batch => batch.map(candidate => ({ ...candidate, image_url: `${candidate.url}/img.jpg` })),
    research: async () => ({ source_decisions: [] }),
    inspectRaw: async (sources, research, maxInspections) => ({ ...research, source_decisions: [...research.source_decisions, ...sources.slice(0, Math.min(inspectionsPerBatch, maxInspections)).map(source => ({ url: source.url, inspection: { status: 'rejected' } }))] }),
    select: () => [],
  })
  const harvest = { source_candidates: Array.from({ length: 24 }, (_, i) => ({ url: `https://x.com/a${i}/status/${i}`, note_id: `n${i}`, source_channel: 'twitter-bookmark' })) }
  it.each(['acquire', 'research', 'inspectRaw'])('retains charges when %s throws before returning a batch', async stage => {
    const budget = { acquisitions: 0, inspections: 0 }
    const original = new Error('injected evidence write failure')
    const failing = { ...adapters(), [stage]: async () => { throw original } }
    await expect(acquireBoundedBookmarkSources(harvest, { runDir: path.join(root, 'failed'), budget, adapters: failing })).rejects.toBe(original)
    expect(budget.acquisitions).toBe(6)
    expect(budget.inspections).toBe(stage === 'inspectRaw' ? 10 : 0)
    await acquireBoundedBookmarkSources(harvest, { runDir: path.join(root, 'fallback'), budget, adapters: adapters() })
    expect(budget.acquisitions).toBe(24)
    expect(budget.inspections).toBeLessThanOrEqual(24)
  })
  it('charges acquisitions and inspections to one shared 24 budget', async () => {
    const budget = { acquisitions: 0, inspections: 0 }
    const first = await acquireBoundedBookmarkSources(harvest, { runDir: path.join(root, 'run1'), budget, adapters: adapters() })
    expect(first.audit.acquired).toBe(24)
    expect(budget).toEqual({ acquisitions: 24, inspections: 24 })
    const spent = { acquisitions: 18, inspections: 20 }
    const second = await acquireBoundedBookmarkSources(harvest, { runDir: path.join(root, 'run2'), budget: spent, adapters: adapters() })
    expect(second.audit.acquired).toBe(6)
    expect(spent).toEqual({ acquisitions: 24, inspections: 24 })
  })
})

describe('review fixes: integrated mine/research fallback', () => {
  const options = { inputMode: 'obsidian-allowlist', publish: true, maxSources: 6, model: 'm', date: '2026-10-19', inputRoot: '/vault', configPath: null }
  function steps({ claimImpl, finalizeImpl, inspect, mined = [] }) {
    const context = {}
    const mine = createMineSignalsStep({ options, context, recentDiversityAvoidTerms: [], recentSourceKeys: new Set(), root, runDir: path.join(root, 'run'),
      mineSignals: async args => { mined.push(args.preparedReserve ? 'reserve' : 'fresh'); return { notes_selected: [], source_candidates: [], notes_scanned: 0, selection_policy: { prepared_reserve: args.preparedReserve ? { set_id: 's' } : undefined } } },
      reserve: { claim: claimImpl, finalize: finalizeImpl } })
    const research = createResearchSourcesStep({ apiKey: null, context, options, recentSourceKeys: new Set(), root, runDir: path.join(root, 'run'), inspectSourceCandidates: inspect })
    return { context, mine, research }
  }
  it('falls back to fresh intake when fingerprint or claim infrastructure throws', async () => {
    const mined = []
    const { context, mine } = steps({ claimImpl: async () => { throw new Error('EACCES reserve dir') }, mined })
    const saved = process.env.HERMES_HOME
    process.env.HERMES_HOME = root
    try { await mine.run() } finally { if (saved === undefined) delete process.env.HERMES_HOME; else process.env.HERMES_HOME = saved }
    expect(mined).toEqual(['fresh'])
    expect(context.preparedReserveClaimResult).toMatchObject({ claimed: false, error: expect.stringMatching(/EACCES/) })
  })
  it('falls back without a reserve when the frontpage transport is not explicit', async () => {
    const mined = []
    let claims = 0
    const { context, mine } = steps({ claimImpl: async () => { claims++; return { claim: null } }, mined })
    const saved = process.env.HERMES_HOME
    delete process.env.HERMES_HOME
    try { await mine.run() } finally { if (saved !== undefined) process.env.HERMES_HOME = saved }
    expect(claims).toBe(0)
    expect(mined).toEqual(['fresh'])
    expect(context.preparedReserveClaimResult.error).toMatch(/HERMES_HOME/)
  })
  async function withHermes(fn) {
    const saved = process.env.HERMES_HOME
    process.env.HERMES_HOME = root
    try { return await fn() } finally { if (saved === undefined) delete process.env.HERMES_HOME; else process.env.HERMES_HOME = saved }
  }
  it('settles the claim once and mines fresh when mining the claimed reserve notes throws', async () => {
    const mined = [], settled = []
    const context = {}
    const mine = createMineSignalsStep({ options, context, recentDiversityAvoidTerms: [], recentSourceKeys: new Set(), root, runDir: path.join(root, 'run'),
      mineSignals: async args => { mined.push(args.preparedReserve ? 'reserve' : 'fresh'); if (args.preparedReserve) throw new Error('EIO harvest write'); return { notes_selected: [], source_candidates: [], notes_scanned: 0, selection_policy: {} } },
      reserve: { claim: async () => ({ claim: { set: { set_id: 's' } }, notes: [] }), finalize: async (claimed, outcome) => { settled.push(outcome.error.message); return { state: 'invalid' } } } })
    await withHermes(() => mine.run())
    expect(mined).toEqual(['reserve', 'fresh'])
    expect(settled).toEqual(['EIO harvest write'])
    expect(context.reserveClaim).toBeFalsy()
    expect(context.preparedReserveClaimResult).toMatchObject({ claimed: false, error: expect.stringMatching(/EIO/) })
  })
  it('calls finalize exactly once when it throws and still falls back within the remaining budget', async () => {
    const mined = [], budgets = []
    let finalizeCalls = 0
    const { context, mine, research } = steps({ mined,
      claimImpl: async () => ({ claim: { set: { set_id: 's' } }, notes: [] }),
      finalizeImpl: async () => { finalizeCalls++; throw new Error('ENOSPC sidecar') },
      inspect: async (harvest, opts) => { budgets.push({ ...opts.bookmarkBudget }); opts.bookmarkBudget.acquisitions += 12; opts.bookmarkBudget.inspections += 10; return { content_sources: [], autoresearch: {}, content_source_count: 6 } } })
    await withHermes(() => mine.run())
    await research.run()
    expect(finalizeCalls).toBe(1)
    expect(mined).toEqual(['reserve', 'fresh'])
    expect(budgets).toEqual([{ acquisitions: 0, inspections: 0 }, { acquisitions: 12, inspections: 10 }])
    expect(context.preparedReserveOutcome).toMatchObject({ state: 'finalize-error' })
  })
  it('fails closed with the original research error when the shared budget is exhausted', async () => {
    const mined = []
    const original = new Error('Source research produced 4 non-duplicate renderable content sources')
    let calls = 0
    const { mine, research } = steps({ mined,
      claimImpl: async () => ({ claim: { set: { set_id: 's' } }, notes: [] }),
      finalizeImpl: async () => { throw new Error('finalize also failed') },
      inspect: async (harvest, opts) => { calls++; opts.bookmarkBudget.acquisitions = 24; opts.bookmarkBudget.inspections = 24; throw original } })
    await withHermes(() => mine.run())
    await expect(research.run()).rejects.toBe(original)
    expect(calls).toBe(1)
    expect(mined).toEqual(['reserve'])
  })
  it('consumes through real mineSignals and real claim/finalize on a vault fixture', async () => {
    await fs.mkdir(path.join(vault, 'Inbox/tweets'), { recursive: true })
    for (let i = 0; i < 6; i++) await fs.writeFile(path.join(vault, `Inbox/tweets/${i}.md`), `# Artwork ${i}\nhttps://x.com/artist${i}/status/${1000 + i}\n`)
    await prepare()
    const context = {}
    const runDir = path.join(root, 'run')
    const realOptions = { ...options, inputRoot: vault }
    const reserve = {
      claim: args => claimPreparedReserve({ ...args, reserveDir, fingerprints: fingerprints(), ...deps({ readNotes: readVaultNoteDigests }) }),
      finalize: finalizeReserveClaim,
    }
    const mine = createMineSignalsStep({ options: realOptions, context, recentDiversityAvoidTerms: [], recentSourceKeys: new Set(), root, runDir, mineSignals, reserve })
    const research = createResearchSourcesStep({ apiKey: null, context, options: realOptions, recentSourceKeys: new Set(), root, runDir,
      inspectSourceCandidates: async harvest => {
        expect(harvest.selection_policy.prepared_reserve.set_id).toBeTruthy()
        const { contentSources, autoresearch } = admitted(harvest)
        return { content_sources: contentSources, autoresearch, content_source_count: contentSources.length }
      } })
    await withHermes(() => mine.run())
    expect(context.preparedReserveClaimResult.claimed).toBe(true)
    await research.run()
    expect(context.preparedReserveOutcome.state).toBe('consumed')
    expect(await reserveState(reserveDir)).toMatchObject({ prepared: [], claimed: [], consumed: [expect.any(String)] })
    expect(JSON.parse(await fs.readFile(path.join(runDir, 'prepared-reserve-outcome.json'), 'utf8')).state).toBe('consumed')
  })
})

describe('source-only preparation CLI', () => {
  it('parses bounded source-only flags and cannot reach plate or brief generation', async () => {
    const { parseArgs } = await import('../../scripts/prepare-artwork-reserve.mjs')
    expect(parseArgs([])).toMatchObject({ ttlHours: 72, auditOnly: false, allowLocalCode: false, proveConsumption: false })
    expect(parseArgs(['--audit-only', '--prove-consumption'])).toMatchObject({ auditOnly: true, proveConsumption: true })
    expect(() => parseArgs(['--ttl-hours', '500'])).toThrow(/ttl/)
    expect(() => parseArgs(['--publish'])).toThrow(/Unknown/)
    expect(() => parseArgs(['--allow-local-code'])).toThrow(/--reserve-dir/)
    const text = await fs.readFile('scripts/prepare-artwork-reserve.mjs', 'utf8')
    expect(text).not.toMatch(/scene-generation|generateScenePlate|composeDailyPayload|generate-plate|compose-brief|--publish'/)
  })
  it('compares every admission module byte-for-byte with the deployed ref, including untracked ones', async () => {
    const { compareAdmissionCode } = await import('../../scripts/prepare-artwork-reserve.mjs')
    const same = await compareAdmissionCode('origin/main', { readRef: async rel => fs.readFile(path.resolve(rel)) })
    expect(same).toMatchObject({ matches: true, mismatched: [] })
    const diff = await compareAdmissionCode('origin/main', { readRef: async rel => rel === 'scripts/lib/artwork-reserve.mjs' ? null : rel === 'scripts/lib/source-research.mjs' ? Buffer.from('old') : fs.readFile(path.resolve(rel)) })
    expect(diff.matches).toBe(false)
    expect(diff.mismatched.sort()).toEqual(['scripts/lib/artwork-reserve.mjs', 'scripts/lib/source-research.mjs'])
  })

  const fakeDeps = (over = {}) => {
    const calls = { acquire: 0, prove: 0 }
    return { calls, deps: {
      completeLedger: async () => ({ keys: new Set(['x.com/old/status/1']), ref: 'origin/main', ref_commit: 'a'.repeat(40), editions: 1, current_edition_id: 'e' }),
      codeCheck: async () => ({ matches: true, mismatched: [], ref: 'origin/main' }),
      fingerprint: async () => ({ config_sha256: 'c'.repeat(64) }),
      press: () => ({ inputRoot: vault, date: '2026-10-19', model: 'm', configPath: null }),
      audit: args => auditPreparedReserves({ ...args, ...deps() }),
      mine: async () => harvestFixture(),
      acquire: async harvest => { calls.acquire++; return { ...admitted(harvest), inspected: [], audit: { acquired: 6 } } },
      prove: async () => { calls.prove++; return { consumed: true } },
      ...over,
    } }
  }
  it('invalidates a stale prepared set with the production reason and acquires a replacement instead of reporting already-prepared forever', async () => {
    const { runPreparation } = await import('../../scripts/prepare-artwork-reserve.mjs')
    const { set: stale } = await prepare({ fingerprints: fingerprints({ config_sha256: 'd'.repeat(64) }) })
    const { calls, deps: d } = fakeDeps()
    const out = await runPreparation({ options: { reserveDir, ttlHours: 72 }, runDir: path.join(root, 'run'), deps: d })
    expect(out.status).toBe('prepared')
    expect(out.audit.invalidated).toEqual([{ set_id: stale.set_id, reason: 'policy/config changed since preparation' }])
    expect(calls.acquire).toBe(1)
    const state = await reserveState(reserveDir)
    expect(state.invalid).toEqual([stale.set_id])
    expect(state.prepared).toHaveLength(1)
    expect(JSON.parse(await fs.readFile(path.join(reserveDir, 'prepared', `${state.prepared[0]}.json`), 'utf8'))).toMatchObject({ code_matches_ref: true, code_ref: 'origin/main@' + 'a'.repeat(40) })
  })
  it('reports a still-valid set as ready without consuming it or spending intake', async () => {
    const { runPreparation } = await import('../../scripts/prepare-artwork-reserve.mjs')
    const { set } = await prepare()
    const { calls, deps: d } = fakeDeps()
    const out = await runPreparation({ options: { reserveDir, ttlHours: 72 }, runDir: path.join(root, 'run'), deps: d })
    expect(out).toMatchObject({ status: 'ready', ready: [set.set_id] })
    expect(calls.acquire).toBe(0)
    expect(await reserveState(reserveDir)).toMatchObject({ prepared: [set.set_id], consumed: [], claimed: [] })
  })
  it('blocks undeployed admission code unless explicitly labelled local diagnostic in a separate reserve dir', async () => {
    const { runPreparation } = await import('../../scripts/prepare-artwork-reserve.mjs')
    const local = { codeCheck: async () => ({ matches: false, mismatched: ['scripts/lib/artwork-reserve.mjs'], ref: 'origin/main' }) }
    const blocked = fakeDeps(local)
    const out = await runPreparation({ options: { reserveDir, ttlHours: 72 }, runDir: path.join(root, 'run'), deps: blocked.deps })
    expect(out.status).toBe('blocked-undeployed-code')
    expect(blocked.calls.acquire).toBe(0)
    const diag = fakeDeps(local)
    const labelled = await runPreparation({ options: { reserveDir, ttlHours: 72, allowLocalCode: true }, runDir: path.join(root, 'run2'), deps: diag.deps })
    expect(labelled).toMatchObject({ status: 'prepared', readiness: 'local-diagnostic-not-deployed' })
    const state = await reserveState(reserveDir)
    expect(JSON.parse(await fs.readFile(path.join(reserveDir, 'prepared', `${state.prepared[0]}.json`), 'utf8')).code_matches_ref).toBe(false)
  })
  it('audit-only and prove-consumption never acquire; proof requires a ready set', async () => {
    const { runPreparation } = await import('../../scripts/prepare-artwork-reserve.mjs')
    const a = fakeDeps()
    expect((await runPreparation({ options: { reserveDir, ttlHours: 72, auditOnly: true }, runDir: path.join(root, 'r1'), deps: a.deps })).status).toBe('audited')
    const b = fakeDeps()
    expect((await runPreparation({ options: { reserveDir, ttlHours: 72, proveConsumption: true }, runDir: path.join(root, 'r2'), deps: b.deps })).status).toBe('no-ready-set')
    await prepare()
    const c = fakeDeps()
    const proved = await runPreparation({ options: { reserveDir, ttlHours: 72, proveConsumption: true }, runDir: path.join(root, 'r3'), deps: c.deps })
    expect(proved.status).toBe('consumption-proven')
    expect(c.calls).toEqual({ acquire: 0, prove: 1 })
  })
  it('proves consumption on a scratch copy through the integrated mine/research steps, asserting finalMedia bindings and capture digests', async () => {
    const { proveReserveConsumption } = await import('../../scripts/prepare-artwork-reserve.mjs')
    await fs.mkdir(path.join(vault, 'Inbox/tweets'), { recursive: true })
    for (let i = 0; i < 6; i++) await fs.writeFile(path.join(vault, `Inbox/tweets/${i}.md`), `# Artwork ${i}\nhttps://x.com/artist${i}/status/${1000 + i}\n`)
    const captures = path.join(root, 'captures')
    await fs.mkdir(captures)
    for (let i = 0; i < 6; i++) await fs.writeFile(path.join(captures, `${i}.jpg`), `media-${i}`)
    const { set, file } = await prepare()
    const before = await fs.readFile(file, 'utf8')
    const runDir = path.join(root, 'proof')
    const proof = await proveReserveConsumption({ setFile: file, runDir, root,
      options: { inputMode: 'obsidian-allowlist', inputRoot: vault, model: 'm', date: '2026-10-19', maxSources: 6, maxNotes: 24, windowDays: 1 },
      recentSourceKeys: new Set(), mineSignals,
      claimDeps: { fingerprints: fingerprints(), ...deps({ readNotes: readVaultNoteDigests }) },
      inspectSourceCandidates: async (harvest, opts) => {
        expect(opts.bookmarkBudget).toEqual({ acquisitions: 0, inspections: 0 })
        const { contentSources, autoresearch } = admitted(harvest)
        for (const [i, row] of autoresearch.source_decisions.entries()) row.inspection.capture_path = path.join(captures, `${i}.jpg`)
        return { content_sources: contentSources, sources: contentSources, autoresearch, content_source_count: 6 }
      } })
    expect(proof).toMatchObject({ set_id: set.set_id, outcome: 'consumed', final_media_bindings: 6 })
    expect(proof.capture_digests.map(d => d.capture_sha256)).toEqual(set.sources.map(s => s.capture_sha256))
    expect(await fs.readFile(file, 'utf8')).toBe(before)
    expect((await reserveState(reserveDir)).prepared).toEqual([set.set_id])
    // A capture whose bytes no longer match fails the finalMedia digest assertion.
    await fs.writeFile(path.join(captures, '2.jpg'), 'tampered')
    await expect(proveReserveConsumption({ setFile: file, runDir: path.join(root, 'proof2'), root,
      options: { inputMode: 'obsidian-allowlist', inputRoot: vault, model: 'm', date: '2026-10-19', maxSources: 6, maxNotes: 24, windowDays: 1 },
      recentSourceKeys: new Set(), mineSignals, claimDeps: { fingerprints: fingerprints(), ...deps({ readNotes: readVaultNoteDigests }) },
      inspectSourceCandidates: async harvest => {
        const { contentSources, autoresearch } = admitted(harvest)
        for (const [i, row] of autoresearch.source_decisions.entries()) row.inspection.capture_path = path.join(captures, `${i}.jpg`)
        return { content_sources: contentSources, sources: contentSources, autoresearch, content_source_count: 6 }
      } })).rejects.toThrow(/capture integrity/)
  })
})
