import { it, expect } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import sharp from 'sharp'
import { execFileSync } from 'node:child_process'
import { syntheticProofContext, syntheticReview } from '../fixtures/independent-review.mjs'
import { commitPublishedArtifacts, completeCandidatePublication } from '../../scripts/run-daily-publish-cron.mjs'
import { continueReviewedPublication } from '../../scripts/lib/review-continuation.mjs'
import { discoverRecovery } from '../../scripts/lib/cron-reliability.mjs'
import { readCandidateCheckpoint } from '../../scripts/lib/cron-recovery-state.mjs'
import { repairRejectedCandidate } from '../../scripts/lib/independent-review-repair.mjs'

it('SYNTHETIC offline actual boundary: reject -> changed package -> new independent review -> local bare-git publish; restart does not review/repair twice', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'review-localbare-SYNTHETIC-'))
  const git = (...args) => execFileSync('git', args, { cwd: root, stdio: 'pipe' }).toString().trim()
  git('init', '-q'); git('config','status.showUntrackedFiles','all'); git('config','user.name','Synthetic test'); git('config','user.email','synthetic@example.invalid')
  await fs.mkdir(path.join(root,'tmp'), {recursive:true}); await fs.writeFile(path.join(root,'.git/info/exclude'),'tmp/\n')
  await fs.writeFile(path.join(root,'README'), 'SYNTHETIC isolated offline publication fixture\n'); git('add','README'); git('commit','-qm','fixture baseline')
  const bare = path.join(root,'tmp/remote.git'); git('init','--bare','-q',bare); git('remote','add','origin',bare)
  const editionId = '2099-01-01-synthetic-v1'
  const initial = await syntheticProofContext(editionId, root, path.join(root,'tmp/daily-process-runs/initial'))
  await fs.rm(path.join(initial.latest_run_dir,'independent-visual-review.json'))
  await fs.writeFile(path.join(initial.latest_run_dir,'source-research.json'),JSON.stringify({sources:[{url:'https://example.org/synthetic-owner'}],SYNTHETIC:true}))
  await fs.writeFile(path.join(initial.latest_run_dir,'signal-harvest.json'),JSON.stringify({SYNTHETIC:true}))
  await fs.writeFile(path.join(initial.latest_run_dir,'bookmark-acquisition.json'),JSON.stringify({shared_budget:{acquisitions:23,inspections:24},SYNTHETIC:true}))
  const manifest = { current_edition_id:editionId, editions:[{edition_id:editionId,is_live:true,path:`/editions/${editionId}`,preview_asset_path:`/editions/${editionId}/assets/preview.png`}] }
  await fs.writeFile(path.join(root,'public/editions/index.json'),JSON.stringify(manifest))
  const initialOptions = { worktreeDir:root,runDir:initial.latest_run_dir,editionId }
  // This is the pre-change failure at the actual exported commit/staged boundary.
  await expect(commitPublishedArtifacts(root,editionId,'main',{runDir:initialOptions.runDir})).rejects.toThrow(/independent visual review/)
  expect(git('diff','--cached','--name-only')).toBe('')
  const calls = []; let reviews = 0; let repairs = 0; let interrupted = false
  const adapters = {
    prepare: async options => { calls.push(`QA:${path.basename(options.runDir)}`); if(options.runDir!==initialOptions.runDir&&!interrupted){interrupted=true;throw Error('SYNTHETIC owner interruption after actual changed package persisted')} },
    review: async options => {
      reviews++; calls.push(`review:${path.basename(options.runDir)}`)
      const {file} = await syntheticReview(options,{record:false}); const report = JSON.parse(await fs.readFile(file))
      if (reviews === 1) { report.verdict='BLOCK'; report.findings[0].status='failed'; report.adverse_findings=['SYNTHETIC compositional critique: black plate lacks source-derived red mass'] }
      await fs.writeFile(file,JSON.stringify(report)); return file
    },
    repair: async (options, action, nextRunDir) => {
      repairs++; expect(action.adverse_findings[0]).toMatch(/red mass/)
      return repairRejectedCandidate(options,action,nextRunDir,{
        generationOptions:{date:'2099-01-01',imageBackend:'hermes'},
        generate:async({payload},runDir)=>{expect(payload.scene_prompt).toContain('source-derived red mass');const outputPath=path.join(runDir,'plate.png');await fs.writeFile(outputPath,await sharp({create:{width:120,height:80,channels:3,background:'#e02030'}}).png().toBuffer());return{outputPath}},
        audit:async()=>{},map:async()=>({SYNTHETIC:true}),
        assemble:async({runDir,plate})=>{const dir=path.join(root,'public/editions',editionId);for(const asset of ['plate.png','preview.png'])await fs.copyFile(plate.outputPath,path.join(dir,'assets',asset));await fs.writeFile(path.join(runDir,'edition-package-summary.json'),JSON.stringify({edition_id:editionId,edition_dir:dir}));return{editionId}},
        postprocess:async()=>{},
      })
    },
    publish: options => commitPublishedArtifacts(root,editionId,'main',{runDir:options.runDir}),
  }
  const statePath = path.join(root,'tmp/day-review.json')
  await expect(completeCandidatePublication(initialOptions, { branch: 'main', statePath }, adapters)).rejects.toThrow(/owner interruption/)
  expect(repairs).toBe(1);expect(reviews).toBe(1)
  expect(JSON.parse(await fs.readFile(statePath)).current.runDir).toBe(`${initialOptions.runDir}-review-repair-1`)
  const result = await completeCandidatePublication(initialOptions, { branch: 'main', statePath }, adapters)
  expect(result.push_succeeded).toBe(true)
  expect(git('ls-remote','origin','refs/heads/main').split(/\s/)[0]).toBe(result.commit)
  expect(reviews).toBe(2); expect(repairs).toBe(1)
  expect(await fs.readFile(path.join(result.candidate.runDir,'bookmark-acquisition.json'),'utf8')).toBe(await fs.readFile(path.join(initialOptions.runDir,'bookmark-acquisition.json'),'utf8'))
  expect(calls).toEqual(['QA:initial','review:initial','QA:initial-review-repair-1','QA:initial-review-repair-1','review:initial-review-repair-1'])
  const rejected = JSON.parse(await fs.readFile(path.join(initialOptions.runDir,'independent-visual-review.json')))
  expect(rejected.verdict).toBe('BLOCK')
  const replay = await continueReviewedPublication(initialOptions, {statePath,...adapters})
  expect(replay.commit).toBe(result.commit); expect(reviews).toBe(2); expect(repairs).toBe(1)
  expect(git('rev-list','--count','HEAD')).toBe('2')
  // Reconcile the ACTUAL existing normal discovery / --resume-candidate boundary
  // after an owner stopped between persisted successor and checkpoint update.
  const store=path.join(root,'tmp/cron-checkpoints'); await fs.mkdir(store,{recursive:true})
  const oldCheckpoint=path.join(store,'old.json'), nextCheckpoint=path.join(store,'next.json')
  const summary={worktree_dir:root,latest_run_dir:initialOptions.runDir,local_edition_id:editionId,review_continuation_state:statePath,updated_at:'2099-01-01T04:00:00Z'}
  await fs.writeFile(oldCheckpoint,JSON.stringify(summary))
  await fs.writeFile(nextCheckpoint,JSON.stringify({...summary,latest_run_dir:result.candidate.runDir,updated_at:'2099-01-01T04:01:00Z'}))
  expect(await discoverRecovery(store,'2099-01-01',root)).toEqual({resumeCandidate:nextCheckpoint})
  expect((await readCandidateCheckpoint(oldCheckpoint,root)).latest_run_dir).toBe(result.candidate.runDir)
  console.log(JSON.stringify({SYNTHETIC_INTEGRATION_ONLY:true,worktree:root,local_bare_remote:bare,commit:result.commit,verified_remote_commit:git('ls-remote','origin','refs/heads/main').split(/\s/)[0],original_verdict:rejected.verdict,reviews,repairs,stages:calls,original_plate_sha256:rejected.binding.candidate_files['assets/plate.png'],replacement_run:result.candidate.runDir,resumed_after_interruption:true,manual_input:false,real_publication:false},null,2))
})
