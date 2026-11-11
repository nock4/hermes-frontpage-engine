#!/usr/bin/env node
// Local stand-in for Cloudflare Pages: serves the built viewer (dist/) and runs
// the real Pages Function for /editions/* against a local bucket directory.
//
//   npm run build && node press/serve.mjs --bucket <dir> [--prefix shadow/] [--port 4175] [--dist dist]
//
// Use it to look at what the press produced before anything touches R2.

import fs from 'node:fs/promises'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { LocalStore, contentTypeForKey } from './lib/store.mjs'

const repoRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const STATIC_TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.txt': 'text/plain' }

// R2 bucket binding lookalike over a directory.
export function localBucket(root) {
  const store = new LocalStore(root)
  return {
    async get(key) {
      let body
      try { body = await store.get(key) } catch { return null }
      if (!body) return null
      return { body, httpEtag: `"${body.length.toString(16)}-${key.length.toString(16)}"` }
    },
  }
}

// env.ASSETS lookalike: static files from dist with single-page-app fallback.
export function staticAssets(distDir) {
  const root = path.resolve(distDir)
  return {
    async fetch(request) {
      const pathname = decodeURIComponent(new URL(request.url).pathname)
      const file = path.join(root, pathname)
      if (file.startsWith(root)) {
        try {
          const stat = await fs.stat(file)
          if (stat.isFile()) {
            const type = STATIC_TYPES[path.extname(file).toLowerCase()] || contentTypeForKey(file)
            return new Response(request.method === 'HEAD' ? null : await fs.readFile(file), { headers: { 'content-type': type } })
          }
        } catch { /* fall through to the app shell */ }
      }
      return new Response(await fs.readFile(path.join(root, 'index.html')), { headers: { 'content-type': STATIC_TYPES['.html'] } })
    },
  }
}

export async function createHandler({ bucketDir, distDir, prefix = '' }) {
  const { onRequest } = await import(pathToFileURL(path.join(repoRoot, 'functions/editions/[[path]].js')).href)
  const env = { ASSETS: staticAssets(distDir), ...(bucketDir ? { EDITIONS_BUCKET: localBucket(bucketDir) } : {}), EDITIONS_PREFIX: prefix }
  return async (request) => (new URL(request.url).pathname.startsWith('/editions/') ? onRequest({ request, env }) : env.ASSETS.fetch(request))
}

export async function startServer({ bucketDir, distDir = path.join(repoRoot, 'dist'), prefix = '', port = 4175, host = '127.0.0.1' }) {
  const handle = await createHandler({ bucketDir, distDir, prefix })
  const server = http.createServer(async (incoming, outgoing) => {
    try {
      const response = await handle(new Request(`http://${incoming.headers.host}${incoming.url}`, { method: incoming.method, headers: incoming.headers }))
      outgoing.writeHead(response.status, Object.fromEntries(response.headers))
      outgoing.end(Buffer.from(await response.arrayBuffer()))
    } catch (error) {
      outgoing.writeHead(500, { 'content-type': 'text/plain' })
      outgoing.end(error.message)
    }
  })
  await new Promise((resolve) => server.listen(port, host, resolve))
  return server
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  const option = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback)
  const port = Number(option('--port', '4175'))
  const bucketDir = option('--bucket', '')
  await startServer({ bucketDir, distDir: option('--dist', path.join(repoRoot, 'dist')), prefix: option('--prefix', ''), port })
  console.log(`press: viewer at http://127.0.0.1:${port}/ (bucket: ${bucketDir || 'none, static only'})`)
}
