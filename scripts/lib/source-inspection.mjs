import { spawn } from 'node:child_process'
import dns from 'node:dns/promises'
import http from 'node:http'
import path from 'node:path'

import { fetchWithTimeout } from './fetch-with-timeout.mjs'
import { resolveFetchableHtmlUrl, resolveFetchableImageUrl } from './source-image-network-policy.mjs'
import {
  classifySource,
  isAllowedInspectedSource,
  isLowValueVisualImage,
  scoreVisualCandidate,
  selectBestVisualReference,
} from './source-selection-policy.mjs'
import {
  isAllowedSourceUrl,
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

const youtubeEmbedStatusCache = new Map()

export function classifyYouTubeEmbedFrameText(text) {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim().toLowerCase()
  if (!normalized) return null
  if (
    normalized.includes('video unavailable')
    || normalized.includes('playback on other websites has been disabled')
    || normalized.includes('only available on youtube')
    || normalized.includes('watch video on youtube')
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
    browser = await chromium.launch()
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
    await page.waitForTimeout(4200)
    const frame = page.frames().find((candidate) => candidate.url().includes(`/embed/${videoId}`))
    const bodyText = frame
      ? await frame.locator('body').innerText({ timeout: 1200 }).catch(() => '')
      : ''
    return classifyYouTubeEmbedFrameText(bodyText)
  } catch {
    return null
  } finally {
    if (browser) await browser.close().catch(() => {})
    if (temporaryOrigin) await temporaryOrigin.close().catch(() => {})
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
  } catch {
    youtubeEmbedStatusCache.set(cacheKey, 'unavailable')
    return 'unavailable'
  }

  const status = verifyPlayback ? await browserVerifiedYouTubeEmbedStatus(videoId) : null
  youtubeEmbedStatusCache.set(cacheKey, status)
  return status
}

const visualImageHealthCache = new Map()

async function isLoadableVisualImage(imageUrl) {
  if (!imageUrl || isLowValueVisualImage(imageUrl)) return false
  if (visualImageHealthCache.has(imageUrl)) return visualImageHealthCache.get(imageUrl)

  const fetchableImageUrl = await resolveFetchableImageUrl(imageUrl, { lookup: dns.lookup })
  if (!fetchableImageUrl) {
    visualImageHealthCache.set(imageUrl, false)
    return false
  }

  try {
    const response = await fetchWithTimeout(fetchableImageUrl, {
      headers: {
        accept: 'image/avif,image/webp,image/png,image/jpeg,image/*,*/*;q=0.5',
        range: 'bytes=0-4095',
        'user-agent': 'daily-frontpage-engine-source-research/0.1',
      },
      redirect: 'error',
    }, 8000)
    const contentType = response.headers.get('content-type')?.toLowerCase() || ''
    const loadable = response.ok && (!contentType || (contentType.startsWith('image/') && !contentType.includes('svg')))
    visualImageHealthCache.set(imageUrl, loadable)
    return loadable
  } catch {
    visualImageHealthCache.set(imageUrl, false)
    return false
  }
}

async function normalizeInspectedSourceMedia(source) {
  if (!source) return null
  if (!isAllowedInspectedSource(source)) return null

  const imageUrl = absoluteUrl(source.image_url, source.final_url || source.source_url || source.url)
  if (imageUrl && await isLoadableVisualImage(imageUrl)) {
    return { ...source, image_url: imageUrl }
  }

  return { ...source, image_url: null }
}

function runCaptured(command, args, { input = '', cwd = process.cwd(), timeoutMs = 30_000, env = process.env } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      reject(new Error(`${command} timed out after ${timeoutMs}ms`))
    }, timeoutMs)
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString()
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })
    child.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code, stdout, stderr })
    })
    if (input) child.stdin.write(input)
    child.stdin.end()
  })
}

async function inspectWithBrowserHarness(sourceUrl, browserHarnessPath) {
  const script = `
import json

url = ${JSON.stringify(sourceUrl)}
try:
    ensure_real_tab()
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

export async function inspectWithFetch(candidate, fetchable, classification) {
  try {
    const response = await fetchWithTimeout(fetchable, {
      headers: {
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'user-agent': 'daily-frontpage-engine-source-research/0.1',
      },
    }, 8000)
    const html = await response.text()
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
      final_url: fetchable,
      title,
      description,
      image_url: absoluteUrl(image, fetchable),
      fetch_status: response.ok ? 'fetch-ok' : `fetch-http-${response.status}`,
    }
  } catch (error) {
    return {
      ...candidate,
      ...classification,
      source_url: candidate.url,
      final_url: fetchable,
      title: candidate.note_title,
      description: '',
      image_url: null,
      fetch_status: `fetch-error: ${error.message}`,
    }
  }
}

export async function inspectCandidateSource(candidate, { sourceTool, browserHarness }) {
  if (!isAllowedSourceUrl(candidate.url)) return null
  const classification = classifySource(candidate.url)
  const videoId = youtubeId(candidate.url)
  const embedStatus = videoId ? await youtubeEmbedStatus(candidate.url) : null
  if (embedStatus === 'unavailable') return null
  const fetchable = await resolveFetchableHtmlUrl(candidate.url, { lookup: dns.lookup })
  if (!fetchable) return null

  if (sourceTool === 'browser-harness') {
    const browserData = await inspectWithBrowserHarness(fetchable, browserHarness)
    if (browserData.fetch_status === 'browser-harness-error') {
      const fallbackData = await inspectWithFetch(candidate, fetchable, classification)
      if (fallbackData.fetch_status === 'fetch-ok') {
        return normalizeInspectedSourceMedia({
          ...fallbackData,
          source_url: candidate.url,
          final_url: fallbackData.final_url || fetchable,
          image_url: fallbackData.image_url || (videoId ? `https://img.youtube.com/vi/${videoId}/hqdefault.jpg` : null),
          fetch_status: 'browser-harness-error-fetch-ok',
          youtube_embed_status: embedStatus,
          browser_error: browserData.error || undefined,
        })
      }
    }
    return normalizeInspectedSourceMedia({
      ...candidate,
      ...classification,
      source_url: candidate.url,
      final_url: browserData.final_url || fetchable,
      title: browserData.title || browserData.h1 || candidate.note_title,
      description: browserData.description || browserData.visible_text || '',
      image_url: absoluteUrl(browserData.image_url, browserData.final_url || fetchable) || (videoId ? `https://img.youtube.com/vi/${videoId}/hqdefault.jpg` : null),
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
