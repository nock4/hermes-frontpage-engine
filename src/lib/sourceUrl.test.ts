import { describe, expect, it, vi } from 'vitest'

import { sanitizeSourceImageUrl, sanitizeSourceUrl } from './sourceUrl'

describe('sanitizeSourceUrl', () => {
  it('keeps public http and https urls', () => {
    expect(sanitizeSourceUrl('https://example.com/story')).toBe('https://example.com/story')
    expect(sanitizeSourceUrl('http://example.com/story')).toBe('http://example.com/story')
  })

  it('rejects javascript and data urls', () => {
    expect(sanitizeSourceUrl('javascript:alert(1)')).toBeNull()
    expect(sanitizeSourceUrl('data:text/html,<script>alert(1)</script>')).toBeNull()
  })

  it('rejects malformed and private-host urls', () => {
    expect(sanitizeSourceUrl('not a url')).toBeNull()
    expect(sanitizeSourceUrl('http://localhost:3000/test')).toBeNull()
    expect(sanitizeSourceUrl('http://127.0.0.1/test')).toBeNull()
    expect(sanitizeSourceUrl('http://192.168.1.10/test')).toBeNull()
    expect(sanitizeSourceUrl('http://devbox.local/test')).toBeNull()
    expect(sanitizeSourceUrl('http://metadata.google.internal/test')).toBeNull()
    expect(sanitizeSourceUrl('http://localhost./test')).toBeNull()
    expect(sanitizeSourceUrl('http://devbox.local./test')).toBeNull()
    expect(sanitizeSourceUrl('http://metadata.google.internal./test')).toBeNull()
  })

  it('rejects mapped and special-use IP literal forms', () => {
    expect(sanitizeSourceUrl('http://[::ffff:127.0.0.1]/test')).toBeNull()
    expect(sanitizeSourceUrl('http://[::ffff:c0a8:010a]/test')).toBeNull()
    expect(sanitizeSourceUrl('http://[fc00::1]/test')).toBeNull()
    expect(sanitizeSourceUrl('http://100.64.0.1/test')).toBeNull()
    expect(sanitizeSourceUrl('http://198.18.0.1/test')).toBeNull()
    expect(sanitizeSourceUrl('https://[2606:2800:220:1:248:1893:25c8:1946]/story')).not.toBeNull()
  })
})

describe('sanitizeSourceImageUrl', () => {
  it('keeps public absolute image urls', () => {
    expect(sanitizeSourceImageUrl('https://images.example.com/story.jpg')).toBe('https://images.example.com/story.jpg')
  })

  it('allows same-origin relative asset paths', () => {
    vi.stubGlobal('location', { origin: 'https://frontpage.example' } as Location)
    expect(sanitizeSourceImageUrl('/editions/test/assets/source.jpg')).toBe('https://frontpage.example/editions/test/assets/source.jpg')
    vi.unstubAllGlobals()
  })

  it('rejects private-host and non-http image urls', () => {
    expect(sanitizeSourceImageUrl('http://localhost:3000/source.jpg')).toBeNull()
    expect(sanitizeSourceImageUrl('http://169.254.169.254/source.jpg')).toBeNull()
    expect(sanitizeSourceImageUrl('file:///tmp/source.jpg')).toBeNull()
  })
})
