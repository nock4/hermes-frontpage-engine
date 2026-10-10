import { spawn } from 'node:child_process'
import dns from 'node:dns/promises'
import http from 'node:http'
import path from 'node:path'
import { validatedYouTubeCreator } from './provider-creator.mjs'

import { fetchWithTimeout } from './fetch-with-timeout.mjs'
import { fetchVettedImage } from './fetch-vetted-image.mjs'
import { fetchVettedRemoteUrl, resolveFetchableHtmlUrl } from './source-image-network-policy.mjs'
import {
  classifySource,
  isAllowedInspectedSource,
  isLowValueVisualImage,
  scoreVisualCandidate,
  selectBestVisualReference,
} from './source-selection-policy.mjs'
import {
  isAllowedSourceUrl,
  isBandcampStreamingSourceUrl,
  isYouTubeVideoUrl,
  youtubeId,
} from './source-url-policy.mjs'

function decodeHtml(value) {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
}

function extractMeta(html, regexes) {
  for (const regex of regexes) {
    const match = html.match(regex)
    if (match?.[1]) return decodeHtml(match[1].trim())
  }
  return null
}

function absoluteUrl(url, base) {
  if (!url) return null
  try {
    return new URL(url, base).toString()
  } catch {
    return null
  }
}

function extractBandcampEmbedHtml(html) {
  const raw = extractMeta(html, [/data-embed=["']([^"']+)["']/i])
  if (!raw) return null
  try {
    const embed = JSON.parse(raw)
    const param = embed?.tralbum_param
    const paramName = param?.name === 'album' ? 'album' : param?.name === 'track' ? 'track' : null
    const paramValue = Number.parseInt(String(param?.value || ''), 10)
    if (!paramName || !Number.isFinite(paramValue) || paramValue <= 0) return null
    return `<iframe src="https://bandcamp.com/EmbeddedPlayer/${paramName}=${paramValue}/size=large/bgcol=333333/linkcol=e32c14/artwork=small/transparent=true/"></iframe>`
  } catch {
    return null
  }
}

async function fetchBandcampEmbedHtml(fetchable) {
  try {
    const response = await fetchVettedRemoteUrl(fetchable, {
      lookup: dns.lookup,
      headers: {
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'user-agent': 'daily-frontpage-engine-source-research/0.1',
      },
      timeoutMs: 8000,
      maxBytes: 1_000_001,
    })
    if (!response) throw new Error('blocked HTML URL')
    const html = await response.text()
    return extractBandcampEmbedHtml(html)
  } catch {
    return null
  }
}

const youtubeEmbedStatusCache = new Map()
const youtubeCreatorCache = new Map()

export function youtubeCreatorAttribution(sourceUrl) {
  const author = youtubeCreatorCache.get(youtubeId(sourceUrl))
  return author ? validatedYouTubeCreator(sourceUrl, author) : null
}

function timeoutAfter(timeoutMs, message) {
  let timer = null
  const promise = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), timeoutMs)
  })
  return { promise, cancel: () => clearTimeout(timer) }
}

async function withTimeout(promise, timeoutMs, message) {
  const timeout = timeoutAfter(timeoutMs, message)
  try {
    return await Promise.race([promise, timeout.promise])
  } finally {
    timeout.cancel()
  }
}

export function classifyYouTubeEmbedFrameText(text) {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim().toLowerCase()
  if (!normalized) return null
  if (
    normalized.includes('video unavailable')
    || normalized.includes('playback on other websites has been disabled')
    || normalized.includes('only available on youtube')
    || normalized.includes('watch video on youtube')
    || normalized.includes('watch on youtube')
    || normalized.includes('video player configuration error')
  ) {
    return 'unavailable'
  }
  return null
}

function startTemporaryEmbedOrigin() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((request, response) => {
      response.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
      })
      response.end('<!doctype html><html><head><title>Daily Frontpage Embed Probe</title></head><body></body></html>')
    })
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address !== 'object') {
        server.close()
        reject(new Error('Unable to allocate YouTube embed probe origin.'))
        return
      }
      resolve({
        origin: `http://127.0.0.1:${address.port}`,
        close: () => new Promise((closeResolve) => server.close(closeResolve)),
      })
    })
  })
}

async function browserVerifiedYouTubeEmbedStatus(videoId) {
  let browser = null
  let temporaryOrigin = null
  try {
    const { chromium } = await import('playwright')
    temporaryOrigin = await startTemporaryEmbedOrigin()
    browser = await chromium.launch({ timeout: 8000 })
    const page = await browser.newPage({ viewport: { width: 640, height: 390 } })
    await page.goto(temporaryOrigin.origin, { waitUntil: 'domcontentloaded', timeout: 6000 })
    await page.evaluate(({ origin, videoId }) => {
      document.body.innerHTML = ''
      const iframe = document.createElement('iframe')
      iframe.width = '560'
      iframe.height = '315'
      iframe.src = `https://www.youtube.com/embed/${videoId}?autoplay=0&origin=${encodeURIComponent(origin)}`
      iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share'
      iframe.allowFullscreen = true
      document.body.append(iframe)
    }, { origin: temporaryOrigin.origin, videoId })
    let lastBodyText = ''
    for (let attempt = 0; attempt < 8; attempt += 1) {
      await page.waitForTimeout(1500)
      const frame = page.frames().find((candidate) => candidate.url().includes(`/embed/${videoId}`))
      lastBodyText = frame
        ? await frame.locator('body').innerText({ timeout: 1500 }).catch(() => '')
        : ''
      const classified = classifyYouTubeEmbedFrameText(lastBodyText)
      if (classified) return classified
    }
    return classifyYouTubeEmbedFrameText(lastBodyText)
  } catch {
    return null
  } finally {
    if (browser) await browser.close().catch(() => {})
    if (temporaryOrigin) await temporaryOrigin.close().catch(() => {})
  }
}

async function browserVerifiedYouTubeEmbedStatusWithTimeout(videoId, timeoutMs = 20_000) {
  try {
    return await withTimeout(
      browserVerifiedYouTubeEmbedStatus(videoId),
      timeoutMs,
      `YouTube embed playback probe timed out after ${timeoutMs}ms`,
    )
  } catch {
    return null
  }
}

export async function youtubeEmbedStatus(sourceUrl, { verifyPlayback = true } = {}) {
  if (!isYouTubeVideoUrl(sourceUrl)) return null
  const videoId = youtubeId(sourceUrl)
  if (!videoId) return null
  const cacheKey = `${videoId}:${verifyPlayback ? 'verified' : 'oembed'}`
  if (youtubeEmbedStatusCache.has(cacheKey)) return youtubeEmbedStatusCache.get(cacheKey)

  const endpoint = `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(sourceUrl)}`
  try {
    const response = await fetchWithTimeout(endpoint, {
      headers: {
        accept: 'application/json,text/plain,*/*;q=0.8',
        'user-agent': 'daily-frontpage-engine-youtube-embed-check/0.1',
      },
    }, 5000)
    if (!response.ok) {
      youtubeEmbedStatusCache.set(cacheKey, 'unavailable')
      return 'unavailable'
    }
    // Attribution failure must not change the existing playback result.
    let metadataReader
    try {
      // Fetch's timeout ends at headers. Keep body consumption bounded too,
      // retaining the reader so a stalled stream can actually be cancelled.
      const metadata = response.body?.getReader ? (async () => {
        metadataReader = response.body.getReader()
        const decoder = new TextDecoder()
        let text = ''
        while (true) {
          const { done, value } = await metadataReader.read()
          if (done) break
          text += decoder.decode(value, { stream: true })
        }
        return JSON.parse(text + decoder.decode())
      })() : response.json()
      const payload = await withTimeout(metadata, 5000, 'YouTube metadata body timed out')
      const creator = validatedYouTubeCreator(sourceUrl, payload?.author_url)
      if (creator) youtubeCreatorCache.set(videoId, creator.author_url)
    } catch { /* Missing/malformed/timed-out metadata has no creator identity. */ }
    finally { void metadataReader?.cancel().catch(() => {}) }
  } catch {
    youtubeEmbedStatusCache.set(cacheKey, 'unavailable')
    return 'unavailable'
  }

  const status = verifyPlayback ? await browserVerifiedYouTubeEmbedStatusWithTimeout(videoId) : null
  youtubeEmbedStatusCache.set(cacheKey, status)
  return status
}

const visualImageHealthCache = new Map()

async function isLoadableVisualImage(imageUrl) {
  if (!imageUrl || isLowValueVisualImage(imageUrl)) return false
  if (visualImageHealthCache.has(imageUrl)) return visualImageHealthCache.get(imageUrl)

  try {
    const { response, finalUrl, imageUrls } = await fetchVettedImage(imageUrl, {
      lookup: dns.lookup,
      headers: {
        accept: 'image/avif,image/webp,image/png,image/jpeg,image/*,*/*;q=0.5',
        range: 'bytes=0-4095',
      },
      timeoutMs: 8000,
      // Range is advisory: some image CDNs return the entire image with HTTP 200.
      // Keep the same bounded ceiling used by vetted source-image downloads.
      maxBytes: 8_000_000,
    })
    if (!response) throw new Error('blocked image URL')
    const contentType = response.headers.get('content-type')?.toLowerCase() || ''
    const loadable = response.ok && (!contentType || (contentType.startsWith('image/') && !contentType.includes('svg')))
    const resolved = loadable && !isLowValueVisualImage(finalUrl) ? { finalUrl, imageUrls } : false
    visualImageHealthCache.set(imageUrl, resolved)
    return resolved
  } catch {
    visualImageHealthCache.set(imageUrl, false)
    return false
  }
}

async function normalizeInspectedSourceMedia(source) {
  if (!source) return null
  if (!isAllowedInspectedSource(source)) return null

  const imageUrl = absoluteUrl(source.image_url, source.final_url || source.source_url || source.url)
  const resolvedImageUrl = imageUrl && await isLoadableVisualImage(imageUrl)
  if (resolvedImageUrl) {
    return {
      ...source,
      source_image_url: source.source_image_url || imageUrl,
      source_image_aliases: [...new Set([
        ...(source.source_image_aliases || []), source.source_image_url, imageUrl, ...resolvedImageUrl.imageUrls,
      ].filter(Boolean))],
      image_url: resolvedImageUrl.finalUrl,
    }
  }

  return { ...source, image_url: null }
}

function isTweetStatusUrl(sourceUrl) {
  try {
    const parsed = new URL(sourceUrl)
    const host = parsed.hostname.replace(/^www\./, '').toLowerCase()
    return (host === 'x.com' || host === 'twitter.com') && /^\/(?:[^/]+\/|i\/web\/)?status\/\d+(?:\/|$)/.test(parsed.pathname)
  } catch {
    return false
  }
}

function fxtwitterApiUrl(sourceUrl) {
  try {
    const parsed = new URL(sourceUrl)
    if (!isTweetStatusUrl(sourceUrl)) return null
    const match = parsed.pathname.match(/\/status\/(\d+)(?:\/|$)/)
    if (!match) return null
    // The provider resolves authorless saved permalinks by status id too.
    return `https://api.fxtwitter.com/status/${match[1]}`
  } catch {
    return null
  }
}

function bestTweetMedia(tweet) {
  const media = [
    ...(tweet?.media?.videos || []),
    ...(tweet?.media?.all || []),
    ...(tweet?.media?.photos || []),
  ]

  for (const item of media) {
    if (item?.type !== 'video' && item?.type !== 'gif') continue
    const variants = [
      ...(item?.variants || []),
      ...(item?.video_info?.variants || []),
    ].filter((variant) => typeof variant?.url === 'string' && variant.url.includes('.mp4'))
    const bestVariant = variants
      .map((variant) => ({ ...variant, bitrate: Number(variant.bitrate || 0) }))
      .sort((a, b) => b.bitrate - a.bitrate)[0]
    if (bestVariant?.url) {
      return {
        media_url: bestVariant.url,
        media_type: 'video',
        image_url: item.thumbnail_url || item.url || null,
      }
    }
    if (item.thumbnail_url) {
      return {
        media_url: item.thumbnail_url,
        media_type: 'image',
        image_url: item.thumbnail_url,
      }
    }
  }

  for (const item of media) {
    if (item?.type === 'photo' && item.url) {
      return {
        media_url: item.url,
        media_type: 'image',
        image_url: item.url,
      }
    }
  }

  return { media_url: null, media_type: null, image_url: null }
}

function tweetProviderFallback(candidate, classification, reason = 'fxtwitter-unavailable') {
  return {
    ...candidate,
    ...classification,
    source_url: candidate?.url || null,
    final_url: candidate?.url || null,
    title: candidate?.note_title || candidate?.url || 'Tweet source',
    description: candidate?.note_title || '',
    image_url: null,
    media_url: null,
    media_type: null,
    fetch_status: `tweet-provider-fallback:${reason}`,
    tweet_media_count: 0,
  }
}

async function inspectTweetWithFxtwitter(candidate, classification) {
  const endpoint = fxtwitterApiUrl(candidate.url)
  if (!endpoint) return null

  try {
    const response = await fetchWithTimeout(endpoint, {
      headers: {
        accept: 'application/json,text/plain,*/*;q=0.8',
        'user-agent': 'daily-frontpage-engine-source-research/0.1',
      },
    }, 8000)
    if (!response.ok) return null
    const payload = await response.json()
    if (payload?.code && Number(payload.code) >= 400) return null
    const tweet = payload?.tweet
    if (!tweet) return null

    const author = tweet.author?.screen_name ? `@${tweet.author.screen_name}` : null
    const text = String(tweet.text || '').trim()
    const title = text
      ? `${author ? `${author}: ` : ''}${text.replace(/\s+/g, ' ').slice(0, 140)}`
      : candidate.note_title
    const media = bestTweetMedia(tweet)
    return normalizeInspectedSourceMedia({
      ...candidate,
      ...classification,
      source_url: candidate.url,
      final_url: tweet.url || candidate.url,
      title,
      description: text || candidate.note_title || '',
      image_url: media.image_url,
      media_url: media.media_url,
      media_type: media.media_type,
      fetch_status: 'fxtwitter-fetch-ok',
      tweet_media_count: tweet.media?.all?.length || tweet.media?.photos?.length || 0,
    })
  } catch {
    return null
  }
}

function runCaptured(command, args, { input = '', cwd = process.cwd(), timeoutMs = 30_000, env = process.env } = {}) {
  return new Promise((resolve, reject) => {
    let failure = null
    let killTimer = null
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    const stop = (error) => {
      failure ||= error
      if (!child.pid || child.exitCode !== null || child.signalCode !== null || killTimer) return
      child.kill('SIGTERM')
      // Do not settle on timeout: keep escalation alive until the child exits.
      killTimer = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
      }, 2000)
    }
    const timer = setTimeout(() => {
      stop(new Error(`${command} timed out after ${timeoutMs}ms`))
    }, timeoutMs)
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString()
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })
    child.on('error', stop)
    // An early exit can break a pending input write. Observe that error and use
    // the same termination/reaping path instead of throwing an uncaught EPIPE.
    child.stdin.on('error', stop)
    child.on('exit', () => {
      clearTimeout(timer)
      clearTimeout(killTimer)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      clearTimeout(killTimer)
      // close follows exit (or spawn failure) and stdio closure: the child has
      // been reaped before either timeout rejection or successful completion.
      if (failure) reject(failure)
      else resolve({ code, stdout, stderr })
    })
    child.stdin.end(input)
  })
}

async function inspectWithBrowserHarness(sourceUrl, browserHarnessPath) {
  if (process.env.DFE_ENABLE_UNTRUSTED_BROWSER_SOURCE_INSPECTION !== '1') {
    return {
      fetch_status: 'browser-harness-disabled',
      error: 'browser-harness source navigation is disabled unless DFE_ENABLE_UNTRUSTED_BROWSER_SOURCE_INSPECTION=1; using DNS-vetted fetch fallback',
      final_url: sourceUrl,
      title: '',
      description: '',
      image_url: '',
      visible_text: '',
    }
  }
  // Snapshot explicit caller ownership before the harness can load its own .env.
  // Only our isolated run names and literal loopback Chrome endpoints qualify.
  const relayName = process.env.BU_NAME || ''
  const relayWs = process.env.BU_CDP_WS || ''
  let canReconnect = false
  try {
    const endpoint = new URL(relayWs)
    canReconnect = /^dfe-[a-zA-Z0-9_-]{1,48}$/.test(relayName)
      && /^ws:\/\/(?:127\.0\.0\.1|\[::1\]):[0-9]+\//.test(relayWs)
      && endpoint.protocol === 'ws:'
      && ['127.0.0.1', '[::1]'].includes(endpoint.hostname)
      && Boolean(endpoint.port)
      && /^\/devtools\/browser\/[a-zA-Z0-9_-]+$/.test(endpoint.pathname)
      && !endpoint.username && !endpoint.password && !endpoint.search && !endpoint.hash
      && !process.env.BU_BROWSER_ID
  } catch { /* Missing or non-local endpoint: never restart a shared relay. */ }
  const script = `
import json

url = ${JSON.stringify(sourceUrl)}
def inspect_source(url):
    ensure_real_tab()
    if ${canReconnect ? 'True' : 'False'}:
        # The relay's load-event title marker awaits a CDP reply from inside
        # its receive loop. Queued load callbacks can exhaust the 18s budget.
        # Our owned metadata capture polls readyState and needs no Page events.
        # Leave shared/remote browser subscriptions untouched.
        cdp('Page.disable')
    goto(url)
    wait_for_load(8)
    wait(0.8)
    payload = js(r'''
JSON.stringify({
  final_url: location.href,
  title: document.querySelector('meta[property="og:title"]')?.content
    || document.querySelector('meta[name="twitter:title"]')?.content
    || document.title
    || '',
  description: document.querySelector('meta[name="description"]')?.content
    || document.querySelector('meta[property="og:description"]')?.content
    || document.querySelector('meta[name="twitter:description"]')?.content
    || '',
  image_url: document.querySelector('meta[property="og:image:secure_url"]')?.content
    || document.querySelector('meta[property="og:image"]')?.content
    || document.querySelector('meta[name="twitter:image:src"]')?.content
    || document.querySelector('meta[name="twitter:image"]')?.content
    || document.querySelector('img')?.src
    || '',
  h1: document.querySelector('h1')?.innerText?.trim() || '',
  visible_text: (document.body?.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 900)
})
''')
    data = json.loads(payload or '{}')
    data['fetch_status'] = 'browser-harness'
    return data

try:
    try:
        data = inspect_source(url)
    except Exception as exc:
        message = str(exc).lower()
        stale = 'keepalive ping timeout' in message or 'no close frame received or sent' in message
        if not (${canReconnect ? 'True' : 'False'} and stale):
            raise
        # Restart only this managed relay, not Chrome. The single retry repeats
        # navigation to the exact vetted source; all work shares the 18s deadline.
        from admin import restart_daemon, ensure_daemon
        restart_daemon(name=${JSON.stringify(relayName)})
        ensure_daemon(wait=5, name=${JSON.stringify(relayName)}, env={
            'BU_CDP_WS': ${JSON.stringify(relayWs)}, 'BU_BROWSER_ID': ''
        })
        data = inspect_source(url)
    print(json.dumps(data))
except Exception as exc:
    print(json.dumps({
        'fetch_status': 'browser-harness-error',
        'error': str(exc),
        'final_url': url,
        'title': '',
        'description': '',
        'image_url': '',
        'visible_text': ''
    }))
`
  let result
  try {
    result = await runCaptured(browserHarnessPath, [], {
      input: script,
      cwd: path.dirname(path.dirname(browserHarnessPath)),
      timeoutMs: 18_000,
    })
  } catch (error) {
    return {
      fetch_status: 'browser-harness-error',
      error: error.message,
      final_url: sourceUrl,
      title: '',
      description: '',
      image_url: '',
      visible_text: '',
    }
  }
  const lines = result.stdout.trim().split(/\r?\n/).filter(Boolean)
  const jsonLine = [...lines].reverse().find((line) => line.trim().startsWith('{'))
  if (!jsonLine) {
    return {
      fetch_status: 'browser-harness-error',
      error: `browser-harness returned no JSON. exit=${result.code} stderr=${result.stderr.slice(0, 500)}`,
      final_url: sourceUrl,
      title: '',
      description: '',
      image_url: '',
      visible_text: '',
    }
  }
  const parsed = JSON.parse(jsonLine)
  if (result.code !== 0 && parsed.fetch_status !== 'browser-harness-error') {
    throw new Error(`browser-harness failed. exit=${result.code} stderr=${result.stderr.slice(0, 500)}`)
  }
  return parsed
}

// HTML keeps its smaller byte ceiling; images use fetchVettedImage separately.
async function fetchSourcePage(sourceUrl, { timeoutMs = 8000, maxBytes = 1_000_001 } = {}) {
  timeoutMs = Math.min(8000, Math.max(1, timeoutMs))
  maxBytes = Math.min(1_000_001, Math.max(1, maxBytes))
  const controller = new AbortController()
  let finalUrl = sourceUrl
  let timer
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error(`Source page fetch timed out after ${timeoutMs}ms`)
      controller.abort(error)
      reject(error)
    }, timeoutMs)
  })
  const follow = async () => {
    const visited = new Set()
    let remainingBytes = maxBytes
    for (let redirects = 0; ; redirects += 1) {
      controller.signal.throwIfAborted()
      const url = new URL(finalUrl)
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
        throw new Error('Unsafe source page URL')
      }
      url.hash = '' // Fragments do not change the resource fetched.
      finalUrl = url.href
      if (visited.has(finalUrl)) throw new Error('Source page redirect loop')
      visited.add(finalUrl)
      const response = await fetchVettedRemoteUrl(finalUrl, {
        lookup: dns.lookup,
        headers: {
          accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
        timeoutMs,
        maxBytes: remainingBytes,
        signal: controller.signal,
      })
      if (!response) throw new Error('blocked HTML URL')
      // Count raw bytes, including redirect bodies, rather than decoded characters.
      const body = response.arrayBuffer
        ? Buffer.from(await response.arrayBuffer())
        : Buffer.from(await response.text())
      remainingBytes -= body.length
      if (remainingBytes < 0) throw new Error(`Response exceeded ${maxBytes} total bytes`)
      if (![301, 302, 303, 307, 308].includes(response.status)) {
        return { response, html: body.toString('utf8'), finalUrl }
      }
      if (redirects >= 3) throw new Error('Source page redirect limit exceeded')
      const location = response.headers.get('location')
      if (typeof location !== 'string' || !location.trim()
        || /[\u0000-\u0020\u007f\\\\]/.test(location) || /%(?![0-9a-f]{2})/i.test(location)) {
        throw new Error('Missing or malformed redirect Location')
      }
      finalUrl = new URL(location, finalUrl).href
    }
  }
  try {
    return await Promise.race([follow(), deadline])
  } catch (error) {
    error.final_url = finalUrl
    throw error
  } finally {
    clearTimeout(timer)
  }
}

export async function inspectWithFetch(candidate, fetchable, classification, pageOptions = {}) {
  const videoId = youtubeId(candidate?.url) || youtubeId(fetchable)
  try {
    const { response, html, finalUrl } = await fetchSourcePage(fetchable, pageOptions)
    const bandcampEmbedHtml = isBandcampStreamingSourceUrl(finalUrl) ? extractBandcampEmbedHtml(html) : null
    const title = extractMeta(html, [
      /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["'][^>]*>/i,
      /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["'][^>]*>/i,
      /<title[^>]*>([^<]+)<\/title>/i,
    ]) || candidate.note_title
    const description = extractMeta(html, [
      /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["'][^>]*>/i,
      /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["'][^>]*>/i,
      /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:description["'][^>]*>/i,
    ]) || ''
    const image = extractMeta(html, [
      /<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]+content=["']([^"']+)["'][^>]*>/i,
      /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image(?::secure_url)?["'][^>]*>/i,
      /<meta[^>]+name=["']twitter:image(?::src)?["'][^>]+content=["']([^"']+)["'][^>]*>/i,
    ])

    return {
      ...candidate,
      ...classification,
      source_url: candidate.url,
      final_url: finalUrl,
      title,
      description,
      image_url: absoluteUrl(image, finalUrl) || (videoId ? `https://img.youtube.com/vi/${videoId}/hqdefault.jpg` : null),
      source_embed_html: bandcampEmbedHtml || undefined,
      fetch_status: response.ok ? 'fetch-ok' : `fetch-http-${response.status}`,
    }
  } catch (error) {
    if (videoId) {
      return {
        ...candidate,
        ...classification,
        source_url: candidate.url,
        final_url: error.final_url || fetchable,
        title: candidate.note_title,
        description: '',
        image_url: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
        fetch_status: `fetch-error-youtube-thumbnail-fallback: ${error.message}`,
      }
    }
    return {
      ...candidate,
      ...classification,
      source_url: candidate.url,
      final_url: error.final_url || fetchable,
      title: candidate.note_title,
      description: '',
      image_url: null,
      fetch_status: `fetch-error: ${error.message}`,
    }
  }
}

async function inspectCandidateSourceInner(candidate, { sourceTool, browserHarness }) {
  if (!isAllowedSourceUrl(candidate.url)) return null
  const classification = classifySource(candidate.url)
  const videoId = youtubeId(candidate.url)
  const embedStatus = videoId ? await youtubeEmbedStatus(candidate.url) : null

  if (isTweetStatusUrl(candidate.url)) {
    const tweetSource = await inspectTweetWithFxtwitter(candidate, classification)
    if (tweetSource?.image_url) return tweetSource
    if (tweetSource) return tweetSource
    return tweetProviderFallback(candidate, classification)
  }

  const fetchable = await resolveFetchableHtmlUrl(candidate.url, { lookup: dns.lookup })
  if (!fetchable) return null
  const bandcampEmbedHtml = isBandcampStreamingSourceUrl(fetchable) ? await fetchBandcampEmbedHtml(fetchable) : null

  if (sourceTool === 'browser-harness') {
    const browserData = await inspectWithBrowserHarness(fetchable, browserHarness)
    const browserFinalUrl = browserData.final_url || fetchable
    const browserFinalFetchable = browserData.fetch_status !== 'browser-harness'
      ? null
      : await resolveFetchableHtmlUrl(browserFinalUrl, { lookup: dns.lookup })
    if (browserData.fetch_status !== 'browser-harness' || !browserFinalFetchable) {
      const fallbackData = await inspectWithFetch(candidate, fetchable, classification)
      if (fallbackData.fetch_status === 'fetch-ok') {
        return normalizeInspectedSourceMedia({
          ...fallbackData,
          source_url: candidate.url,
          final_url: fallbackData.final_url || fetchable,
          image_url: fallbackData.image_url || (videoId ? `https://img.youtube.com/vi/${videoId}/hqdefault.jpg` : null),
          source_embed_html: fallbackData.source_embed_html || bandcampEmbedHtml || undefined,
          fetch_status: browserData.fetch_status === 'browser-harness-error'
            ? 'browser-harness-error-fetch-ok'
            : browserData.fetch_status === 'browser-harness-disabled'
              ? 'browser-harness-disabled-fetch-ok'
              : 'browser-harness-blocked-final-url-fetch-ok',
          youtube_embed_status: embedStatus,
          browser_error: browserData.error || (!browserFinalFetchable ? `blocked browser final URL: ${browserFinalUrl}` : undefined),
        })
      }
      if (!browserFinalFetchable) return null
    }
    return normalizeInspectedSourceMedia({
      ...candidate,
      ...classification,
      source_url: candidate.url,
      final_url: browserData.final_url || fetchable,
      title: browserData.title || browserData.h1 || candidate.note_title,
      description: browserData.description || browserData.visible_text || '',
      image_url: absoluteUrl(browserData.image_url, browserData.final_url || fetchable) || (videoId ? `https://img.youtube.com/vi/${videoId}/hqdefault.jpg` : null),
      source_embed_html: bandcampEmbedHtml || undefined,
      fetch_status: browserData.fetch_status,
      youtube_embed_status: embedStatus,
      browser_error: browserData.error || undefined,
    })
  }

  return normalizeInspectedSourceMedia({
    ...await inspectWithFetch(candidate, fetchable, classification),
    youtube_embed_status: embedStatus,
  })
}

export async function inspectCandidateSource(candidate, { sourceTool, browserHarness, timeoutMs = 35_000 } = {}) {
  try {
    const source = await withTimeout(
      inspectCandidateSourceInner(candidate, { sourceTool, browserHarness }),
      timeoutMs,
      `Source inspection timed out after ${timeoutMs}ms: ${candidate?.url || 'unknown source'}`,
    )
    // Metadata enrichment is additive evidence, not permission to erase the
    // candidate's original editorial role, workflow pitch, or parent identity.
    return source ? { ...source, creator_attribution: youtubeCreatorAttribution(candidate.url), editorial_evidence: [...(source.editorial_evidence || []), candidate] } : null
  } catch (error) {
    return {
      ...candidate,
      ...classifySource(candidate?.url || ''),
      // The failure path must not promote a caller's attribution claim either.
      creator_attribution: youtubeCreatorAttribution(candidate?.url),
      source_url: candidate?.url || null,
      final_url: candidate?.url || null,
      title: candidate?.note_title || candidate?.url || 'Timed out source',
      description: '',
      image_url: null,
      fetch_status: `source-inspection-timeout: ${error.message}`,
      browser_error: error.message,
    }
  }
}

export async function findVisualReference(signalHarvest, inspected, { sourceTool, browserHarness, recentSourceKeys = new Set() }) {
  const primaryBest = selectBestVisualReference(inspected, recentSourceKeys)
  if (primaryBest && primaryBest.score >= 12 && !isLowValueVisualImage(primaryBest.source.image_url)) {
    return {
      ...primaryBest.source,
      visual_reference_score: primaryBest.score,
      selection_reason: 'Best image-bearing source from the primary inspected source set.',
    }
  }

  const alreadyInspectedUrls = new Set(inspected.map((source) => source.url))
  const candidates = signalHarvest.source_candidates
    .filter((candidate) => !alreadyInspectedUrls.has(candidate.url))
    .map((candidate) => ({ candidate, score: scoreVisualCandidate(candidate) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, 8)

  const additionalSources = []
  for (const { candidate } of candidates) {
    const source = await inspectCandidateSource(candidate, { sourceTool, browserHarness })
    if (!source) continue
    additionalSources.push(source)
    const best = selectBestVisualReference([source], recentSourceKeys)
    if (best && best.score >= 12 && !isLowValueVisualImage(best.source.image_url)) {
      return {
        ...best.source,
        visual_reference_score: best.score,
        selection_reason: 'Selected from additional visually promising source candidates because the primary inspected set was too technical.',
      }
    }
  }

  const fallbackBest = selectBestVisualReference([...inspected, ...additionalSources], recentSourceKeys)
  if (!fallbackBest) return null
  return {
    ...fallbackBest.source,
    visual_reference_score: fallbackBest.score,
    selection_reason: 'Fallback best available image-bearing source; no stronger artistic raster source was found.',
  }
}
