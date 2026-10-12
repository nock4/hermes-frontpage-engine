import { afterEach, expect, it, vi } from 'vitest'

import { verifyOriginalImageDelivery, getOriginalImageDeliveryUrl } from './originalImageDelivery'
import { getUsableSourceImageUrl } from '../components/runtime/sourceWindowShared'
import { getSourceVisualImageUrl } from '../components/runtime/SourceWindowBody'
import { collectEmbedPreloads } from './embedPreloads'
import { collectWarmImageUrls } from './runtimeWarmup'
import { getSourceWindowDescriptor } from './sourceWindowContent'
import type { SourceBindingRecord } from '../types/runtime'
const bytes = Uint8Array.from([137,80,78,71,13,10,26,10,1,2,3])
const hash = '7f47b756761a46e6d4a4d96f0d8a4448f8449235009d1f3ad1493f5c773c19e8'
const edition = '2026-10-12-paint-gives-way-to-air-v1'
function binding() {
  return { id: 'original', source_url: 'https://artist.example/work', source_image_url: 'https://artist.example/image.png',
    source_media_url: 'https://artist.example/image.png', source_media_type: 'image', source_type: 'web', window_type: 'web',
    source_visual: { poster_asset_path: '/wrong-crop.png', render_mode: 'poster-crop', crop_risk: 'low' },
    source_image_delivery: { version: 1, kind: 'attested-full-original', edition_id: edition, source_url: 'https://artist.example/work',
      media_url: 'https://artist.example/image.png', capture_sha256: hash, mime_type: 'image/png', byte_length: bytes.length,
      asset_path: `/editions/${edition}/assets/source-originals/${hash}.png` },
  } as SourceBindingRecord
}
afterEach(() => vi.unstubAllGlobals())
function response(body = bytes) {

  vi.stubGlobal('fetch', vi.fn(async () => new Response(body, { headers: { 'content-type': 'image/png' } })))
}
it('uses verified local full original for still, preview and preloads, retaining identity', async () => {
  const b = binding(); response()
  expect(getOriginalImageDeliveryUrl(b)).toBeNull()
  await verifyOriginalImageDelivery(b, edition)
  const asset = b.source_image_delivery!.asset_path
  expect(getOriginalImageDeliveryUrl(b)).toBe(asset)
  expect(getUsableSourceImageUrl(b)).toBe(asset)
  expect(getSourceVisualImageUrl(b, b.source_image_url!)).toBe(asset)
  expect(collectEmbedPreloads({ bindings: [b], reviewMode: 'live', openBindingIds: [] })[0].src).toBe(asset)
  expect(collectWarmImageUrls([b])).toEqual([asset])
  expect(b.source_image_url).toBe('https://artist.example/image.png')
  expect(b.source_media_url).toBe(b.source_image_url)
})
it.each(['edition', 'owner', 'media', 'path', 'digest', 'placeholder', 'size', 'redirect', 'type'])('fails closed on %s', async attack => {
  const b = binding(); response()
  if (attack === 'edition') b.source_image_delivery!.edition_id = 'other'
  if (attack === 'owner') b.source_image_delivery!.source_url += '/other'
  if (attack === 'media') b.source_image_delivery!.media_url += '?alias'
  if (attack === 'path') b.source_image_delivery!.asset_path += '?x'
  if (attack === 'digest') response(Uint8Array.from([...bytes, 8]))
  if (attack === 'placeholder') response(new TextEncoder().encode('<svg>source image unavailable</svg>'))
  if (attack === 'size') response(new Uint8Array(8_000_001))
  if (attack === 'redirect') vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, redirected: true })))
  if (attack === 'type') vi.stubGlobal('fetch', vi.fn(async () => new Response(bytes, { headers: { 'content-type': 'text/html' } })))
  await expect(verifyOriginalImageDelivery(b, edition)).rejects.toThrow()
  expect(getOriginalImageDeliveryUrl(b)).toBeNull()
})
it('does not attest copies or mutations of a verified binding', async () => {
  const b = binding(); response(); await verifyOriginalImageDelivery(b, edition)
  expect(getOriginalImageDeliveryUrl({ ...b })).toBeNull()
  b.source_media_url = 'https://artist.example/unrelated.png'
  expect(getOriginalImageDeliveryUrl(b)).toBeNull()
})

it('revokes prior verification when reloaded bytes change', async () => {
  const b = binding(); response(); await verifyOriginalImageDelivery(b, edition)
  response(Uint8Array.from([...bytes, 8]))
  await expect(verifyOriginalImageDelivery(b, edition)).rejects.toThrow()
  expect(getOriginalImageDeliveryUrl(b)).toBeNull()
})

it('keeps native video identity and descriptor when its poster is attested', async () => {
  const b = binding()
  b.source_url = 'https://www.youtube.com/watch?v=abcdefghijk'
  b.source_image_delivery!.source_url = b.source_url
  b.source_media_type = 'video'
  b.source_media_url = 'https://video.example/original.mp4'
  const before = getSourceWindowDescriptor(b)
  response(); await verifyOriginalImageDelivery(b, edition)
  expect(getSourceWindowDescriptor(b)).toEqual(before)
  expect(b.source_media_url).toBe('https://video.example/original.mp4')
  expect(getUsableSourceImageUrl(b)).toBe(b.source_image_delivery!.asset_path)
})
