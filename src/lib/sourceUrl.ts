const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'metadata.google.internal',
  '169.254.169.254',
])

const isLocalHostname = (hostname: string) => {
  const normalized = hostname.toLowerCase()
  return BLOCKED_HOSTNAMES.has(normalized) || normalized.endsWith('.local') || normalized.endsWith('.internal')
}

const isPrivateIpv4 = (address: string) => {
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

const isPrivateIpv6 = (address: string) => {
  const normalized = address.toLowerCase()
  return normalized === '::1' || normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('fe80:')
}

const isIpLiteral = (hostname: string) => /^\d+\.\d+\.\d+\.\d+$/.test(hostname) || hostname.includes(':')

const isBlockedRemoteHostname = (hostname: string) => {
  const normalized = hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (!normalized) return true
  if (isLocalHostname(normalized)) return true
  if (isIpLiteral(normalized)) return isPrivateIpv4(normalized) || isPrivateIpv6(normalized)
  return false
}

const sanitizeHttpUrl = (
  value: string | null | undefined,
  { allowRelative = false, allowPrivateHosts = false }: { allowRelative?: boolean; allowPrivateHosts?: boolean } = {},
): string | null => {
  if (!value) return null

  try {
    const baseOrigin = allowRelative ? (globalThis.location?.origin ?? 'https://runtime-warmup.local') : undefined
    const url = baseOrigin ? new URL(value, baseOrigin) : new URL(value)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
    if (!allowPrivateHosts && isBlockedRemoteHostname(url.hostname)) return null
    return url.toString()
  } catch {
    return null
  }
}

export const sanitizeSourceUrl = (value: string | null | undefined): string | null => (
  sanitizeHttpUrl(value, { allowRelative: false, allowPrivateHosts: false })
)

export const sanitizeSourceImageUrl = (value: string | null | undefined): string | null => (
  sanitizeHttpUrl(value, { allowRelative: true, allowPrivateHosts: false })
)
