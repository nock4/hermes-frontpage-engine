#!/usr/bin/env node
// Read-only publication observer and durable, single-owner delivery. Never runs the press.
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash, randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { checkPressProof } from './lib/press-proof.mjs'
import { localPublicationDate } from './lib/cron-reliability.mjs'
const profile = '/Users/nickgeorge-studio/.hermes/profiles/frontpage'
const stateRoot = path.join(profile, 'delivery')
const target = 'telegram:2142213564'
const site = 'https://daily.nockgarden.com/'
const digest = bytes => createHash('sha256').update(bytes).digest('hex')
async function atomic(file, value) {
  await fs.mkdir(path.dirname(file), {recursive:true})
  const tmp = `${file}.${randomUUID()}.tmp`
  await fs.writeFile(tmp, JSON.stringify(value,null,2)+'\n', {mode:0o600})
  await fs.rename(tmp,file)
}
async function readJson(file) { try { return JSON.parse(await fs.readFile(file,'utf8')) } catch(e) { if(e.code==='ENOENT') return null; throw e } }

export function planDelivery({now=new Date(), lastGood=null, liveId=null, fallbackSent=false, reason=null, diagnostic=false}={}) {
  const date=localPublicationDate(now)
  const time=new Intl.DateTimeFormat('en-GB',{timeZone:'America/New_York',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(now)
  const fresh=lastGood?.edition_id?.startsWith(date+'-') && liveId===lastGood.edition_id
  if (!fresh && time<'07:00' && !diagnostic) return null
  const type=diagnostic?'diagnostic':fresh?(fallbackSent?'recovery':'edition'):'fallback'
  const heading=diagnostic?'DIAGNOSTIC — fallback delivery exercise; no production failure asserted':fresh?(fallbackSent?'Recovery — verified edition now available':'Verified daily edition'):'Daily fallback — not a new edition'
  const edition=lastGood?.edition_id
  const text=[`${heading} — ${date} (America/New_York)`,
    fresh&&!diagnostic?`Edition: ${edition}`:`${diagnostic?'Simulated deadline/missing-proof scenario; this is not a report of a real publication failure.':reason || 'No accepted current-day full-QA publication proof available at the delivery deadline.'} Repair remains open; fallback does not stop recovery.`,
    edition?`Last verified edition: ${edition}\n${site}?edition=${encodeURIComponent(edition)}`:`Last verified edition unavailable in local delivery registry. ${site}`,
    !fresh||diagnostic?'The site is not modified by this watchdog. The attached screenshot is retained proof of the identified edition, not a claim of current site availability.':null,
    lastGood?.screenshot?`MEDIA:${lastGood.screenshot}`:'No accepted screenshot is available; no image has been fabricated.',
    fresh&&!diagnostic&&lastGood?.prompt?`MEDIA:${lastGood.prompt}`:null].filter(Boolean).join('\n\n')
  return {key:`${date}-${type}`,date,type,run_id:lastGood?.run_id||'no-accepted-outcome',edition_id:edition||null,target,text}
}

export async function acceptProof(proof, root=stateRoot) {
  if (proof.status!=='green' || !checkPressProof(proof).green || proof.qa?.adversarialVisualQa!=='pass' || proof.summary?.push_succeeded!==true || !/^\d{4}-\d{2}-\d{2}-[a-z0-9-]+-v\d+$/.test(proof.expected_edition_id||'')) throw Error('Full green publication and explicit adversarial proof required')
  const bytes=await fs.readFile(proof.screenshot_path)
  if (!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) throw Error('Accepted screenshot must be PNG')
  const edition=proof.expected_edition_id
  const screenshot=path.join(root,'screenshots',`${edition}-${digest(bytes).slice(0,16)}.png`)
  await fs.mkdir(path.dirname(screenshot),{recursive:true}); await fs.writeFile(screenshot,bytes)
  const prompt=path.join(root,'documents',`${edition}-scene-prompt.txt`)
  await fs.mkdir(path.dirname(prompt),{recursive:true})
  await fs.copyFile(proof.prompt_path,prompt)
  const value={edition_id:edition,run_id:proof.summary.checkpoint_path||proof.summary.commit,screenshot,prompt,screenshot_sha256:digest(bytes),accepted_at:new Date().toISOString(),proof}
  await atomic(path.join(root,'accepted',`${edition}.json`),value)
  return value
}

// Caller holds the OS flock. Pending is persisted BEFORE network I/O. A timeout
// or partial multipart send is ambiguous: never blindly resend and duplicate.
export async function deliverOnce(root, plan, send) {
  const file=path.join(root,'receipts',`${plan.key}.json`)
  const previous=await readJson(file)
  if (previous) return previous
  const record={...plan,status:'pending',started_at:new Date().toISOString()}
  await atomic(file,record)
  try {
    const receipt=await send(plan.text)
    if (receipt?.success!==true || receipt.platform!=='telegram' || String(receipt.chat_id)!=='2142213564' || !receipt.message_id) throw Error(`Delivery not confirmed for exact target: ${JSON.stringify(receipt)}`)
    record.status='sent'; record.receipt=receipt; record.completed_at=new Date().toISOString()
    await atomic(file,record); return record
  } catch(e) {record.status='uncertain';record.error=String(e.message).slice(0,1500);await atomic(file,record);throw e}
}
export async function latestAccepted(root, liveId=null) {
  const dir=path.join(root,'accepted')
  const names=await fs.readdir(dir).catch(e=>{if(e.code==='ENOENT')return [];throw e})
  const valid=[]
  for (const name of names.filter(n=>n.endsWith('.json'))) {
    try {
      const value=await readJson(path.join(dir,name))
      if(value && digest(await fs.readFile(value.screenshot))===value.screenshot_sha256 && checkPressProof(value.proof).green && value.proof.qa?.adversarialVisualQa==='pass') valid.push(value)
    } catch { /* A broken newer record must not discard an intact last-good. */ }
  }
  return valid.find(value=>value.edition_id===liveId) || valid.sort((a,b)=>String(b.accepted_at).localeCompare(String(a.accepted_at)))[0] || null
}
async function liveIdentity() {
  const request=async url=>{const r=await fetch(url,{signal:AbortSignal.timeout(15000),headers:{'Cache-Control':'no-cache','User-Agent':'DailyFrontpageCronRemoteVerify/1.0'}});if(!r.ok)throw Error(`HTTP ${r.status}`);return r.json()}
  const manifest=await request(`${site}editions/index.json?delivery=${Date.now()}`)
  const id=manifest.current_edition_id
  if(!/^\d{4}-\d{2}-\d{2}-[a-z0-9-]+-v\d+$/.test(id||'') || manifest.editions.filter(e=>e.is_live).length!==1 || !manifest.editions.some(e=>e.is_live&&e.edition_id===id&&e.path===`/editions/${id}`)) throw Error('Remote manifest identity invalid')
  if((await request(`${site}editions/${id}/edition.json?delivery=${Date.now()}`)).edition_id!==id) throw Error('Remote edition identity mismatch')
  return id
}
async function alarmUncertain(record) {
  const result = {status:'unavailable',deadline:'07:00',expected_date:record.date,evidence:'telegram-transport-uncertain',target,run_id:record.run_id,notification_type:record.type,receipt_state:record.status,error:record.error||'Process interrupted after durable intent, before receipt',policy:'Do not resend blindly: inspect exact Telegram target/receipt first. This alarm does not stop publication repair.'}
  // Local evidence only. Offhost workflow is the SOLE GitHub delivery-issue writer,
  // avoiding a list/create race during network partitions or delayed API visibility.
  await atomic(path.join(stateRoot,'alarms',`${record.date}.json`),{result})
  console.error('Telegram delivery remains uncertain; retained locally for offhost attestation.')
}
async function main() {
  const args=process.argv.slice(2)
  if(args[0]==='--accept-proof' && args.length===2) { console.log(JSON.stringify(await acceptProof(await readJson(args[1]))));return }
  if(args.some(a=>!['--diagnostic','--dry-run'].includes(a))) throw Error('Use --accept-proof PATH, --diagnostic, or --dry-run')
  const diagnostic=args.includes('--diagnostic'), now=new Date(), date=localPublicationDate(now)
  // Rollout cutoff avoids duplicating the already-delivered day; not a receipt.
  if(!diagnostic && process.env.DFE_DELIVERY_START_DATE && date<process.env.DFE_DELIVERY_START_DATE) return
  let lastGood=null,liveId=null,reason=null
  try {liveId=await liveIdentity()} catch(e) {reason=`Live verification unavailable: ${e.message}. Current-day publication cannot be confirmed.`}
  try {lastGood=await latestAccepted(stateRoot,liveId)} catch(e) {reason=`Accepted proof registry unreadable: ${e.message}`}
  const fallback=await readJson(path.join(stateRoot,'receipts',`${date}-fallback.json`))
  const plan=planDelivery({now,lastGood,liveId,reason,fallbackSent:!!fallback,diagnostic})
  if(!plan)return
  // Once today's new edition has a receipt, do not send later fallback merely
  // because a subsequent transient fetch failed. Availability is monitored separately.
  if(!diagnostic) {
    for(const type of ['edition','recovery','fallback']) {
      const existing=await readJson(path.join(stateRoot,'receipts',`${date}-${type}.json`))
      if(existing && existing.status!=='sent') {
        if(!args.includes('--dry-run'))await alarmUncertain(existing)
        if(type!=='fallback' || plan.type!=='recovery') return
      }
      if(existing && type!=='fallback') return
    }
  }
  if(args.includes('--dry-run')) {console.log(JSON.stringify(plan,null,2));return}
  let result
  try { result=await deliverOnce(stateRoot,plan,async text=>{
    const output=execFileSync('hermes',['-p','frontpage','send','--to',target,'--json','--file','-'],{input:text,encoding:'utf8',timeout:90000,maxBuffer:1024*1024})
    return JSON.parse(output)
  }) } catch(e) {
    if(!diagnostic)await alarmUncertain(await readJson(path.join(stateRoot,'receipts',`${plan.key}.json`)))
    throw e
  }
  console.log(JSON.stringify(result,null,2))
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) main().catch(e=>{console.error(e);process.exitCode=1})
