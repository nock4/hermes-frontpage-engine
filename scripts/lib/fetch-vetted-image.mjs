import { fetchVettedRemoteUrl } from './source-image-network-policy.mjs'

// Image health and pixel capture share the same bounded, DNS-pinned transport.
// Use Node's ordinary default request identity (no invented browser/bot UA),
// consistently with full-byte capture. No retries with alternate identities.
export async function fetchVettedImage(sourceUrl, { lookup, headers = {}, timeoutMs = 8000, maxBytes = 8_000_000 } = {}) {
  timeoutMs = Math.min(8000, Math.max(1, timeoutMs))
  maxBytes = Math.min(8_000_000, Math.max(1, maxBytes))
  const controller = new AbortController()
  let timer
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error(`Image fetch timed out after ${timeoutMs}ms`)
      controller.abort(error); reject(error)
    }, timeoutMs)
  })
  const follow = async () => {
    let finalUrl = sourceUrl, remainingBytes = maxBytes
    const visited = new Set()
    for (let redirects = 0; ; redirects += 1) {
      controller.signal.throwIfAborted()
      const url = new URL(finalUrl)
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Unsafe image URL')
      url.hash = ''
      finalUrl = url.href
      if (visited.has(finalUrl)) throw new Error('Image redirect loop')
      visited.add(finalUrl)
      const response = await fetchVettedRemoteUrl(finalUrl, { lookup, headers, timeoutMs, maxBytes: remainingBytes, signal: controller.signal })
      if (!response) throw new Error('Blocked image URL')
      const body = Buffer.from(await response.arrayBuffer())
      remainingBytes -= body.length
      if (remainingBytes < 0) throw new Error(`Response exceeded ${maxBytes} total bytes`)
      if (![301, 302, 303, 307, 308].includes(response.status)) return { response, finalUrl, body, imageUrls: [...visited] }
      if (redirects >= 3) throw new Error('Image redirect limit exceeded')
      const location = response.headers.get('location')
      if (typeof location !== 'string' || !location.trim() || /[\u0000-\u0020\u007f\\]/.test(location) || /%(?![0-9a-f]{2})/i.test(location)) throw new Error('Missing or malformed redirect Location')
      finalUrl = new URL(location, finalUrl).href
    }
  }
  try { return await Promise.race([follow(), deadline]) }
  finally { clearTimeout(timer) }
}
