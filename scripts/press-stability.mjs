#!/usr/bin/env node
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { auditPressStability, formatPressStabilityAudit } from './lib/press-stability.mjs'

const repoRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)))

function parseArgs(argv) {
  const options = { logsDir: path.join(repoRoot, 'tmp', 'cron-logs'), limit: 28, json: false }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    const readValue = () => {
      const value = argv[index + 1]
      if (!value || value.startsWith('--')) throw new Error(`Missing value for ${arg}`)
      index += 1
      return value
    }
    if (arg === '--logs-dir') options.logsDir = path.resolve(readValue())
    else if (arg === '--limit') options.limit = Number.parseInt(readValue(), 10)
    else if (arg === '--json') options.json = true
    else if (arg === '--help') {
      console.log('Usage: node scripts/press-stability.mjs [--logs-dir tmp/cron-logs] [--limit 28] [--json]')
      process.exit(0)
    } else throw new Error(`Unknown option: ${arg}`)
  }
  if (!Number.isFinite(options.limit) || options.limit < 1) throw new Error('--limit must be >= 1')
  return options
}

export async function runPressStability(options) {
  return auditPressStability(options)
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isDirectRun) {
  try {
    const options = parseArgs(process.argv.slice(2))
    const audit = await runPressStability(options)
    if (options.json) console.log(JSON.stringify(audit, null, 2))
    else console.log(formatPressStabilityAudit(audit))
  } catch (error) {
    console.error(error.stack || error.message)
    process.exit(1)
  }
}
