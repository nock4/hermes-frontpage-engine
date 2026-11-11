#!/usr/bin/env node
// Daily Frontpage press. Plain Node, run on the Mac by launchd; no agent.
// Editions are files in this repository: a run ends with one commit and push.
// On main that push is the publish; on any other branch it is a shadow run.
//
//   tsx press/press.mjs run      flip due editions, then build the next missing one
//   tsx press/press.mjs build    build only   [--date YYYY-MM-DD]
//   tsx press/press.mjs flip     flip only
//   tsx press/press.mjs status   show what is live, parked and queued
//
// Configuration is environment only; see press/README.md.

import fs from 'node:fs/promises'

import { INDEX_KEY, PARKED_KEY, normalizeParked } from '../shared/edition-index.js'
import { currentBranch, publish } from './lib/git.mjs'
import { createModels } from './lib/models.mjs'
import { CANDIDATES_KEY, LEDGER_KEY, normalizeLedger, orderCandidates } from './lib/pick.mjs'
import { build, builtMessage, failedMessage, flip, shouldTellFailure } from './lib/run.mjs'
import { storeFromEnv } from './lib/store.mjs'
import { tell } from './lib/telegram.mjs'
import { localDate } from './lib/time.mjs'

function option(args, name) {
  const index = args.indexOf(name)
  return index === -1 ? null : args[index + 1] || null
}

async function seedIndexFromEnv(env) {
  if (!env.PRESS_SEED_INDEX) return null
  return JSON.parse(await fs.readFile(env.PRESS_SEED_INDEX, 'utf8'))
}

async function main() {
  const [command = 'run', ...args] = process.argv.slice(2)
  const env = process.env
  const store = storeFromEnv(env)
  const seedIndex = await seedIndexFromEnv(env)
  const siteUrl = env.PRESS_SITE_URL || ''
  const now = new Date()
  // A shadow run parks editions but never folds them into the live manifest,
  // so its branch keeps merging cleanly with main.
  const shadow = store.repo ? (await currentBranch(store.repo)) !== 'main' : false
  const say = (message) => tell(message, { shadow })
  let commitMessage = 'chore: update the press ledger'
  const finish = async () => {
    if (!store.repo) return
    try {
      const pushed = await publish(store.repo, commitMessage)
      console.log(`press: publish ${JSON.stringify(pushed)}`)
    } catch (error) {
      console.error(`press: failed at push: ${error.message}`)
      if (await shouldTellFailure(store, { date: localDate(now), step: 'push' })) await say(failedMessage(Object.assign(error, { step: 'push' })))
      process.exitCode = 1
    }
  }

  if (command === 'status') {
    const index = (await store.getJson(INDEX_KEY)) || seedIndex
    const parked = normalizeParked(await store.getJson(PARKED_KEY))
    const ledger = normalizeLedger(await store.getJson(LEDGER_KEY))
    const candidates = (await store.getJson(CANDIDATES_KEY))?.candidates || []
    console.log(JSON.stringify({
      store: store.describe(),
      today: localDate(now),
      current_edition_id: index?.current_edition_id || null,
      editions: index?.editions.length || 0,
      parked: parked.entries.map((entry) => ({ edition_id: entry.edition_id, go_live_at: entry.go_live_at })),
      candidates: candidates.length,
      unused_candidates: orderCandidates(candidates, ledger).length,
      unused_with_image: orderCandidates(candidates, ledger).filter((candidate) => candidate.media_urls.length).length,
      used_sources: Object.keys(ledger.used).length,
    }, null, 2))
    return
  }

  if ((command === 'run' || command === 'flip') && shadow) console.log('press: shadow run, manifest left alone')
  if ((command === 'run' || command === 'flip') && !shadow) {
    const flipped = await flip({ store, now, seedIndex, siteUrl })
    console.log(`press: flip ${JSON.stringify(flipped)}`)
    if (flipped.applied.length) commitMessage = `chore: fold ${flipped.applied.join(', ')} into the manifest`
    if (flipped.site && flipped.site !== 'ok') {
      await say(`Frontpage live check failed for ${flipped.current}: ${flipped.site}`)
      process.exitCode = 1
    }
  }
  if (command === 'flip') return finish()

  if (command === 'run' || command === 'build') {
    const models = createModels({ env })
    try {
      const result = await build({
        store, models, now, seedIndex,
        date: option(args, '--date'),
        lookaheadDays: Number.parseInt(env.PRESS_LOOKAHEAD_DAYS || '1', 10),
      })
      if (result.status === 'nothing-to-do') {
        console.log('press: nothing to build')
        return finish()
      }
      console.log(`press: built ${JSON.stringify({ ...result, calls: result.calls.length })}`)
      commitMessage = `feat: publish daily edition ${result.editionId} (live ${result.goLiveAt})`
      await finish()
      if (!process.exitCode) await say(builtMessage(result, siteUrl))
    } catch (error) {
      console.error(`press: failed at ${error.step || 'unknown'}: ${error.message}`)
      if (await shouldTellFailure(store, { date: error.date || localDate(now), step: error.step || 'unknown' })) await say(failedMessage(error))
      process.exitCode = 1
      await finish()
    }
    return
  }

  throw new Error(`Unknown command "${command}". Use run, build, flip or status.`)
}

main().catch((error) => {
  console.error(`press: ${error.message}`)
  process.exitCode = 1
})
