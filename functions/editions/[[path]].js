// Cloudflare Pages Function: the go-live gate for /editions/index.json.
//
// The press commits tomorrow's edition a day early and lists it in
// /press/parked.json with a go_live_at time. This adds every parked edition
// whose time has passed to the manifest as it is served, so an edition goes
// live on time with no deploy and no job at that moment. Everything else, and
// any failure here, is the plain static file.
//
// public/_routes.json sends only /editions/index.json through this function.

import { mergeParked, normalizeParked } from '../../shared/edition-index.js'

export async function onRequest({ request, env }) {
  const url = new URL(request.url)
  if (request.method !== 'GET' || url.pathname !== '/editions/index.json') return env.ASSETS.fetch(request)
  try {
    // Plain requests: a browser's cached copy of the static manifest must not
    // answer "not modified" across a go-live time.
    const [manifest, parkedFile] = await Promise.all([env.ASSETS.fetch(new Request(url)), env.ASSETS.fetch(new Request(new URL('/press/parked.json', url)))])
    if (!manifest.ok || !parkedFile.ok) return env.ASSETS.fetch(request)
    const parked = normalizeParked(await parkedFile.json())
    if (!parked.entries.length) return env.ASSETS.fetch(request)
    const { index } = mergeParked(await manifest.json(), parked, Date.now())
    return new Response(JSON.stringify(index), {
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=60' },
    })
  } catch {
    return env.ASSETS.fetch(request)
  }
}
