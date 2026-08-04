import dns from 'node:dns/promises'
import http from 'node:http'
import https from 'node:https'

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

async function resolvePublicRemote(sourceUrl, { lookup = dns.lookup } = {}) {
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
    return isPrivateAddress(hostname) ? null : { url, hostname, address: hostname, family: hostname.includes(':') ? 6 : 4 }
  }

  if (!lookup) return null

  try {
    const records = await lookup(hostname, { all: true })
    if (!Array.isArray(records) || records.length === 0) return null
    if (records.some((record) => isPrivateAddress(record.address))) return null
    const pinned = records.find((record) => !isPrivateAddress(record.address))
    return pinned ? { url, hostname, address: pinned.address, family: pinned.family || (pinned.address.includes(':') ? 6 : 4) } : null
  } catch {
    return null
  }
}

async function resolveFetchableRemoteUrl(sourceUrl, options = {}) {
  const resolved = await resolvePublicRemote(sourceUrl, options)
  return resolved ? resolved.url.toString() : null
}

class VettedResponse {
  constructor({ status, statusText, headers, body }) {
    this.status = status
    this.statusText = statusText || ''
    this.ok = status >= 200 && status < 300
    this.headers = {
      get: (name) => headers[String(name || '').toLowerCase()] ?? null,
    }
    this._body = body
  }

  async text() {
    return this._body.toString('utf8')
  }

  async arrayBuffer() {
    const buffer = this._body
    return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
  }

  async json() {
    return JSON.parse(await this.text())
  }
}

export async function fetchVettedRemoteUrl(sourceUrl, {
  lookup = dns.lookup,
  headers = {},
  method = 'GET',
  timeoutMs = 8000,
  maxBytes = 5_000_000,
} = {}) {
  const resolved = await resolvePublicRemote(sourceUrl, { lookup })
  if (!resolved) return null

  const { url, hostname, address, family } = resolved

  if (process.env.NODE_ENV === 'test' && process.env.DFE_TEST_USE_GLOBAL_FETCH === '1') {
    return fetch(url.toString(), {
      method,
      headers,
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs),
    })
  }

  const transport = url.protocol === 'https:' ? https : http

  return new Promise((resolve, reject) => {
    let settled = false
    const request = transport.request({
      protocol: url.protocol,
      hostname,
      port: url.port || undefined,
      path: `${url.pathname}${url.search}`,
      method,
      headers,
      servername: hostname,
      lookup: (_hostname, options, callback) => {
        if (options?.all) {
          callback(null, [{ address, family }])
          return
        }
        callback(null, address, family)
      },
    }, (response) => {
      const chunks = []
      let total = 0
      response.on('data', (chunk) => {
        total += chunk.length
        if (total > maxBytes) {
          request.destroy(new Error(`Response exceeded ${maxBytes} bytes`))
          return
        }
        chunks.push(chunk)
      })
      response.on('end', () => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        const normalizedHeaders = Object.fromEntries(
          Object.entries(response.headers).map(([key, value]) => [key.toLowerCase(), Array.isArray(value) ? value.join(', ') : String(value ?? '')]),
        )
        resolve(new VettedResponse({
          status: response.statusCode || 0,
          statusText: response.statusMessage || '',
          headers: normalizedHeaders,
          body: Buffer.concat(chunks),
        }))
      })
    })

    const timer = setTimeout(() => {
      request.destroy(new Error(`Fetch timed out after ${timeoutMs}ms`))
    }, timeoutMs)

    request.on('error', (error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(error)
    })
    request.end()
  })
}

export async function resolveFetchableHtmlUrl(sourceUrl, options = {}) {
  return resolveFetchableRemoteUrl(sourceUrl, options)
}

export async function resolveFetchableImageUrl(sourceUrl, options = {}) {
  return resolveFetchableRemoteUrl(sourceUrl, options)
}
