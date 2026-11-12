import { it, expect } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import { syntheticProofContext, syntheticReview } from '../fixtures/independent-review.mjs'
import { continueReviewedPublication } from '../../scripts/lib/review-continuation.mjs'
import { repairRejectedCandidate } from '../../scripts/lib/independent-review-repair.mjs'
import { independentReviewExpectation } from '../../scripts/lib/independent-visual-review.mjs'
import { resolveReviewContinuation } from '../../scripts/lib/cron-reliability.mjs'
import { readCandidateCheckpoint } from '../../scripts/lib/cron-recovery-state.mjs'
const scratch=path.resolve('tmp/review-restart-fixtures')
async function fixture(){await fs.mkdir(scratch,{recursive:true});const root=await fs.mkdtemp(path.join(scratch,'restart-SYNTHETIC-'));const editionId='2099-01-01-synthetic-v1';const f=await syntheticProofContext(editionId,root,path.join(root,'tmp/daily-process-runs/old'));return{worktreeDir:root,runDir:f.latest_run_dir,editionId}}
async function blocked(o){const {file}=await syntheticReview(o,{record:false});const r=JSON.parse(await fs.readFile(file));r.verdict='BLOCK';r.findings[0].status='failed';r.adverse_findings=['SYNTHETIC failed composition'];await fs.writeFile(file,JSON.stringify(r));return file}
async function planningFixture(){const o=await fixture();for(const n of ['source-research.json','signal-harvest.json'])await fs.writeFile(path.join(o.runDir,n),'{}');const p=path.join(o.runDir,'daily-generation-payload.json');const payload=JSON.parse(await fs.readFile(p));payload.source_image_fingerprints=[{image_url:'https://example.org/SYNTHETIC.png'}];await fs.writeFile(p,JSON.stringify(payload));return{o,next:path.join(o.worktreeDir,'tmp/daily-process-runs/new'),action:{adverse_findings:['SYNTHETIC failed plate'],findings:[]}}}
it('exclusive planning guard prevents accepted-unknown repeats and retains diagnostics',async()=>{
 const {o,next,action}=await planningFixture();let calls=0;const adapters={generationOptions:{},replan:async(_,io)=>{calls++;await io.record('request',{SYNTHETIC:true});await io.record('response',{raw:'accepted unknown'});throw Error('SYNTHETIC accepted unknown')},generate:async()=>{throw Error('must not generate')}}
 await expect(repairRejectedCandidate(o,action,next,adapters)).rejects.toThrow(/accepted unknown/);const raw=await fs.readFile(path.join(next,'real-mark-plan.response.json'),'utf8');await expect(repairRejectedCandidate(o,action,next,adapters)).rejects.toThrow(/reconcile.*repair-planning-request/i);expect(calls).toBe(1);expect(await fs.readFile(path.join(next,'real-mark-plan.response.json'),'utf8')).toBe(raw)
})
it('saved exact successful plan resumes without replan after payload-write interruption',async()=>{
 const {o,next,action}=await planningFixture();let calls=0;const adapters={generationOptions:{},replan:async({payload})=>{calls++;return payload},generate:async()=>{throw Error('SYNTHETIC generation boundary')}}
 const original=fs.writeFile;let once=true;fs.writeFile=async(...a)=>{if(once&&a[0]===path.join(next,'daily-generation-payload.json')){once=false;throw Error('SYNTHETIC payload interruption')}return original(...a)}
 try{await expect(repairRejectedCandidate(o,action,next,adapters)).rejects.toThrow(/payload interruption/)}finally{fs.writeFile=original}
 await expect(repairRejectedCandidate(o,action,next,adapters)).rejects.toThrow(/generation boundary/);expect(calls).toBe(1)
})
it('malformed partial planning guard fails closed without provider work',async()=>{const{o,next,action}=await planningFixture();await fs.mkdir(next,{recursive:true});await fs.writeFile(path.join(next,'repair-planning-request.json'),'{');let calls=0;await expect(repairRejectedCandidate(o,action,next,{generationOptions:{},replan:async()=>{calls++;throw Error('provider invoked')}})).rejects.toThrow(/planning.*reconcil/i);expect(calls).toBe(0)})
it('canonical filesystem aliases preserve exact stored evidence, reject wrong/missing paths',async()=>{
 const o=await fixture();const alias=path.join(o.worktreeDir,'alias');await fs.symlink(o.worktreeDir,alias,'dir');const a={...o,worktreeDir:alias,runDir:path.join(alias,path.relative(o.worktreeDir,o.runDir))};const next={...a,runDir:`${a.runDir}-repair`};await fs.cp(o.runDir,next.runDir,{recursive:true});const binding=independentReviewExpectation(a),replacement=independentReviewExpectation(next);const statePath=path.join(o.worktreeDir,'state.json');const state={schema_version:1,initial:a,current:next,repairs:1,blocked_plate_sha256:[binding.candidate_files['assets/plate.png']]};await fs.writeFile(statePath,JSON.stringify(state));await fs.writeFile(path.join(o.runDir,'automatic-review-successor.json'),JSON.stringify({disposition:'REPLACED_AFTER_BLOCK',publication_authorized:false,state_path:statePath,blocked_binding:binding,replacement_binding:replacement,successor:next}));const summary={worktree_dir:alias,latest_run_dir:a.runDir,local_edition_id:o.editionId,review_continuation_state:statePath};const checkpoint=path.join(o.worktreeDir,'checkpoint.json');await fs.writeFile(checkpoint,JSON.stringify(summary));expect((await resolveReviewContinuation(summary,o.worktreeDir)).latest_run_dir).toBe(next.runDir);expect((await readCandidateCheckpoint(checkpoint,o.worktreeDir)).worktree_dir).toBe(alias);expect(JSON.parse(await fs.readFile(statePath))).toEqual(state)
 await expect(resolveReviewContinuation(summary,path.dirname(o.worktreeDir))).rejects.toThrow();await expect(resolveReviewContinuation(summary,path.join(o.worktreeDir,'missing'))).rejects.toThrow()
})
