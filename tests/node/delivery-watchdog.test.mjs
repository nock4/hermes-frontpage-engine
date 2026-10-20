import { describe, it, expect } from 'vitest'
import { planDelivery, deliverOnce, acceptProof, latestAccepted } from '../../scripts/delivery-watchdog.mjs'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { buildPublishProof } from '../../scripts/lib/press-proof.mjs'
const good = { edition_id: '2026-10-20-art-v1', run_id: 'run-a', screenshot: '/proof.png' }
const now = new Date('2026-10-21T11:00:00Z')
describe('daily delivery policy', () => {
  it('runner is bounded, profile-only and no-agent even with missing outcome', () => {
    execFileSync('python3',['-c',`import importlib.util, tempfile, pathlib, sys, subprocess, fcntl
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('watchdog','scripts/delivery-watchdog-runner.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
with tempfile.TemporaryDirectory() as root:
 m.STATE=pathlib.Path(root);sys.argv=['watchdog','--dry-run']
 with patch.object(m.subprocess,'run') as run:
  run.return_value.returncode=0
  assert m.main()==0
  args,kw=run.call_args
  assert args[0][0]=='/opt/homebrew/bin/node' and args[0][-1]=='--dry-run'
  assert kw['timeout']==150 and kw['env']['HERMES_HOME'].endswith('/profiles/frontpage')
 with patch.object(m.subprocess,'run',side_effect=subprocess.TimeoutExpired('node',150)):
  assert m.main()==1
 with (m.STATE/'watchdog.lock').open('a') as lock:
  fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
  with patch.object(m.subprocess,'run') as run:
   assert m.main()==0 and not run.called
`],{encoding:'utf8'})
  })
  it('registers accepted proof durably but rejects missing independent visual acceptance', async () => {
    const root=await fs.mkdtemp(path.join(os.tmpdir(),'accepted-proof-'))
    try {
      const screenshot=path.join(root,'source.png'),prompt=path.join(root,'prompt.txt')
      const bytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXioAAAAASUVORK5CYII=','base64')
      await fs.writeFile(screenshot,bytes);await fs.writeFile(prompt,'test prompt')
      const id=good.edition_id
      const proof=buildPublishProof({summary:{ok:true,push_succeeded:true,remote_matches:true,local_edition_id:id,checkpoint_path:'fixture-run'},liveProof:{expectedEditionId:id,pageEditionId:id,loadedPlateImageCount:1,plate:{src:`https://daily.nockgarden.com/editions/${id}/assets/plate.png`,naturalWidth:1440,naturalHeight:900}},screenshotPath:screenshot,promptPath:prompt,qa:{qaPublishPassed:true,adversarialVisualQa:'pass'}})
      const accepted=await acceptProof(proof,path.join(root,'durable'))
      expect(await fs.readFile(accepted.screenshot)).toEqual(bytes)
      expect(await fs.readFile(accepted.prompt,'utf8')).toBe('test prompt')
      await fs.writeFile(path.join(root,'durable','accepted','9999-corrupt.json'),'{broken')
      expect((await latestAccepted(path.join(root,'durable'))).edition_id).toBe(id)
      await fs.writeFile(accepted.screenshot,'tampered')
      expect(await latestAccepted(path.join(root,'durable'))).toBeNull()
      await expect(acceptProof({...proof,qa:{qaPublishPassed:true}},root)).rejects.toThrow('explicit adversarial')
    } finally {await fs.rm(root,{recursive:true,force:true})}
  })
  it('waits before deadline even without agent or outcome', () => expect(planDelivery({now:new Date('2026-10-21T10:59:00Z'), lastGood:good})).toBeNull())
  it('sends dated stale-edition fallback at deadline with missing outcome', () => {
    const p=planDelivery({now,lastGood:good}); expect(p.type).toBe('fallback'); expect(p.text).toContain('2026-10-21'); expect(p.text).toContain('not a new edition'); expect(p.text).toContain(good.edition_id); expect(p.text).toContain('No accepted'); expect(p.text).toContain('MEDIA:/proof.png')
  })
  it('does not mistake remote freshness for full QA', () => expect(planDelivery({now,lastGood:good, liveId:'2026-10-21-art-v1'}).type).toBe('fallback'))
  it('delivers accepted success without agent final response', () => expect(planDelivery({now,lastGood:{...good,edition_id:'2026-10-21-art-v1'},liveId:'2026-10-21-art-v1'}).type).toBe('edition'))
  it('delivers recovery after fallback, not another daily edition', () => expect(planDelivery({now,lastGood:{...good,edition_id:'2026-10-21-art-v1'},liveId:'2026-10-21-art-v1',fallbackSent:true}).type).toBe('recovery'))
  it('handles winter and summer DST in Eastern wall clock', () => {
    expect(planDelivery({now:new Date('2026-11-01T11:59:00Z'),lastGood:good})).toBeNull()
    expect(planDelivery({now:new Date('2026-11-01T12:00:00Z'),lastGood:good}).date).toBe('2026-11-01')
    expect(planDelivery({now:new Date('2026-03-08T11:00:00Z'),lastGood:good}).date).toBe('2026-03-08')
  })
  it('fails honestly without last-good screenshot, not fabricating content', () => expect(planDelivery({now}).text).toContain('No accepted screenshot'))
  it('labels diagnostic simulation and never calls it a new edition', () => {
    const p=planDelivery({now,lastGood:good,diagnostic:true});expect(p.type).toBe('diagnostic');expect(p.text).toContain('Simulated');expect(p.text).toContain('no production failure asserted')
  })
  it('preserves the known failure reason without inventing an outcome', () => expect(planDelivery({now,lastGood:good,reason:'Live verification unavailable: HTTP 503'}).text).toContain('HTTP 503'))
  it('rejects partial and wrong-target receipts and keeps a durable uncertain state', async () => {
    const root=await fs.mkdtemp(path.join(os.tmpdir(),'delivery-failure-'))
    try {
      for(const [suffix,receipt] of [['partial',{success:false,partial_success:true}],['wrong',{success:true,platform:'telegram',chat_id:'other',message_id:1}]]) {
        const p={...planDelivery({now,lastGood:good}),key:`test-${suffix}`}
        await expect(deliverOnce(root,p,async()=>receipt)).rejects.toThrow('exact target')
        expect(JSON.parse(await fs.readFile(path.join(root,'receipts',p.key+'.json'))).status).toBe('uncertain')
      }
      const p={...planDelivery({now,lastGood:good}),key:'crashed'}
      await fs.writeFile(path.join(root,'receipts','crashed.json'),JSON.stringify({...p,status:'pending'}))
      expect((await deliverOnce(root,p,async()=>{throw Error('must not resend')})).status).toBe('pending')
    } finally {await fs.rm(root,{recursive:true,force:true})}
  })
  it('deduplicates recovery separately from the fallback', async () => {
    const root=await fs.mkdtemp(path.join(os.tmpdir(),'delivery-recovery-'));let calls=0
    const send=async()=>({success:true,platform:'telegram',chat_id:'2142213564',message_id:++calls})
    try {
      await deliverOnce(root,planDelivery({now,lastGood:good}),send)
      const recovery=planDelivery({now,lastGood:{...good,edition_id:'2026-10-21-art-v1'},liveId:'2026-10-21-art-v1',fallbackSent:true})
      await deliverOnce(root,recovery,send);await deliverOnce(root,recovery,send);expect(calls).toBe(2)
    } finally {await fs.rm(root,{recursive:true,force:true})}
  })
  it('requires green QA and adversarial proof before registering', async () => await expect(acceptProof({status:'green'},'/unused')).rejects.toThrow())
  it('durably dedupes runs and retries neither ambiguous nor partial delivery', async () => {
    const root=await fs.mkdtemp(path.join(os.tmpdir(),'delivery-test-')); let calls=0
    const p=planDelivery({now,lastGood:good}); const send=async()=>{calls++;return {success:true,platform:'telegram',chat_id:'2142213564',message_id:42}}
    try { expect((await deliverOnce(root,p,send)).status).toBe('sent'); expect((await deliverOnce(root,{...p,run_id:'different'},send)).status).toBe('sent'); expect(calls).toBe(1)
      const q={...p,key:p.key+'-ambiguous'}; await expect(deliverOnce(root,q,async()=>{throw Error('timeout')})).rejects.toThrow('timeout'); expect((await deliverOnce(root,q,send)).status).toBe('uncertain'); expect(calls).toBe(1)
    } finally {await fs.rm(root,{recursive:true,force:true})}
  })
})
