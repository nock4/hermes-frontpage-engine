# Hermes Frontpage Engine

Hermes Frontpage Engine is a Hermes-native creative automation system that turns saved links, notes, playlists, and research trails into a new interactive front page every day.

It is not a static homepage template.
It is a daily edition engine.

## Why this fits the hackathon
- creative software, not just a wrapper around image generation
- Hermes does the orchestration: intake, research, scene shaping, artifact binding, packaging
- output is a runnable, shareable interactive artifact
- works for artists, curators, researchers, and weird internet archivists

## Quickstart

```bash
npm install
cp .env.example .env
npm run demo:sample
npm run build
npm run demo:preview
```

Then open `http://127.0.0.1:4174`.

## Supported input adapters
- `manifest`: JSON list of URLs and metadata
- `markdown-folder`: local markdown notes with URLs
- `obsidian-allowlist`: legacy Nick-compatible vault scan

Examples:

```bash
npm run daily:process -- --input-mode manifest --signal-manifest ./examples/signals/sample-signals.json
npm run daily:process -- --input-mode markdown-folder --input-root ./examples/signals/sample-notes
npm run daily:process -- --input-mode obsidian-allowlist --input-root /path/to/vault
```

Legacy alias:

```bash
npm run daily:process -- --vault /path/to/vault
```

## What Hermes is doing
1. ingest recent signals from one of the supported adapters
2. research and filter candidate sources
3. write the scene brief and interpretation files
4. generate the plate image
5. map visible artifacts to real media
6. assemble a packaged edition for the runtime and archive

## Main commands
- `npm run daily:process`
- `npm run demo:sample`
- `npm run build`
- `npm run demo:preview`
- `npm run qa:publish`
- `npm run qa:source-windows`
- `npm run test:ux:media`
- `npm run check:setup`
- `npm test`

## Requirements
- Node `^20.19.0 || >=22.12.0`
- npm
- `OPENAI_API_KEY` for the default from-scratch text/vision pipeline
- `browser-harness` on your `PATH` or set via `BROWSER_HARNESS_PATH` for full source capture
- optional: `DFE_IMAGE_BACKEND=hermes` to generate plates through Hermes image providers instead of direct OpenAI image calls

## Public setup
- `.env.example` has the expected environment variables
- `config/frontpage.config.example.json` shows a portable config file
- `docs/guides/setup.md` covers first-run setup
- `docs/guides/inputs.md` documents the supported input shapes
- `docs/hackathon-submission.md` holds the submission narrative

## Repo structure
- runtime app: `src/`
- generation scripts: `scripts/`
- packaged editions: `public/editions/`
- sample inputs: `examples/signals/`
- setup and input docs: `docs/guides/`

## Product rules
- live mode is full-page artwork only
- review chrome exists only in explicit QA and debug modes
- every day gets a new scene and editions stay explorable in the archive
- prefer abstract, image-led, research-shaped worlds over default office/desk metaphors
- artifact mapping must anchor to real visible marks, objects, edges, surfaces, or gestures in the generated plate
- source windows should expose real media or source-framed fallbacks, not summary cards
- generated editions should use 6-10 non-duplicate source windows when enough valid source material exists

## Deploying
This repo now includes `vercel.json` for static Vite deploys with SPA fallback. Existing files are served directly, and non-file routes fall back to `index.html` so archive routing works under a custom domain.

## Notes
- `gpt-image-2` remains the required image model when `DFE_IMAGE_BACKEND=openai`
- bundled sample inputs remove the Obsidian dependency for first run
- legacy Obsidian allowlist mode is still available for Nick's existing pipeline
