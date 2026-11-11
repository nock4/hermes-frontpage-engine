#!/usr/bin/env node
// Mac-side sync: push the saved-bookmark candidate list to the press bucket.
// No agent, no model calls, no publishing. Run by launchd; safe to run by hand.
//
//   PRESS_VAULT=<vault dir> node press/sync-candidates.mjs [--dry-run]
//
// Uploads press/candidates.json only when the list changed. The used-source
// ledger lives next to it in the bucket and is owned by the press, not by this.

import { CANDIDATES_KEY } from './lib/pick.mjs'
import { storeFromEnv } from './lib/store.mjs'
import { scanVault } from './lib/vault.mjs'

const dryRun = process.argv.includes('--dry-run')
const vault = process.env.PRESS_VAULT
if (!vault) {
  console.error('press-sync: set PRESS_VAULT to the Obsidian vault directory')
  process.exit(1)
}

const { notes, candidates } = scanVault(vault)
const summary = { notes, candidates: candidates.length, with_image: candidates.filter((candidate) => candidate.media_urls.length).length }
if (dryRun) {
  console.log(`press-sync: dry run ${JSON.stringify(summary)}`)
  process.exit(0)
}

const store = storeFromEnv()
const existing = await store.getJson(CANDIDATES_KEY)
if (existing && JSON.stringify(existing.candidates) === JSON.stringify(candidates)) {
  console.log(`press-sync: unchanged ${JSON.stringify(summary)}`)
} else {
  await store.putJson(CANDIDATES_KEY, { generated_at: new Date().toISOString(), candidates })
  console.log(`press-sync: uploaded ${JSON.stringify(summary)} to ${store.describe()}`)
}
