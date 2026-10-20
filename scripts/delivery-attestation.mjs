// Nonsecret host assertion, not independent Telegram verification or a send lease.
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { localPublicationDate } from './lib/cron-reliability.mjs'
import { latestAccepted } from './delivery-watchdog.mjs'
const types=['edition','fallback','recovery']
export const variable='DFE_DELIVERY_ATTESTATION'
export function buildAttestation({now=new Date(),records=[],accepted=false}={}) {
 const date=localPublicationDate(now)
 return {version:1,date,heartbeat_at:now.toISOString(),accepted_current:accepted===true,receipts:records.filter(r=>r?.date===date&&types.includes(r.type)).map(r=>({type:r.type,status:r.status==='sent'&&r.receipt?.success===true&&r.receipt?.platform==='telegram'&&r.target===`telegram:${r.receipt.chat_id}`&&r.receipt?.message_id?'sent':'uncertain'}))}
}
export function evaluateDelivery(a,{now=new Date()}={}) {
 const date=localPublicationDate(now)
 const time=new Intl.DateTimeFormat('en-GB',{timeZone:'America/New_York',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(now)
 const result={expected_date:date,deadline:'07:00',checked_at:now.toISOString(),status:'unavailable',reason:'no-heartbeat',heartbeat:'absent',accepted_current:false}
 if(date<'2026-10-21')return {...result,status:'before-rollout'}
 if(time<'07:00')return {...result,status:'before-deadline'}
 if(!a)return result
 const age=now-new Date(a.heartbeat_at)
 if(Object.keys(a).sort().join()!=='accepted_current,date,heartbeat_at,receipts,version'||a.version!==1||typeof a.accepted_current!=='boolean'||!Number.isFinite(age)||age< -60000||a.date!==localPublicationDate(new Date(a.heartbeat_at))||!Array.isArray(a.receipts)||a.receipts.length>3||new Set(a.receipts.map(r=>r?.type)).size!==a.receipts.length||a.receipts.some(r=>!r||Object.keys(r).sort().join()!=='status,type'||!types.includes(r.type)||!['sent','uncertain'].includes(r.status)))return {...result,reason:'invalid-heartbeat',heartbeat:'invalid'}
 result.heartbeat=age>30*60*1000?'stale':'fresh'
 result.accepted_current=a.date===date&&a.accepted_current
 const receipts=a.date===date?a.receipts:[]
 if(receipts.some(r=>r.status==='uncertain'))return {...result,reason:'send-uncertain'}
 if(receipts.some(r=>r.status==='sent'))return {...result,status:'delivered',reason:'host-attested-transport-receipt'}
 return {...result,reason:result.heartbeat==='stale'?'stale-heartbeat':'receipt-absent'}
}
async function main(){
 const root=path.join(os.homedir(),'.hermes/profiles/frontpage/delivery'),now=new Date(),date=localPublicationDate(now)
 const records=[]
 for(const type of types){try{records.push(JSON.parse(await fs.readFile(path.join(root,'receipts',`${date}-${type}.json`),'utf8')))}catch(e){if(e.code!=='ENOENT')throw Error('Receipt registry unreadable')}}
 const accepted=await latestAccepted(root)
 const value=buildAttestation({now,records,accepted:accepted?.edition_id?.startsWith(date+'-')===true})
 const body=JSON.stringify(value)
 const gh=args=>execFileSync('gh',args,{encoding:'utf8',timeout:15000})
 gh(['variable','set',variable,'--repo','nock4/hermes-frontpage-engine','--body',body])
 const readback=gh(['variable','get',variable,'--repo','nock4/hermes-frontpage-engine']).trim()
 if(readback!==body)throw Error('Attestation readback mismatch')
 console.log(body)
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(()=>{console.error('Nonsecret delivery attestation upload failed; remote freshness will expire.');process.exitCode=1})
