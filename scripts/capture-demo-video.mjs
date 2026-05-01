import fs from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright'

function parseArgs(argv) {
  const parsed = {}
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (!token.startsWith('--')) continue
    const key = token.slice(2)
    const next = argv[index + 1]
    if (!next || next.startsWith('--')) {
      parsed[key] = true
      continue
    }
    parsed[key] = next
    index += 1
  }
  return parsed
}

const args = parseArgs(process.argv.slice(2))
const viewport = { width: 1600, height: 900 }
const targetUrl = String(args.url || 'https://daily.nockgarden.com/')
const outDir = path.resolve(String(args['out-dir'] || 'artifacts/demo-video'))
const rawDir = path.join(outDir, 'raw')
const tempVideoDir = path.join(outDir, '.tmp-videos')
const manifestPath = path.join(outDir, 'capture-manifest.json')

const shots = [
  {
    id: '01-live-hero',
    label: 'Live hero',
    async run(page) {
      await waitForScene(page)
      await page.waitForTimeout(2600)
    },
  },
  {
    id: '02-source-window-a',
    label: 'Open first source window',
    async run(page) {
      await waitForScene(page)
      await openArtifact(page, 1)
      await page.waitForTimeout(2400)
    },
  },
  {
    id: '03-source-window-b',
    label: 'Open second source window',
    async run(page) {
      await waitForScene(page)
      await openArtifact(page, 2)
      await page.waitForTimeout(2400)
    },
  },
  {
    id: '04-about-panel',
    label: 'Open About panel',
    async run(page) {
      await waitForScene(page)
      const buttons = page.locator('.about-unfurl__button')
      const count = await buttons.count()
      if (count < 2) throw new Error('Expected at least two about/archive controls')
      await buttons.nth(1).click()
      await page.locator('#about-panel.is-visible').waitFor({ state: 'visible', timeout: 15_000 })
      await page.waitForTimeout(2400)
    },
  },
  {
    id: '05-archive-panel',
    label: 'Open Archive panel',
    async run(page) {
      await waitForScene(page)
      const button = page.locator('.about-unfurl__button').first()
      await button.click()
      await page.locator('#archive-panel.is-visible').waitFor({ state: 'visible', timeout: 15_000 })
      await page.waitForTimeout(2400)
    },
  },
]

async function ensureDirectory(dirPath) {
  await fs.mkdir(dirPath, { recursive: true })
}

async function waitForScene(page) {
  await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 })
  await page.locator('img.plate').waitFor({ state: 'visible', timeout: 30_000 })
  await page.locator('.artifact').first().waitFor({ state: 'attached', timeout: 30_000 })
  await page.waitForTimeout(1800)
  await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => {})
}

async function openArtifact(page, preferredIndex) {
  const artifacts = page.locator('.artifact')
  const count = await artifacts.count()
  if (!count) throw new Error('No interactive artifacts found on stage')

  const tried = new Set()
  const candidateIndices = [preferredIndex, ...Array.from({ length: count }, (_, index) => index)]

  for (const candidate of candidateIndices) {
    const actualIndex = ((candidate % count) + count) % count
    if (tried.has(actualIndex)) continue
    tried.add(actualIndex)

    await artifacts.nth(actualIndex).click({ timeout: 15_000 })
    const opened = await page.locator('.source-window').first().waitFor({ state: 'visible', timeout: 5_000 }).then(() => true).catch(() => false)
    if (opened) return
  }

  throw new Error('Clicked multiple artifacts but no source window became visible')
}

async function recordShot(browser, shot) {
  const context = await browser.newContext({
    viewport,
    screen: viewport,
    colorScheme: 'dark',
    recordVideo: {
      dir: tempVideoDir,
      size: viewport,
    },
  })

  const page = await context.newPage()
  const video = page.video()

  try {
    await shot.run(page)
  } finally {
    await context.close()
  }

  if (!video) throw new Error(`No video recorded for ${shot.id}`)
  const sourcePath = await video.path()
  const destinationPath = path.join(rawDir, `${shot.id}.webm`)
  await fs.copyFile(sourcePath, destinationPath)
  return destinationPath
}

async function main() {
  await ensureDirectory(outDir)
  await ensureDirectory(rawDir)
  await ensureDirectory(tempVideoDir)

  const browser = await chromium.launch({ headless: true })
  const manifest = {
    url: targetUrl,
    viewport,
    generated_at: new Date().toISOString(),
    shots: [],
  }

  try {
    for (const shot of shots) {
      const clipPath = await recordShot(browser, shot)
      manifest.shots.push({
        id: shot.id,
        label: shot.label,
        clip_path: clipPath,
      })
      console.log(`captured ${shot.id} -> ${clipPath}`)
    }
  } finally {
    await browser.close()
  }

  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  console.log(`wrote manifest -> ${manifestPath}`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
