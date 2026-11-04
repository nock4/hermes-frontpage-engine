import { it, expect, vi } from 'vitest'
import fs from 'node:fs/promises'
import { admitNativeVideo } from '../../scripts/lib/effect-video-admission.mjs'
it('refuses still-generated/local videos, mismatched owner media and missing wildcard CORS before decoding', async () => {
  const fetchRemote = vi.fn(async () => ({
    ok: true,
    headers: new Headers({ 'content-type': 'video/mp4' }),
    arrayBuffer: async () => new ArrayBuffer(0),
  }))
  expect(
    await admitNativeVideo(
      {
        source: {
          url: 'https://artist.example/work',
          media_type: 'image',
          media_url: 'https://cdn.example/still.mp4',
        },
        binding: {
          source_url: 'https://artist.example/work',
          source_media_url: 'https://cdn.example/still.mp4',
          source_media_type: 'video',
        },
      },
      { fetchRemote },
    ),
  ).toBeNull()
  const source = {
      url: 'https://artist.example/work',
      media_type: 'video',
      media_url: 'https://cdn.example/native.mp4',
    },
    binding = { source_url: source.url, source_media_url: source.media_url, source_media_type: 'video' }
  expect(await admitNativeVideo({ source, binding }, { fetchRemote })).toBeNull()
  expect(fetchRemote).toHaveBeenCalledTimes(1)
  expect(
    await admitNativeVideo(
      {
        source: { ...source, media_url: '/review/generated.mp4' },
        binding: { ...binding, source_media_url: '/review/generated.mp4' },
      },
      { fetchRemote },
    ),
  ).toBeNull()
  expect(fetchRemote).toHaveBeenCalledTimes(1)
})
it('SYNTHETIC native video bytes really decode, advance and admit pixel-safe projection; a still cannot pass', async () => {
  const bytes = await fs.readFile('tests/fixtures/native-video-controls.webm')
  const source = {
    url: 'https://effects-fixture.example/work',
    media_type: 'video',
    media_url: 'https://effects-fixture.example/native.webm',
  }
  const binding = { source_url: source.url, source_media_type: 'video', source_media_url: source.media_url }
  const fetchRemote = async () =>
    new Response(bytes, { headers: { 'content-type': 'video/webm', 'access-control-allow-origin': '*' } })
  expect(await admitNativeVideo({ source, binding }, { fetchRemote })).toEqual({
    url: source.media_url,
    owner_url: source.url,
    verified_native: true,
    cors_safe: true,
  })
  const still = await fs.readFile(
    'public' +
      JSON.parse(await fs.readFile('public/editions/index.json', 'utf8')).editions[0].preview_asset_path,
  )
  expect(
    await admitNativeVideo(
      { source, binding },
      {
        fetchRemote: async () =>
          new Response(still, {
            headers: { 'content-type': 'video/webm', 'access-control-allow-origin': '*' },
          }),
      },
    ),
  ).toBeNull()
}, 15000)
