const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'metadata.google.internal',
  '169.254.169.254',
])

const isLocalHostname = (hostname) => {
  const normalized = hostname.toLowerCase()
  return BLOCKED_HOSTNAMES.has(normalized) || normalized.endsWith('.local') || normalized.endsWith('.internal')
}

const isPrivateIpv4 = (address) => {
  const parts = address.split('.').map((part) => Number(part))
  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part) || part < 0 || part > 255)) return false
  const [a, b] = parts
  if (a === 10) return true
  if (a === 127) return true
  if (a === 169 && b === 254) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 0) return true
  return false
}

const isPrivateIpv6 = (address) => {
  const normalized = address.toLowerCase()
  return normalized === '::1' || normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('fe80:')
}

const isIpLiteral = (hostname) => /^\d+\.\d+\.\d+\.\d+$/.test(hostname) || hostname.includes(':')

const isPrivateAddress = (address) => isPrivateIpv4(address) || isPrivateIpv6(address)

export async function resolveFetchableRemoteUrl(sourceUrl, { lookup } = {}) {
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
