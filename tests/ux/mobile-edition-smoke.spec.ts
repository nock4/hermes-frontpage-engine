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
  mediaAreaRatio: number
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
        mediaAreaRatio: 0,
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
    const close = node.querySelector('.source-window__close')
    const closeRect = close?.getBoundingClientRect()
    const hasReachableClose = Boolean(closeRect
      && closeRect.width >= 32
      && closeRect.height >= 32
      && closeRect.left >= -1
      && closeRect.top >= -1
      && closeRect.right <= window.innerWidth + 1
      && closeRect.bottom <= window.innerHeight + 1)
    const text = (node.textContent || '').replace(/\s+/g, ' ').trim()

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
      mediaAreaRatio: rect.width > 0 && rect.height > 0 ? largestMediaArea / (rect.width * rect.height) : 0,
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

      let metric = await collectWindowMetric(page, binding.id, label)
      if (!metric.exists) {
        await page.evaluate((index) => {
          const button = document.querySelectorAll('button.artifact')[index]
          button?.dispatchEvent(new FocusEvent('focus', { bubbles: true }))
          button?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, cancelable: true }))
        }, artifactIndex)
        await page.waitForTimeout(350)
        metric = await collectWindowMetric(page, binding.id, label)
      }

      metrics.push(metric)
      if (!metric.exists) failures.push(`${viewport.name} / ${label}: source window did not open from focus/tap preview`)
      const minimumReadableWidth = Math.min(240, viewport.width - 24)
      if (metric.width < minimumReadableWidth - 1) failures.push(`${viewport.name} / ${label}: source window too narrow for readable source card (${Math.round(metric.width)}px < ${minimumReadableWidth}px)`)
      if (metric.clipped) failures.push(`${viewport.name} / ${label}: source window clipped by mobile viewport`)
      if (!metric.hasReachableClose) failures.push(`${viewport.name} / ${label}: source window close control is not reachable on mobile`)
      if (!metric.hasVisibleMedia && !metric.hasReadableText) failures.push(`${viewport.name} / ${label}: source window has no visible media or readable fallback`)
      if (metric.hasVisibleMedia && metric.mediaAreaRatio < 0.22) failures.push(`${viewport.name} / ${label}: source media is too small in the mobile source window (${metric.mediaAreaRatio.toFixed(2)} < 0.22)`)

      if (metrics.length === 1 && metric.exists) {
        await page.screenshot({ path: path.join(reportRoot, `${viewport.name}-window-open.png`), fullPage: false })
      }
    }

    fs.writeFileSync(
      path.join(reportRoot, `${viewport.name}-report.json`),
      `${JSON.stringify({ viewport, edition: currentEdition.edition_id, metrics, failures, popups }, null, 2)}\n`,
    )

    expect(failures).toEqual([])
  })
}
