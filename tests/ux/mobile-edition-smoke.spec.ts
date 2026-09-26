import fs from 'node:fs'
import path from 'node:path'

import { expect, test, type Page } from '@playwright/test'

type ManifestItem = {
  edition_id: string
  slug: string
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
  source_media_type?: string
  source_media_url?: string
  source_image_url?: string
}

type MobileWindowMetric = {
  bindingId: string
  artifactLabel: string
  mode: string | null
  exists: boolean
  clipped: boolean
  width: number
  height: number
  hasVisibleMedia: boolean
  hasReadableText: boolean
  hasReachableClose: boolean
  hasVisibleClose: boolean
  closeOverRawCard: boolean
  captionVisible: boolean
  captionOverMedia: boolean
  titleVisible: boolean
  mediaAreaRatio: number
  sourceVisualMode: string | null
  sourceVisualImageUrl: string | null
  hasAmbientFill: boolean
}

const root = process.cwd()
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'public/editions/index.json'), 'utf8')) as {
  current_edition_id: string
  editions: ManifestItem[]
}
const currentEdition = manifest.editions.find((edition) => edition.edition_id === manifest.current_edition_id) ?? manifest.editions[0]
const reportStamp = new Date().toISOString().replace(/[:.]/g, '-')
const reportRoot = process.env.DFE_MOBILE_QA_DIR
  ? path.resolve(root, process.env.DFE_MOBILE_QA_DIR)
  : path.join(root, 'tmp/mobile-qa', reportStamp)

const mobileViewports = [
  { name: 'iphone-se', width: 375, height: 667 },
  { name: 'iphone-modern', width: 393, height: 852 },
  { name: 'android-small', width: 360, height: 740 },
  { name: 'mobile-landscape', width: 852, height: 393 },
]

function readEditionJson<T>(edition: ManifestItem, fileName: string): T {
  return JSON.parse(fs.readFileSync(path.join(root, 'public', edition.path.replace(/^\//, ''), fileName), 'utf8')) as T
}

function sanitizePathPart(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'item'
}

async function gotoLiveEdition(page: Page) {
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('img.plate', { timeout: 20_000 })
  await page.waitForSelector('button.artifact', { timeout: 20_000 })
}

async function collectStageState(page: Page) {
  return await page.evaluate(() => {
    const stage = document.querySelector('.stage')
    const plate = document.querySelector('img.plate') as HTMLImageElement | null
    const body = document.documentElement
    const stageRect = stage?.getBoundingClientRect()
    const plateRect = plate?.getBoundingClientRect()
    const debugChrome = Array.from(document.querySelectorAll('.artifact span, .window-dock:not(.window-dock--stage), .side-rail, .runtime-topbar')).filter((node) => {
      const element = node as HTMLElement
      const rect = element.getBoundingClientRect()
      const style = window.getComputedStyle(element)
      return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || '1') > 0.01 && rect.width > 0 && rect.height > 0
    }).length
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      documentWidth: body.scrollWidth,
      stage: stageRect ? {
        left: stageRect.left,
        top: stageRect.top,
        right: stageRect.right,
        bottom: stageRect.bottom,
        width: stageRect.width,
        height: stageRect.height,
      } : null,
      plate: plate ? {
        complete: plate.complete,
        naturalWidth: plate.naturalWidth,
        naturalHeight: plate.naturalHeight,
        rect: plateRect ? {
          left: plateRect.left,
          top: plateRect.top,
          right: plateRect.right,
          bottom: plateRect.bottom,
          width: plateRect.width,
          height: plateRect.height,
        } : null,
      } : null,
      debugChrome,
    }
  })
}

async function waitForSourceWindowSettle(page: Page, bindingId: string) {
  await page.waitForFunction(({ expectedBindingId }) => {
    const node = document.querySelector(`.stage-overlay-windows--live .source-window[data-binding-id="${expectedBindingId}"]`)
    if (!node) return false
    const animations = (node as HTMLElement).getAnimations({ subtree: true })
    return animations.every((animation) => animation.playState === 'finished' || animation.playState === 'idle')
  }, { expectedBindingId: bindingId }, { timeout: 1_800 }).catch(() => undefined)
}

async function collectWindowMetric(page: Page, bindingId: string, artifactLabel: string): Promise<MobileWindowMetric> {
  return await page.evaluate(({ expectedBindingId, expectedArtifactLabel }) => {
    const node = document.querySelector(`.stage-overlay-windows--live .source-window[data-binding-id="${expectedBindingId}"]`)
    if (!node) {
      return {
        bindingId: expectedBindingId,
        artifactLabel: expectedArtifactLabel,
        mode: null,
        exists: false,
        clipped: true,
        width: 0,
        height: 0,
        hasVisibleMedia: false,
        hasReadableText: false,
        hasReachableClose: false,
        hasVisibleClose: false,
        closeOverRawCard: false,
        captionVisible: false,
        captionOverMedia: false,
        titleVisible: false,
        mediaAreaRatio: 0,
        sourceVisualMode: null,
        sourceVisualImageUrl: null,
        hasAmbientFill: false,
      }
    }

    const rect = node.getBoundingClientRect()
    const clipped = rect.left < -1
      || rect.top < -1
      || rect.right > window.innerWidth + 1
      || rect.bottom > window.innerHeight + 1
    let largestMediaArea = 0
    const visibleMedia = Array.from(node.querySelectorAll('img, iframe, video')).some((element) => {
      const mediaRect = element.getBoundingClientRect()
      const visible = mediaRect.width >= 48 && mediaRect.height >= 48
      if (visible) largestMediaArea = Math.max(largestMediaArea, mediaRect.width * mediaRect.height)
      return visible
    })
    const close = node.querySelector('.source-window__close') as HTMLElement | null
    const closeRect = close?.getBoundingClientRect()
    const hasReachableClose = Boolean(closeRect
      && closeRect.width >= 32
      && closeRect.height >= 32
      && closeRect.left >= -1
      && closeRect.top >= -1
      && closeRect.right <= window.innerWidth + 1
      && closeRect.bottom <= window.innerHeight + 1)
    const closeStyle = close ? window.getComputedStyle(close) : null
    const closeCenterX = closeRect ? closeRect.left + closeRect.width / 2 : -1
    const closeCenterY = closeRect ? closeRect.top + closeRect.height / 2 : -1
    const closeHitTarget = closeRect ? document.elementFromPoint(closeCenterX, closeCenterY) : null
    const hasVisibleClose = Boolean(hasReachableClose
      && closeStyle
      && closeStyle.display !== 'none'
      && closeStyle.visibility === 'visible'
      && Number(closeStyle.opacity || '1') > 0.5
      && (close === closeHitTarget || close?.contains(closeHitTarget)))
    const rawCard = node.querySelector('.visual-source-card[data-source-visual-mode="raw"]')
    const visualCard = node.querySelector('.visual-source-card')
    const rawCardRect = rawCard?.getBoundingClientRect()
    const closeOverRawCard = !rawCard || Boolean(closeRect && rawCardRect
      && closeRect.left >= rawCardRect.left - 1
      && closeRect.right <= rawCardRect.right + 1
      && closeCenterX > rawCardRect.left + rawCardRect.width * 0.68
      && closeCenterY < rawCardRect.top + rawCardRect.height * 0.25)
    const caption = node.querySelector('.visual-source-card__caption') as HTMLElement | null
    const captionStyle = caption ? window.getComputedStyle(caption) : null
    const captionVisible = Boolean(captionStyle
      && captionStyle.display !== 'none'
      && captionStyle.visibility !== 'hidden'
      && Number(captionStyle.opacity || '1') > 0.01)
    const captionRect = caption?.getBoundingClientRect()
    const figureRect = visualCard?.querySelector('.visual-source-card__figure')?.getBoundingClientRect()
    const captionOverlapWidth = captionRect && figureRect
      ? Math.max(0, Math.min(captionRect.right, figureRect.right) - Math.max(captionRect.left, figureRect.left))
      : 0
    const captionOverlapHeight = captionRect && figureRect
      ? Math.max(0, Math.min(captionRect.bottom, figureRect.bottom) - Math.max(captionRect.top, figureRect.top))
      : 0
    const captionOverMedia = captionVisible && captionOverlapWidth * captionOverlapHeight > 12
    const isPreviewMode = node.getAttribute('data-source-window-mode') === 'preview'
    const title = (isPreviewMode
      ? node.querySelector('.visual-source-card__edge-title')
      : node.querySelector('.visual-source-card__title')) as HTMLElement | null
    const titleRect = title?.getBoundingClientRect()
    const titleStyle = title ? window.getComputedStyle(title) : null
    const titleVisible = Boolean(titleRect
      && titleStyle
      && titleStyle.display !== 'none'
      && titleStyle.visibility !== 'hidden'
      && Number(titleStyle.opacity || '1') > 0.01
      && Number.parseFloat(titleStyle.fontSize) >= 10
      && titleRect.width >= 64
      && titleRect.height >= 12
      && titleRect.left >= -1
      && titleRect.top >= -1
      && titleRect.right <= window.innerWidth + 1
      && titleRect.bottom <= window.innerHeight + 1)
    const text = (node.textContent || '').replace(/\s+/g, ' ').trim()
    const sourceVisualMode = visualCard?.getAttribute('data-source-visual-mode') || null
    const sourceVisualImageUrl = visualCard?.querySelector('img.visual-source-card__image')?.getAttribute('src') || null
    const figure = visualCard?.querySelector('.visual-source-card__figure')
    const ambientStyle = figure ? window.getComputedStyle(figure, '::before') : null
    const hasAmbientFill = Boolean(ambientStyle
      && ambientStyle.content !== 'none'
      && ambientStyle.backgroundImage !== 'none'
      && ambientStyle.backgroundImage.includes('url('))

    return {
      bindingId: expectedBindingId,
      artifactLabel: expectedArtifactLabel,
      mode: node.getAttribute('data-source-window-mode'),
      exists: true,
      clipped,
      width: rect.width,
      height: rect.height,
      hasVisibleMedia: visibleMedia,
      hasReadableText: text.length >= 12,
      hasReachableClose,
      hasVisibleClose,
      closeOverRawCard,
      captionVisible,
      captionOverMedia,
      titleVisible,
      mediaAreaRatio: rect.width > 0 && rect.height > 0 ? largestMediaArea / (rect.width * rect.height) : 0,
      sourceVisualMode,
      sourceVisualImageUrl,
      hasAmbientFill,
    }
  }, { expectedBindingId: bindingId, expectedArtifactLabel: artifactLabel })
}

for (const viewport of mobileViewports) {
  test(`current edition remains image-led and tappable on ${viewport.name}`, async ({ page }) => {
    test.setTimeout(120_000)
    fs.mkdirSync(reportRoot, { recursive: true })
    await page.setViewportSize({ width: viewport.width, height: viewport.height })

    const popups: string[] = []
    page.on('popup', async (popup) => {
      popups.push(popup.url())
      await popup.close().catch(() => undefined)
    })

    await gotoLiveEdition(page)
    await page.screenshot({ path: path.join(reportRoot, `${viewport.name}-live.png`), fullPage: false })

    const stageState = await collectStageState(page)
    expect(stageState.plate?.complete).toBe(true)
    expect(stageState.plate?.naturalWidth).toBeGreaterThan(0)
    expect(stageState.plate?.naturalHeight).toBeGreaterThan(0)
    expect(stageState.stage?.width).toBeGreaterThanOrEqual(viewport.width - 2)
    expect(stageState.stage?.height).toBeGreaterThanOrEqual(viewport.height - 2)
    expect(stageState.documentWidth).toBeLessThanOrEqual(viewport.width + 1)
    expect(stageState.debugChrome).toBe(0)

    const artifactCount = await page.locator('button.artifact').count()
    expect(artifactCount).toBeGreaterThanOrEqual(6)

    const sourceBindings = readEditionJson<{ bindings: SourceBindingRecord[] }>(currentEdition, 'source-bindings.json')
    const artifactMap = readEditionJson<{ artifacts: ArtifactRecord[] }>(currentEdition, 'artifact-map.json')
    const metrics: MobileWindowMetric[] = []
    const failures: string[] = []
    let primaryMetric: MobileWindowMetric | null = null

    for (const binding of sourceBindings.bindings) {
      const artifactIndex = artifactMap.artifacts.findIndex((artifact) => artifact.id === binding.artifact_id)
      const artifact = artifactMap.artifacts[artifactIndex]
      if (artifactIndex < 0 || !artifact) {
        failures.push(`${viewport.name} / ${binding.artifact_id}: source binding has no artifact`)
        continue
      }
      const label = artifact.label

      await gotoLiveEdition(page)
      const artifactButton = page.locator('button.artifact').nth(artifactIndex)
      await artifactButton.focus()
      await page.waitForTimeout(250)
      await waitForSourceWindowSettle(page, binding.id)

      let metric = await collectWindowMetric(page, binding.id, label)
      if (!metric.exists) {
        await page.evaluate((index) => {
          const button = document.querySelectorAll('button.artifact')[index]
          button?.dispatchEvent(new FocusEvent('focus', { bubbles: true }))
          button?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, cancelable: true }))
        }, artifactIndex)
        await page.waitForTimeout(350)
        await waitForSourceWindowSettle(page, binding.id)
        metric = await collectWindowMetric(page, binding.id, label)
      }

      metrics.push(metric)
      if (!metric.exists) failures.push(`${viewport.name} / ${label}: source window did not open from focus/tap preview`)
      const minimumReadableWidth = Math.min(240, viewport.width - 24)
      if (metric.width < minimumReadableWidth - 1) failures.push(`${viewport.name} / ${label}: source window too narrow for readable source card (${Math.round(metric.width)}px < ${minimumReadableWidth}px)`)
      if (metric.clipped) failures.push(`${viewport.name} / ${label}: source window clipped by mobile viewport`)
      if (!metric.hasReachableClose) failures.push(`${viewport.name} / ${label}: source window close control is not reachable on mobile`)
      if (!metric.hasVisibleClose) failures.push(`${viewport.name} / ${label}: source window close control is not visibly on top of the source surface`)
      if (!metric.closeOverRawCard) failures.push(`${viewport.name} / ${label}: close control is not anchored to the raw-media card`)
      if (metric.captionOverMedia) failures.push(`${viewport.name} / ${label}: source title overlaps and obscures the media surface`)
      if (metrics.length === 1 && metric.sourceVisualMode && !metric.titleVisible) failures.push(`${viewport.name} / ${label}: image-backed preview has no readable source title`)
      if (!metric.hasVisibleMedia && !metric.hasReadableText) failures.push(`${viewport.name} / ${label}: source window has no visible media or readable fallback`)
      if (metric.hasVisibleMedia && metric.mediaAreaRatio < 0.22) failures.push(`${viewport.name} / ${label}: source media is too small in the mobile source window (${metric.mediaAreaRatio.toFixed(2)} < 0.22)`)
      if (viewport.name === 'mobile-landscape' && binding.source_media_type !== 'video' && (binding.source_media_url || binding.source_image_url)) {
        if (metric.sourceVisualMode !== 'raw') failures.push(`${viewport.name} / ${label}: still-image source must use contained raw media in short landscape (mode=${metric.sourceVisualMode})`)
        if (!metric.hasAmbientFill) failures.push(`${viewport.name} / ${label}: contained landscape source is missing blurred ambient fill`)
        const expectedRawImageUrl = binding.source_media_url || binding.source_image_url || null
        if (expectedRawImageUrl && metric.sourceVisualImageUrl !== expectedRawImageUrl) failures.push(`${viewport.name} / ${label}: landscape still must render the original source image, not its poster crop`)
        if (metric.sourceVisualMode === 'raw' && metric.height < viewport.height * 0.55) failures.push(`${viewport.name} / ${label}: landscape source aperture is too short to show the image (${Math.round(metric.height)}px < ${Math.round(viewport.height * 0.55)}px)`)
      }

      if (metrics.length === 1 && metric.exists) {
        await page.screenshot({ path: path.join(reportRoot, `${viewport.name}-window-open.png`), fullPage: false })
      }
    }

    const primaryBinding = sourceBindings.bindings[0]
    if (primaryBinding) {
      const primaryArtifactIndex = artifactMap.artifacts.findIndex((artifact) => artifact.id === primaryBinding.artifact_id)
      if (primaryArtifactIndex < 0) {
        failures.push(`${viewport.name} / ${primaryBinding.artifact_id}: primary source binding has no artifact`)
      } else {
        await gotoLiveEdition(page)
        const primaryArtifactButton = page.locator('button.artifact').nth(primaryArtifactIndex)
        const point = await primaryArtifactButton.evaluate((node) => {
          const element = node as HTMLElement
          const rect = element.getBoundingClientRect()
          for (const xStep of [0.5, 0.35, 0.65, 0.2, 0.8]) {
            for (const yStep of [0.5, 0.35, 0.65, 0.2, 0.8]) {
              const x = rect.left + rect.width * xStep
              const y = rect.top + rect.height * yStep
              const hit = document.elementFromPoint(x, y)
              if (hit === element || element.contains(hit)) return { x, y }
            }
          }
          return null
        })
        if (!point) {
          failures.push(`${viewport.name} / ${primaryBinding.artifact_id}: no visible hit point to open primary source window`)
        } else {
          await page.mouse.click(point.x, point.y)
          const primaryWindow = page.locator(`.stage-overlay-windows--live .source-window[data-binding-id="${primaryBinding.id}"]`)
          await expect(primaryWindow).toHaveAttribute('data-source-window-mode', 'primary', { timeout: 8_000 })
          await waitForSourceWindowSettle(page, primaryBinding.id)
          primaryMetric = await collectWindowMetric(page, primaryBinding.id, primaryBinding.title || primaryBinding.artifact_id)
          if (!primaryMetric.exists) failures.push(`${viewport.name} / primary source: clicked source window did not open`)
          if (primaryMetric.clipped) failures.push(`${viewport.name} / primary source: clicked source window is clipped by mobile viewport`)
          if (primaryMetric.width < Math.min(240, viewport.width - 24)) failures.push(`${viewport.name} / primary source: clicked source window is too narrow (${Math.round(primaryMetric.width)}px)`)
          if (!primaryMetric.hasVisibleMedia || primaryMetric.mediaAreaRatio < 0.22) failures.push(`${viewport.name} / primary source: clicked source window does not keep media dominant (${primaryMetric.mediaAreaRatio.toFixed(2)})`)
          if (!primaryMetric.titleVisible) failures.push(`${viewport.name} / primary source: compact source title is not fully visible`)
          if (!primaryMetric.hasReachableClose || !primaryMetric.hasVisibleClose) failures.push(`${viewport.name} / primary source: close control is not visible and reachable`)
          if (!primaryMetric.closeOverRawCard) failures.push(`${viewport.name} / primary source: close control is not anchored over the media card`)
          if (viewport.name === 'mobile-landscape' && primaryBinding.source_media_type !== 'video') {
            if (primaryMetric.sourceVisualMode !== 'raw' || !primaryMetric.hasAmbientFill) failures.push(`${viewport.name} / primary source: short-landscape raw media mode/ambient fill is missing`)
            const expectedRawImageUrl = primaryBinding.source_media_url || primaryBinding.source_image_url || null
            if (expectedRawImageUrl && primaryMetric.sourceVisualImageUrl !== expectedRawImageUrl) failures.push(`${viewport.name} / primary source: landscape still must render the original source image, not its poster crop`)
            if (primaryMetric.height < viewport.height * 0.55) failures.push(`${viewport.name} / primary source: clicked source aperture is too short (${Math.round(primaryMetric.height)}px < ${Math.round(viewport.height * 0.55)}px)`)
          }
          await page.screenshot({ path: path.join(reportRoot, `${viewport.name}-primary-open.png`), fullPage: false })
        }
      }
    }

    fs.writeFileSync(
      path.join(reportRoot, `${viewport.name}-report.json`),
      `${JSON.stringify({ viewport, edition: currentEdition.edition_id, metrics, primaryMetric, failures, popups }, null, 2)}\n`,
    )

    expect(failures).toEqual([])
  })
}
