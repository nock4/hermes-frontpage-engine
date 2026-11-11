// Pure manifest logic shared by the press (Node) and the Pages Function (edge).
// No imports: this file must run unchanged in both runtimes.
//
// The live manifest is `editions/index.json`. A built edition waits in
// `press/parked.json` with a `go_live_at` instant. It becomes visible the moment
// that instant passes, because every reader of the manifest merges due parked
// entries first. No scheduler has to fire for an edition to go live.

export const INDEX_KEY = 'editions/index.json'
export const PARKED_KEY = 'press/parked.json'

function emptyParked() {
  return { version: 1, entries: [] }
}

export function normalizeParked(value) {
  if (!value || typeof value !== 'object' || !Array.isArray(value.entries)) return emptyParked()
  const entries = value.entries.filter((entry) => entry
    && typeof entry.edition_id === 'string'
    && typeof entry.date === 'string'
    && Number.isFinite(Date.parse(entry.go_live_at))
    && entry.manifest_item && entry.manifest_item.edition_id === entry.edition_id)
  return { version: 1, entries }
}

export function dueEntries(parked, nowMs) {
  return normalizeParked(parked).entries
    .filter((entry) => Date.parse(entry.go_live_at) <= nowMs)
    .sort((a, b) => Date.parse(a.go_live_at) - Date.parse(b.go_live_at))
}

export function pendingEntries(parked, nowMs) {
  return normalizeParked(parked).entries.filter((entry) => Date.parse(entry.go_live_at) > nowMs)
}

// Returns a new manifest with every due parked edition made live, oldest first,
// so the newest due edition ends up current. Never mutates its inputs.
export function mergeParked(index, parked, nowMs) {
  const due = dueEntries(parked, nowMs)
  if (!due.length) return { index, applied: [] }
  let editions = (index?.editions || []).map((item) => ({ ...item }))
  let current = index?.current_edition_id
  for (const entry of due) {
    editions = editions.filter((item) => item.edition_id !== entry.edition_id)
    for (const item of editions) item.is_live = false
    editions.unshift({ ...entry.manifest_item, is_live: true })
    current = entry.edition_id
  }
  return { index: { ...index, current_edition_id: current, editions }, applied: due }
}

export function editionDates(index, parked) {
  const dates = new Set((index?.editions || []).map((item) => item.date))
  for (const entry of normalizeParked(parked).entries) dates.add(entry.date)
  return dates
}
