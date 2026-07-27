#!/usr/bin/env node
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { buildPublishProofFromCronLog, checkPressProof } from './lib/press-proof.mjs'

function parseArgs(argv) {
  const options = {
    log: null,
    output: null,
    adversarialVisualQa: null,
    json: false,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    const readValue = () => {
      const value = argv[index + 1]
      if (!value || value.startsWith('--')) throw new Error(`Missing value for ${arg}`)
      index += 1
      return value
    }
    if (arg === '--log') options.log = readValue()
    else if (arg === '--output') options.output = readValue()
    else if (arg === '--adversarial-visual-qa') options.adversarialVisualQa = readValue()
    else if (arg === '--json') options.json = true
    else if (arg === '--help') {
      console.log('Usage: node scripts/check-press-proof.mjs --log <cron-log> [--output tmp/publish-proof.json] [--adversarial-visual-qa pass|fail] [--json]')
      process.exit(0)
    } else {
      throw new Error(`Unknown option: ${arg}`)
    }
  }
  if (!options.log) throw new Error('--log is required')
  return options
}

export async function runCheckPressProof(options) {
  const logText = await fs.readFile(options.log, 'utf8')
  const proof = buildPublishProofFromCronLog(logText, {
    adversarialVisualQa: options.adversarialVisualQa,
  })
  const checked = checkPressProof(proof)
  if (options.output) {
    await fs.mkdir(path.dirname(options.output), { recursive: true })
    await fs.writeFile(options.output, `${JSON.stringify(proof, null, 2)}\n`, 'utf8')
  }
  return { proof, checked }
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isDirectRun) {
  try {
    const options = parseArgs(process.argv.slice(2))
    const { proof, checked } = await runCheckPressProof(options)
    if (options.json) {
      console.log(JSON.stringify(proof, null, 2))
    } else {
      console.log(`Press proof: ${proof.status}`)
      console.log(`Green: ${checked.green}`)
      if (checked.blockers.length) {
        console.log('Blockers:')
        for (const blocker of checked.blockers) console.log(`- ${blocker}`)
      }
      if (options.output) console.log(`Proof file: ${options.output}`)
    }
    if (!checked.green) process.exit(1)
  } catch (error) {
    console.error(error.stack || error.message)
    process.exit(1)
  }
}
