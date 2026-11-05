# Edition experiences

The approved vocabulary is a runtime capability, **not nine effects applied to every edition**. Published/archive edition bytes are not rewritten. No backend, microphone, camera, motion permission or audio output is activated by loading an edition.

## Production path

1. `inspectGeneratedPlate` may return `detected_objects[].effect_material`: a concrete material, verbatim visual observation and supported modalities. The normalizer strips unknown modalities and all model-authored video assertions.
2. The **same existing model call** independently returns `detected_objects[].effect_editorial` keep/omit decisions. `map-artifacts` passes `researchField`; `buildEffectsEditorialContext` joins exact planned owner URLs to existing affirmative actual-media inspections. The prompt separates inspected source observation/capture hash from metadata title/summary and research aesthetic thesis (claims), and includes the edition scene brief. It treats all reference prose as untrusted data, not instructions. No new research/paid call, source inspection stamp or deterministic rationale generator is added. Absent source context or decisions means no effects, not a substitute approval.
3. `assembleEditionPackage` joins high-confidence (at least 0.8), actually polygon-mapped objects to their exact source binding. Physical/material and native-video admission remain necessary and unchanged. It resolves each model decision's explicit `planned_artifact_index` and `source_url` to the final artifact/binding; forged final IDs, wrong owners, malformed decisions and missing references fail closed for effects only. `planEffects` requires a specific keep with verbatim source observation + capture SHA256, verbatim plate material observation, a scene-brief quote, and separate `why_behavior`, `why_input`, `why_not_none` rationales. Source metadata alone, paper/touch compatibility, music, portraits or social subjects cannot confer sensors/shared. Remote co-presence and sensor input require independent editorial reasons. Explicit omit never nominates an alternative. Zero is valid even when technically compatible; three is a cap, not a minimum/quota. The edition seed breaks ties only among explicit supported approvals; one per kind, duplicate/conflicting decisions rejected.
4. The optional `effects.json` travels with the package. The validator and actual loader share the normalizer. Authoring/publish validation rejects malformed contracts; runtime discards an invalid/unavailable optional contract so it cannot hide the original plate or break its sources. Missing contract means no experiences, including archived editions. No extension to the source-binding identity or original-image attestation is required.
5. `EditionExperiences` renders quiet, accessible 44px activation marks at the actual artifact edge. Placement resolves collisions after viewport clamping in measured plate-field pixels, using nearby rows/columns and recomputing on resize; multiple effects on a tiny corner artifact remain separate touch targets, not a toolbar. Decorative paint uses the **visible source polygon**, never the inflated hover territory. The original plate, DOM source territories, source URL, native source media and source open/close system are not transformed or replaced.

Example optional contract (identifiers must actually match the edition):

```json
{
  "schema_version": 1,
  "edition_id": "edition-id",
  "effects": [{
    "kind": "resonance",
    "artifact_id": "artifact-id",
    "binding_id": "binding-id",
    "evidence": {
      "artifact_id": "artifact-id",
      "binding_id": "binding-id",
      "material": "metal",
      "observation": "Specific inspected reflective ridges and a recessed vibrating surface",
      "modalities": ["reflective", "resonant"]
    }
  }]
}
```

`material` is metal, glass, water, stone, ceramic, fabric, paper, wood, screen or pigment. Modalities are reflective, resonant, depth, fracture, touch, and separately verified video. Unknown ownership, degenerate/out-of-range geometry, duplicate directions, over-budget contracts and unsupported media fail validation; none may silently change a source.

### Future authoring audit and compatibility

`EffectEditorialDecision` / `EffectEditorialSource` in `src/lib/editionEffects.d.mts` define the bound authoring records. Plate-analysis decisions use `planned_artifact_index` instead of final IDs (which do not exist yet). Normalization retains model-authored decisions without manufacturing prose. The packager re-derives citable source context from current research rather than trusting model-provided provenance. Missing/rejected/malformed editorial input writes an empty `effects.json` while ordinary valid original-plate publication proceeds.

The noninteractive run artifact `effects-selection-audit.json` retains selected, omitted and rejected decisions, model reasons, exact bound source context, seed, and separately named material diagnostics. Assembly also requires the captured analysis-call context to match current research/brief context; a plausible quoted response cannot approve if the actual model call lacked that evidence. Missing decisions have an explicit system omission reason; these are not represented as model judgments. The audit is not live chrome and does not extend source-binding or original-image attestations. Published `effects.json` remains schema v1: `normalizeEffects` intentionally does **not** require these new authoring fields, so accepted archive contracts stay backward compatible and byte-identical.

Validation can verify quoted evidence/identity and require independent rationale fields; it cannot mechanically prove the artistic quality or truth of a model's inference. Review the retained audit against actual source media and plate before accepting a new live edition. Synthetic integration fixtures prove plumbing, not a new live model decision or next-edition artistic acceptance.

| Runtime kind | Approved direction | Admission / activation |
| --- | --- | --- |
| `refraction` | Mercury | Reflective material; explicit local activation then pointer-reactive localized refraction |
| `projection` | Transmission | Separately verified native video; explicit play, polygon-masked original source projection |
| `camera` | Borrowed reflection | Reflective material; explicit camera permission, local mirrored live stream only |
| `resonance` | Sustained resonance | Resonant material; explicit microphone permission, pitched YIN analysis and traveling shader waves; focused mark + held Space is sensor-free |
| `depth` | Tilt depth | Actual layered geometry; explicit orientation permission where required, local bounded displacement |
| `castlight` | Borrowed video light | Verified native video; explicit play, actual decoded frame-pixel average, no clock-driven color fallback |
| `shared` | Shared ephemeral surface | Touch-receptive material; explicit join plus secure configured service, no fake visitors or reconnect |
| `rupture` | Once-only rupture | Inspected seam/fracture; one bounded release per mounted edition visit, then settled |
| `sound` | Material instrument | Resonant material; explicit enable, bounded synthesized material voices, no microphone |

## Native-video honesty

`effect-video-admission.mjs` is an optional source inspection, capped at two eligible sources per package. It requires the actual inspected source's `media_type: video` and exact original media URL/owner mapping, HTTPS, a DNS-pinned bounded download (16 MB / 6 seconds), video MIME and anonymous `Access-Control-Allow-Origin: *`. A browser decodes those exact bytes offline, verifies nonzero dimensions, actual playback advancement and readable canvas pixels. Browser launch is bounded to 5 seconds and playback checks to 5 seconds. Failure removes video effects only; the normal DOM source remains usable.

Neither still-image vision nor a generated movie of a plate can grant this admission. Local `/review/` movies and source stills are rejected. Generated review motion is **not original source footage**. At runtime `crossOrigin=anonymous` and actual playback still have to succeed; castlight catches pixel-read failure and stops. The current silver/blue edition is a still-source edition, so its QA review does **not** enable projection or castlight.

## Lifecycle and fallback

`EffectSession` owns tracks, WebAudio nodes/contexts, video playback, orientation listener, shared connection and pending-permission epoch. Switching experiences, Off/Stop, Escape, source-primary open, About/Archive open, navigation/unmount, pagehide, visibility loss, offline and reduced-motion change stop resources. Late camera/microphone grants stop acquired tracks instead of attaching them. No visibility return, permission denial, stream end or network restoration reacquires anything automatically.

Reduced motion keeps the original complete plate. No-WebGL/context loss stops shader experiences and leaves the original image and DOM sources available. Camera/native projection remain ordinary contained video layers with no WebGL dependency. Shader resolution is bounded by DPR 1.5 / longest dimension 1600; idle editions run no effect animation loop. Media source windows stay viewport-bounded, including mobile landscape, and opening one stops the active experience. The sensor-off status hides while a source is open so it cannot cover native controls.

Resonance keeps confident voiced input continuously driven, bridges at most 280ms of above-floor confidence loss, releases on silence/noise, and retains pitch texture during release. Bass owns broad/heavy displacement, high notes own faster/tighter waves, loudness controls energy, and fresh high pitch immediately removes bass weight. Processing is local: no recording, upload or transcription.

## Shared service: production dependency, not a deployment claim

The static site has **no shared backend by default**. The experience reads `/effects-config.json` only after explicit join. Without a valid configured endpoint it fails closed with an Off/not-configured status; it does not fabricate participants or silently substitute a tunnel.

Executable, dependency-free Node service:

```sh
SURFACE_ORIGINS=https://your-edition-origin.example \
HOST=127.0.0.1 PORT=4181 node scripts/services/shared-surface.mjs
```

Host this process behind a TLS reverse proxy with SSE buffering disabled; deploy a static configuration containing:

```json
{"shared_endpoint":"https://your-surface-service.example"}
```

Do not put a temporary tunnel or loopback endpoint in production. HTTPS is mandatory except when both page and endpoint are loopback for local tests. Use a separate service origin so browser EventSource supplies Origin, or configure the reverse proxy to forward the validated same-origin Origin explicitly. The service requires an explicit allowlist, validates rooms/coordinates/custom request header, sends no cookies, has no storage/replay/chat/names, and bounds clients, buffers, body size, rate-map size and connection lifetime (maximum two minutes). Join again explicitly after expiry; no automatic reconnection. The server receives ordinary connection/IP metadata to rate limit in bounded memory; coordinates are transient and never persisted by this module. Disable/access-sanitize reverse-proxy logs according to deployment privacy policy.

**No service has been deployed or production endpoint configured by this implementation.** Two isolated browser contexts exercise the real local SSE service in QA, including leave/no-receive behavior.

Request admission reserves the peer's 80ms slot synchronously **before** reading a POST body, including malformed, oversized, timed-out and aborted admitted bodies. Concurrent fragmented uploads cannot bypass the slot. The relay caps active body readers at 32, peer-rate entries at 1024 (60-second idle expiry), and bodies at 128 bytes with an absolute five-second read deadline. Saturated reader/map capacity returns 503, same-peer rate rejection 429, oversized body 413 and body deadline 408. Reader listeners/timers and capacity are released on completion, abort, overflow and timeout; unfinished rejected uploads close their connection. Constructor options may lower these limits for testing/hosting, not increase them. A complete asynchronous request rejection boundary contains malformed URL parsing (400), body and broadcast errors so invalid raw HTTP cannot terminate Node.

## QA and local review

`npm run qa:publish` includes `edition-effects.spec.ts` and `effects-build-boundary.spec.ts`; unit/node suites run under `npm test`. Tests explicitly label synthetic source/sensor admissions. They exercise all nine directions, actual WebAudio oscillator → MediaStream → application analyser → shader for twelve real seconds, low→high/release, actual canvas-stream camera, orientation, synthesized graph, real decoded video projection/frame-pixel light, late permission cleanup, no-WebGL/context loss, reduced motion, source open/close and a fresh synthetic candidate through the **real packager, loader and full app**. These are browser/synthetic proofs, **not physical-device microphone/camera/tilt acceptance**.

Diagnostics exist only with `?qaEffects=1`: `window.__effectsQA` is a read-only numerical observer, never a sensor activator or production toolbar. Screenshot labels are injected by QA, not live UI.

For current-edition hands-on review only, the Vite **dev server** can read an explicitly authored local `tmp/effects-review-admission.json`. With both `?qaEffects=1&effectReview=resonance` (or another supported kind), a same-origin `X-DFE-Effects-Review` request hint reaches server-only middleware. This preserves the site's `no-referrer` privacy policy. It refuses an existing real contract, wrong edition, missing local admission or unsupported modality. It writes no archive bytes. The override is absent from static builds and Vite preview; the request hint alone cannot activate an effect in production.

Current local review URL when server is running:

`http://127.0.0.1:4180/?qaEffects=1&effectReview=resonance`

The same actual-geometry review supports `refraction`, `camera`, `depth`, `shared`, `rupture` and `sound`; source video modes remain unsupported on this still-source edition. The reviewed current admission file is disposable and intentionally not committed. `/public/review` studies remain intact locally but `exclude-review-assets` removes `dist/review` at build time, verified by publish QA.
