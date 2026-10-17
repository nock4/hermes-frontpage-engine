import { expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import ts from 'typescript'
import { nativeVideoPlaybackProgress } from '../ux/helpers/native-video-playback'

// Execute the actual audit analyzer without registering network/browser tests.
const source = fs.readFileSync(new URL('../ux/source-window-media-audit.spec.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(`${source}\nglobalThis.analyze = analyzeWindow;`, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText
const context = { exports: {}, process, console, URL, require: name => {
  if (name === 'node:fs') return fs
  if (name === 'node:path') return path
  if (name === '@playwright/test') return { test() {}, expect }
  if (name === './helpers/native-video-playback') return { nativeVideoPlaybackProgress }
  throw new Error(`Unexpected audit dependency ${name}`)
} }
vm.runInNewContext(compiled, context)
const binding = { source_image_url: 'https://artist.example/art.jpg' }
function audit(src, overrides = {}) {
  return context.analyze(binding, {
    exists: true, mode: 'hover', kind: 'image', width: 320, height: 180, viewportClipped: false, frames: [],
    images: [{ src, complete: true, naturalWidth: 320, naturalHeight: 180, width: 320, height: 180,
      objectFit: 'contain', areaRatio: 1, aspectDelta: 0, viewportClipped: false, ...overrides }],
  })
}

it('rejects both runtime unavailable SVG placeholders despite decoded dimensions', () => {
  for (const file of ['SourceWindowBody.tsx', 'sourceWindowShared.ts']) {
    const runtime = fs.readFileSync(new URL(`../../src/components/runtime/${file}`, import.meta.url), 'utf8')
    const fallback = runtime.match(/const SOURCE_IMAGE_FALLBACK_DATA_URL = '([^']+)'/)[1]
    expect(audit(fallback).join('\n')).toMatch(/placeholder|low-value|failed to load/)
  }
})
it.each(['data:image/svg+xml;base64,PHN2Zy8+', 'DATA:image/svg+xml,%3Csvg%2F%3E'])('rejects SVG data media: %s', src => {
  expect(audit(src).length).toBeGreaterThan(0)
})
it('retains the normal decoded original and packaged poster cases', () => {
  expect(audit(binding.source_image_url)).toEqual([])
  expect(audit('http://localhost/editions/fixture/assets/source-posters/art.jpg')).toEqual([])
})
it('continues rejecting broken originals', () => {
  expect(audit(binding.source_image_url, { complete: false, naturalWidth: 0 }).join('\n')).toMatch(/failed to load/)
})
