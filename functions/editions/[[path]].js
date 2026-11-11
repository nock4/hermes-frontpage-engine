// Cloudflare Pages Function: serve /editions/* from R2 when a bucket is bound.
//
// The switch is the binding. With no EDITIONS_BUCKET binding (today's production)
// every request falls through to the static files built from public/editions, so
// merging this changes nothing. Bind a bucket and any file present in R2 wins;
// anything missing still falls back to the static copy.
//
// Bindings (Pages project settings):
//   EDITIONS_BUCKET  R2 bucket binding (optional)
//   EDITIONS_PREFIX  plain variable, e.g. "shadow/" to preview the shadow press (optional)

import { INDEX_KEY, PARKED_KEY, mergeParked } from '../../shared/edition-index.js'

const TYPES = {
  json: 'application/json; charset=utf-8',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  mp4: 'video/mp4',
  webm: 'video/webm',
}

function contentType(key) {
  return TYPES[key.split('.').pop().toLowerCase()] || 'application/octet-stream'
}

async function readJson(bucket, key) {
  const object = await bucket.get(key)
  if (!object) return null
  try { return JSON.parse(await new Response(object.body).text()) } catch { return null }
}

async function manifestResponse({ request, env, bucket, prefix }) {
  let index = await readJson(bucket, `${prefix}${INDEX_KEY}`)
  if (!index) {
    const fallback = await env.ASSETS.fetch(request)
    if (!fallback.ok) return fallback
    try { index = await fallback.clone().json() } catch { return fallback }
  }
  const parked = await readJson(bucket, `${prefix}${PARKED_KEY}`)
  const merged = mergeParked(index, parked, Date.now()).index
  return new Response(request.method === 'HEAD' ? null : JSON.stringify(merged), {
    headers: { 'content-type': TYPES.json, 'cache-control': 'public, max-age=60' },
  })
}

export async function onRequest({ request, env }) {
  const bucket = env.EDITIONS_BUCKET
  if (!bucket || (request.method !== 'GET' && request.method !== 'HEAD')) return env.ASSETS.fetch(request)

  let key
  try { key = decodeURIComponent(new URL(request.url).pathname).replace(/^\/+/, '') } catch { return env.ASSETS.fetch(request) }
  // Only real files under editions/. Client routes such as /editions/<id> have
  // no extension and belong to the single-page app.
  if (!key.startsWith('editions/') || key.includes('..') || !/\.[a-z0-9]{2,5}$/i.test(key)) return env.ASSETS.fetch(request)

  const prefix = typeof env.EDITIONS_PREFIX === 'string' ? env.EDITIONS_PREFIX : ''
  if (key === INDEX_KEY) return manifestResponse({ request, env, bucket, prefix })

  const object = await bucket.get(`${prefix}${key}`)
  if (!object) return env.ASSETS.fetch(request)

  const headers = new Headers({
    'content-type': contentType(key),
    'cache-control': key.endsWith('.json') ? 'public, max-age=300' : 'public, max-age=86400',
  })
  if (object.httpEtag) headers.set('etag', object.httpEtag)
  if (object.httpEtag && request.headers.get('if-none-match') === object.httpEtag) return new Response(null, { status: 304, headers })
  return new Response(request.method === 'HEAD' ? null : object.body, { headers })
}
