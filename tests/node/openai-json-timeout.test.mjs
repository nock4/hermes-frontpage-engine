import { it, expect } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { openAiJson } from '../../scripts/lib/openai-json.mjs'

it('terminates and reaps a real subprocess ignoring SIGTERM before rejecting', async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'hermes-deadline-'))
 const executable=path.join(dir,'fake-hermes')
 const pidFile=path.join(dir,'pid')
 // Use an exec'd sleep rather than starting a second Node runtime: under a
 // busy full suite Node startup can consume the entire deadline before the PID
 // marker/handler is installed. Ignored TERM survives exec and the PID is stable.
 await fs.writeFile(executable,`#!/bin/sh\ntrap '' TERM\nprintf '%s' "$$" > ${JSON.stringify(pidFile)}\nexec /bin/sleep 30\n`,{mode:0o755})
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
