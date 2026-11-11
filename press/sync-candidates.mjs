#!/usr/bin/env node
// Read the saved-bookmark candidate list from the Obsidian vault.
// No agent, no model calls, no publishing. Run by the press job; safe to run by hand.
//
//   PRESS_VAULT=<vault dir> node press/sync-candidates.mjs [--dry-run]
//
// Writes press/data/candidates.json, which is not committed: the repository is
// public and the bookmark list is not. The used-source ledger next to it is
// owned by the press, not by this.

import fs from 'node:fs'

import { CANDIDATES_KEY } from './lib/pick.mjs'
import { storeFromEnv } from './lib/store.mjs'
import { scanVault } from './lib/vault.mjs'

const dryRun = process.argv.includes('--dry-run')
const vault = process.env.PRESS_VAULT
if (!vault) {
  console.error('press-sync: set PRESS_VAULT to the Obsidian vault directory')
  process.exit(1)
}
if (!fs.existsSync(vault) || !fs.statSync(vault).isDirectory()) {
  console.error(`press-sync: vault not found at ${vault}. Move the vault there or fix PRESS_VAULT`)
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
  console.log(`press-sync: wrote ${JSON.stringify(summary)} to ${store.describe()}`)
}
