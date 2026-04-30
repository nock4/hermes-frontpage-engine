import { describe, expect, it, vi } from 'vitest'

import {
  resolveFetchableHtmlUrl,
  resolveFetchableImageUrl,
} from '../../scripts/lib/source-image-network-policy.mjs'

describe('source-image-network-policy', () => {
  it('allows normal public https urls', async () => {
    const lookup = vi.fn(async () => [{ address: '93.184.216.34', family: 4 }])

    await expect(resolveFetchableHtmlUrl('https://example.com/story', { lookup })).resolves.toBe('https://example.com/story')
    await expect(resolveFetchableImageUrl('https://images.example.com/story.jpg', { lookup })).resolves.toBe('https://images.example.com/story.jpg')
  })

  it('rejects localhost and private ip literals', async () => {
    const lookup = vi.fn()

    await expect(resolveFetchableHtmlUrl('http://127.0.0.1:8080/', { lookup })).resolves.toBeNull()
    await expect(resolveFetchableHtmlUrl('http://192.168.1.10/', { lookup })).resolves.toBeNull()
    await expect(resolveFetchableImageUrl('http://[::1]/private.jpg', { lookup })).resolves.toBeNull()
    expect(lookup).not.toHaveBeenCalled()
  })

  it('rejects non-http protocols', async () => {
    const lookup = vi.fn()

    await expect(resolveFetchableHtmlUrl('file:///etc/passwd', { lookup })).resolves.toBeNull()
    await expect(resolveFetchableImageUrl('javascript:alert(1)', { lookup })).resolves.toBeNull()
  })

  it('rejects hostnames that resolve to private or loopback addresses', async () => {
    const lookup = vi.fn(async () => [{ address: '127.0.0.1', family: 4 }])

    await expect(resolveFetchableHtmlUrl('https://internal.example/', { lookup })).resolves.toBeNull()
    await expect(resolveFetchableImageUrl('https://images.internal.example/private.jpg', { lookup })).resolves.toBeNull()
  })

  it('rejects metadata and localhost-style hostnames', async () => {
    const lookup = vi.fn()

    await expect(resolveFetchableHtmlUrl('http://localhost:3000/', { lookup })).resolves.toBeNull()
    await expect(resolveFetchableHtmlUrl('http://169.254.169.254/latest/meta-data/', { lookup })).resolves.toBeNull()
    await expect(resolveFetchableImageUrl('http://devbox.local/private.jpg', { lookup })).resolves.toBeNull()
  })
})
