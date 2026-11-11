// Object storage for the press: one tiny interface, two backends.
//   LocalStore  a directory laid out exactly like the bucket (tests, local runs)
//   R2Store     Cloudflare R2 over its S3 API, signed with SigV4 (no SDK dependency)
// Keys are bucket keys such as "editions/index.json". A prefix (e.g. "shadow/")
// namespaces a whole press without touching the live keys.

import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

const TYPES = {
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
}

export function contentTypeForKey(key) {
  return TYPES[path.extname(key).toLowerCase()] || 'application/octet-stream'
}

function assertKey(key) {
  if (typeof key !== 'string' || !key || key.startsWith('/') || key.split('/').some((part) => part === '..' || part === '')) {
    throw new Error(`Invalid store key: ${JSON.stringify(key)}`)
  }
}

class BaseStore {
  constructor(prefix = '') {
    this.prefix = prefix
  }

  async getJson(key) {
    const body = await this.get(key)
    return body ? JSON.parse(body.toString('utf8')) : null
  }

  async putJson(key, value) {
    await this.put(key, Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8'))
  }
}

export class LocalStore extends BaseStore {
  constructor(root, prefix = '') {
    super(prefix)
    this.root = path.resolve(root)
  }

  describe() {
    return `local:${this.root}/${this.prefix}`
  }

  file(key) {
    assertKey(key)
    return path.join(this.root, this.prefix, key)
  }

  async get(key) {
    try { return await fs.readFile(this.file(key)) } catch (error) { if (error.code === 'ENOENT') return null; throw error }
  }

  async put(key, body) {
    const file = this.file(key)
    await fs.mkdir(path.dirname(file), { recursive: true })
    const temporary = `${file}.${process.pid}.tmp`
    await fs.writeFile(temporary, body)
    await fs.rename(temporary, file)
  }

  async delete(key) {
    await fs.rm(this.file(key), { force: true })
  }
}

const sha256Hex = (data) => crypto.createHash('sha256').update(data).digest('hex')
const hmac = (key, data) => crypto.createHmac('sha256', key).update(data).digest()
const encodeSegment = (segment) => encodeURIComponent(segment).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)

export class R2Store extends BaseStore {
  constructor({ accountId, bucket, accessKeyId, secretAccessKey, prefix = '', fetchImpl = fetch }) {
    super(prefix)
    for (const [name, value] of Object.entries({ accountId, bucket, accessKeyId, secretAccessKey })) {
      if (!value) throw new Error(`R2Store requires ${name}`)
    }
    Object.assign(this, { accountId, bucket, accessKeyId, secretAccessKey, fetchImpl })
    this.host = `${accountId}.r2.cloudflarestorage.com`
  }

  describe() {
    return `r2:${this.bucket}/${this.prefix}`
  }

  sign(method, key, body, extraHeaders = {}) {
    assertKey(key)
    const now = new Date()
    const amzDate = now.toISOString().replace(/[-:]|\.\d{3}/g, '')
    const day = amzDate.slice(0, 8)
    const canonicalUri = `/${[this.bucket, ...`${this.prefix}${key}`.split('/')].map(encodeSegment).join('/')}`
    const payloadHash = sha256Hex(body || '')
    const headers = { host: this.host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate, ...extraHeaders }
    const names = Object.keys(headers).map((name) => name.toLowerCase()).sort()
    const canonicalHeaders = names.map((name) => `${name}:${String(headers[name]).trim()}\n`).join('')
    const signedHeaders = names.join(';')
    const canonicalRequest = [method, canonicalUri, '', canonicalHeaders, signedHeaders, payloadHash].join('\n')
    const scope = `${day}/auto/s3/aws4_request`
    const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonicalRequest)].join('\n')
    const signingKey = hmac(hmac(hmac(hmac(`AWS4${this.secretAccessKey}`, day), 'auto'), 's3'), 'aws4_request')
    const signature = crypto.createHmac('sha256', signingKey).update(stringToSign).digest('hex')
    const { host, ...sendHeaders } = headers
    return {
      url: `https://${this.host}${canonicalUri}`,
      headers: { ...sendHeaders, authorization: `AWS4-HMAC-SHA256 Credential=${this.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}` },
    }
  }

  async request(method, key, body, extraHeaders) {
    let lastError
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        const { url, headers } = this.sign(method, key, body, extraHeaders)
        const response = await this.fetchImpl(url, { method, headers, body, signal: AbortSignal.timeout(60_000) })
        if (response.status >= 500) throw new Error(`R2 ${method} ${key} failed with ${response.status}`)
        return response
      } catch (error) {
        lastError = error
        if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 1500))
      }
    }
    throw lastError
  }

  async get(key) {
    const response = await this.request('GET', key)
    if (response.status === 404) return null
    if (!response.ok) throw new Error(`R2 GET ${key} failed with ${response.status}`)
    return Buffer.from(await response.arrayBuffer())
  }

  async put(key, body) {
    const response = await this.request('PUT', key, body, { 'content-type': contentTypeForKey(key) })
    if (!response.ok) throw new Error(`R2 PUT ${key} failed with ${response.status}`)
  }

  async delete(key) {
    const response = await this.request('DELETE', key)
    if (!response.ok && response.status !== 404) throw new Error(`R2 DELETE ${key} failed with ${response.status}`)
  }
}

// PRESS_STORE=local:<dir> or PRESS_STORE=r2 (default when R2 credentials are set).
export function storeFromEnv(env = process.env) {
  const prefix = env.PRESS_PREFIX || ''
  if (prefix && !prefix.endsWith('/')) throw new Error('PRESS_PREFIX must end with "/"')
  const target = env.PRESS_STORE || (env.R2_ACCESS_KEY_ID ? 'r2' : '')
  if (target.startsWith('local:')) return new LocalStore(target.slice('local:'.length), prefix)
  if (target === 'r2') {
    return new R2Store({
      accountId: env.R2_ACCOUNT_ID,
      bucket: env.R2_BUCKET,
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY,
      prefix,
    })
  }
  throw new Error('No store configured: set PRESS_STORE=local:<dir>, or PRESS_STORE=r2 with R2_ACCOUNT_ID, R2_BUCKET, R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY')
}
