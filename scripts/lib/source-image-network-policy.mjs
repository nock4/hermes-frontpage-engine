const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'metadata.google.internal',
  '169.254.169.254',
])

const isLocalHostname = (hostname) => {
  const normalized = hostname.toLowerCase().replace(/\.+$/g, '')
  return BLOCKED_HOSTNAMES.has(normalized) || normalized.endsWith('.local') || normalized.endsWith('.internal')
}

const parseIpv4 = (address) => {
  const parts = address.split('.').map((part) => Number(part))
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null
  return parts
}

const isBlockedIpv4 = (address) => {
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

const expandIpv6 = (address) => {
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

const ipv4FromMappedIpv6 = (parts) => {
  if (parts.length !== 8) return null
  const isMapped = parts.slice(0, 5).every((part) => part === 0) && parts[5] === 0xffff
  const isCompatible = parts.slice(0, 6).every((part) => part === 0)
  if (!isMapped && !isCompatible) return null
  return `${parts[6] >> 8}.${parts[6] & 0xff}.${parts[7] >> 8}.${parts[7] & 0xff}`
}

const isBlockedIpv6 = (address) => {
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

const isIpLiteral = (hostname) => /^\d+\.\d+\.\d+\.\d+$/.test(hostname) || hostname.includes(':')

const isPrivateAddress = (address) => isBlockedIpv4(address) || isBlockedIpv6(address)

async function resolveFetchableRemoteUrl(sourceUrl, { lookup } = {}) {
  if (!sourceUrl) return null

  let url
  try {
    url = new URL(sourceUrl)
  } catch {
    return null
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null

  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (!hostname || isLocalHostname(hostname)) return null

  if (isIpLiteral(hostname)) {
    return isPrivateAddress(hostname) ? null : url.toString()
  }

  if (!lookup) return url.toString()

  try {
    const records = await lookup(hostname, { all: true })
    if (!Array.isArray(records) || records.length === 0) return null
    if (records.some((record) => isPrivateAddress(record.address))) return null
  } catch {
    return null
  }

  return url.toString()
}

export async function resolveFetchableHtmlUrl(sourceUrl, options = {}) {
  return resolveFetchableRemoteUrl(sourceUrl, options)
}

export async function resolveFetchableImageUrl(sourceUrl, options = {}) {
  return resolveFetchableRemoteUrl(sourceUrl, options)
}
