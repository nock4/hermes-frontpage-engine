import dns from 'node:dns/promises'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { inspectCandidateSource } from '../../scripts/lib/source-inspection.mjs'
import { hasCreativeArtifactEvidence, isAutoresearchExcluded } from '../../scripts/lib/source-selection-policy.mjs'

const dirs = []
afterEach(async () => {
  vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs()
  for (const dir of dirs.splice(0)) await fs.rm(dir, { recursive: true, force: true })
})

async function harness(pages) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'shared-preview-'))
  dirs.push(dir)
  const executable = path.join(dir, 'harness.mjs')
  await fs.writeFile(executable, `#!${process.execPath}
import fs from 'node:fs';
import { chromium } from ${JSON.stringify(import.meta.resolve('playwright'))};
const input = fs.readFileSync(0, 'utf8');
const expression = input.match(/payload = js\\(r'''([\\s\\S]*?)'''\\)/)[1];
const url = JSON.parse(input.match(/^url = (.+)$/m)[1]);
const pages = ${JSON.stringify(pages)};
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ javaScriptEnabled: false });
  await page.route('**/*', route => route.request().isNavigationRequest() && pages[route.request().url()]
    ? route.fulfill({ contentType: 'text/html', body: pages[route.request().url()] }) : route.abort());
  await page.goto(url);
  console.log(JSON.stringify({ ...JSON.parse(await page.evaluate(expression)), fetch_status: 'browser-harness' }));
} finally { await browser.close(); }
`, { mode: 0o755 })
  vi.stubEnv('DFE_ENABLE_UNTRUSTED_BROWSER_SOURCE_INSPECTION', '1')
  vi.stubEnv('DFE_TEST_USE_GLOBAL_FETCH', '1')
  vi.spyOn(dns, 'lookup').mockResolvedValue([{ address: '93.184.216.34', family: 4 }])
  const fetch = vi.fn(async () => new Response('fixture', { headers: { 'content-type': 'image/jpeg' } }))
  vi.stubGlobal('fetch', fetch)
  return { fetch, inspect: (url, observedSources = [], extra = {}) => inspectCandidateSource({ url, note_title: 'Observed page', ...extra }, {
    sourceTool: 'browser-harness', browserHarness: executable, observedSources,
  }) }
}

it('replays captured owner root and child through production extraction, reduction and health normalization', async () => {
  const root = 'https://designcore.org/'
  const child = `${root}news/drinks-by-design-light-sound`
  const preview = 'https://cdn.prod.website-files.com/6843dc0e77a499af83ad76f4/688f84ba8f1be3bee981f2af_desigcore-opengraph-image-min.jpg'
  const photo = 'https://cdn.prod.website-files.com/6846cb7928c816d4ff6b26be/6a57948e5348b7d4e896509a_July2026_DrinksbyDesign_Web_9.jpg'
  const { inspect, fetch } = await harness({
    [root]: await fs.readFile(new URL('../fixtures/shared-preview/design-root.html', import.meta.url), 'utf8'),
    [child]: await fs.readFile(new URL('../fixtures/shared-preview/design-child.html', import.meta.url), 'utf8'),
  })
  const owner = await inspect(root)
  expect(owner.image_url).toBe(preview)
  fetch.mockClear()
  const article = await inspect(child, [owner], { autoresearch_role: 'reject', attribution_note: 'Mixed event; pictured artist unknown' })
  // Chromium may populate currentSrc with the literal responsive URL from
  // this captured srcset; both are observed, not reconstructed CDN URLs.
  const responsive = 'https://cdn.prod.website-files.com/6846cb7928c816d4ff6b26be/6a57948e5348b7d4e896509a_July2026_DrinksbyDesign_Web_9-p-1600.jpg'
  expect([photo, responsive]).toContain(article.image_url)
  const selectedPhoto = article.image_url
  expect(article.image_candidates).toContainEqual(expect.objectContaining({ image_url: photo, page_url: child, context: 'main', kind: 'dom' }))
  expect(article.image_candidates).toContainEqual(expect.objectContaining({ image_url: preview, kind: 'metadata' }))
  expect(article.image_selection).toMatchObject({ reason: 'observed-shared-homepage-preview', shared_preview_url: preview, evidence_page_url: root })
  expect(article.source_image_url).toBe(selectedPhoto)
  expect(article.source_image_aliases).toEqual([selectedPhoto])
  expect(article.url).toBe(child)
  expect(article.creator_attribution).toBeNull()
  expect(article.attribution_note).toBe('Mixed event; pictured artist unknown')
  expect(isAutoresearchExcluded(article)).toBe(true)
  expect(hasCreativeArtifactEvidence(article, {})).toBe(false)
  expect(fetch.mock.calls.map(([url]) => url)).toEqual([selectedPhoto])
}, 20000)

it('uses already-fetched homepage metadata without an extra root request', async () => {
  const rootUrl = 'https://archive.example/'
  const articleUrl = `${rootUrl}work`
  const og = 'https://images.archive.example/brand.jpg'
  const photo = 'https://images.archive.example/work.jpg'
  const html = `<meta property="og:image" content="${og}">`
  const { inspect, fetch } = await harness({ [articleUrl]: html + `<main><img src="${photo}"></main>` })
  fetch.mockImplementation(async url => url === rootUrl
    ? new Response(html, { headers: { 'content-type': 'text/html' } })
    : new Response('fixture', { headers: { 'content-type': 'image/jpeg' } }))
  const owner = await inspectCandidateSource({ url: rootUrl }, { sourceTool: 'fetch' })
  expect(owner.image_candidates).toContainEqual(expect.objectContaining({ image_url: og, page_url: rootUrl, kind: 'metadata' }))
  fetch.mockClear()
  const article = await inspect(articleUrl, [owner], { image_url: og, source_image_url: og, source_image_aliases: [og] })
  expect(article.image_url).toBe(photo)
  expect(article.source_image_url).toBe(photo)
  expect(article.source_image_aliases).toEqual([photo])
  expect(fetch.mock.calls.map(([url]) => url)).toEqual([photo])
})

const preview = 'https://media.unrelated.example/opaque-7.jpg'
const art = 'https://media.unrelated.example/opaque-8.jpg'
const root = 'https://museum.example/'
const child = `${root}exhibit`
const meta = url => `<meta property="og:image" content="${url}">`
it('generalizes only from same-origin observed homepage metadata, preserving unique OG and page boundaries', async () => {
  const unique = 'https://media.unrelated.example/unique-work.jpg'
  const pages = {
    [root]: meta(preview) + `<main><img src="${art}"></main>`,
    [child]: meta(preview) + `<nav><img src="/nav.jpg"></nav><main><header><img src="/header.jpg"></header><aside><img src="/aside.jpg"></aside><a href="https://other.example/work"><img src="/unrelated.jpg"></a><img src="/logo.png"><img src="/beacon.jpg" width="1" height="1"><article><img src="${art}" alt="Mixed installation"></article></main><footer><img src="/footer.jpg"></footer>`,
    [`${root}unique`]: meta(unique) + `<main><img src="${art}"></main>`,
    'https://other.example/': meta(preview),
  }
  const { inspect } = await harness(pages)
  const owner = await inspect(root)
  const unrelated = await inspect('https://other.example/')
  expect((await inspect(child)).image_url).toBe(preview)
  expect((await inspect(child, [unrelated])).image_url).toBe(preview)
  const selected = await inspect(child, [owner])
  expect(selected.image_url).toBe(art)
  expect(selected.image_candidates).toContainEqual(expect.objectContaining({ image_url: art, alt: 'Mixed installation', context: 'article' }))
  expect((await inspect(`${root}unique`, [owner])).image_url).toBe(unique)
  expect((await inspect(root, [selected])).image_url).toBe(preview)
  expect(hasCreativeArtifactEvidence(selected, {})).toBe(false)
}, 30000)

it('requires successful exact-owner root evidence and never retries a failed selected image', async () => {
  const ownerUrl = 'https://gallery-proof.example/'
  const pageUrl = `${ownerUrl}work`
  const og = 'https://media.gallery-proof.example/opaque.jpg'
  const photo = 'https://media.gallery-proof.example/photo.jpg'
  const { inspect, fetch } = await harness({
    [ownerUrl]: meta(og),
    [pageUrl]: meta(og) + `<main><img src="${photo}"></main>`,
  })
  const owner = await inspect(ownerUrl)
  expect((await inspect(pageUrl, [{ ...owner, fetch_status: 'fetch-http-404' }])).image_url).toBe(og)
  expect((await inspect(pageUrl, [{ ...owner, final_url: 'https://sub.gallery-proof.example/' }])).image_url).toBe(og)
  expect((await inspect(pageUrl, [{ ...owner, image_candidates: [] }])).image_url).toBe(og)
  fetch.mockClear()
  fetch.mockResolvedValue(new Response('missing', { status: 404 }))
  const failed = await inspect(pageUrl, [owner])
  expect(failed.image_url).toBeNull()
  expect(failed.image_candidates).toContainEqual(expect.objectContaining({ image_url: photo, context: 'main' }))
  expect(fetch.mock.calls.map(([url]) => url)).toEqual([photo])
  expect(hasCreativeArtifactEvidence(failed, {})).toBe(false)
}, 20000)

it('does not promote images without own main context or turn tool/event ads into creative evidence', async () => {
  const { inspect } = await harness({
    [root]: meta(preview),
    [child]: meta(preview) + `<main><aside><img src="${art}"></aside><a href="/different"><img src="${art}"></a></main><img src="${art}">`,
    [`${root}tool`]: `<title>AI workflow tooling</title>` + meta(preview) + `<main><img src="${art}" alt="Tool screenshot"></main>`,
    [`${root}missing`]: `<title>Requested Page Not Found (404)</title><h1>Page not found</h1><p>Error code: 404. We can't find the page you're looking for.</p>` + meta(preview) + `<main><img src="${art}"></main>`,
  })
  const owner = await inspect(root)
  expect((await inspect(child, [owner])).image_url).toBe(preview)
  const tool = await inspect(`${root}tool`, [owner], { autoresearch_role: 'reject', title: 'Event promotion / AI tooling' })
  expect(hasCreativeArtifactEvidence(tool, {})).toBe(false)
  expect(isAutoresearchExcluded(tool)).toBe(true)
  expect(await inspect(`${root}missing`, [owner])).toBeNull()
}, 20000)
