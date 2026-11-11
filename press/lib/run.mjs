// The press: flip due editions live, then build the next missing edition.
//
//   pick -> brief -> plate -> map -> assemble -> write -> smoke -> park -> push -> tell
//
// Rules:
//   - Publish and note it when the art is weak. Only "the page would not load"
//     (the smoke step) blocks an edition.
//   - A built edition is parked with a go-live time; readers of the manifest make
//     it live when that time passes. `flip` only folds it into index.json.
//   - Every run is idempotent: it builds at most one edition, for the earliest
//     date from today to today + lookahead that has none.

import { INDEX_KEY, PARKED_KEY, dueEntries, editionDates, mergeParked, normalizeParked, pendingEntries } from '../../shared/edition-index.js'
import { assembleEdition } from './assemble.mjs'
import { CANDIDATES_KEY, LEDGER_KEY, loadSource, markSkipped, markUsed, normalizeLedger, orderCandidates } from './pick.mjs'
import { smokeEdition, smokeSite } from './smoke.mjs'
import { UnusableSource, composeBrief, generatePlate, mapPlate } from './steps.mjs'
import { addDays, goLiveAt, localDate } from './time.mjs'

const STATE_KEY = 'press/state.json'
const MAX_PICK_TRIES = 5

async function step(name, run) {
  try {
    return await run()
  } catch (error) {
    if (!error.step) error.step = name
    throw error
  }
}

async function readManifest(store, seedIndex) {
  const stored = await store.getJson(INDEX_KEY)
  if (stored) return { index: stored, seeded: false }
  if (seedIndex) return { index: seedIndex, seeded: true }
  throw Object.assign(new Error(`No manifest at ${INDEX_KEY} and no seed manifest given`), { step: 'load' })
}

export function chooseDate({ index, parked, today, lookaheadDays }) {
  const taken = editionDates(index, parked)
  for (let offset = 0; offset <= lookaheadDays; offset += 1) {
    const date = addDays(today, offset)
    if (!taken.has(date)) return date
  }
  return null
}

// Fold every due parked edition into index.json. Safe to run at any time.
export async function flip({ store, now = new Date(), seedIndex = null, siteUrl = '', fetchImpl = fetch }) {
  const { index, seeded } = await readManifest(store, seedIndex)
  const parked = normalizeParked(await store.getJson(PARKED_KEY))
  const merged = mergeParked(index, parked, now.getTime())
  if (merged.applied.length || seeded) await store.putJson(INDEX_KEY, merged.index)
  if (merged.applied.length) await store.putJson(PARKED_KEY, { version: 1, entries: pendingEntries(parked, now.getTime()) })
  const result = { applied: merged.applied.map((entry) => entry.edition_id), current: merged.index.current_edition_id, site: null }
  if (siteUrl && merged.applied.length) {
    try {
      await smokeSite({ siteUrl, editionId: merged.index.current_edition_id, fetchImpl })
      result.site = 'ok'
    } catch (error) {
      result.site = `failed: ${error.message}`
    }
  }
  return result
}

export async function build({
  store, models, now = new Date(), date = null, seedIndex = null, lookaheadDays = 1,
  deps = {}, log = console.log,
}) {
  const sourceLoader = deps.loadSource || loadSource
  const { index } = await step('load', () => readManifest(store, seedIndex))
  const parked = normalizeParked(await store.getJson(PARKED_KEY))
  const target = date || chooseDate({ index, parked, today: localDate(now), lookaheadDays })
  if (!target) return { status: 'nothing-to-do' }
  const liveAt = goLiveAt(target)

  const ledger = normalizeLedger(await store.getJson(LEDGER_KEY))
  const candidates = (await store.getJson(CANDIDATES_KEY))?.candidates || []
  const queue = orderCandidates(candidates, ledger)
  const recentEditions = [...parked.entries.map((entry) => entry.manifest_item), ...index.editions].slice(0, 8)

  let source = null
  let brief = null
  let ledgerChanged = false
  let written = []
  const skipped = []
  try {
    for (const candidate of queue.slice(0, MAX_PICK_TRIES)) {
      let loaded
      try {
        loaded = await sourceLoader(candidate)
      } catch (error) {
        markSkipped(ledger, candidate.key, error.message)
        ledgerChanged = true
        skipped.push(`${candidate.key}: ${error.message}`)
        continue
      }
      try {
        brief = await step('brief', () => composeBrief({ models, date: target, source: loaded, recentEditions }))
        source = loaded
        break
      } catch (error) {
        if (!(error instanceof UnusableSource)) throw error
        markSkipped(ledger, candidate.key, error.message, { permanent: true })
        ledgerChanged = true
        skipped.push(`${candidate.key}: ${error.message}`)
      }
    }
    if (!source) {
      throw Object.assign(new Error(`No usable source: ${queue.length} unused candidates, tried ${Math.min(queue.length, MAX_PICK_TRIES)}${skipped.length ? ` (${skipped.join('; ')})` : ''}`), { step: 'pick' })
    }
    log(`press: ${target} from ${source.url}`)

    const plate = await step('plate', () => generatePlate({ models, brief, source }))
    const map = await step('map', () => mapPlate({ models, brief, plate }))
    const existingIds = new Set([...index.editions.map((item) => item.edition_id), ...parked.entries.map((entry) => entry.edition_id)])
    const edition = await step('assemble', () => assembleEdition({
      date: target, goLiveAt: liveAt, source, brief, plate, map, existingIds, builtAt: now.toISOString(), provenance: { calls: models.calls },
    }))

    await step('write', async () => {
      for (const [key, body] of edition.files) {
        written.push(key)
        await store.put(key, body)
      }
    })

    const entry = { edition_id: edition.editionId, date: target, go_live_at: liveAt, built_at: now.toISOString(), manifest_item: edition.manifestItem }
    const nextParked = { version: 1, entries: [...parked.entries.filter((item) => item.date !== target), entry] }
    const liveIndex = mergeParked(index, { version: 1, entries: [...dueEntries(parked, Date.parse(liveAt)), entry] }, Date.parse(liveAt)).index
    const smoke = await step('smoke', () => smokeEdition({ store, editionId: edition.editionId, index: liveIndex }))

    // Commit point: once the ledger and parked list are written the edition is
    // scheduled. Everything before this can be rerun without leaving a trace
    // that readers can see.
    await step('park', async () => {
      markUsed(ledger, source.key, { edition_id: edition.editionId, date: target })
      await store.putJson(LEDGER_KEY, ledger)
      ledgerChanged = false
      await store.putJson(PARKED_KEY, nextParked)
      written = []
    })
    return {
      status: 'built', date: target, editionId: edition.editionId, title: brief.edition_title, goLiveAt: liveAt,
      liveNow: Date.parse(liveAt) <= now.getTime(), sourceUrl: source.url, notes: edition.notes, smoke, calls: models.calls,
    }
  } catch (error) {
    error.date = target
    // An edition that was written but not parked must not be left to be committed.
    for (const key of written) await store.delete(key).catch(() => {})
    throw error
  } finally {
    if (ledgerChanged) await store.putJson(LEDGER_KEY, ledger).catch(() => {})
  }
}

// One failure notice per (date, step): repeated runs must not repeat the message.
export async function shouldTellFailure(store, { date, step: failedStep }) {
  const state = (await store.getJson(STATE_KEY).catch(() => null)) || {}
  const same = state.last_failure?.date === date && state.last_failure?.step === failedStep
  if (!same) await store.putJson(STATE_KEY, { ...state, last_failure: { date, step: failedStep, at: new Date().toISOString() } }).catch(() => {})
  return !same
}

export function builtMessage(result, siteUrl = '') {
  const day = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${result.date}T12:00:00Z`))
  const lines = [result.liveNow
    ? `Frontpage live now (${day}): "${result.title}"`
    : `Frontpage parked for ${day}: "${result.title}". Goes live 4:00 AM ET.`]
  if (result.liveNow && siteUrl) lines.push(siteUrl.replace(/\/+$/, '/'))
  lines.push(`Source: ${result.sourceUrl}`)
  for (const note of result.notes) lines.push(`Note: ${note}`)
  return lines.join('\n')
}

export function failedMessage(error) {
  const reason = String(error.message || error).replace(/\s+/g, ' ').slice(0, 500)
  return `Frontpage press failed at "${error.step || 'unknown'}"${error.date ? ` for ${error.date}` : ''}: ${reason}\nIt retries on the next scheduled run.`
}
