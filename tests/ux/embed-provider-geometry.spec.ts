import { expect, test, type Page } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'

// Real provider internals: an in-bounds iframe can still cut its track row.
for (const viewport of [{ width: 360, height: 740 }, { width: 375, height: 667 }, { width: 393, height: 852 }, { width: 852, height: 393 }]) {
  test(`Bandcamp internal track row fits candidate at ${viewport.width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport)
    await page.goto('/?edition=2026-10-02-a-pulse-inside-the-opening-v1')
    const artifact = page.getByRole('button', { name: 'Ivory contour aperture', exact: true })
    await artifact.focus()
    await artifact.press('Enter')
    const surface = page.locator('.stage-overlay-windows--live .source-window[data-source-window-mode="primary"]')
    const iframe = surface.locator('iframe')
    await expect(iframe).toHaveAttribute('src', /track=1200520298/)
    const provider = iframe.contentFrame()
    await expect(provider.locator('#tracklist li').first()).toBeVisible({ timeout: 30000 })
    await surface.evaluate(async node => {
      await Promise.all(node.getAnimations({ subtree: true }).filter(a => a.effect?.getComputedTiming().iterations !== Infinity).map(a => a.finished.catch(() => {})))
    })
    // Exercise the unchanged real transport, not merely provider readiness.
    await provider.locator('#play:visible, #big_play_button:visible').first().click()
    await expect.poll(() => provider.locator('audio').evaluateAll(nodes => nodes.some(node => {
      const audio = node as HTMLAudioElement
      return Boolean(audio.currentSrc) && audio.currentTime > 0.2 && !audio.paused && !audio.muted && !audio.error
    })), { timeout: 20000 }).toBe(true)
    const internal = await provider.locator('#tracklist').evaluate(node => ({
      list: node.getBoundingClientRect().toJSON(),
      row: node.querySelector('li')!.getBoundingClientRect().toJSON(),
      height: innerHeight,
    }))
    const outer = await surface.evaluate(node => ({ surface: node.getBoundingClientRect().toJSON(), frame: node.querySelector('iframe')!.getBoundingClientRect().toJSON() }))
    const root = process.env.DFE_BANDCAMP_QA_DIR || testInfo.outputPath('bandcamp-proof')
    fs.mkdirSync(root, { recursive: true })
    const stem = path.join(root, `${viewport.width}-primary`)
    fs.writeFileSync(`${stem}.json`, JSON.stringify({ edition: '2026-10-02-a-pulse-inside-the-opening-v1', viewport, internal, outer }, null, 2))
    await page.screenshot({ path: `${stem}.png` })
    expect(internal.row.height).toBeGreaterThan(20)
    expect(internal.row.top).toBeGreaterThanOrEqual(internal.list.top)
    expect(internal.row.bottom, 'provider track row must not be clipped by its own tracklist').toBeLessThanOrEqual(internal.list.bottom)
    expect(outer.frame.bottom).toBeLessThanOrEqual(outer.surface.bottom)
    expect(outer.surface.bottom).toBeLessThanOrEqual(viewport.height)
    expect(outer.surface.top).toBeGreaterThanOrEqual(0)
  })
}


const bandcampFixtureSrc = 'https://bandcamp.com/EmbeddedPlayer/track=2003169497/size=large/bgcol=333333/linkcol=e32c14/artwork=small/transparent=true/'

type ProviderCase = {
  kind: 'tweet' | 'youtube' | 'soundcloud' | 'bandcamp'
  route: string
  artifactName: string | RegExp
  preloadSelector: string
  preloadUrlPattern: RegExp
  openFramePattern?: RegExp
  openMediaSelector?: string
  minWidth: number
  minHeight: number
  interceptBandcamp?: boolean
}

const providerCases: ProviderCase[] = [
  {
    kind: 'tweet',
    route: '/archive/feather-inbox-rupture-v1',
    artifactName: 'glyph material fold',
    preloadSelector: '.embed-preload-layer iframe[data-embed-preload-kind="tweet"]',
    preloadUrlPattern: /platform\.twitter\.com\/embed\/Tweet\.html\?/,
    openMediaSelector: '.visual-source-card__image',
    minWidth: 480,
    minHeight: 500,
  },
  {
    kind: 'youtube',
    route: '/archive/porcelain-ripple-source-field-v1',
    artifactName: 'gray-card notch',
    preloadSelector: '.embed-preload-layer iframe[data-embed-preload-kind="youtube"]',
    preloadUrlPattern: /youtube\.com\/embed\//,
    openFramePattern: /youtube\.com\/embed\//,
    minWidth: 480,
    minHeight: 270,
  },
  {
    kind: 'soundcloud',
    route: '/archive/pink-brine-evidence-lounge-v1',
    artifactName: 'Springtime sunset amber coaster',
    preloadSelector: '.embed-preload-layer iframe[data-embed-preload-kind="soundcloud"]',
    preloadUrlPattern: /w\.soundcloud\.com\/player\//,
    openFramePattern: /w\.soundcloud\.com\/player\//,
    minWidth: 320,
    minHeight: 160,
  },
  {
    kind: 'bandcamp',
    route: '/archive/clouded-earth-radio-garden-v1',
    artifactName: 'PINKCOURTESYPHONE translucent album slab',
    preloadSelector: '.embed-preload-layer iframe[data-embed-preload-kind="bandcamp"]',
    preloadUrlPattern: /bandcamp\.com\/EmbeddedPlayer\//,
    openFramePattern: /bandcamp\.com\/EmbeddedPlayer\//,
    minWidth: 360,
    minHeight: 180,
    interceptBandcamp: true,
  },
]

async function injectBandcampEmbedFixture(page: Page) {
  await page.route('**/editions/2026-05-14-clouded-earth-radio-garden-v1/source-bindings.json', async (route) => {
    const response = await route.fetch()
    const data = await response.json()
    const binding = data.bindings.find((entry: { id?: string }) => entry.id === 'binding-hero-pinkcourtesyphone-translucent-album-') ?? data.bindings[0]
    binding.source_embed_html = `<iframe src="${bandcampFixtureSrc}"></iframe>`
    await route.fulfill({ response, json: data })
  })
}

async function openProviderWindow(page: Page, providerCase: ProviderCase) {
  if (providerCase.interceptBandcamp) await injectBandcampEmbedFixture(page)

  await page.goto(providerCase.route, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('img.plate', { timeout: 20_000 })
  await page.waitForSelector('button.artifact', { timeout: 20_000 })

  const preloads = page.locator(providerCase.preloadSelector)
  await expect(preloads.first()).toBeAttached({ timeout: 10_000 })
  const preloadUrls = await preloads.evaluateAll((nodes) => nodes.map((node) => (node as HTMLIFrameElement).src))
  expect(preloadUrls.some((url) => providerCase.preloadUrlPattern.test(url))).toBe(true)

  await page.evaluate((artifactName) => {
    const matcher = typeof artifactName === 'string'
      ? (value: string) => value.includes(artifactName)
      : (value: string) => new RegExp(artifactName.source, artifactName.flags).test(value)
    const button = Array.from(document.querySelectorAll('button.artifact')).find((candidate) => matcher(candidate.textContent || candidate.getAttribute('aria-label') || ''))
    button?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }))
    button?.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 0 }))
    button?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }))
  }, providerCase.artifactName)
  await page.waitForTimeout(1_200)
  const sourceWindow = page.locator('.stage-overlay-windows--live .source-window[data-source-window-mode="primary"]')
  await expect(sourceWindow).toHaveCount(1)

  const media = providerCase.openMediaSelector
    ? sourceWindow.locator(providerCase.openMediaSelector).first()
    : sourceWindow.locator('iframe').first()
  await expect(media).toBeAttached({ timeout: 10_000 })
  const openFramePattern = providerCase.openFramePattern
  if (openFramePattern) await expect(media).toHaveAttribute('src', openFramePattern)
  await page.waitForTimeout(1_500)

  return sourceWindow
}

async function collectMediaGeometry(page: Page, providerCase: ProviderCase) {
  const selector = providerCase.openMediaSelector || 'iframe'
  return page.locator(`.stage-overlay-windows--live .source-window[data-source-window-mode="primary"] ${selector}`).first().evaluate((node) => {
    const rect = node.getBoundingClientRect()
    return {
      src: node instanceof HTMLIFrameElement || node instanceof HTMLImageElement || node instanceof HTMLVideoElement ? node.currentSrc || node.src : '',
      width: rect.width,
      height: rect.height,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      left: rect.left,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      clipped: rect.left < -1 || rect.top < -1 || rect.right > window.innerWidth + 1 || rect.bottom > window.innerHeight + 1,
      liveChrome: Array.from(document.querySelectorAll('.runtime-topbar,.debug-overlay,[data-debug]')).filter((element) => {
        const style = window.getComputedStyle(element)
        return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || 1) !== 0
      }).length,
    }
  })
}

test.describe('provider embed preload/open geometry', () => {
  for (const providerCase of providerCases) {
    test(`${providerCase.kind} preloads and opens provider iframe without bottom clipping`, async ({ page }) => {
      test.setTimeout(60_000)
      await openProviderWindow(page, providerCase)
      const geometry = await collectMediaGeometry(page, providerCase)

      if (providerCase.openFramePattern) expect(geometry.src).toMatch(providerCase.openFramePattern)
      expect(geometry.width).toBeGreaterThanOrEqual(providerCase.minWidth)
      expect(geometry.height).toBeGreaterThanOrEqual(providerCase.minHeight)
      expect(geometry.clipped).toBe(false)
      expect(geometry.bottom).toBeLessThanOrEqual(geometry.viewportHeight + 1)
      expect(geometry.liveChrome).toBe(0)
    })
  }
})
