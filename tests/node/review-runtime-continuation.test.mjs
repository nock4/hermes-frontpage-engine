import { it, expect } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { syntheticProofContext, syntheticReview } from '../fixtures/independent-review.mjs'
import { continueReviewedPublication } from '../../scripts/lib/review-continuation.mjs'

it('opened-source-only BLOCK requires real runtime change, then automatically re-reviews changed runtime in a new context without plate generation or manual receipt', async () => {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'runtime-review-SYNTHETIC-')); const id='2099-01-01-synthetic-v1'
  const f=await syntheticProofContext(id,root,path.join(root,'tmp/daily-process-runs/initial'))
  const options={worktreeDir:root,runDir:f.latest_run_dir,editionId:id}; await fs.rm(path.join(options.runDir,'independent-visual-review.json'))
  await fs.mkdir(path.join(root,'src')); await fs.writeFile(path.join(root,'src/runtime.ts'),'SYNTHETIC clipped runtime')
  const statePath=path.join(root,'tmp/day.json');let calls=0
  const adapters={statePath,prepare:async()=>{},repair:async()=>{throw Error('must not generate')},publish:async()=>({push_succeeded:true,commit:'a'.repeat(40)}),review:async current=>{
    calls++;const {file}=await syntheticReview(current,{record:false});const report=JSON.parse(await fs.readFile(file))
    if(calls===1){report.verdict='BLOCK';report.findings[1].status='failed';report.adverse_findings=['SYNTHETIC opened window clipped']}
    await fs.writeFile(file,JSON.stringify(report));return file
  }}
  await expect(continueReviewedPublication(options,adapters)).rejects.toMatchObject({code:'REVIEW_RUNTIME_REPAIR'})
  await expect(continueReviewedPublication(options,adapters)).rejects.toThrow(/runtime.*unchanged/i)
  expect(calls).toBe(1)
  await fs.writeFile(path.join(root,'src/runtime.ts'),'SYNTHETIC actual corrected runtime')
  const result=await continueReviewedPublication(options,adapters)
  expect(result.push_succeeded).toBe(true);expect(calls).toBe(2)
  expect(result.candidate.runDir).not.toBe(options.runDir)
  expect(JSON.parse(await fs.readFile(path.join(options.runDir,'independent-visual-review.json'))).verdict).toBe('BLOCK')
})
