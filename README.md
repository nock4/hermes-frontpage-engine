# Daily Frontpage Engine

Scene-first runtime for a daily front page that becomes a new interactive artwork every day.

## Requirements

- Node `^20.19.0 || >=22.12.0`
- npm
- `OPENAI_API_KEY` for from-scratch generation
- browser-harness available at `/Users/nickgeorge-studio/Projects/browser-harness/.venv/bin/browser-harness` unless `BROWSER_HARNESS_PATH` is set

Goal:
Ship a daily edition engine, not a one-off homepage.

Core idea:
The image is the interface.
Each edition is a world with native visible artifacts that open real source windows.

Current product rules:
- live mode is full-page artwork only
- review chrome exists only in explicit QA and debug modes
- every day gets a new scene and editions stay explorable in the archive
- prefer abstract, image-led, research-shaped worlds over default office/desk metaphors
- artifact mapping must anchor to real visible marks, objects, edges, surfaces, or gestures in the generated plate
- strong source images should be used as generation inputs for palette, contrast, edge behavior, gesture, or formal language
- source windows should expose real media or source-framed fallbacks, not summary cards
- provider-native URL detection outranks weak binding metadata when the URL is unambiguous
- generated editions should use 7-10 non-duplicate source windows when enough valid source material exists
- raw Twitter/X CDN media may be used as supporting image material, but not as a primary source URL
- NTS liked tracks are discovery signals only; packaged bindings use resolved streamable sources such as YouTube, Bandcamp, or SoundCloud

Current repo state:
- runtime lives in this repo
- packaged editions live under `public/editions/`
- root manifest lives at `public/editions/index.json`
- current live edition: `2026-04-23-forest-breath-cabinet-v2`
- current archive count: 55 packaged editions
- latest generated review edition: `2026-04-28-ash-procession-flare-v1`

Current strongest review routes:
- `/` -> current live edition
- `/archive/ash-procession-flare-v1`
- `/archive/indigo-proofing-wash-v1`
- `/archive/forest-breath-cabinet-v2`
- `/archive/sustainable-ai-ledger-room-v1`
- `/archive/algorithmic-folklore-watchpost-v1`
- `/archive/tape-commons-transfer-desk-v9`

Working commands:
- `npm run daily:process`
- `npm run qa:publish`
- `npm run qa:source-windows`
- `npm run test:ux:media`
- `npm run audit:codebase`
- `npm test`
- `npm run validate:editions`
- `npm run build`
- `npm run preview -- --host 127.0.0.1 --port 4174`
- `npm run test:ux:update`
- `npm run test:ux`
- `npm run test:ux:a11y`

Repository purpose:
- hold the actual runtime shell
- keep packaged editions and archive routing in one place
- track architecture, product decisions, and review rules
- preserve the current contract for live mode, review modes, and source-window behavior

Daily generation:
- `npm run daily:process` runs the full pipeline from recent saved signals through source research, `gpt-5.5` brief/vision work, `gpt-image-2` plate generation, package assembly, mask geometry, validation, build, Playwright smoke, and media audit.
- Signal mining is intentionally narrow: recent Twitter/X bookmarks, YouTube likes, NTS liked-track source maps, and Chrome bookmarks only.
- Source research first gathers evidence with Node fetch and the DNS-aware source policy, then asks `gpt-5.5` for an autoresearch-style synthesis, then uses browser-harness for selected page/image capture.
- New packages are review editions by default. Passing `--publish` is required to switch the live pointer.

Security / QA:
- `npm run qa:publish` is the publish gate: dependency audit, codebase audit, edition validation, unit tests, production build, generated-edition smoke test, and source-window media audit.
- `npm audit --audit-level=moderate` and `npm audit --omit=dev --audit-level=moderate` should both report 0 vulnerabilities before pushing.
- `npm run audit:codebase` runs strict unused TypeScript checks, Knip dead-code detection, and generated-content slop scans.
- Source-window media QA fails generated editions when YouTube falls back to linkout, media is title-only, images fail, or media framing is visibly clipped.

See:
- `docs/research-to-scene-spec.md`
- `docs/daily-behavior-system-spec.md`
- `docs/vision.md`
- `docs/architecture.md`
- `docs/runtime-plan.md`
- `docs/source-window-embed-interaction-spec.md`
- `docs/current-state.md`
- `docs/decision-log.md`
- `docs/testing/ux-acceptance-states.md`
- `docs/testing/review-checklist.md`
- `docs/testing/argos-ci.md`
