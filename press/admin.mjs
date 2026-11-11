#!/usr/bin/env node
// One-time operations. Nothing here runs in the daily path.
//
//   tsx press/admin.mjs seed-ledger     --from public/editions [--dry-run]
//       Mark every source the existing archive already used, so nothing repeats.

import fs from 'node:fs/promises'
import path from 'node:path'

import { LEDGER_KEY, markUsed, normalizeLedger, sourceKey } from './lib/pick.mjs'
import { storeFromEnv } from './lib/store.mjs'

const [command, ...args] = process.argv.slice(2)
const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null)
const dryRun = args.includes('--dry-run')
const from = option('--from')
if (command !== 'seed-ledger' || !from) {
  console.error('Usage: tsx press/admin.mjs seed-ledger --from <editions dir> [--dry-run]')
  process.exit(1)
}

if (command === 'seed-ledger') {
  const index = JSON.parse(await fs.readFile(path.join(from, 'index.json'), 'utf8'))
  const store = dryRun ? null : storeFromEnv()
  const ledger = normalizeLedger(store ? await store.getJson(LEDGER_KEY) : null)
  let bindings = 0
  for (const item of index.editions) {
    let set
    try { set = JSON.parse(await fs.readFile(path.join(from, item.edition_id, 'source-bindings.json'), 'utf8')) } catch { continue }
    for (const binding of set.bindings || []) {
      if (!binding.source_url) continue
      bindings += 1
      const key = sourceKey(binding.source_url)
      if (!ledger.used[key]) markUsed(ledger, key, { edition_id: item.edition_id, date: item.date })
    }
  }
  const summary = { editions: index.editions.length, bindings, used_sources: Object.keys(ledger.used).length }
  if (store) await store.putJson(LEDGER_KEY, ledger)
  console.log(`press-admin: ${dryRun ? 'dry run ' : ''}seed-ledger ${JSON.stringify(summary)}`)
}
