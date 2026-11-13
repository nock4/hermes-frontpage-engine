import { it, expect, vi } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { syntheticProofContext, syntheticReview } from '../fixtures/independent-review.mjs'
import { independentReviewExpectation } from '../../scripts/lib/independent-visual-review.mjs'
import { ensureAutomaticReview } from '../../scripts/lib/automatic-visual-review.mjs'
// No test may reach a real CLI, gateway or model. All transport is SYNTHETIC.
vi.mock('node:child_process', async importOriginal => ({ ...await importOriginal(), spawn: () => { throw Error('SYNTHETIC test forbids real provider') }, execFile: () => { throw Error('SYNTHETIC test forbids real gateway') } }))
const hash = x => createHash('sha256').update(x).digest('hex')
// DATA ONLY: sanitized exact assistant row from retained Nov9 export. No prompts/auth.
const nov9 = { role: 'assistant', content: 'Your request was not processed. Send it again if you still want me to carry it out.', display_kind: 'failed_turn', tool_calls: null }
const scratch = path.resolve('tmp/reviewer-transport-SYNTHETIC')
async function fixture(legacy = true) {
  await fs.mkdir(scratch, { recursive: true })
  const root = await fs.mkdtemp(path.join(scratch, 'run-'))
  const editionId = '2099-01-01-synthetic-v1'
  const context = await syntheticProofContext(editionId, root)
  const o = { worktreeDir: root, runDir: context.latest_run_dir, editionId }
  await fs.rm(path.join(o.runDir, 'independent-visual-review.json'))
  const dir = path.join(o.runDir, 'automatic-review'); await fs.mkdir(dir, { recursive: true })
  const binding = independentReviewExpectation(o)
  const bytes = Buffer.from('SYNTHETIC immutable image evidence')
  await fs.writeFile(path.join(dir, 'source.png'), bytes)
  await fs.writeFile(path.join(dir, 'evidence.json'), JSON.stringify({ binding, evidence: [{ path: 'automatic-review/source.png', sha256: hash(bytes), role: 'source' }], source_snapshot: { path: null, sha256: null, unavailable_reason: 'SYNTHETIC no fetched source' } }))
  const raw = JSON.stringify({ type: 'system', subtype: 'init', session_id: '' }) + '\n'
  if (legacy) {
    await fs.writeFile(path.join(dir, 'hermes.stdout.jsonl'), raw)
    await fs.writeFile(path.join(dir, 'hermes.stderr.txt'), 'Session: SYNTHETIC-original\n')
  }
  return { o, dir, raw }
}
function failure(prompt) {
  return { session_id: 'SYNTHETIC-original', running: false, execution_generation: 1, pending: [], prompts: [], prompt_sha256: hash(prompt),
    receipt: { admission_id: 'SYNTHETIC-admitted', ref: { session_id: 'SYNTHETIC-original' }, status: 'terminal', outcome: 'failed', execution_generation: 1,
      result: { failed: true, completed: false, partial: false, failure_reason: 'timeout', error: 'SYNTHETIC provider exhausted retries', messages: [nov9], final_response: 'SYNTHETIC infrastructure notice', input_tokens: 0, output_tokens: 0 } } }
}
async function successfulRun(o, args, cwd, dir) {
  const binding = independentReviewExpectation(o)
  const manifest = JSON.parse(await fs.readFile(path.join(o.runDir, 'automatic-review/evidence.json')))
  const rows = manifest.evidence.filter(r => r.path.endsWith('.png')).flatMap((r, i) => [
    { type: 'tool_use', name: 'vision_analyze', tool_call_id: `SYNTHETIC-${i}`, input: { image_url: path.join(o.runDir, r.path) } },
    { type: 'tool_result', name: 'vision_analyze', tool_call_id: `SYNTHETIC-${i}`, is_error: false, output: JSON.stringify({ success: true, analysis: 'SYNTHETIC successful pixels' }) }])
  const report = { verdict: 'PASS', findings: binding.required_clauses.map(r => ({ ...r, status: 'fulfilled', visible_evidence: 'SYNTHETIC visible evidence', context: 'SYNTHETIC source and plate', reason: 'SYNTHETIC clause fulfilled' })), adverse_findings: [] }
  rows.push({ type: 'result', session_id: 'SYNTHETIC-actual-retry-session', exit_code: 0, text: JSON.stringify(report) })
  await fs.writeFile(path.join(dir, 'hermes.stdout.jsonl'), rows.map(r => JSON.stringify(r)).join('\n'), { flag: 'wx' })
  await fs.writeFile(path.join(dir, 'hermes.stderr.txt'), 'session_id: SYNTHETIC-actual-retry-session', { flag: 'wx' })
}
function transport(o, mutate = x => x) {
  const calls = { run: 0, reconcile: 0 }
  return { calls,
    reconcile: async ({ prompt }) => { calls.reconcile++; return mutate(failure(prompt)) },
    run: async (...args) => { calls.run++; return successfulRun(o, ...args) } }
}
it('normal adapter reconciles exact Nov9 terminal-unprocessed turn, charges ONE immutable transport retry, resumes canonical PASS without reroll', async () => {
  const { o, dir, raw } = await fixture(); const t = transport(o)
  expect((await ensureAutomaticReview(o, { transport: t })).verdict).toBe('PASS')
  expect(t.calls.run).toBe(1); expect(t.calls.reconcile).toBeGreaterThanOrEqual(2)
  expect(await fs.readFile(path.join(dir, 'hermes.stdout.jsonl'), 'utf8')).toBe(raw)
  const intent = JSON.parse(await fs.readFile(path.join(dir, 'transport-attempts/001/intent.json')))
  expect(intent.kind).toBe('transport-retry'); expect(intent.original_raw_sha256).toBe(hash(raw))
  expect((await ensureAutomaticReview(o, { transport: t })).verdict).toBe('PASS'); expect(t.calls.run).toBe(1)
  const canonical = JSON.parse(await fs.readFile(path.join(o.runDir, 'independent-visual-review.json')))
  expect(canonical.reviewer.session_id).toBe('SYNTHETIC-actual-retry-session')
})
it('terminal failed CLI envelope is infrastructure, not a semantic vote, only when its exact receipt proves unprocessed', async () => {
  const { o, dir } = await fixture(); const t = transport(o)
  const v = failure('SYNTHETIC').receipt.result
  await fs.appendFile(path.join(dir, 'hermes.stdout.jsonl'), JSON.stringify({ type: 'result', session_id: 'SYNTHETIC-original', exit_code: 1, error: v.error, text: v.final_response }) + '\n')
  expect((await ensureAutomaticReview(o, { transport: t })).verdict).toBe('PASS'); expect(t.calls.run).toBe(1)
})
it('terminal failed envelope containing different review prose never retries', async () => {
  const { o, dir } = await fixture(); const t = transport(o); const v = failure('SYNTHETIC').receipt.result
  await fs.appendFile(path.join(dir, 'hermes.stdout.jsonl'), JSON.stringify({ type: 'result', session_id: 'SYNTHETIC-original', exit_code: 1, error: v.error, text: 'SYNTHETIC uncertain source identity' }) + '\n')
  await expect(ensureAutomaticReview(o, { transport: t })).rejects.toThrow(/reconcil|unprocessed/i); expect(t.calls.run).toBe(0)
})
it('fresh original failure automatically reconciles and retries within the same normal invocation', async () => {
  const { o } = await fixture(false); const t = transport(o)
  t.run = async (...a) => {
    t.calls.run++
    if (t.calls.run === 1) {
      await fs.writeFile(path.join(a[2], 'hermes.stdout.jsonl'), JSON.stringify({ type: 'system', subtype: 'init', session_id: '' }) + '\n', { flag: 'wx' })
      await fs.writeFile(path.join(a[2], 'hermes.stderr.txt'), 'session_id: SYNTHETIC-original\n', { flag: 'wx' })
      throw Error('SYNTHETIC viewer exited after known terminal failure')
    }
    await successfulRun(o, ...a)
  }
  expect((await ensureAutomaticReview(o, { transport: t })).verdict).toBe('PASS'); expect(t.calls.run).toBe(2)
})
it('fresh normal path persists exclusive intent before I/O and restart reuses raw without another provider call', async () => {
  const { o, dir } = await fixture(false); const t = transport(o)
  t.run = async (...a) => { t.calls.run++; expect(JSON.parse(await fs.readFile(path.join(dir, 'transport-attempts/000/intent.json'))).kind).toBe('original'); await successfulRun(o, ...a) }
  expect((await ensureAutomaticReview(o, { transport: t })).verdict).toBe('PASS')
  await fs.rm(path.join(o.runDir, 'independent-visual-review.json'))
  expect((await ensureAutomaticReview(o, { transport: t })).verdict).toBe('PASS')
  expect(t.calls.run).toBe(1); expect(t.calls.reconcile).toBe(0)
})
it.each([
  ['running', x => ({ ...x, running: true })], ['unknown', x => ({ ...x, receipt: { ...x.receipt, status: 'unknown' } })],
  ['queued', x => ({ ...x, pending: [{}] })], ['generation changed', x => ({ ...x, execution_generation: 2 })],
  ['wrong session', x => ({ ...x, session_id: 'SYNTHETIC-wrong' })], ['wrong prompt', x => ({ ...x, prompt_sha256: '0'.repeat(64) })],
  ['timeout only', x => ({ ...x, receipt: { ...x.receipt, result: { ...x.receipt.result, messages: [] } } })],
  ['partial', x => ({ ...x, receipt: { ...x.receipt, result: { ...x.receipt.result, partial: true } } })],
  ['inspection', x => ({ ...x, receipt: { ...x.receipt, result: { ...x.receipt.result, messages: [{ role: 'tool', content: 'SYNTHETIC pixels' }, nov9] } } })],
  ['adverse', x => ({ ...x, receipt: { ...x.receipt, result: { ...x.receipt.result, messages: [{ role: 'assistant', content: 'BLOCK uncertain' }] } } })],
  ['completed', x => ({ ...x, receipt: { ...x.receipt, outcome: 'completed' } })],
  ['not infrastructure', x => ({ ...x, receipt: { ...x.receipt, result: { ...x.receipt.result, failure_reason: 'policy' } } })],
])('never rerolls %s', async (_, mutate) => {
  const { o, dir, raw } = await fixture(); const t = transport(o, mutate)
  await expect(ensureAutomaticReview(o, { transport: t })).rejects.toThrow(/reconcil|terminal|unprocessed/i)
  expect(t.calls.run).toBe(0); expect(await fs.readFile(path.join(dir, 'hermes.stdout.jsonl'), 'utf8')).toBe(raw)
})
it('late original completion wins final preflight and prevents retry', async () => {
  const { o } = await fixture(); const t = transport(o); const reconcile = t.reconcile
  t.reconcile = async a => { const r = await reconcile(a); if (t.calls.reconcile > 1) r.receipt.outcome = 'completed'; return r }
  await expect(ensureAutomaticReview(o, { transport: t })).rejects.toThrow(/reconcil|terminal|unprocessed/i); expect(t.calls.run).toBe(0)
})
it('persisted retry intent survives failure/restart, never replenishes transport or semantic budget', async () => {
  const { o, dir, raw } = await fixture(); const t = transport(o)
  t.run = async (_, __, attemptDir) => { t.calls.run++; await fs.writeFile(path.join(attemptDir, 'hermes.stdout.jsonl'), raw, { flag: 'wx' }); await fs.writeFile(path.join(attemptDir, 'hermes.stderr.txt'), 'session_id: SYNTHETIC-original'); throw Error('SYNTHETIC viewer timeout') }
  await expect(ensureAutomaticReview(o, { transport: t })).rejects.toThrow(/viewer timeout/)
  await expect(ensureAutomaticReview(o, { transport: t })).rejects.toThrow(/exhausted|reconcil/i)
  expect(t.calls.run).toBe(1); expect(await fs.readFile(path.join(dir, 'hermes.stdout.jsonl'), 'utf8')).toBe(raw)
})
it('exclusive owner permits one retry under concurrent resume', async () => {
  const { o } = await fixture(); const t = transport(o)
  const results = await Promise.allSettled([ensureAutomaticReview(o, { transport: t }), ensureAutomaticReview(o, { transport: t })])
  expect(results.some(r => r.status === 'fulfilled')).toBe(true); expect(t.calls.run).toBe(1)
})
it.each(['evidence', 'candidate', 'context', 'raw'])('rejects changed %s before retry', async kind => {
  const { o, dir } = await fixture(); const t = transport(o)
  // First reconciliation establishes immutable intent, then stops before retry.
  t.reconcile = async () => { throw Error('SYNTHETIC gateway outage') }
  await expect(ensureAutomaticReview(o, { transport: t })).rejects.toThrow()
  if (kind === 'evidence') await fs.writeFile(path.join(dir, 'source.png'), 'SYNTHETIC changed')
  if (kind === 'candidate') await fs.appendFile(path.join(o.worktreeDir, 'public/editions', o.editionId, 'assets/plate.png'), 'SYNTHETIC changed')
  if (kind === 'context') { const p = path.join(dir, 'evidence.json'); const m = JSON.parse(await fs.readFile(p)); m.source_snapshot.extra = 'SYNTHETIC changed'; await fs.writeFile(p, JSON.stringify(m)) }
  if (kind === 'raw') await fs.appendFile(path.join(dir, 'hermes.stdout.jsonl'), '\n')
  await expect(ensureAutomaticReview(o, { transport: transport(o) })).rejects.toThrow(/changed|stale|mismatch/i)
  expect(t.calls.run).toBe(0)
})
it('rejects duplicate manifest keys before any transport', async () => {
  const { o, dir } = await fixture(); const file = path.join(dir, 'evidence.json')
  const text = await fs.readFile(file, 'utf8'); await fs.writeFile(file, text.replace('{"binding":', '{"binding":null,"binding":'))
  const t = transport(o); await expect(ensureAutomaticReview(o, { transport: t })).rejects.toThrow(/duplicate/i)
  expect(t.calls.run).toBe(0); expect(t.calls.reconcile).toBe(0)
})
it.each(['text', 'tool_use', 'tool_result'])('retains partial stdout %s without another call even with failed_turn receipt', async type => {
  const { o, dir } = await fixture(); await fs.appendFile(path.join(dir, 'hermes.stdout.jsonl'), JSON.stringify({ type, text: 'SYNTHETIC partial inspection' }) + '\n')
  const t = transport(o); await expect(ensureAutomaticReview(o, { transport: t })).rejects.toThrow(/reconcil|unprocessed/i); expect(t.calls.run).toBe(0)
})
it('late genuine canonical PASS during reconciliation short circuits with no retry', async () => {
  const { o } = await fixture(); const t = transport(o)
  t.reconcile = async ({ prompt }) => { await syntheticReview(o); return failure(prompt) }
  expect((await ensureAutomaticReview(o, { transport: t })).verdict).toBe('PASS'); expect(t.calls.run).toBe(0)
})
it('retained request with no launch intent/raw is unknown, never proof of nonacceptance', async () => {
  const { o } = await fixture(false); const t = transport(o)
  await fs.writeFile(path.join(o.runDir, 'automatic-review-request.json'), JSON.stringify({ binding: independentReviewExpectation(o), status: 'requested' }, null, 2))
  await expect(ensureAutomaticReview(o, { transport: t })).rejects.toThrow(/unknown|reconcil/i)
  expect(t.calls.run).toBe(0)
})
it('charged original with absent raw is ambiguous, never launches on restart', async () => {
  const { o, dir } = await fixture(false); const t = transport(o)
  t.run = async () => { t.calls.run++; throw Error('SYNTHETIC admission unknown') }
  await expect(ensureAutomaticReview(o, { transport: t })).rejects.toThrow(/unknown|reconcil/i)
  await expect(ensureAutomaticReview(o, { transport: t })).rejects.toThrow(/unknown|reconcil/i)
  expect(t.calls.run).toBe(1); expect(await fs.readFile(path.join(dir, 'transport-attempts/000/intent.json'), 'utf8')).toContain('original')
})
it('retains completed adverse BLOCK verbatim without a new vote', async () => {
  const { o, dir } = await fixture(); await fs.rm(path.join(dir, 'hermes.stdout.jsonl')); await fs.rm(path.join(dir, 'hermes.stderr.txt'))
  await successfulRun(o, [], o.worktreeDir, dir)
  const p = path.join(dir, 'hermes.stdout.jsonl'); const rows = (await fs.readFile(p, 'utf8')).split('\n').map(JSON.parse)
  const report = JSON.parse(rows.at(-1).text); report.verdict = 'BLOCK'; report.findings[0].status = 'uncertain'; report.adverse_findings = ['SYNTHETIC unreadable source']; rows.at(-1).text = JSON.stringify(report)
  await fs.writeFile(p, rows.map(r => JSON.stringify(r)).join('\n')); const original = await fs.readFile(p)
  const t = transport(o); await expect(ensureAutomaticReview(o, { transport: t })).rejects.toMatchObject({ code: 'INDEPENDENT_REVIEW_RECOVERY' })
  expect(t.calls.run).toBe(0); expect(t.calls.reconcile).toBe(0); expect(await fs.readFile(p)).toEqual(original)
  expect(JSON.parse(await fs.readFile(path.join(o.runDir, 'independent-visual-review.json'))).adverse_findings).toEqual(report.adverse_findings)
})
async function lateCompletion(verdict = 'PASS', initial = 'outage', fenced = false) {
  const f = await fixture(); const t = transport(f.o)
  t.reconcile = async ({ prompt }) => {
    if (initial === 'outage') throw Error('SYNTHETIC temporary owner outage')
    const s = failure(prompt); s.running = true; s.receipt.status = 'running'; s.receipt.outcome = null; return s
  }
  await expect(ensureAutomaticReview(f.o, { transport: t })).rejects.toThrow(/outage|unprocessed/)
  const staging = path.join(f.dir, 'SYNTHETIC-completed'); await fs.mkdir(staging)
  await successfulRun(f.o, [], f.o.worktreeDir, staging)
  const rows = (await fs.readFile(path.join(staging, 'hermes.stdout.jsonl'), 'utf8')).split('\n').map(JSON.parse)
  const end = rows.at(-1); end.session_id = 'SYNTHETIC-original'
  const report = JSON.parse(end.text)
  if (verdict === 'BLOCK') { report.verdict = 'BLOCK'; report.findings[0].status = 'uncertain'; report.adverse_findings = ['SYNTHETIC original adverse'] }
  end.text = fenced ? '```json\n' + JSON.stringify(report) + '\n```' : JSON.stringify(report)
  await fs.appendFile(path.join(f.dir, 'hermes.stdout.jsonl'), rows.map(JSON.stringify).join('\n') + '\n')
  t.reconcile = async ({ prompt }) => {
    t.calls.reconcile++
    const state = failure(prompt); state.receipt.outcome = 'completed'
    state.receipt.result = { failed: false, completed: true, partial: false, final_response: end.text,
      messages: rows.filter(r => r.type === 'tool_use').flatMap(r => [
        { role: 'assistant', content: '', tool_calls: [{ id: r.tool_call_id, type: 'function', function: { name: r.name, arguments: JSON.stringify(r.input) } }] },
        { role: 'tool', tool_call_id: r.tool_call_id, content: rows.find(v => v.type === 'tool_result' && v.tool_call_id === r.tool_call_id).output },
      ]).concat([{ role: 'assistant', content: end.text }]) }
    return state
  }
  return { ...f, t }
}
it.each(['PASS', 'BLOCK'])('late same-original authoritative %s preserves partial evidence and never launches', async verdict => {
  const { o, dir, raw, t } = await lateCompletion(verdict)
  const intent = await fs.readFile(path.join(dir, 'transport-attempts/000/intent.json'))
  if (verdict === 'PASS') expect((await ensureAutomaticReview(o, { transport: t })).verdict).toBe('PASS')
  else await expect(ensureAutomaticReview(o, { transport: t })).rejects.toMatchObject({ code: 'INDEPENDENT_REVIEW_RECOVERY' })
  const c = JSON.parse(await fs.readFile(path.join(o.runDir, 'independent-visual-review.json')))
  expect(c.verdict).toBe(verdict); expect(c.reviewer.session_id).toBe('SYNTHETIC-original'); expect(t.calls.run).toBe(0)
  expect(await fs.readFile(path.join(dir, 'transport-attempts/000/intent.json'))).toEqual(intent)
  expect(await fs.readFile(path.join(dir, 'transport-attempts/000/original.stdout.snapshot'), 'utf8')).toBe(raw)
  const ref = c.evidence.find(r => r.role.includes('raw session'))
  expect(ref.path).toContain('completed-'); expect(hash(await fs.readFile(path.join(o.runDir, ref.path)))).toBe(ref.sha256)
  await fs.appendFile(path.join(dir, 'hermes.stdout.jsonl'), '\n')
  const closed = { run: () => { throw Error('forbidden') }, reconcile: () => { throw Error('forbidden') } }
  if (verdict === 'PASS') expect((await ensureAutomaticReview(o, { transport: closed })).verdict).toBe('PASS')
  else await expect(ensureAutomaticReview(o, { transport: closed })).rejects.toMatchObject({ code: 'INDEPENDENT_REVIEW_RECOVERY' })
})
it.each(['prefix', 'truncate', 'session', 'running', 'queue', 'generation', 'prompt', 'receipt', 'output', 'inspection', 'partial'])('late extension rejects %s without retry', async kind => {
  const { o, dir, t } = await lateCompletion()
  const file = path.join(dir, 'hermes.stdout.jsonl')
  if (kind === 'prefix') await fs.writeFile(file, (await fs.readFile(file, 'utf8')).replace('"init"', '"evil"'))
  if (kind === 'truncate') await fs.writeFile(file, '{}\n')
  if (kind === 'session') await fs.appendFile(path.join(dir, 'hermes.stderr.txt'), 'Session: SYNTHETIC-other\n')
  const reconcile = t.reconcile
  t.reconcile = async a => { const s = await reconcile(a)
    if (kind === 'running') s.running = true
    if (kind === 'queue') s.pending = [{}]
    if (kind === 'generation') s.execution_generation++
    if (kind === 'prompt') s.prompt_sha256 = '0'.repeat(64)
    if (kind === 'receipt') s.receipt.status = 'unknown'
    if (kind === 'output') s.receipt.result.final_response = '{}'
    if (kind === 'inspection') s.receipt.result.messages = []
    if (kind === 'partial') s.receipt.result.partial = true
    return s }
  await expect(ensureAutomaticReview(o, { transport: t })).rejects.toThrow()
  expect(t.calls.run).toBe(0)
  expect(await fs.access(path.join(o.runDir, 'independent-visual-review.json')).then(() => true, () => false)).toBe(false)
})
it('late completed receipt preserves the existing parser markdown JSON envelope support', async () => {
  const { o, t } = await lateCompletion('PASS', 'outage', true)
  expect((await ensureAutomaticReview(o, { transport: t })).verdict).toBe('PASS'); expect(t.calls.run).toBe(0)
})
it.each(['same', 'admission', 'generation', 'legacy-snapshot'])('running original later completes only its pinned identity: %s', async kind => {
  const { o, dir, t } = await lateCompletion('PASS', 'running')
  const reconcile = t.reconcile
  t.reconcile = async a => { const s = await reconcile(a)
    if (kind === 'admission') s.receipt.admission_id = 'SYNTHETIC-different-admission'
    if (kind === 'generation') { s.execution_generation = 2; s.receipt.execution_generation = 2 }
    return s }
  if (kind === 'legacy-snapshot') await fs.rm(path.join(dir, 'transport-attempts/000/original.stdout.snapshot'))
  if (['same', 'legacy-snapshot'].includes(kind)) expect((await ensureAutomaticReview(o, { transport: t })).verdict).toBe('PASS')
  else await expect(ensureAutomaticReview(o, { transport: t })).rejects.toThrow(/changed/)
  expect(t.calls.run).toBe(0)
})
it('concurrent late completion consumes one frozen original without a new launch', async () => {
  const { o, t } = await lateCompletion()
  const results = await Promise.allSettled([ensureAutomaticReview(o, { transport: t }), ensureAutomaticReview(o, { transport: t })])
  expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1)
  expect(t.calls.run).toBe(0)
})
it('read-only Python bridge uses exact admission/input and two live generation fences (SYNTHETIC RPC only)', async () => {
  const { o } = await fixture()
  const probe = `import asyncio,importlib.util,json,sqlite3,sys,types
from pathlib import Path
from contextlib import asynccontextmanager
from unittest.mock import patch
root=Path(sys.argv[1]); home=root/'.hermes/profiles/frontpage'; home.mkdir(parents=True)
with sqlite3.connect(home/'state.db') as db:
 db.execute('CREATE TABLE session_admissions(admission_id TEXT, generation INT, payload_json TEXT, target_session_id TEXT)')
 db.execute('INSERT INTO session_admissions VALUES(?,?,?,?)',('SYNTHETIC-adm',1,json.dumps({'text':'SYNTHETIC prompt'}),'SYNTHETIC-session'))
prompt=root/'prompt.txt'; prompt.write_text('SYNTHETIC prompt')
spec=importlib.util.spec_from_file_location('review',sys.argv[2]); m=importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
calls=[]
class Client:
 async def rpc(self,method,**params):
  calls.append([method,params])
  if method=='session.resume': return {'session_id':'SYNTHETIC-session','execution_generation':1,'running':False,'pending':[],'prompts':[]}
  assert method=='prompt.receipt' and params['admission_id']=='SYNTHETIC-adm' and params['include_result'] is True
  return {'ref':{'profile_id':str(home),'session_id':'SYNTHETIC-session'},'execution_generation':1,'status':'terminal','result':{'failed':True}}
@asynccontextmanager
async def connect(endpoint):
 assert endpoint=='SYNTHETIC-endpoint'
 yield Client()
cli=types.ModuleType('hermes_cli'); cli.__file__=str(root/'hermes_cli/__init__.py')
gc=types.ModuleType('hermes_cli.gateway_client'); gc.connect_gateway=connect
gr=types.ModuleType('hermes_cli.gateway_runtime'); gr.discover_gateway_endpoint=lambda _:types.SimpleNamespace(state='ready',endpoint='SYNTHETIC-endpoint')
with patch.dict(sys.modules,{'hermes_cli':cli,'hermes_cli.gateway_client':gc,'hermes_cli.gateway_runtime':gr}),patch.object(Path,'home',return_value=root):
 result=asyncio.run(m.observe('SYNTHETIC-session',prompt))
 try: m.admitted_turn(home,'SYNTHETIC-session','changed')
 except ValueError: pass
 else: raise AssertionError('changed prompt accepted')
print(json.dumps({'calls':calls,'result':result}))`
  const output = JSON.parse(execFileSync('python3', ['-c', probe, o.worktreeDir, path.resolve('scripts/lib/review-turn-state.py')], { encoding: 'utf8' }))
  expect(output.calls.map(r => r[0])).toEqual(['session.resume', 'prompt.receipt', 'session.resume'])
  expect(output.result.prompt_sha256).toBe(hash('SYNTHETIC prompt')); expect(output.result.execution_generation).toBe(1)
})

it('reconciles review turns with the Hermes venv Python, not whatever python3 is on PATH', async () => {
  const { hermesPython } = await import('../../scripts/lib/hermes-review-adapter.mjs')
  expect(hermesPython({})).toMatch(/hermes-agent\/venv\/bin\/python3$/)
  expect(hermesPython({ DFE_HERMES_PYTHON: '/custom/python3' })).toBe('/custom/python3')
})
