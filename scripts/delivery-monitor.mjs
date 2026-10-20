// GitHub-only observer. Never holds Telegram credentials, sends, or grants leases.
import fs from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { evaluateDelivery } from './delivery-attestation.mjs'
import { reconcileIssue, checkPublication } from './publication-monitor.mjs'
const mode=process.argv.includes('--exercise-issue')?'exercise-issue':process.argv.includes('--diagnostic')?'diagnostic':'production'
const repo=process.env.GITHUB_REPOSITORY
const runUrl=`https://github.com/${repo}/actions/runs/${process.env.GITHUB_RUN_ID}`
const gh=args=>execFileSync('gh',args,{encoding:'utf8',timeout:20000})
async function main(){
 let attestation=null
 try{attestation=JSON.parse(process.env.DFE_DELIVERY_ATTESTATION||'null')}catch{attestation={invalid:true}}
 const publication=await checkPublication()
 const result={...evaluateDelivery(attestation),publication_status:publication.status,evidence:'host-attestation-not-independent-telegram-proof'}
 const reconcile=(r,diagnostic=false)=>reconcileIssue({repo,gh,runUrl,result:r,title:`[Frontpage delivery${diagnostic?' DIAGNOSTIC':''}] ${r.expected_date}`,diagnostic,subject:'Daily Telegram receipt'})
 let report={mode,result}
 if(mode==='exercise-issue'){
  const injected={...result,status:'unavailable',reason:'no-heartbeat',diagnostic:true}
  const first=reconcile(injected,true),second=reconcile(injected,true)
  const close=reconcile({...injected,status:'delivered',reason:'host-attested-transport-receipt'},true)
  report={mode,injected:true,first,second,close,ok:second.action==='existing-open'&&first.issue.number===second.issue.number&&close.issue.number===first.issue.number&&close.issue.state==='CLOSED'}
  if(!report.ok)process.exitCode=1
 }else if(mode==='production'&&!['before-deadline','before-rollout'].includes(result.status)){
  report.issue=reconcile(result)
  if(result.status==='unavailable')process.exitCode=1
 }
 const text=JSON.stringify(report,null,2)+'\n'
 console.log(text)
 if(process.env.DFE_DELIVERY_EVIDENCE_PATH)await fs.writeFile(process.env.DFE_DELIVERY_EVIDENCE_PATH,text)
 if(process.env.GITHUB_STEP_SUMMARY)await fs.appendFile(process.env.GITHUB_STEP_SUMMARY,`## Delivery monitor (${mode})\n\n\`\`\`json\n${text}\`\`\`\n`)
}
main().catch(()=>{console.error('Delivery monitor failed; inspect GitHub API availability. No delivery claimed.');process.exitCode=1})
