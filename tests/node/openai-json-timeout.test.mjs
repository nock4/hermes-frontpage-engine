import { it, expect } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { openAiJson } from '../../scripts/lib/openai-json.mjs'

it('terminates and reaps a real subprocess ignoring SIGTERM before rejecting', async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'hermes-deadline-'))
 const executable=path.join(dir,'fake-hermes')
 const pidFile=path.join(dir,'pid')
 await fs.writeFile(executable,`#!${process.execPath}\nrequire('node:fs').writeFileSync(${JSON.stringify(pidFile)},String(process.pid));process.on('SIGTERM',()=>{});setTimeout(()=>process.exit(0),3000)\n`,{mode:0o755})
 const previous=process.env.HERMES_BIN
 process.env.HERMES_BIN=executable
 try {
  await expect(openAiJson({input:'test',timeoutMs:1000})).rejects.toThrow(/timed out/)
  const pid=Number(await fs.readFile(pidFile,'utf8'))
  expect(()=>process.kill(pid,0)).toThrow()
 } finally {
  if(previous===undefined)delete process.env.HERMES_BIN;else process.env.HERMES_BIN=previous
  await fs.rm(dir,{recursive:true,force:true})
 }
},6000)
