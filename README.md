# Hermes Frontpage Engine

Hermes Frontpage Engine is a Hermes-native creative system that turns saved links, notes, playlists, and research trails into a new interactive front page every day.

It is not a static homepage template.
It is a daily edition engine: Hermes researches the day's signals, shapes a visual scene, binds visible marks to real source media, and ships a browsable edition.

## Live demo
- live site: https://daily.nockgarden.com/
- current edition: image-led homepage where clicking visible marks opens real source windows
- archive: browse prior generated editions from the live site's `ARCHIVE` entry point

## What makes this interesting
- the image is the interface, not just decoration
- Hermes is doing orchestration, research, scene direction, source binding, packaging, and QA
- the output is a runnable creative artifact, not a text report or prompt dump
- each edition becomes both a daily artwork and an explorable source archive

## Why this fits the hackathon
- creative software, not just a wrapper around image generation
- Hermes handles the full workflow: intake, research, scene shaping, artifact binding, packaging, and QA
- output is a runnable, shareable interactive artifact
- works for artists, curators, researchers, and weird internet archivists

## What to click in the live demo
- open the page and treat the artwork itself like the interface
- click visible marks, cuts, apertures, or interruptions in the scene to open real source windows
- use `ABOUT` for the generation/process explanation
- use `ARCHIVE` to inspect previous editions

## Quickstart

```bash
npm install
cp .env.example .env
npm run demo:sample
npm run build
npm run demo:preview
```

Then open `http://127.0.0.1:4174`.

If you want the full generation pipeline instead of the bundled sample demo:

```bash
npm run daily:process -- --input-mode manifest --signal-manifest ./examples/signals/sample-signals.json
npm run build
npm run demo:preview
```

## Supported input adapters
- `manifest`: JSON list of URLs and metadata
- `markdown-folder`: local markdown notes with URLs
- `obsidian-allowlist`: legacy Nick-compatible vault scan

## Single-run inspiration override

The engine can temporarily bias the **next run** with a one-off image override manifest.
This is what Hermes Agent's Telegram single-photo `/frontpage`, `/frontpage-override`, and `/fp` caption flow writes into.

Quick example:

```bash
npm run daily:set-inspiration-override -- \
  --image /absolute/path/to/seed.jpg \
  --title "urgent trend seed" \
  --bias-terms election,breaking \
  --note "Keep source discovery broad."
```

What this does:
- writes a manifest for the next run at `tmp/next-run-inspiration-override.json` by default
- treats the supplied image as the strongest visual cue
- keeps the normal saved-signal research flow active
- stores optional `prompt_bias_terms` that tilt downstream source discovery
- auto-consumes the override after a successful run unless you explicitly disable that in the manifest

The Telegram caption mapping is:
- first command line: optional title
- `bias:`: comma-separated bias terms
- `note:` and any extra body lines: freeform note

You can also point the engine at a custom manifest path with `DFE_INSPIRATION_OVERRIDE` or `inspiration_override_manifest` in the JSON config.

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
- `npm run daily:set-inspiration-override`
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

## Hackathon framing
If you are reviewing this for a creative-tooling or agentic-systems hackathon, the fastest way to understand it is:
- visit the live demo
- click into the artwork
- open `ABOUT`
- inspect how the runtime turns source research into a navigable visual surface

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
This repo includes `vercel.json` for static Vite deploys with SPA fallback. Existing files are served directly, and non-file routes fall back to `index.html` so archive routing works under a custom domain.

## Notes
- `gpt-image-2` remains the required image model when `DFE_IMAGE_BACKEND=openai`
- bundled sample inputs remove the Obsidian dependency for first run
- legacy Obsidian allowlist mode is still available for Nick's existing pipeline
