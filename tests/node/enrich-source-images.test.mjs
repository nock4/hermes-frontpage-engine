import { expect, it } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const script = fileURLToPath(new URL('../../scripts/enrich-source-images.mjs', import.meta.url))
// Replace DNS/socket I/O only: the subprocess runs production enrichment and
// the real vetted response reader, including its byte ceiling and MIME gates.
const preload = `
import dns from 'node:dns/promises'
import http from 'node:http'
import https from 'node:https'
import fs from 'node:fs'
import { EventEmitter } from 'node:events'
import { Readable } from 'node:stream'
dns.lookup = async host => [{ address: host === 'private.example' ? '127.0.0.1' : '93.184.216.34', family: 4 }]
const request = (options, callback) => {
  const req = new EventEmitter()
  req.destroy = error => queueMicrotask(() => req.emit('error', error))
  req.end = () => queueMicrotask(() => {
    options.lookup(options.hostname, { all: true }, (error, addresses) => {
      if (error || addresses[0].address !== '93.184.216.34') throw new Error('Request not publicly pinned')
    })
    const headers = Object.fromEntries(Object.entries(options.headers).map(([key, value]) => [key.toLowerCase(), value]))
    const denied = Boolean(headers['user-agent']) || options.path === '/denied.jpg'
    const page = !options.path.endsWith('.jpg')
    const body = denied ? 'Forbidden' : page
      ? options.path === '/work' ? '<meta property="og:image" content="/art.jpg">' : '<html>No preview</html>'
      : options.path === '/oversized.jpg' ? 'x'.repeat(8193) : 'image fixture bytes'
    const response = Readable.from([Buffer.from(body)])
    response.statusCode = denied ? 403 : page ? 200 : 206
    response.headers = { 'content-type': denied || page || options.path === '/wrong-type.jpg' ? 'text/html' : 'image/jpeg' }
    fs.appendFileSync('requests.jsonl', JSON.stringify({ path: options.path, headers, status: response.statusCode }) + '\\n')
    callback(response)
  })
  return req
}
http.request = https.request = request
`

async function enrich(binding) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'enrichment-identity-'))
  try {
    const edition = path.join(root, 'public/editions/fixture')
    await fs.mkdir(edition, { recursive: true })
    await fs.writeFile(path.join(root, 'public/editions/index.json'), JSON.stringify({ editions: [{ edition_id: 'fixture', path: '/editions/fixture' }] }))
    await fs.writeFile(path.join(edition, 'source-bindings.json'), JSON.stringify({ bindings: [binding] }))
    await fs.writeFile(path.join(root, 'transport.mjs'), preload)
    const stdout = execFileSync(process.execPath, ['--import', path.join(root, 'transport.mjs'), script, '--edition', 'fixture'], {
      cwd: root,
      env: { ...process.env, NODE_ENV: 'test', DFE_TEST_USE_GLOBAL_FETCH: '0', NODE_OPTIONS: '' },
      timeout: 15000,
      encoding: 'utf8',
    })
    const output = JSON.parse(await fs.readFile(path.join(edition, 'source-bindings.json'), 'utf8'))
    const requests = (await fs.readFile(path.join(root, 'requests.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse)
    return { binding: output.bindings[0], requests, summary: JSON.parse(stdout) }
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
}

it('preserves an existing healthy descriptor with ordinary image-health identity', async () => {
  const binding = { source_url: 'https://gallery.example/empty', source_image_url: 'https://gallery.example/art.jpg', source_image_alt: 'Original artwork' }
  const result = await enrich(binding)
  expect(result.binding).toEqual(binding)
  expect(result.summary).toEqual({ updatedBindings: 0, updatedEditions: [] })
  expect(result.requests).toEqual([{ path: '/art.jpg', status: 206, headers: {
    accept: 'image/avif,image/webp,image/png,image/jpeg,image/*,*/*;q=0.5', range: 'bytes=0-4095',
  } }])
})

it('enriches owning-page metadata using the same ordinary identity as image health', async () => {
  const result = await enrich({ source_url: 'https://gallery.example/work' })
  expect(result.binding.source_image_url).toBe('https://gallery.example/art.jpg')
  expect(result.summary).toEqual({ updatedBindings: 1, updatedEditions: ['fixture'] })
  expect(result.requests.map(request => request.path)).toEqual(['/work', '/art.jpg'])
  expect(result.requests.every(request => !request.headers['user-agent'])).toBe(true)
  expect(result.requests[0].headers).toEqual({ accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8' })
  expect(result.requests[1].headers.range).toBe('bytes=0-4095')
})

it.each([
  'https://gallery.example/denied.jpg',
  'https://gallery.example/wrong-type.jpg',
  'https://gallery.example/oversized.jpg',
  'https://private.example/art.jpg',
  'https://gallery.example/art.svg',
])('still clears an unusable descriptor without identity retries: %s', async image => {
  const result = await enrich({ source_url: 'https://gallery.example/empty', source_image_url: image, source_image_alt: 'Unusable' })
  expect(result.binding).toEqual({ source_url: 'https://gallery.example/empty' })
  expect(result.summary).toEqual({ updatedBindings: 1, updatedEditions: ['fixture'] })
  const imageRequests = result.requests.filter(request => request.path.endsWith('.jpg') || request.path.endsWith('.svg'))
  expect(imageRequests).toHaveLength(image.includes('private.example') || image.endsWith('.svg') ? 0 : 1)
  expect(result.requests.every(request => !request.headers['user-agent'])).toBe(true)
  if (imageRequests.length) expect(imageRequests[0].status).toBe(image.endsWith('/denied.jpg') ? 403 : 206)
})
