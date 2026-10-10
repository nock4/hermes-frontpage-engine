import { afterEach, expect, it, vi } from 'vitest'
import { fetchVettedImage } from '../../scripts/lib/fetch-vetted-image.mjs'
import { fetchVettedRemoteUrl } from '../../scripts/lib/source-image-network-policy.mjs'
vi.mock('../../scripts/lib/source-image-network-policy.mjs', () => ({ fetchVettedRemoteUrl: vi.fn() }))
afterEach(() => vi.clearAllMocks())
it('returns the complete cross-host redirect identity chain', async () => {
  const urls = ['https://original.example/art.jpg', 'https://relay.example/art.jpg', 'https://cdn.example/art.jpg']
  fetchVettedRemoteUrl.mockImplementation(async url => url === urls[2]
    ? new Response('pixels', { headers: { 'content-type': 'image/jpeg' } })
    : new Response('', { status: 302, headers: { location: urls[urls.indexOf(url) + 1] } }))
  const result = await fetchVettedImage(urls[0])
  expect(result.imageUrls).toEqual(urls)
})
it('permits three redirects but fails closed on a fourth', async () => {
  fetchVettedRemoteUrl.mockImplementation(async url => new Response('', { status: 302, headers: { location: `${url}x` } }))
  await expect(fetchVettedImage('https://images.example/a.jpg')).rejects.toThrow('redirect limit')
  expect(fetchVettedRemoteUrl).toHaveBeenCalledTimes(4)
})
it('counts redirect bodies against the cumulative byte ceiling', async () => {
  fetchVettedRemoteUrl.mockResolvedValueOnce(new Response('1234', { status: 301, headers: { location: '/b.jpg' } }))
    .mockResolvedValueOnce(new Response('5678', { headers: { 'content-type': 'image/jpeg' } }))
  await expect(fetchVettedImage('https://images.example/a.jpg', { maxBytes: 7 })).rejects.toThrow('total bytes')
  expect(fetchVettedRemoteUrl.mock.calls[1][1].maxBytes).toBe(3)
})
it('bounds stalled DNS/transport with one deadline and aborts the in-flight request', async () => {
  let signal
  fetchVettedRemoteUrl.mockImplementation(async (_url, options) => { signal = options.signal; return new Promise(() => {}) })
  await expect(fetchVettedImage('https://images.example/a.jpg', { timeoutMs: 10 })).rejects.toThrow('timed out')
  expect(signal.aborted).toBe(true)
})
it.each([null, '', '/x\\y', '/x%no', '/x\ny'])('rejects malformed Location %j', async location => {
  fetchVettedRemoteUrl.mockResolvedValue({ status: 302, arrayBuffer: async () => new ArrayBuffer(0), headers: { get: () => location } })
  await expect(fetchVettedImage('https://images.example/a.jpg')).rejects.toThrow('Location')
  expect(fetchVettedRemoteUrl).toHaveBeenCalledOnce()
})
