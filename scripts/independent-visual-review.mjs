#!/usr/bin/env node
// No generation, provider calls, automatic review or publication.
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { independentReviewExpectation, recordIndependentVisualReview, assertIndependentVisualReview } from './lib/independent-visual-review.mjs'

export function runIndependentReviewCli(argv) {
  const [action, ...args] = argv
  if (!['context', 'record', 'validate'].includes(action)) throw Error('Usage: node scripts/independent-visual-review.mjs context|record|validate --worktree DIR --run-dir DIR --edition ID [--report FILE]')
  const names = { '--worktree': 'worktreeDir', '--run-dir': 'runDir', '--edition': 'editionId', '--report': 'report' }
  const options = {}
  for (let i = 0; i < args.length; i += 2) {
    const key = names[args[i]], value = args[i + 1]
    if (!key || key in options || !value || value.startsWith('--')) throw Error('Invalid/duplicate review CLI argument')
    options[key] = value
  }
  for (const key of ['worktreeDir', 'runDir', 'editionId']) if (!options[key]) throw Error(`Missing ${key}`)
  if (action === 'context') return independentReviewExpectation(options)
  if (action === 'record') {
    if (!options.report) throw Error('--report is required; the operator must supply an actual external review')
    return recordIndependentVisualReview(options, options.report)
  }
  return assertIndependentVisualReview(options)
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(runIndependentReviewCli(process.argv.slice(2)), null, 2)) }
  catch (error) { console.error(error.message); process.exitCode = 1 }
}
