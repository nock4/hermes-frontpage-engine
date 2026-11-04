# Hosted ephemeral shared-surface relay

Production handle: **https://daily-shared-surface.powahgen.workers.dev**

This is a Cloudflare Worker plus a globally unique Durable Object per validated
room, not a tunnel, local daemon, Vercel function, or ordinary stateless Worker
fanout. SQLite backing is declared for Workers Free compatibility; application
code never invokes SQL, storage, alarms, or any outbound HTTP fetch. Losing an
instance or deploying ends participation; there is no replay or restoration.

## Deployment and staged rollout

Account: `96c1eb235b51167597b61ac2c58401a4`. Worker: `daily-shared-surface`.
The initial SQLite migration is `v1` / `SurfaceRoom`; keep it on subsequent deploys.
The supported migrations configuration is deliberately explicit. Do not change
it to `new_classes` (legacy KV, which requires a paid plan).

```sh
npm ci --prefix workers/shared-surface --ignore-scripts
npm audit --prefix workers/shared-surface --audit-level=moderate
npx vitest run workers/shared-surface/relay.test.mjs workers/shared-surface/worker.test.mjs
npm --prefix workers/shared-surface run check
WRANGLER_SEND_METRICS=false npm --prefix workers/shared-surface run deploy
node workers/shared-surface/verify-remote.mjs https://daily-shared-surface.powahgen.workers.dev
```

Existing Wrangler OAuth authentication must authorize this explicit account.
Never introduce a card, change plans/billing, print tokens, or substitute a
short-lived tunnel if deployment fails. Only the Worker has been deployed in
this change; `public/effects-config.json` is a **proposed**, unpublished site
configuration. Independent code/security review and parent production QA must
precede committing/publishing that configuration. No Vercel deployment is part
of this runbook's Worker deployment command.

The config is public, not a credential:

```json
{ "shared_endpoint": "https://daily-shared-surface.powahgen.workers.dev" }
```

## Protocol and hard limits

Only exact Origin `https://daily.nockgarden.com` is allowed; neither localhost
nor previews are admitted in production. Origin is a browser restriction, **not
authentication**: non-browser clients can forge it. Do not claim access control
or anonymity based on CORS. There are no user identities, cookies, private URLs,
credentials or participant lists.

* Exact `/surface?room=<id>` only; one query key, ASCII `[a-zA-Z0-9_-]`, 1–100
  characters. No arbitrary path, URL forwarding or proxy facility.
* GET returns SSE with one joined comment, no historical events. Explicit
  runtime join is required; the existing runtime closes EventSource on leave,
  error, visibility/pagehide/offline, and does not automatically reconnect.
* POST requires exact `Content-Type: application/json`, `X-Surface: touch`.
  JSON must be an object with exactly numeric finite `x`, `y` in `[0,1]`.
  Broadcast coordinates are rounded to three decimal places; success is 204.
* OPTIONS validates requested method GET/POST and header names Content-Type /
  X-Surface. No credentialed CORS. All responses have no-store and nosniff.
* **Per room:** 64 subscribers; each expires after 120 seconds, including silent
  or orphaned subscribers. Cancellation removes it sooner when propagated.
* Each subscriber queue is bounded at 4096 bytes. A slow consumer is errored
  and discarded rather than accumulating event history. The platform may have
  its own bounded network buffering outside application control.
* **Per room:** 32 active body readers, 128 bytes / 128 chunks per request,
  five-second body deadline. Reader slots and per-IP rate reservations happen
  synchronously before the first body await. Rejected bodies cannot hold a
  slot waiting for sender cancellation.
* **Per room:** 1024 in-memory IP rate keys, 80 ms minimum interval, idle keys
  expire after 60 seconds and a scheduled cleanup removes orphaned keys.
  The trusted edge CF-Connecting-IP header supplies the rate key; it is never
  broadcast or persisted. NAT peers share a rate budget.
* 400 invalid input, 403 disallowed/missing Origin, 408 body deadline, 413 body
  limit, 429 rate limit, 503 capacity/platform failure. No error bodies/logs.

These are per-room limits, not account-wide room-admission guarantees. Arbitrary
valid room names can instantiate additional objects. Public abuse can exhaust
platform quotas; CORS is not a defense against a determined HTTP client. A
finite room allowlist or stronger admission would require a separate product /
contract decision and review. Fail closed rather than silently persisting or
adding identity to solve abuse.

## Privacy, resources, and failure behavior

There are no application coordinate/IP/body logs, persistent event data, SQL
queries or alarms. Worker observability and invocation logs are explicitly
disabled. **Cloudflare still receives connection/IP/request metadata and
processes transient coordinate bodies as the hosting provider.** Ordinary
provider operational/security processing, aggregate metrics, and policy apply;
this is not a promise of zero platform metadata or cryptographic anonymity.

SSE and timers keep rooms non-hibernating while active. At documentation review,
Workers Free includes 100,000 DO requests/day and 13,000 GB-s/day; Worker request
limits also apply. DO duration is metered at 128 MB per active object regardless
of actual memory. Many simultaneous rooms can exhaust free duration; daily
limits fail operations and reset at 00:00 UTC. No unlimited uptime, capacity, or
paid-plan change is promised. Monitor aggregate Cloudflare usage without turning
on payload/IP logging. This deployment did not change billing or plans.

An outage, quota denial, TTL or deploy closes the stream; existing runtime
reports Off/unavailable and original sources remain usable. Visitors must join
again explicitly; do not add auto-reconnect. To disable public participation,
remove the site's config in the next reviewed site deployment (the existing
runtime fails closed). To retire the backend, after disabling site config and
waiting out the two-minute TTL, run Wrangler's reviewed Worker deletion process
for this explicit Worker/account. Deleting the Worker/namespace is destructive;
never delete other account resources. There is no startup daemon to stop.

## Evidence and acceptance boundaries

`tmp/shared-production/` retains RED/GREEN command logs, deployment/readback JSON,
remote acceptance JSON, browser traces, and desktop/mobile joined/off PNGs.
The remote verifier routes **only** `/effects-config.json` inside isolated
Playwright contexts at the actual public origin. It does not replace the live
Nov 4 contract, artifact/source bindings, plate, shader, or runtime. It verifies
explicit opt-in/no early network, cross-context delivery, changed WebGL pixels,
leave/no later receipt and no automatic reconnect. Camera/microphone permission
is never requested. Visibility cleanup in that script is explicitly a simulated
hidden event against the real handler, not physical background-tab acceptance.
The Node remote SSE acceptance waits the actual two-minute production TTL.
Additional remote capacity probes admit 64 streams, reject the 65th with 503,
and admit again after cancellation. **External slow-upload limitation:** both
Node fetch and raw HTTP/2 probes withheld final body bytes; the public path did
not respond until request EOF (even an initial 129-byte oversized chunk was
rejected only after EOF). A never-finished upload hit the client's 12-second
deadline, not an observable 408. The five-second application read deadline is
unit-verified, not claimed as a five-second edge/network upload cutoff; provider
request buffering/lifetime lies outside this relay. Preserve the failed probe
and the HTTP/2 measurements for independent review rather than calling them a
remote timeout pass.

The repository's root Vitest runner includes the pure Web API and real
Miniflare/workerd SQLite DO tests, plus existing Node relay regression tests.
Root audit recognizes this package as a separate Knip workspace; root dependency
install/lock is unchanged. Scoped Wrangler/Miniflare are pinned together and
have their own lock and audit. Newer Miniflare 5 uses worker config/manifests;
older installed Wrangler 4.110 pulled vulnerable dev-only dependencies, so the
scoped package uses the patched 4.157 SDK instead of weakening the audit.

Authoritative references reviewed before implementation:

* https://developers.cloudflare.com/durable-objects/platform/pricing/
* https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/
* https://developers.cloudflare.com/durable-objects/reference/durable-objects-migrations/
* https://developers.cloudflare.com/durable-objects/reference/durable-object-class-migrations-legacy/
* https://developers.cloudflare.com/durable-objects/concepts/durable-object-lifecycle/
* https://developers.cloudflare.com/workers/runtime-apis/streams/
* https://developers.cloudflare.com/workers/runtime-apis/streams/readablestream/
* https://developers.cloudflare.com/workers/observability/logs/workers-logs/
