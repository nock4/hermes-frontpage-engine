// Edition dates are calendar days in America/Detroit; editions go live at 04:00 there.

const PRESS_TIMEZONE = 'America/Detroit'
const GO_LIVE_HOUR = 4

const dateFormat = new Intl.DateTimeFormat('en-CA', { timeZone: PRESS_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' })
const hourFormat = new Intl.DateTimeFormat('en-US', { timeZone: PRESS_TIMEZONE, hour: 'numeric', hourCycle: 'h23' })

export function localDate(now = new Date()) {
  return dateFormat.format(now)
}

export function addDays(date, days) {
  const [year, month, day] = date.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10)
}

// The UTC instant of 04:00 local time on the given edition date (handles EST/EDT).
export function goLiveAt(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`Invalid edition date: ${date}`)
  const [year, month, day] = date.split('-').map(Number)
  for (const offsetHours of [4, 5]) {
    const candidate = new Date(Date.UTC(year, month - 1, day, GO_LIVE_HOUR + offsetHours))
    if (localDate(candidate) === date && Number(hourFormat.format(candidate)) === GO_LIVE_HOUR) return candidate.toISOString()
  }
  throw new Error(`Could not resolve ${GO_LIVE_HOUR}:00 ${PRESS_TIMEZONE} on ${date}`)
}
