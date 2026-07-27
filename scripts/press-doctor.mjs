#!/usr/bin/env node
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { classifyCronFailure, planPressDoctorActions } from './lib/press-doctor.mjs'

function parseArgs(argv) {
  const options = { log: null, json: false }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    const readValue = () => {
      const value = argv[index + 1]
      if (!value || value.startsWith('--')) throw new Error(`Missing value for ${arg}`)
      index += 1
      return value
    }
    if (arg === '--log') options.log = readValue()
    else if (arg === '--json') options.json = true
    else if (arg === '--help') {
      console.log('Usage: node scripts/press-doctor.mjs --log <cron-log> [--json]')
      process.exit(0)
    } else throw new Error(`Unknown option: ${arg}`)
  }
  if (!options.log) throw new Error('--log is required')
  return options
}

export async function runPressDoctor(options) {
  const text = await fs.readFile(options.log, 'utf8')
  const incident = classifyCronFailure(text)
  return { incident, actions: planPressDoctorActions(incident) }
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isDirectRun) {
  try {
    const options = parseArgs(process.argv.slice(2))
    const result = await runPressDoctor(options)
    if (options.json) {
      console.log(JSON.stringify(result, null, 2))
    } else {
      console.log(`Incident: ${result.incident.kind}`)
      console.log(`Stage: ${result.incident.stage}`)
      console.log(`Next action: ${result.incident.next_action}`)
      if (result.incident.blocker) console.log(`Blocker: ${result.incident.blocker}`)
      console.log('Runbook:')
      for (const step of result.actions) console.log(`- ${step.id}: ${step.action}`)
    }
  } catch (error) {
    console.error(error.stack || error.message)
    process.exit(1)
  }
}
