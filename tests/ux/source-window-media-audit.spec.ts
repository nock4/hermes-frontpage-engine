import fs from 'node:fs'
import path from 'node:path'

import { expect, test, type Locator, type Page } from '@playwright/test'

type ManifestItem = {
  edition_id: string
  slug: string
  title: string
  path: string
}

type ArtifactRecord = {
  id: string
  label: string
}

type SourceBindingRecord = {
  id: string
  artifact_id: string
  source_type?: string
  source_url?: string
  window_type?: string
  title?: string
  source_title?: string
  source_image_url?: string
  source_media_url?: string
  source_media_type?: string
  embed_status?: string
}

type WindowImageMetric = {
  src: string | null
  complete: boolean
  naturalWidth: number
  naturalHeight: number
  width: number
  height: number
  objectFit: string
  areaRatio: number
  aspectDelta: number | null
  viewportClipped: boolean
}

type WindowFrameMetric = {
  src: string | null
  title: string | null
  bodyText: string | null
  width: number
  height: number
  areaRatio: number
  viewportClipped: boolean
}

type WindowMetric = {
  exists: boolean
  mode: 'hover' | 'primary'
  kind: string | null
  width: number
  height: number
  viewportClipped: boolean
  images: WindowImageMetric[]
  frames: WindowFrameMetric[]
}

type MediaAuditRecord = {
  edition_id: string
  slug: string
  route: string
  artifact_id: string
  artifact_label: string
  binding_id: string
  title: string
  source_url: string
  source_type: string
  window_type: string
  source_image_url: string
  source_media_url: string
  screenshots: Record<string, string>
  hover: WindowMetric
  primary?: WindowMetric
  failures: string[]
}

const root = process.cwd()
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'public/editions/index.json'), 'utf8')) as { editions: ManifestItem[] }

const defaultEditionSlugs = [
  manifest.editions[0]?.slug,
  'forest-breath-cabinet-v2',
  'roller-cipher-chapel-v1',
  'tape-commons-transfer-desk-v9',
  'forest-listening-table-v1',
  'signal-greenhouse-bench-v1',
].filter(Boolean) as string[]

const editionSlugs = (process.env.DFE_MEDIA_AUDIT_EDITIONS?.split(',').map((entry) => entry.trim()).filter(Boolean) ?? defaultEditionSlugs)
const reportStamp = new Date().toISOString().replace(/[:.]/g, '-')
const reportRoot = process.env.DFE_MEDIA_AUDIT_DIR
  ? path.resolve(root, process.env.DFE_MEDIA_AUDIT_DIR)
  : path.join(root, 'tmp/source-window-media-audit', reportStamp)
const requireYouTubeEmbeds = process.env.DFE_MEDIA_AUDIT_REQUIRE_YOUTUBE_EMBEDS === '1'

function readEditionJson<T>(edition: ManifestItem, fileName: string): T {
  return JSON.parse(fs.readFileSync(path.join(root, 'public', edition.path.replace(/^\//, ''), fileName), 'utf8')) as T
}

function sanitizePathPart(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'item'
}

function isKnownBadImageUrl(value: string | undefined) {
  if (!value) return false
  const lower = value.toLowerCase()
  return lower.includes('abs.twimg.com')
    || lower.includes('profile_images')
    || lower.includes('profile_pic')
    || lower.includes('profile-picture')
    || lower.includes('/profile/')
    || lower.includes('s100x100')
    || lower.includes('favicon')
    || lower.includes('apple-touch-icon')
    || lower.includes('site-icon')
    || lower.includes('wordmark')
    || lower.includes('/logo')
    || /(?:^|[/_\-.])icon(?:[/_\-.]|$)/.test(lower)
    || /\.ico(?:$|[?#])/.test(lower)
    || /\.svg(?:$|[?#])/.test(lower)
}

function isDirectImageUrl(value: string | undefined) {
  if (!value) return false
  const lower = value.toLowerCase()
  return lower.includes('pbs.twimg.com/media/')
    || lower.includes('pbs.twimg.com/amplify_video_thumb/')
    || lower.includes('pbs.twimg.com/ext_tw_video_thumb/')
    || /\.(png|jpe?g|webp|avif)(?:$|[?#])/.test(lower)
}

function isYouTubeUrl(value: string | undefined) {
  if (!value) return false
  try {
    const host = new URL(value).hostname.replace(/^www\./, '')
    return host === 'youtube.com' || host === 'youtu.be' || host === 'music.youtube.com' || host === 'm.youtube.com' || host === 'youtube-nocookie.com'
  } catch {
    return false
  }
}

function isYouTubeVideoUrl(value: string | undefined) {
  if (!value) return false
  try {
    const url = new URL(value)
    const host = url.hostname.replace(/^www\./, '')
    const parts = url.pathname.split('/').filter(Boolean)
    if (host === 'youtu.be') return Boolean(parts[0])
    return isYouTubeUrl(value) && (url.pathname === '/watch' ? Boolean(url.searchParams.get('v')) : ['embed', 'shorts', 'live', 'v'].includes(parts[0] ?? '') && Boolean(parts[1]))
  } catch {
    return false
  }
}

function shouldOpenPrimaryWindow(binding: SourceBindingRecord) {
  return isYouTubeVideoUrl(binding.source_url)
    || binding.source_type === 'youtube'
    || binding.window_type === 'video'
    || binding.source_type === 'tweet'
    || binding.source_type === 'social'
    || binding.window_type === 'social'
    || binding.source_type === 'audio'
    || binding.window_type === 'audio'
}

function isMediaCapable(binding: Partial<SourceBindingRecord>) {
  return Boolean(binding.source_media_url)
    || Boolean(binding.source_image_url)
    || isDirectImageUrl(binding.source_url)
    || isYouTubeVideoUrl(binding.source_url)
    || binding.window_type === 'video'
    || binding.source_type === 'youtube'
}

async function gotoEdition(page: Page, route: string) {
  await page.goto(route, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('img.plate', { timeout: 20_000 })
  await page.waitForSelector('button.artifact', { timeout: 20_000 })
}

async function triggerArtifactPreview(page: Page, artifactButton: Locator, artifactIndex: number, windowSelector: string) {
  await artifactButton.hover({ force: true })
  await artifactButton.focus()
  await page.waitForTimeout(400)

  if (await page.locator(windowSelector).count()) return

  await page.evaluate((index) => {
    const button = document.querySelectorAll('button.artifact')[index]
    button?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, cancelable: true }))
    button?.dispatchEvent(new FocusEvent('focus', { bubbles: true, cancelable: true }))
  }, artifactIndex)
  await page.waitForTimeout(350)
}

async function triggerArtifactPrimary(page: Page, artifactButton: Locator, artifactIndex: number) {
  await artifactButton.click({ force: true })
  await page.waitForTimeout(300)
  await page.evaluate((index) => {
    const button = document.querySelectorAll('button.artifact')[index]
    button?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }))
    button?.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 0 }))
    button?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }))
  }, artifactIndex)
}

function isBlockedYouTubeFrameText(value: string | null | undefined) {
  const normalized = String(value || '').replace(/\s+/g, ' ').trim().toLowerCase()
  return normalized.includes('video unavailable')
    || normalized.includes('watch on youtube')
    || normalized.includes('only available on youtube')
    || normalized.includes('playback on other websites has been disabled')
}

async function collectWindowMetric(page: Page, locator: Locator, mode: 'hover' | 'primary'): Promise<WindowMetric> {
  if (await locator.count() === 0) {
    return {
      exists: false,
      mode,
      kind: null,
      width: 0,
      height: 0,
      viewportClipped: true,
      images: [],
      frames: [],
    }
  }

  const metric = await locator.first().evaluate((node, metricMode) => {
    const windowRect = node.getBoundingClientRect()
    const windowArea = Math.max(1, windowRect.width * windowRect.height)
    const viewportClipped = windowRect.left < -1
      || windowRect.top < -1
      || windowRect.right > window.innerWidth + 1
      || windowRect.bottom > window.innerHeight + 1

    const imageMetrics = Array.from(node.querySelectorAll('img')).map((image) => {
      const element = image as HTMLImageElement
      const rect = element.getBoundingClientRect()
      const style = window.getComputedStyle(element)
      const renderedAspect = rect.width > 0 && rect.height > 0 ? rect.width / rect.height : null
      const naturalAspect = element.naturalWidth > 0 && element.naturalHeight > 0 ? element.naturalWidth / element.naturalHeight : null
      return {
        src: element.currentSrc || element.src || null,
        complete: element.complete,
        naturalWidth: element.naturalWidth,
        naturalHeight: element.naturalHeight,
        width: rect.width,
        height: rect.height,
        objectFit: style.objectFit,
        areaRatio: (rect.width * rect.height) / windowArea,
        aspectDelta: renderedAspect && naturalAspect ? Math.abs(Math.log(renderedAspect / naturalAspect)) : null,
        viewportClipped: rect.left < -1 || rect.top < -1 || rect.right > window.innerWidth + 1 || rect.bottom > window.innerHeight + 1,
      }
    })

    const frameMetrics: WindowFrameMetric[] = Array.from(node.querySelectorAll('iframe, video')).map((media) => {
      const element = media as HTMLIFrameElement | HTMLVideoElement
      const rect = element.getBoundingClientRect()
      const src = element instanceof HTMLVideoElement ? (element.currentSrc || element.src) : element.src
      return {
        src: src || null,
        title: element instanceof HTMLIFrameElement ? (element.title || null) : null,
        bodyText: null,
        width: rect.width,
        height: rect.height,
        areaRatio: (rect.width * rect.height) / windowArea,
        viewportClipped: rect.left < -1 || rect.top < -1 || rect.right > window.innerWidth + 1 || rect.bottom > window.innerHeight + 1,
      }
    })

    return {
      exists: true,
      mode: metricMode,
      kind: node.getAttribute('data-source-window-kind'),
      width: windowRect.width,
      height: windowRect.height,
      viewportClipped,
      images: imageMetrics,
      frames: frameMetrics,
    }
  }, mode)

  metric.frames = await Promise.all(metric.frames.map(async (frameMetric) => {
    if (!frameMetric.src || !isYouTubeUrl(frameMetric.src)) return frameMetric
    const browserFrame = page.frames().find((frame) => frame.url() === frameMetric.src)
      || page.frames().find((frame) => frame.url().split('?')[0] === frameMetric.src?.split('?')[0])
    if (!browserFrame) return frameMetric
    return {
      ...frameMetric,
      title: await browserFrame.title().catch(() => frameMetric.title),
      bodyText: await browserFrame.locator('body').innerText({ timeout: 2_000 }).catch(() => null),
    }
  }))

  return metric
}

function analyzeWindow(binding: SourceBindingRecord, metric: WindowMetric) {
  const failures: string[] = []
  const mediaCapable = isMediaCapable(binding)
  const youtubeBinding = binding.source_type === 'youtube' || binding.window_type === 'video' || isYouTubeVideoUrl(binding.source_url)
  const minMediaRatio = metric.mode === 'hover' ? 0.035 : 0.08
  const visibleImages = metric.images.filter((image) => image.width >= 48 && image.height >= 48)
  const visibleFrames = metric.frames.filter((frame) => frame.width >= 160 && frame.height >= 90)

  if (!metric.exists) {
    failures.push(`${metric.mode}: source window did not render`)
    return failures
  }

  if (metric.viewportClipped) failures.push(`${metric.mode}: source window is clipped by the viewport`)

  if (requireYouTubeEmbeds && youtubeBinding && metric.kind === 'youtube-linkout') {
    failures.push(`${metric.mode}: YouTube URL is not embeddable and fell back to linkout`)
  }

  if (requireYouTubeEmbeds && youtubeBinding && metric.mode === 'primary' && metric.kind !== 'youtube-embed') {
    failures.push(`${metric.mode}: YouTube source did not render as a native iframe embed`)
  }

  if (binding.source_image_url && isKnownBadImageUrl(binding.source_image_url)) {
    failures.push(`${metric.mode}: binding uses low-value source_image_url ${binding.source_image_url}`)
  }

  if (mediaCapable && visibleImages.length === 0 && visibleFrames.length === 0) {
    failures.push(`${metric.mode}: media-capable binding rendered title-only/no visible media`)
  }

  for (const image of visibleImages) {
    if (isKnownBadImageUrl(image.src ?? undefined)) failures.push(`${metric.mode}: rendered low-value image ${image.src}`)
    if (!image.complete || image.naturalWidth < 24 || image.naturalHeight < 24) failures.push(`${metric.mode}: image failed to load ${image.src}`)
    if (image.viewportClipped) failures.push(`${metric.mode}: image is clipped by the viewport ${image.src}`)
    if (image.areaRatio < minMediaRatio) failures.push(`${metric.mode}: image is too small in the source window ${image.src}`)
    if (image.objectFit === 'cover' && image.aspectDelta !== null && image.aspectDelta > 0.34) {
      failures.push(`${metric.mode}: image has high crop risk with object-fit: cover ${image.src}`)
    }
  }

  for (const frame of visibleFrames) {
    if (frame.viewportClipped) failures.push(`${metric.mode}: iframe is clipped by the viewport ${frame.src}`)
    if (frame.areaRatio < minMediaRatio) failures.push(`${metric.mode}: iframe is too small in the source window ${frame.src}`)
    if (youtubeBinding && isBlockedYouTubeFrameText(frame.bodyText)) {
      failures.push(`${metric.mode}: YouTube iframe reports unavailable/linkout-only playback: ${frame.bodyText}`)
    }
  }

  return failures
}

async function screenshotWindow(locator: Locator, outputPath: string) {
  if (await locator.count() === 0) return null
  await fs.promises.mkdir(path.dirname(outputPath), { recursive: true })
  await locator.first().screenshot({ path: outputPath })
  return path.relative(root, outputPath)
}

async function waitForWindowMedia(page: Page, selector: string) {
  await page.waitForFunction((windowSelector) => {
    const node = document.querySelector(windowSelector)
    if (!node) return false

    const images = Array.from(node.querySelectorAll('img')) as HTMLImageElement[]
    if (!images.length) return true

    return images.every((image) => {
      const rect = image.getBoundingClientRect()
      if (rect.width < 24 || rect.height < 24) return true
      return image.complete && image.naturalWidth > 0 && image.naturalHeight > 0
    })
  }, selector, { timeout: 3_500 }).catch(() => undefined)
}

test('real source-window media audit across packaged editions', async ({ page }) => {
  test.setTimeout(240_000)
  fs.mkdirSync(reportRoot, { recursive: true })

  const records: MediaAuditRecord[] = []
  const failures: string[] = []

  page.on('popup', async (popup) => {
    await popup.close().catch(() => undefined)
  })

  for (const slug of editionSlugs) {
    const edition = manifest.editions.find((item) => item.slug === slug || item.edition_id === slug)
    if (!edition) continue

    const route = `/archive/${edition.slug}`
    const artifactMap = readEditionJson<{ artifacts: ArtifactRecord[] }>(edition, 'artifact-map.json')
    const sourceBindings = readEditionJson<{ bindings: SourceBindingRecord[] }>(edition, 'source-bindings.json')

    for (const binding of sourceBindings.bindings) {
      const artifactIndex = artifactMap.artifacts.findIndex((artifact) => artifact.id === binding.artifact_id)
      if (artifactIndex < 0) continue
      const artifact = artifactMap.artifacts[artifactIndex]
      const artifactButton = page.locator('button.artifact').nth(artifactIndex)
      const windowSelector = `.stage-overlay-windows--live .source-window[data-binding-id="${binding.id}"]`
      const editionDir = path.join(reportRoot, sanitizePathPart(edition.slug))
      const artifactSlug = sanitizePathPart(`${artifact.id}-${binding.id}`)

      await gotoEdition(page, route)
      await triggerArtifactPreview(page, artifactButton, artifactIndex, `${windowSelector}[data-source-window-mode="preview"]`)

      const hoverWindow = page.locator(`${windowSelector}[data-source-window-mode="preview"]`)
      await waitForWindowMedia(page, `${windowSelector}[data-source-window-mode="preview"]`)
      const hover = await collectWindowMetric(page, hoverWindow, 'hover')
      const screenshots: Record<string, string> = {}
      const hoverShot = await screenshotWindow(hoverWindow, path.join(editionDir, `${artifactSlug}-hover.png`))
      if (hoverShot) screenshots.hover = hoverShot

      let primary: WindowMetric | undefined
      const shouldTryPrimary = shouldOpenPrimaryWindow(binding)
      if (shouldTryPrimary) {
        await triggerArtifactPrimary(page, artifactButton, artifactIndex)
        await page.waitForTimeout(800)
        const primaryWindow = page.locator(`${windowSelector}[data-source-window-mode="primary"]`)
        await waitForWindowMedia(page, `${windowSelector}[data-source-window-mode="primary"]`)
        primary = await collectWindowMetric(page, primaryWindow, 'primary')
        const primaryShot = await screenshotWindow(primaryWindow, path.join(editionDir, `${artifactSlug}-primary.png`))
        if (primaryShot) screenshots.primary = primaryShot
      }

      const recordFailures = [
        ...analyzeWindow(binding, hover),
        ...(primary ? analyzeWindow(binding, primary) : []),
      ]

      for (const failure of recordFailures) {
        failures.push(`${edition.slug} / ${artifact.label} / ${binding.title ?? binding.id}: ${failure}`)
      }

      records.push({
        edition_id: edition.edition_id,
        slug: edition.slug,
        route,
        artifact_id: artifact.id,
        artifact_label: artifact.label,
        binding_id: binding.id,
        title: binding.title ?? '',
        source_url: binding.source_url ?? '',
        source_type: binding.source_type ?? '',
        window_type: binding.window_type ?? '',
        source_image_url: binding.source_image_url ?? '',
        source_media_url: binding.source_media_url ?? '',
        screenshots,
        hover,
        primary,
        failures: recordFailures,
      })
    }
  }

  const summary = {
    generated_at: new Date().toISOString(),
    editions: editionSlugs,
    report_root: path.relative(root, reportRoot),
    records: records.length,
    failures,
    media_capable_records: records.filter((record) => isMediaCapable(record)).length,
  }

  fs.writeFileSync(path.join(reportRoot, 'report.json'), `${JSON.stringify({ summary, records }, null, 2)}\n`)

  expect(failures).toEqual([])
})
