import { it, expect } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import { execFileSync } from 'node:child_process'
import { syntheticProofContext, syntheticReview } from '../fixtures/independent-review.mjs'
import { commitPublishedArtifacts, completeCandidatePublication } from '../../scripts/run-daily-publish-cron.mjs'
import { repairRejectedCandidate } from '../../scripts/lib/independent-review-repair.mjs'

it.each(['mid-copy','after-copy'])('SYNTHETIC %s snapshot interruption resumes actual changed PNG and local bare-git push exactly once', async point => {
 const scratch=path.resolve('tmp/review-restart-fixtures');await fs.mkdir(scratch,{recursive:true});const root=await fs.mkdtemp(path.join(scratch,'localbare-'))
 const git=(...args)=>execFileSync('git',args,{cwd:root,stdio:'pipe'}).toString().trim()
 git('init','-q');git('config','status.showUntrackedFiles','all');git('config','user.name','Synthetic test');git('config','user.email','synthetic@example.invalid');await fs.mkdir(path.join(root,'tmp'));await fs.writeFile(path.join(root,'.git/info/exclude'),'tmp/\n');await fs.writeFile(path.join(root,'README'),'SYNTHETIC isolated fixture');git('add','README');git('commit','-qm','baseline')
 const bare=path.join(root,'tmp/remote.git');git('init','--bare','-q',bare);git('remote','add','origin',bare)
 const editionId='2099-01-01-synthetic-v1';const f=await syntheticProofContext(editionId,root,path.join(root,'tmp/daily-process-runs/initial'));const initial={worktreeDir:root,runDir:f.latest_run_dir,editionId};await fs.rm(path.join(initial.runDir,'independent-visual-review.json'))
 for(const name of ['source-research.json','signal-harvest.json'])await fs.writeFile(path.join(initial.runDir,name),'{}')
 const ledger=JSON.stringify({shared_budget:{acquisitions:23,inspections:24},SYNTHETIC:true});await fs.writeFile(path.join(initial.runDir,'bookmark-acquisition.json'),ledger)
 await fs.writeFile(path.join(root,'public/editions/index.json'),JSON.stringify({current_edition_id:editionId,editions:[{edition_id:editionId,is_live:true,path:`/editions/${editionId}`,preview_asset_path:`/editions/${editionId}/assets/preview.png`}]}))
 const before=await fs.readFile(path.join(root,'public/editions',editionId,'assets/plate.png'));const statePath=path.join(root,'tmp/day.json');let reviews=0,repairs=0
 const adapters={prepare:async()=>{},review:async o=>{reviews++;const {file}=await syntheticReview(o,{record:false});const r=JSON.parse(await fs.readFile(file));if(reviews===1){r.verdict='BLOCK';r.findings[0].status='failed';r.adverse_findings=['SYNTHETIC missing red mass']}await fs.writeFile(file,JSON.stringify(r));return file},repair:async(o,action,next)=>{repairs++;return repairRejectedCandidate(o,action,next,{generationOptions:{date:'2099-01-01'},generate:async({payload},dir)=>{expect(payload.scene_prompt).toContain('missing red mass');const outputPath=path.join(dir,'plate.png');await fs.writeFile(outputPath,await sharp({create:{width:120,height:80,channels:3,background:'#e02030'}}).png().toBuffer());return{outputPath}},audit:async()=>{},map:async()=>({SYNTHETIC:true}),assemble:async({runDir,plate})=>{const dir=path.join(root,'public/editions',editionId);for(const name of ['plate.png','preview.png'])await fs.copyFile(plate.outputPath,path.join(dir,'assets',name));await fs.writeFile(path.join(runDir,'edition-package-summary.json'),JSON.stringify({edition_id:editionId,edition_dir:dir}));return{editionId}},postprocess:async()=>{}})},publish:o=>commitPublishedArtifacts(root,editionId,'main',{runDir:o.runDir})}
 const originalCopy=fs.copyFile,originalRename=fs.rename;let armed=true
 fs.copyFile=async(...a)=>{await originalCopy(...a);if(point==='mid-copy'&&armed&&String(a[1]).includes('rejected-package')){armed=false;throw Error('SYNTHETIC snapshot interruption')}}
 fs.rename=async(...a)=>{if(point==='after-copy'&&armed&&a[1]===statePath){const s=JSON.parse(await fs.readFile(a[0]));if(s.pending_repair?.snapshot?.phase==='ready'){armed=false;throw Error('SYNTHETIC snapshot interruption')}}return originalRename(...a)}
 try{await expect(completeCandidatePublication(initial,{branch:'main',statePath},adapters)).rejects.toThrow(/snapshot interruption/)}finally{fs.copyFile=originalCopy;fs.rename=originalRename}
 const charged=JSON.parse(await fs.readFile(statePath));expect(charged.repairs).toBe(1);expect(charged.pending_repair.snapshot.phase).toBe('charged');expect(repairs).toBe(0)
 const result=await completeCandidatePublication(initial,{branch:'main',statePath},adapters);expect(result.push_succeeded).toBe(true);const remote=git('ls-remote','origin','refs/heads/main').split(/\s/)[0];expect(remote).toBe(result.commit);expect(repairs).toBe(1);expect(reviews).toBe(2)
 expect(await fs.readFile(path.join(initial.runDir,'rejected-package/assets/plate.png'))).toEqual(before);expect(await fs.readFile(path.join(root,'public/editions',editionId,'assets/plate.png'))).not.toEqual(before)
 expect(JSON.parse(await fs.readFile(path.join(initial.runDir,'independent-visual-review.json'))).verdict).toBe('BLOCK');expect(await fs.readFile(path.join(result.candidate.runDir,'bookmark-acquisition.json'),'utf8')).toBe(ledger)
 expect((await completeCandidatePublication(initial,{branch:'main',statePath},adapters)).commit).toBe(result.commit);expect(repairs).toBe(1);expect(reviews).toBe(2);expect(git('rev-list','--count','HEAD')).toBe('2')
 console.log(JSON.stringify({SYNTHETIC_ONLY:true,point,charged_before_snapshot:true,reviews,repairs,commit:result.commit,remote_commit:remote,bare,original_BLOCK_preserved:true,original_plate_preserved:true,ledger_preserved:true,real_provider_calls:0,production_publication:false}))
})
