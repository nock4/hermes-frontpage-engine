import { describe, it, expect } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { syntheticProofContext, syntheticReview } from '../fixtures/independent-review.mjs'
import { ensureAutomaticReview, prepareAutomaticEvidence } from '../../scripts/lib/automatic-visual-review.mjs'
import { continueReviewedPublication } from '../../scripts/lib/review-continuation.mjs'

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'automatic-review-SYNTHETIC-'))
  const editionId = '2099-01-01-synthetic-v1'
  const context = await syntheticProofContext(editionId, root)
  const options = { worktreeDir: root, runDir: context.latest_run_dir, editionId }
  await fs.rm(path.join(options.runDir, 'independent-visual-review.json'))
  return options
}
const review = async options => (await syntheticReview(options, { record: false })).file

describe('automatic independent candidate review', () => {
  it('retries evidence-only capture after a runtime/build defect without a provider vote or generation, retaining the failed capture',async()=>{
    const options=await fixture();let captures=0;const directory=path.join(options.runDir,'automatic-review')
    const capture=async()=>{captures++;await fs.mkdir(directory);await fs.writeFile(path.join(directory,'partial.txt'),'SYNTHETIC capture attempt');if(captures===1)throw Error('SYNTHETIC stale build');await fs.writeFile(path.join(directory,'evidence.json'),JSON.stringify({SYNTHETIC:true}));return{SYNTHETIC:true}}
    await expect(prepareAutomaticEvidence(options,{capture})).rejects.toThrow(/stale build/)
    await expect(fs.access(path.join(options.runDir,'automatic-review-request.json'))).rejects.toThrow()
    expect(await prepareAutomaticEvidence(options,{capture})).toEqual({SYNTHETIC:true})
    expect(captures).toBe(2)
    const retained=(await fs.readdir(options.runDir)).filter(name=>name.startsWith('automatic-review-capture-failed-'))
    expect(retained).toHaveLength(1);expect(await fs.readFile(path.join(options.runDir,retained[0],'partial.txt'),'utf8')).toContain('SYNTHETIC')
  })
  it('obtains a missing review then reuses the exact PASS without another provider call', async () => {
    const options = await fixture(); let calls = 0
    const adapter = async o => { calls++; return review(o) }
    expect((await ensureAutomaticReview(options, { review: adapter })).verdict).toBe('PASS')
    expect((await ensureAutomaticReview(options, { review: adapter })).verdict).toBe('PASS')
    expect(calls).toBe(1)
  })
  it('retains BLOCK and emits an executable owner action without rerolling unchanged bytes', async () => {
    const options = await fixture(); let calls = 0
    const adapter = async o => {
      calls++; const file = await review(o); const report = JSON.parse(await fs.readFile(file))
      report.verdict = 'BLOCK'; report.findings[0].status = 'failed'; report.adverse_findings = ['SYNTHETIC source identity lost']
      await fs.writeFile(file, JSON.stringify(report)); return file
    }
    for (let i = 0; i < 2; i++) await expect(ensureAutomaticReview(options, { review: adapter })).rejects.toMatchObject({ code: 'INDEPENDENT_REVIEW_RECOVERY', action: { kind: 'repair-or-replace', run_dir: options.runDir } })
    expect(calls).toBe(1)
    expect(JSON.parse(await fs.readFile(path.join(options.runDir, 'independent-visual-review.json'))).verdict).toBe('BLOCK')
  })
  it('does not call a reviewer for a previously retained canonical disposition BLOCK', async () => {
    const options=await fixture();let calls=0
    await fs.writeFile(path.join(options.runDir,'CANDIDATE-DISPOSITION.json'),JSON.stringify({disposition:'BLOCK',publication_authorized:false}))
    await expect(ensureAutomaticReview(options,{review:async o=>{calls++;return review(o)}})).rejects.toThrow(/canonical disposition BLOCK/)
    expect(calls).toBe(0)
  })
  it('does not retry an interrupted review automatically or accept stale PASS', async () => {
    const options = await fixture(); let calls = 0
    const adapter = async () => { calls++; throw Error('SYNTHETIC provider interrupted') }
    await expect(ensureAutomaticReview(options, { review: adapter })).rejects.toMatchObject({code:'INDEPENDENT_REVIEW_PROVIDER',message:'SYNTHETIC provider interrupted'})
    await expect(ensureAutomaticReview(options, { review: adapter })).rejects.toThrow(/incomplete|interrupted/)
    expect(calls).toBe(1)
  })
  it('uncertain evidence is an owner/external blocker, never a reason to generate another plate', async () => {
    const options=await fixture();let repairs=0
    const reviewer=async current=>{const file=await review(current);const report=JSON.parse(await fs.readFile(file));report.verdict='BLOCK';report.findings[0].status='uncertain';report.adverse_findings=['SYNTHETIC source fetch unavailable'];await fs.writeFile(file,JSON.stringify(report));return file}
    await expect(continueReviewedPublication(options,{statePath:path.join(options.worktreeDir,'day.json'),prepare:async()=>{},review:reviewer,repair:async()=>{repairs++;throw Error('must not generate')},publish:async()=>{throw Error('must not publish')}})).rejects.toMatchObject({code:'REVIEW_EVIDENCE_BLOCKER'})
    expect(repairs).toBe(0)
  })
  it('a persisted exhausted day repair allowance cannot be replenished by owner restart', async () => {
    const options=await fixture();const statePath=path.join(options.worktreeDir,'day.json')
    await fs.writeFile(statePath,JSON.stringify({schema_version:1,initial:options,current:options,repairs:3,blocked_plate_sha256:[],pending_repair:null}))
    const reviewer=async current=>{const file=await review(current);const report=JSON.parse(await fs.readFile(file));report.verdict='BLOCK';report.findings[0].status='failed';report.adverse_findings=['SYNTHETIC plate rejected'];await fs.writeFile(file,JSON.stringify(report));return file}
    const adapters={statePath,prepare:async()=>{},review:reviewer,repair:async()=>{throw Error('must not generate')},publish:async()=>{throw Error('must not publish')}}
    await expect(continueReviewedPublication(options,adapters)).rejects.toThrow(/hard repair limit exhausted/)
    await expect(continueReviewedPublication(options,adapters)).rejects.toThrow(/hard repair limit exhausted/)
    expect(JSON.parse(await fs.readFile(statePath)).repairs).toBe(3)
  })
})
