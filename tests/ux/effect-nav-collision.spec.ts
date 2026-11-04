import { test, expect } from '@playwright/test'
import fs from 'node:fs'

const manifest = JSON.parse(fs.readFileSync('public/editions/index.json', 'utf8'))
const current = manifest.editions.find((e: any) => e.edition_id === manifest.current_edition_id)
const map = JSON.parse(fs.readFileSync(`public${current.path}/artifact-map.json`, 'utf8'))
const bindings = JSON.parse(fs.readFileSync(`public${current.path}/source-bindings.json`, 'utf8'))
const artifact = map.artifacts[0]
const binding = bindings.bindings.find((b: any) => b.artifact_id === artifact.id)
const navSelector = '.site-enter-button, .about-unfurl__controls .about-unfurl__button'

test.use({ hasTouch: true })
for (const view of [{ width: 320, height: 240 }, { width: 390, height: 844 }, { width: 852, height: 393 }, { width: 1440, height: 980 }])
  for (const edge of ['top-left', 'top-right'])
    for (const count of [2, 3])
      test(`nav clearance ${edge} ${count} effects ${view.width}x${view.height}`, async ({ page }, info) => {
        await page.setViewportSize(view)
        const x = edge === 'top-left' ? .01 : .97, y = .01
        const kinds = ['refraction', 'depth', 'rupture'].slice(0, count)
        await page.route(`**${current.path}/artifact-map.json`, r => r.fulfill({ json: {
          ...map, artifacts: map.artifacts.map((a: any) => a.id === artifact.id ? {
            ...a, bounds: { x, y, w: .02, h: .02 }, polygon: [[x,y],[x+.02,y],[x+.02,y+.02],[x,y+.02]],
          } : a),
        } }))
        await page.route(`**${current.path}/effects.json`, r => r.fulfill({ json: {
          schema_version: 1, edition_id: current.edition_id,
          effects: kinds.map(kind => ({ kind, artifact_id: artifact.id, binding_id: binding.id,
            evidence: { artifact_id: artifact.id, binding_id: binding.id, material: 'metal',
              observation: 'SYNTHETIC close top corner nav collision regression', modalities: ['reflective','depth','fracture'] } })),
        } }))
        await page.mouse.move(0, 0)
        await page.goto('/?qaEffects=1')
        await expect(page.locator('img.plate')).toBeVisible()
        await expect(page.locator('.edition-effect-mark')).toHaveCount(count)
        const verify = async () => {
          const geometry = await page.evaluate((selector) => {
            const rect = (n: Element) => { const r = n.getBoundingClientRect(); return { x:r.x, y:r.y, w:r.width, h:r.height, hit:n.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)) } }
            return { marks: [...document.querySelectorAll('.edition-effect-mark')].map(rect), nav: [...document.querySelectorAll(selector)].map(rect) }
          }, navSelector)
          expect(geometry.nav).toHaveLength(3)
          const separate = (a: any, b: any) => a.x+a.w+4 <= b.x+.01 || b.x+b.w+4 <= a.x+.01 || a.y+a.h+4 <= b.y+.01 || b.y+b.h+4 <= a.y+.01
          for (const [i, r] of geometry.marks.entries()) {
            expect(r.w).toBe(44); expect(r.h).toBe(44)
            expect(r.x).toBeGreaterThanOrEqual(0); expect(r.y).toBeGreaterThanOrEqual(0)
            expect(r.x+r.w).toBeLessThanOrEqual(page.viewportSize()!.width+.01)
            expect(r.y+r.h).toBeLessThanOrEqual(page.viewportSize()!.height+.01)
            for (const nav of geometry.nav) expect(separate(r, nav), '44px mark clears actual nav hit rectangle by 4px').toBe(true)
            for (const other of geometry.marks.slice(i+1)) expect(separate(r, other)).toBe(true)
            expect(r.hit).toBe(true)
          }
          for (const nav of geometry.nav) expect(nav.hit).toBe(true)
        }
        await expect.poll(async () => { try { await verify(); return true } catch { return false } }).toBe(true)
        if (count === 3) await page.screenshot({ path: `tmp/effects-qa/nav-${edge}-${view.width}x${view.height}.png` })
        for (const kind of kinds) {
          const mark = page.getByRole('button', { name: `Experience ${kind}` })
          for (const input of ['click', 'tap'] as const) {
            await mark[input]()
            await expect(page.locator('.edition-effect-status')).toBeVisible()
            await page.getByRole('button', { name: 'Stop experience' })[input]()
          }
        }
        // Preserve real DOM hit testing and link dispatch without leaving the test site.
        await page.locator('.site-enter-button').evaluate(n => n.addEventListener('click', e => { e.preventDefault(); n.setAttribute('data-hit-count', String(Number(n.getAttribute('data-hit-count') || 0)+1)) }))
        await expect(page.locator('.site-enter-button')).toHaveAttribute('href', 'https://nockgarden.com/')
        for (const input of ['click', 'tap'] as const) {
          await page.locator('.site-enter-button')[input]()
          for (const id of ['archive-panel', 'about-panel']) {
            const control = page.locator(`[aria-controls="${id}"]`)
            await control[input]()
            await expect(control).toHaveAttribute('aria-expanded', 'true')
            await expect(page.locator(`#${id}`)).toBeVisible()
            await control[input]()
            await expect(control).toHaveAttribute('aria-expanded', 'false')
          }
        }
        await expect(page.locator('.site-enter-button')).toHaveAttribute('data-hit-count', '2')
        await page.setViewportSize({ width: view.width-8, height: view.height-8 })
        await expect.poll(async () => { try { await verify(); return true } catch { return false } }).toBe(true)
      })
