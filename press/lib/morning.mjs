// Morning post: once an edition goes live, send Nick a picture of the front
// page and the anchor source material in one Telegram album. Never throws; a
// failed notice must not turn a good edition into a failed run.

const DEFAULT_SITE = 'https://daily.nockgarden.com/'

// The hero binding is the anchor source; fall back to the first binding.
export async function anchorSource(store, editionId) {
  const bindings = (await store.getJson(`editions/${editionId}/source-bindings.json`))?.bindings || []
  const binding = bindings.find((entry) => String(entry.artifact_id || '').startsWith('hero-')) || bindings[0] || null
  if (!binding) return null
  const poster = binding.source_visual?.poster_asset_path || null
  const image = poster ? await store.get(poster.replace(/^\/+/, '')) : null
  return {
    url: binding.source_url || null,
    title: binding.source_title || binding.title || null,
    image,
  }
}

// A real browser view of the live page. Returns null when no browser is
// available; the caller then sends the plate instead.
export async function screenshotSite(siteUrl, { editionId, timeoutMs = 60_000 } = {}) {
  let browser
  try {
    const { chromium } = await import('playwright')
    browser = await chromium.launch()
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
    await page.goto(siteUrl, { waitUntil: 'networkidle', timeout: timeoutMs })
    if (editionId) {
      await page.waitForFunction((id) => [...document.images].some((img) => img.complete && img.naturalWidth > 0 && img.currentSrc.includes(id)),
        editionId, { timeout: timeoutMs })
    }
    await page.waitForTimeout(1500)
    return await page.screenshot({ type: 'png' })
  } catch {
    return null
  } finally {
    await browser?.close().catch(() => {})
  }
}

export function morningCaption({ title, editionId, siteUrl, source }) {
  const lines = [`Frontpage live now: "${title || editionId}"`, siteUrl]
  if (source?.url) lines.push('', `Anchor source: ${source.title ? `${source.title}\n` : ''}${source.url}`)
  return lines.join('\n').slice(0, 1000)
}

export async function sendMorningPost({
  store, editionId, env = process.env, fetchImpl = fetch, log = console.log,
  screenshot = screenshotSite,
}) {
  try {
    const siteUrl = env.PRESS_SITE_URL || DEFAULT_SITE
    const edition = await store.getJson(`editions/${editionId}/edition.json`)
    const source = await anchorSource(store, editionId)
    const front = (await screenshot(siteUrl, { editionId })) || await store.get(`editions/${editionId}/assets/plate.png`)
    const caption = morningCaption({ title: edition?.title, editionId, siteUrl, source })
    log(`morning: ${caption.split('\n')[0]} (front page ${front ? 'attached' : 'missing'}, source image ${source?.image ? 'attached' : 'missing'})`)
    if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) return { sent: false, reason: 'telegram not configured' }

    const photos = [front && { name: 'frontpage.png', bytes: front, type: 'image/png' },
      source?.image && { name: 'source.jpg', bytes: source.image, type: 'image/jpeg' }].filter(Boolean)
    const form = new FormData()
    form.append('chat_id', String(env.TELEGRAM_CHAT_ID))
    let method
    if (photos.length === 0) {
      method = 'sendMessage'
      form.append('text', caption)
    } else if (photos.length === 1) {
      method = 'sendPhoto'
      form.append('photo', new Blob([photos[0].bytes], { type: photos[0].type }), photos[0].name)
      form.append('caption', caption)
    } else {
      method = 'sendMediaGroup'
      form.append('media', JSON.stringify(photos.map((photo, i) => ({
        type: 'photo', media: `attach://${photo.name}`, ...(i === 0 ? { caption } : {}),
      }))))
      for (const photo of photos) form.append(photo.name, new Blob([photo.bytes], { type: photo.type }), photo.name)
    }
    const response = await fetchImpl(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
      method: 'POST', body: form, signal: AbortSignal.timeout(30_000),
    })
    if (!response.ok) return { sent: false, reason: `telegram HTTP ${response.status}` }
    return { sent: true, method, photos: photos.length }
  } catch (error) {
    // The URL holds the bot token: report the kind of failure, never the message.
    return { sent: false, reason: `morning ${error.name}` }
  }
}
