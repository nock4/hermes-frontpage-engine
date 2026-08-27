function cleanupUrl(value) {
  return String(value || '')
    .replace(/[)>.,;:!?]+$/g, '')
    .replace(/&amp;/g, '&')
    .trim()
}

export function extractUrls(text) {
  const matches = String(text || '').match(/https?:\/\/[^\s<>"'`]+/g) || []
  return [...new Set(matches.map(cleanupUrl).filter((url) => {
    try {
      const parsed = new URL(url)
      return parsed.protocol === 'http:' || parsed.protocol === 'https:'
    } catch {
      return false
    }
  }))]
}

export function youtubeId(sourceUrl) {
  try {
    const url = new URL(sourceUrl)
    if (url.hostname.includes('youtu.be')) return url.pathname.split('/').filter(Boolean)[0] || null
    if (url.hostname.includes('youtube.com')) return url.searchParams.get('v') || url.pathname.match(/\/shorts\/([^/?]+)/)?.[1] || null
  } catch {
    return null
  }
  return null
}

function youtubeThumbnailId(sourceUrl) {
  try {
    const url = new URL(sourceUrl)
    const host = url.hostname.replace(/^www\./, '').toLowerCase()
    if (host !== 'i.ytimg.com' && host !== 'img.youtube.com') return null
    const parts = url.pathname.split('/').filter(Boolean)
    const viIndex = parts.indexOf('vi')
    return viIndex >= 0 ? parts[viIndex + 1] || null : null
  } catch {
    return null
  }
}

export function isYouTubeThumbnailUrl(sourceUrl) {
  return Boolean(youtubeThumbnailId(sourceUrl))
}

export function isYouTubeVideoUrl(sourceUrl) {
  return Boolean(youtubeId(sourceUrl)) && !isYouTubeThumbnailUrl(sourceUrl)
}

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'metadata.google.internal',
  '169.254.169.254',
])

function parseIpv4(address) {
  const parts = address.split('.').map((part) => Number(part))
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null
  return parts
}

function isBlockedIpv4(address) {
  const parts = parseIpv4(address)
  if (!parts) return false
  const [a, b] = parts
  if (a === 0) return true
  if (a === 10) return true
  if (a === 100 && b >= 64 && b <= 127) return true
  if (a === 127) return true
  if (a === 169 && b === 254) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 0) return true
  if (a === 192 && b === 168) return true
  if (a === 198 && (b === 18 || b === 19)) return true
  if (a >= 224) return true
  return false
}

function expandIpv6(address) {
  const normalized = address.replace(/^\[|\]$/g, '').toLowerCase()
  if (!normalized.includes(':')) return null
  const [leftRaw, rightRaw, extra] = normalized.split('::')
  if (extra !== undefined) return null
  const left = leftRaw ? leftRaw.split(':') : []
  const right = rightRaw ? rightRaw.split(':') : []
  const normalizeIpv4Tail = (parts) => {
    if (!parts.some((part) => part.includes('.'))) return parts
    const tail = parts[parts.length - 1]
    if (!tail || !tail.includes('.')) return null
    const ipv4 = parseIpv4(tail)
    if (!ipv4) return null
    return [
      ...parts.slice(0, -1),
      ((ipv4[0] << 8) | ipv4[1]).toString(16),
      ((ipv4[2] << 8) | ipv4[3]).toString(16),
    ]
  }
  const normalizedLeft = normalizeIpv4Tail(left)
  const normalizedRight = normalizeIpv4Tail(right)
  if (!normalizedLeft || !normalizedRight) return null
  const parsePart = (part) => {
    if (!/^[0-9a-f]{1,4}$/.test(part)) return null
    return Number.parseInt(part, 16)
  }
  const leftParts = normalizedLeft.map(parsePart)
  const rightParts = normalizedRight.map(parsePart)
  if (leftParts.some((part) => part === null) || rightParts.some((part) => part === null)) return null
  const missing = 8 - leftParts.length - rightParts.length
  if (normalized.includes('::')) {
    if (missing < 0) return null
    return [...leftParts, ...Array.from({ length: missing }, () => 0), ...rightParts]
  }
  if (missing !== 0) return null
  return leftParts
}

function ipv4FromMappedIpv6(parts) {
  if (parts.length !== 8) return null
  const isMapped = parts.slice(0, 5).every((part) => part === 0) && parts[5] === 0xffff
  const isCompatible = parts.slice(0, 6).every((part) => part === 0)
  if (!isMapped && !isCompatible) return null
  return `${parts[6] >> 8}.${parts[6] & 0xff}.${parts[7] >> 8}.${parts[7] & 0xff}`
}

function isBlockedIpv6(address) {
  const normalized = address.replace(/^\[|\]$/g, '').toLowerCase()
  const parts = expandIpv6(normalized)
  if (!parts) return false
  const mappedIpv4 = ipv4FromMappedIpv6(parts)
  if (mappedIpv4 && isBlockedIpv4(mappedIpv4)) return true
  if (parts.every((part) => part === 0)) return true
  if (parts.slice(0, 7).every((part) => part === 0) && parts[7] === 1) return true
  if ((parts[0] & 0xfe00) === 0xfc00) return true
  if ((parts[0] & 0xffc0) === 0xfe80) return true
  if ((parts[0] & 0xff00) === 0xff00) return true
  return false
}

function isBlockedSourceHostname(hostname) {
  const normalized = hostname.replace(/^\[|\]$/g, '').toLowerCase().replace(/\.+$/g, '')
  if (!normalized) return true
  if (BLOCKED_HOSTNAMES.has(normalized)) return true
  if (normalized.endsWith('.local') || normalized.endsWith('.internal')) return true
  if (/^\d+\.\d+\.\d+\.\d+$/.test(normalized)) return isBlockedIpv4(normalized)
  if (normalized.includes(':')) return isBlockedIpv6(normalized)
  return false
}

function isRejectedSourceUrl(value) {
  if (!value) return true
  try {
    const parsed = new URL(value)
    const host = parsed.hostname.toLowerCase()
    const pathname = parsed.pathname.toLowerCase()
    return !['http:', 'https:'].includes(parsed.protocol)
      || isBlockedSourceHostname(host)
      || host.replace(/\.+$/g, '') === 'nts.live'
      || host.replace(/\.+$/g, '').endsWith('.nts.live')
      || /\.(txt|md|markdown|json|xml|csv|tsv|ya?ml|log)(?:$|[?#])/.test(pathname)
      || pathname.includes('/llm.txt')
      || isYouTubeThumbnailUrl(value)
  } catch {
    return true
  }
}

export function isAllowedSourceUrl(value) {
  return !isRejectedSourceUrl(value)
}

export function isYouTubeSearchLocatorUrl(sourceUrl) {
  try {
    const url = new URL(sourceUrl)
    const host = url.hostname.replace(/^www\./, '').toLowerCase()
    return (host === 'youtube.com' || host === 'm.youtube.com' || host === 'music.youtube.com')
      && (url.pathname === '/results' || url.pathname === '/search')
  } catch {
    return false
  }
}

export function isBandcampStreamingSourceUrl(sourceUrl) {
  try {
    const url = new URL(sourceUrl)
    const host = url.hostname.replace(/^www\./, '').toLowerCase()
    if (host === 'bandcamp.com' || !host.endsWith('.bandcamp.com')) return false
    const path = url.pathname.toLowerCase()
    return path.startsWith('/track/') || path.startsWith('/album/')
  } catch {
    return false
  }
}

export function isSoundCloudStreamingSourceUrl(sourceUrl) {
  try {
    const url = new URL(sourceUrl)
    const host = url.hostname.replace(/^www\./, '').toLowerCase()
    if (host !== 'soundcloud.com') return false
    const [first, second] = url.pathname.split('/').filter(Boolean)
    return Boolean(first && second && first !== 'search' && first !== 'discover')
  } catch {
    return false
  }
}

export function isPreferredNtsStreamingSourceUrl(sourceUrl) {
  if (!sourceUrl || !isAllowedSourceUrl(sourceUrl)) return false
  if (isYouTubeSearchLocatorUrl(sourceUrl)) return false
  return isYouTubeVideoUrl(sourceUrl)
    || isBandcampStreamingSourceUrl(sourceUrl)
    || isSoundCloudStreamingSourceUrl(sourceUrl)
}

export function ntsStreamingSourceRank(sourceUrl) {
  if (isYouTubeVideoUrl(sourceUrl)) return 0
  if (isBandcampStreamingSourceUrl(sourceUrl)) return 1
  if (isSoundCloudStreamingSourceUrl(sourceUrl)) return 2
  return 9
}

function parseSourceUrl(value) {
  if (!value) return null
  try {
    return new URL(value)
  } catch {
    return null
  }
}

export function hostnameForUrl(value) {
  const parsed = parseSourceUrl(value)
  return parsed?.hostname.replace(/^www\./, '').toLowerCase() || ''
}

export function canonicalizeSourceUrl(value) {
  const parsed = parseSourceUrl(value)
  if (!parsed) return String(value || '').trim().toLowerCase()

  let hostname = parsed.hostname.replace(/^www\./, '').toLowerCase()
  if (hostname === 'twitter.com') hostname = 'x.com'

  let pathname = parsed.pathname.replace(/\/+$/, '') || '/'
  const statusMatch = pathname.match(/^\/([^/]+)\/status\/(\d+)/)
  if ((hostname === 'x.com' || hostname === 'mobile.x.com') && statusMatch) {
    pathname = `/${statusMatch[1]}/status/${statusMatch[2]}`
    hostname = 'x.com'
  }

  if (hostname === 'pbs.twimg.com' && pathname.startsWith('/media/')) {
    pathname = pathname.replace(/:(?:orig|large|small|medium|thumb)$/i, '')
    return `${hostname}${pathname}`.toLowerCase()
  }

  const thumbnailVideoId = youtubeThumbnailId(value)
  if (thumbnailVideoId) return `youtube.com/watch/${thumbnailVideoId}`.toLowerCase()

  const videoId = youtubeId(value)
  if (videoId) return `youtube.com/watch/${videoId}`.toLowerCase()

  return `${hostname}${pathname}`.toLowerCase()
}
