#!/usr/bin/env node
// One-time and occasional operations. None of these run in the daily path.
//
//   tsx press/admin.mjs seed-ledger     --from public/editions [--dry-run]
//       Mark every source the existing archive already used, so nothing repeats.
//   tsx press/admin.mjs migrate-archive --from public/editions [--dry-run]
//       Copy the archive (index.json and every edition file) into the bucket.
//       Existing objects are overwritten with identical content; rerunnable.

import fs from 'node:fs/promises'
import path from 'node:path'

import { LEDGER_KEY, markUsed, normalizeLedger, sourceKey } from './lib/pick.mjs'
import { storeFromEnv } from './lib/store.mjs'

const [command, ...args] = process.argv.slice(2)
const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null)
const dryRun = args.includes('--dry-run')
const from = option('--from')
if (!['seed-ledger', 'migrate-archive'].includes(command) || !from) {
  console.error('Usage: tsx press/admin.mjs <seed-ledger|migrate-archive> --from <editions dir> [--dry-run]')
  process.exit(1)
}

async function* walk(directory) {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue
    const full = path.join(directory, entry.name)
    if (entry.isDirectory()) yield* walk(full)
    else if (entry.isFile()) yield full
  }
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

if (command === 'migrate-archive') {
  const files = []
  let bytes = 0
  for await (const file of walk(from)) {
    files.push(file)
    bytes += (await fs.stat(file)).size
  }
  const summary = { files: files.length, megabytes: Math.round(bytes / 1e6) }
  if (dryRun) {
    console.log(`press-admin: dry run migrate-archive ${JSON.stringify(summary)}`)
  } else {
    const store = storeFromEnv()
    // index.json goes last: readers never see a manifest ahead of its files.
    const ordered = [...files.filter((file) => path.basename(file) !== 'index.json' || path.dirname(file) !== path.resolve(from)), path.join(path.resolve(from), 'index.json')]
    const queue = [...new Set(ordered.map((file) => path.resolve(file)))]
    const manifest = queue.pop()
    let done = 0
    const worker = async () => {
      for (let file = queue.shift(); file; file = queue.shift()) {
        const key = `editions/${path.relative(path.resolve(from), file).split(path.sep).join('/')}`
        await store.put(key, await fs.readFile(file))
        done += 1
        if (done % 500 === 0) console.log(`press-admin: ${done}/${files.length}`)
      }
    }
    await Promise.all(Array.from({ length: 8 }, worker))
    await store.put('editions/index.json', await fs.readFile(manifest))
    console.log(`press-admin: migrate-archive uploaded ${JSON.stringify(summary)} to ${store.describe()}`)
  }
}
