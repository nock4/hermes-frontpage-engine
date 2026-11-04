import { chromium } from 'playwright'
import { fetchVettedRemoteUrl } from './source-image-network-policy.mjs'

/** Optional, bounded original-source probe; never turns a plate into a movie.
 * DNS-pinned fetch precedes an offline browser decode of exactly those bytes.
 * Remote sources must permit anonymous pixels from every production origin.
 */
export async function admitNativeVideo({ source, binding }, { fetchRemote = fetchVettedRemoteUrl } = {}) {
  if (
    source?.media_type !== 'video' ||
    binding.source_media_type !== 'video' ||
    source.media_url !== binding.source_media_url ||
    ![source.url, source.source_url, source.final_url].includes(binding.source_url) ||
    !/^https:\/\//.test(source.media_url)
  )
    return null
  let browser
  try {
    const response = await fetchRemote(source.media_url, { timeoutMs: 6000, maxBytes: 16000000 })
    if (
      !response?.ok ||
      !response.headers.get('content-type')?.startsWith('video/') ||
      response.headers.get('access-control-allow-origin') !== '*'
    )
      return null
    const bytes = Buffer.from(await response.arrayBuffer())
    browser = await chromium.launch({ headless: true, timeout: 5000 })
    const page = await browser.newPage()
    await page.route('**/*', (route) =>
      route.request().url() === source.media_url
        ? route.fulfill({
            body: bytes,
            headers: {
              'Content-Type': response.headers.get('content-type'),
              'Access-Control-Allow-Origin': '*',
            },
          })
        : route.abort(),
    )
    await page.setContent('<video crossorigin="anonymous" muted playsinline></video>')
    const decoded = await page.evaluate(async (url) => {
      const v = document.querySelector('video')
      v.src = url
      const timeout = new Promise((resolve) => setTimeout(() => resolve(false), 5000))
      return Promise.race([
        timeout,
        (async () => {
          try {
            await v.play()
            await new Promise((r) => setTimeout(r, 300))
            const t = v.currentTime
            if (
              t <= 0 ||
              v.videoWidth < 16 ||
              v.videoHeight < 16 ||
              !Number.isFinite(v.duration) ||
              v.duration < 0.3
            )
              return false
            const c = document.createElement('canvas')
            c.width = 12
            c.height = 8
            const ctx = c.getContext('2d')
            ctx.drawImage(v, 0, 0, 12, 8)
            ctx.getImageData(0, 0, 12, 8)
            await new Promise((r) => setTimeout(r, 200))
            return v.currentTime > t
          } catch {
            return false
          }
        })(),
      ])
    }, source.media_url)
    return decoded
      ? { url: source.media_url, owner_url: binding.source_url, verified_native: true, cors_safe: true }
      : null
  } catch {
    return null
  } finally {
    await browser?.close()
  }
}
