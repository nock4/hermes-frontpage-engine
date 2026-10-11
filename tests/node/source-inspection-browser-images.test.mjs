import dns from 'node:dns/promises'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { inspectCandidateSource } from '../../scripts/lib/source-inspection.mjs'
import { hasCreativeArtifactEvidence, isAutoresearchExcluded, isLowValueVisualImage } from '../../scripts/lib/source-selection-policy.mjs'

const dirs = []
const sourceUrl = 'https://example.com/saved/art?identity=exact#work'
// Exact failed media URLs retained in run8-initial-preserved.
const logo = 'https://rithikaisafool.com/_next/image?url=%2Fassets%2Fshorthome_logo.png&w=256&q=75'
const tiny = 'https://static.wixstatic.com/media/6079d4_2f9e6182d73b4004b9ed9d58dcd1344d~mv2.png/v1/fill/w_73,h_84,al_c,q_85,usm_0.66_1.00_0.01,blur_2,enc_avif,quality_auto/6079d4_2f9e6182d73b4004b9ed9d58dcd1344d~mv2.png'
const art = 'https://cdn.example.com/work%20one.jpg?version=original'

afterEach(async () => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  for (const dir of dirs.splice(0)) await fs.rm(dir, { recursive: true, force: true })
})

async function inspect(html, extra = {}, expectRejected = false, status = 200, imageFixtures = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'source-images-'))
  dirs.push(dir)
  const executable = path.join(dir, 'harness.mjs')
  // Exercise the actual adapter's emitted JavaScript against a real DOM, not
  // a canned metadata response. Only the browser transport is substituted.
  await fs.writeFile(executable, `#!${process.execPath}
import fs from 'node:fs';
import { chromium } from ${JSON.stringify(import.meta.resolve('playwright'))};
const input = fs.readFileSync(0, 'utf8');
const expression = input.match(/payload = js\\(r'''([\\s\\S]*?)'''\\)/)[1];
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  const imageFixtures = ${JSON.stringify(imageFixtures)};
  await page.route('**/*', route => route.request().isNavigationRequest()
    ? route.fulfill({ status: ${status}, contentType: 'text/html', body: ${JSON.stringify(html)} })
    : imageFixtures[route.request().url()]
      ? route.fulfill({ contentType: 'image/svg+xml', body: imageFixtures[route.request().url()] })
      : route.abort());
  await page.goto(${JSON.stringify(sourceUrl)});
  const result = JSON.parse(await page.evaluate(expression));
  console.log(JSON.stringify({ ...result, fetch_status: 'browser-harness' }));
} finally { await browser.close(); }
`, { mode: 0o755 })
  vi.stubEnv('DFE_ENABLE_UNTRUSTED_BROWSER_SOURCE_INSPECTION', '1')
  vi.stubEnv('DFE_TEST_USE_GLOBAL_FETCH', '1')
  vi.spyOn(dns, 'lookup').mockResolvedValue([{ address: '93.184.216.34', family: 4 }])
  const fetch = vi.fn(async () => new Response('image fixture', { headers: { 'content-type': 'image/jpeg' } }))
  vi.stubGlobal('fetch', fetch)
  const candidate = { url: sourceUrl, note_title: 'Saved art', ...extra }
  const result = await inspectCandidateSource(candidate, { sourceTool: 'browser-harness', browserHarness: executable })
  if (expectRejected) {
    expect(result).toBeNull()
    expect(fetch).not.toHaveBeenCalled()
    return { result, fetch }
  }
  expect(result?.fetch_status).toBe('browser-harness')
  expect(result?.url).toBe(sourceUrl)
  expect(result?.source_url).toBe(sourceUrl)
  expect(result?.final_url).toBe(sourceUrl)
  expect(hasCreativeArtifactEvidence(result, {})).toBe(false)
  expect(result?.editorial_evidence).toContainEqual(candidate)
  // At most the existing one image health request, never a media retry loop.
  expect(fetch.mock.calls.length).toBeLessThanOrEqual(1)
  return { result, fetch }
}

it.each([logo, 'https://cdn.example.com/shorthome%5Flogo.png', 'https://cdn.example.com/shorthome_logo.png', tiny])('filters known low-value URL %s', url => {
  expect(isLowValueVisualImage(url)).toBe(true)
})

it('does not confuse full-size Wix artwork or typography with placeholders', () => {
  expect(isLowValueVisualImage(tiny.replace('w_73,h_84', 'w_730,h_840'))).toBe(false)
  expect(isLowValueVisualImage('https://cdn.example.com/study_logotype.jpg')).toBe(false)
})

it.each([
  logo, tiny,
  'https://rithikaisafool.com/assets/shop/Shop%20Logo.png',
  'https://cdn.example.com/Shop%20Logo.png',
  'https://cdn.example.com/Shop Logo.png',
  'https://cdn.example.com/Shop%20Logo%20Dark.png',
])('skips low-value OG media for the same-page content image: %s', async bad => {
  const { result, fetch } = await inspect(`<meta property="og:image" content="${bad}"><img src="${bad}"><img src="${art}">`)
  expect(result.image_url).toBe(art)
  expect(result.source_image_url).toBe(art)
  expect(result.source_image_aliases).toEqual([art])
  expect(fetch.mock.calls.every(([url]) => url === art)).toBe(true)
})

// Opaque URLs deliberately carry no pixel/tracker filename or host cue.
const beacon = 'https://cdn.example.com/action/0?evt=pageLoad'
const sizedImage = (width, height) => `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="red"/></svg>`

it.each([1, 2])('skips an intrinsically %ipx image even when CSS enlarges it', async size => {
  const { result, fetch } = await inspect(`<img src="${beacon}" style="width:800px;height:600px"><img src="${art}">`, {}, false, 200, { [beacon]: sizedImage(size, size) })
  expect(result.image_url).toBe(art)
  expect(fetch.mock.calls.every(([url]) => url === art)).toBe(true)
})

it('skips explicitly tiny unloaded images without rejecting unknown dimensions', async () => {
  const { result } = await inspect(`<img src="${beacon}" width="1" height="1"><img src="${art}">`)
  expect(result.image_url).toBe(art)
})

it('skips a completed zero-size undecoded DOM beacon (live WeTransfer shape)', async () => {
  const { result, fetch } = await inspect(`<img width="0" height="0" alt="" src="${beacon}" style="display:none">`)
  expect(result.image_url).toBeNull()
  expect(fetch).not.toHaveBeenCalled()
})

it.each(['', 'width="" height=""', 'width="invalid" height="invalid"', 'width="0"'])('does not equate unknown dimensions with explicit zero: %s', async attributes => {
  const { result } = await inspect(`<img ${attributes} src="${art}">`)
  expect(result.image_url).toBe(art)
})

it('preserves decoded full-size content despite explicit zero dimensions', async () => {
  const { result } = await inspect(`<img width="0" height="0" src="${art}">`, {}, false, 200, { [art]: sizedImage(1200, 800) })
  expect(result.image_url).toBe(art)
})

it('returns no media and spends no image health request on a pixel-only page', async () => {
  const { result, fetch } = await inspect(`<img src="${beacon}">`, {}, false, 200, { [beacon]: sizedImage(1, 1) })
  expect(result.image_url).toBeNull()
  expect(fetch).not.toHaveBeenCalled()
})

it('preserves full-size content even when declared and displayed at one pixel', async () => {
  const { result } = await inspect(`<img src="${art}" width="1" height="1" style="width:1px;height:1px">`, {}, false, 200, { [art]: sizedImage(1200, 800) })
  expect(result.image_url).toBe(art)
})

it('preserves narrow content rather than treating a single tiny dimension as a pixel', async () => {
  const { result } = await inspect(`<img src="${art}">`, {}, false, 200, { [art]: sizedImage(1, 800) })
  expect(result.image_url).toBe(art)
})

it('checks later metadata before falling back to DOM images', async () => {
  const twitter = 'https://cdn.example.com/twitter-work.jpg'
  const { result } = await inspect(`<meta property="og:image" content="${logo}"><meta name="twitter:image" content="${twitter}"><img src="${art}">`)
  expect(result.image_url).toBe(twitter)
})

it('skips unsafe and low-value first images and resolves relative content against the page', async () => {
  const { result } = await inspect(`<img src="http://127.0.0.1/private.jpg"><img src="${logo}"><img src="../real-work.jpg">`)
  expect(result.image_url).toBe('https://example.com/real-work.jpg')
})

it('returns no media rather than inventing a source when the page has only low-value images', async () => {
  const { result, fetch } = await inspect(`<meta property="og:image" content="${tiny}"><img src="${logo}">`)
  expect(result.image_url).toBeNull()
  expect(fetch).not.toHaveBeenCalled()
})

it('does not crawl linked art or expand the bounded DOM scan', async () => {
  const { result, fetch } = await inspect(`${`<img src="${logo}">`.repeat(64)}<img src="${art}"><a href="https://elsewhere.example/art.jpg">art</a>`)
  expect(result.image_url).toBeNull()
  expect(fetch).not.toHaveBeenCalled()
})

it('skips navigation and footer photos before choosing owning-page artwork', async () => {
  const { result, fetch } = await inspect(`<nav><img src="https://cdn.example.com/mountain.jpg"></nav><div role="navigation"><img src="https://cdn.example.com/flowers.jpg"></div><footer><img src="https://cdn.example.com/bird.jpg"></footer><main><img src="${art}"></main>`)
  expect(result.image_url).toBe(art)
  expect(fetch.mock.calls.every(([url]) => url === art)).toBe(true)
})

it('does not extract media from a missing-page browser shell', async () => {
  const { result, fetch } = await inspect(`<title>Requested Page Not Found (404)</title><h1>Page not found</h1><p>We're sorry, we can't find the page you're looking for. Error code: 404</p><meta property="og:image" content="${art}"><img src="${art}">`, {}, true)
  expect(result).toBeNull()
  expect(fetch).not.toHaveBeenCalled()
})

it('retains navigation HTTP failure even when the page title looks like content', async () => {
  await inspect(`<title>Garden guide</title><meta property="og:image" content="${art}">`, {}, true, 404)
})

it('does not let stale OG metadata hide a corroborated missing-page heading', async () => {
  await inspect(`<meta property="og:title" content="Garden guide"><meta property="og:image" content="${art}"><h1>Page not found</h1><p>Oops! Back to home.</p>`, {}, true)
})

it('preserves a viable OG image and editorial quarantine without granting creative evidence', async () => {
  const og = 'https://cdn.example.com/preferred-work.jpg'
  const { result } = await inspect(`<meta property="og:title" content="Art"><meta property="og:image" content="${og}"><img src="${art}">`, { autoresearch_role: 'reject', title: 'AI workflow tooling' })
  expect(result.image_url).toBe(og)
  expect(isAutoresearchExcluded(result)).toBe(true)
})
