import { it, expect } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import sharp from 'sharp'
import { syntheticProofContext } from '../fixtures/independent-review.mjs'
import { repairRejectedCandidate } from '../../scripts/lib/independent-review-repair.mjs'

it('default same-source critique repair generates real changed pixels in a new run, preserves full clauses/research/budget, never harvests or resets overrides', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'critique-repair-SYNTHETIC-'))
  const editionId='2099-01-01-synthetic-v1'; const retained=await syntheticProofContext(editionId,root,path.join(root,'tmp/daily-process-runs/old'))
  const options={worktreeDir:root,runDir:retained.latest_run_dir,editionId}
  await fs.writeFile(path.join(options.runDir,'source-research.json'),JSON.stringify({sources:[{url:'https://example.org/synthetic-owner'}]}))
  await fs.writeFile(path.join(options.runDir,'signal-harvest.json'),JSON.stringify({SYNTHETIC:true}))
  await fs.writeFile(path.join(options.runDir,'bookmark-acquisition.json'),JSON.stringify({shared_budget:{acquisitions:23,inspections:24}}))
  const calls=[]
  const action={adverse_findings:['SYNTHETIC wrong red mass'],findings:[{clause_id:'plate-visual-acceptance',status:'failed',reason:'SYNTHETIC compositional source loss'}]}
  const next=path.join(root,'tmp/daily-process-runs/new')
  const result=await repairRejectedCandidate(options,action,next,{
    generationOptions:{date:'2099-01-01',imageBackend:'hermes'},
    generate:async ({payload},runDir)=>{calls.push('generate');expect(JSON.stringify(payload)).toContain('wrong red mass');const outputPath=path.join(runDir,'scene.png');await fs.writeFile(outputPath,await sharp({create:{width:120,height:80,channels:3,background:'#f00'}}).png().toBuffer());return{outputPath}},
    audit:async()=>{calls.push('audit')},
    map:async()=>{calls.push('map');return{SYNTHETIC:true}},
    assemble:async ({runDir,plate})=>{calls.push('assemble'); const dir=path.join(root,'public/editions',editionId);for(const name of ['plate.png','preview.png'])await fs.copyFile(plate.outputPath,path.join(dir,'assets',name));await fs.writeFile(path.join(runDir,'edition-package-summary.json'),JSON.stringify({edition_id:editionId,edition_dir:dir}));return{editionId}},
    postprocess:async()=>{calls.push('postprocess')},
  })
  expect(result.runDir).toBe(next)
  expect(calls).toEqual(['generate','audit','map','assemble','postprocess'])
  expect(await fs.readFile(path.join(next,'bookmark-acquisition.json'),'utf8')).toBe(await fs.readFile(path.join(options.runDir,'bookmark-acquisition.json'),'utf8'))
  expect(await fs.readFile(path.join(next,'source-research.json'),'utf8')).toBe(await fs.readFile(path.join(options.runDir,'source-research.json'),'utf8'))
  await repairRejectedCandidate(options,action,next,{generationOptions:{},generate:()=>{throw Error('duplicate generation')}})
})

it.each(['audit','map'])('a retained failed primary %s is never rerolled on restart of a critique repair',async(stage)=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'critique-audit-SYNTHETIC-'));const editionId='2099-01-01-synthetic-v1'
  const f=await syntheticProofContext(editionId,root,path.join(root,'tmp/daily-process-runs/old'));const options={worktreeDir:root,runDir:f.latest_run_dir,editionId}
  for(const name of ['source-research.json','signal-harvest.json'])await fs.writeFile(path.join(options.runDir,name),'{}')
  let generates=0,audits=0,maps=0
  const adapters={generationOptions:{date:'2099-01-01'},generate:async(_,runDir)=>{generates++;const outputPath=path.join(runDir,'plate.png');await fs.copyFile(path.join(root,'public/editions',editionId,'assets/plate.png'),outputPath);return{outputPath}},audit:async()=>{audits++;if(stage==='audit')throw Error('SYNTHETIC primary audit BLOCK')},map:async()=>{maps++;throw Error('SYNTHETIC primary map BLOCK')}}
  const action={adverse_findings:['SYNTHETIC composition failed'],findings:[]},next=path.join(root,'tmp/daily-process-runs/new')
  await expect(repairRejectedCandidate(options,action,next,adapters)).rejects.toThrow(new RegExp(`primary ${stage} BLOCK`))
  await expect(repairRejectedCandidate(options,action,next,adapters)).rejects.toThrow(new RegExp(`prior.*${stage}|${stage}.*interrupted`,'i'))
  expect(generates).toBe(1);expect(audits).toBe(1);expect(maps).toBe(stage==='map'?1:0)
})
