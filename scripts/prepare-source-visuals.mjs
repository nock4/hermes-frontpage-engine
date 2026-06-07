#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

import { pipelinePython } from './pipeline/package-steps.mjs'

const root = process.cwd()
const manifestPath = path.join(root, 'public', 'editions', 'index.json')
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))

const args = process.argv.slice(2)
const getArg = (name, fallback = null) => {
  const index = args.indexOf(name)
  if (index === -1) return fallback
  return args[index + 1] ?? fallback
}
const hasFlag = (name) => args.includes(name)

const editionArg = getArg('--edition', 'current')
const writeBindings = !hasFlag('--metadata-only')
const python = pipelinePython()

const selectedItems = editionArg === 'all'
  ? manifest.editions
  : [manifest.editions.find((item) => item.edition_id === (editionArg === 'current' ? manifest.current_edition_id : editionArg))].filter(Boolean)

if (selectedItems.length === 0) {
  console.error(`No edition found for --edition ${editionArg}`)
  process.exit(1)
}

const scriptPath = path.join(root, 'scripts', 'lib', 'prepare_source_visuals.py')
const results = []
let failed = 0
for (const item of selectedItems) {
  const editionDir = path.join(root, 'public', item.path.replace(/^\//, ''))
  const childArgs = [scriptPath, '--root', root, '--edition-dir', editionDir, '--edition-id', item.edition_id]
  if (writeBindings) childArgs.push('--write-bindings')
  const result = spawnSync(python, childArgs, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  if (result.stdout.trim()) {
    try {
      results.push(JSON.parse(result.stdout))
    } catch {
      results.push({ edition_id: item.edition_id, stdout: result.stdout.trim() })
    }
  }
  if (result.stderr.trim()) process.stderr.write(result.stderr)
  if (result.status !== 0) {
    failed += 1
    console.error(`prepare:source-visuals failed for ${item.edition_id} with exit ${result.status}`)
  }
}

console.log(JSON.stringify({ editions: selectedItems.length, failed, write_bindings: writeBindings, results }, null, 2))
process.exit(failed ? 1 : 0)
