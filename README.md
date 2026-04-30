# Daily Frontpage Engine

Scene-first runtime for a daily front page that becomes a new interactive artwork every day.

## Requirements

- Node `^20.19.0 || >=22.12.0`
- npm
- `OPENAI_API_KEY` for from-scratch generation (or use image generation hermes skill with gpt-image-2)
- browser-harness (or similar fetching tool)

Core idea:
The frontpage engine is page that changes every day. Your obsidian vault is mined from the last 30 days of digital consumption, hermes agent finds something to hone in on and research in depth, it takes aesthetic signals from whatever it researches and generates a prompt for gpt-image-2 based on what it learned. Then, it scans the output for objects, creates masks on them, and pops up embedded links from the original content sources upon a mouse hovering over the object.

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
- examples live under `public/editions/`
- root manifest lives at `public/editions/index.json`
- current live edition: `2026-04-23-forest-breath-cabinet-v2`
- latest generated review edition: `2026-04-28-ash-procession-flare-v1`

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
