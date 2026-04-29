# Process

## Canonical pipeline

1. Mine recent saved signals
2. Run bounded source research on saved-source candidates, then capture selected pages/images
3. Translate the combined signal + research field into a daily scene brief
4. Generate a brand new AI scene for that day
5. Map native artifacts in the generated plate
6. Mount into the live scaffold
7. Attach live source windows sourced only from the saved-signal allowlist
8. Add ambiance influenced by the research field
9. Review, approve, publish
10. Archive the daily edition

## Current runnable command

Run the daily pipeline from recent saved signals through a generated, packaged, browser-tested edition:

```bash
npm run daily:process
```

By default, this creates a new review edition and does not replace the current live edition. To promote the generated edition to the live pointer after package assembly, pass `--publish`:

```bash
npm run daily:process -- --publish
```

Useful variants:

```bash
npm run daily:process -- --date 2026-04-25
npm run daily:process -- --vault /Users/nickgeorge-studio/Documents/nicks-mind-map
npm run daily:process -- --ux full
npm run daily:process -- --existing --edition 2026-04-23-forest-breath-cabinet-v2
npm run daily:process -- --existing --all-editions --ux none
npm run daily:process -- --existing --edition 2026-04-26-bluebell-glowseed-clearing-v1 --prompted-mask-dir tmp/sam2-masks
```

For source-window media QA, run the real-edition media audit:

```bash
npm run test:ux:media
```

That command opens finished packaged editions in Playwright, hovers and clicks real artifacts, screenshots source windows, and writes a report under `tmp/source-window-media-audit/`. It fails on low-value placeholder images, media-capable bindings that render title-only windows, image load failures, clipped media, and high crop-risk `object-fit: cover` usage.

For the broader source-window regression loop, run:

```bash
npm run qa:source-windows
```

For the full publish gate, run:

```bash
npm run qa:publish
```

That command runs dependency audit, codebase audit, edition validation, unit tests, production build, generated-edition Playwright smoke, and source-window media audit.

For the dead-code and content-slop audit, run:

```bash
npm run audit:codebase
```

That command runs strict unused TypeScript checks, Knip dead-code detection, and a repository content scan for known generated/platform-shell artifacts in packaged editions and runtime source.

The daily process command logs every step with its tool and exact command. In from-scratch mode it runs 15 steps:

1. saved-signal Markdown mining from the explicit bookmarks/likes allowlist
2. source autoresearch with Node fetch evidence, DNS-aware URL policy, YouTube embeddability checks, `gpt-5.5` synthesis, then browser-harness capture of selected pages/images
3. OpenAI research field and scene brief composition with `gpt-5.5` plus one attached source-research image reference
4. OpenAI image generation for the scene plate with `gpt-image-2`
5. OpenAI vision inspection of the generated plate for visible artifact mapping with `gpt-5.5`
6. first edition package assembly and manifest insertion
7. source-image enrichment
8. post-plate mask/geometry generation, applying accepted contour polygons back into the packaged artifact map
9. interpretation generation
10. enhancement-plan generation
11. edition validation
12. unit tests
13. production build
14. generated-edition Playwright smoke test
15. source-window media audit that fails generated editions when YouTube falls back to linkout

The command requires an `OPENAI_API_KEY` for from-scratch mode. It checks `process.env`, `.env`, `~/.env`, and `~/.hermes/.env`.

From-scratch runs require browser-harness for post-research source/image capture and `gpt-image-2` for plate generation. The default text, autoresearch, and post-plate vision model is `gpt-5.5`. The default inspected-source budget is 16, and generated editions hard-fail before image generation if fewer than 7 non-duplicate renderable content sources survive source selection.

If `BU_CDP_WS` is already set, browser-harness uses that browser endpoint. Otherwise the command launches a managed Playwright Chromium instance with a local CDP endpoint, sets `BU_CDP_WS` / `BU_NAME` for the run, and uses browser-harness against that controlled browser.

## 1. Mine recent saved signals
Pull recent saved-content signals from the configured saved-signal root without reading the rest of the memory vault.

The current scanner reads Markdown files only from explicit allowlisted paths:
- `Inbox/tweets/**`
- `Inbox/youtube/**`
- `Inbox/nts-liked-tracks-source-map.md`
- `Inbox/nts-liked-tracks-source-map-batch-1.md`
- `Inbox/nts-liked-tracks-source-map-batch-2.md`
- `Inbox/nts-liked-tracks-source-map-batch-3.md`
- `Resources/Chrome Bookmarks.md`
- `Resources/Collections/Chrome Bookmarks.md`
- `Resources/Collections/YouTube Likes.md`

It assigns each note a date from an explicit `YYYY-MM-DD` in the path or from file mtime. It keeps and reads notes from the target date back through the configured window, currently 30 days by default.

Selection scoring:
- recency: `(window_days - age_days) * 2`
- linked-source richness: `min(url_count, 8) * 2`
- saved-content channel boost: Twitter/X bookmarks, YouTube likes, NTS liked tracks, and Chrome bookmarks each get channel-specific boosts
- channel balancing: available YouTube, NTS, Chrome, and Twitter/X groups each get an initial share before score-only filling
- Twitter/X has a soft cap so it cannot crowd out every other source type
- recent edition diversity terms subtract score from notes that repeat the last few generated editions too closely

Look for:
- recent saved Twitter/X bookmarks with source media
- recent YouTube liked videos
- recent NTS liked tracks and resolved streaming sources
- recent Chrome bookmarks
- concrete outbound URLs that can become source windows without leaking private notes
- source media likely to produce visible artifacts, materials, and scene direction

The goal is not summary. The goal is taste and direction extraction.

## 2. Automated research
Before generating the scene, deepen the signal field with an autoresearch-style pass.
The order matters:
1. gather candidate URLs only from the saved-signal allowlist
2. use Node fetch plus the DNS-aware source policy to collect source evidence: final URL, title, description, Open Graph or Twitter image, source type, note provenance, and available page text
3. pass that evidence to `gpt-5.5` for a bounded source-research synthesis inspired by the `llm-wiki` flow: read all evidence first, cluster the field, identify a through-line, reject duplicates or weak sources, and choose the edition source set with provenance
4. only after that synthesis, use browser-harness against a real Chrome tab to capture and verify selected source pages/images
5. select one source image as the visual reference for brief composition, preferring artistic or material-rich raster images over technical logos, favicons, wordmarks, GitHub preview cards, and generic docs chrome
6. choose 7 to 10 source pieces for the edition, de-duplicated by resolved URL/post/image and biased toward variety across notes, domains, media types, and recent editions
7. reject YouTube candidates that fail the oEmbed embeddability check; if the video cannot render as a native iframe, it should not become an edition source
8. let the findings influence scene generation and later ambiance decisions

This step should produce a richer source field than the saved-source records alone. It may choose public source bindings only from the saved-source candidates it was given; it must not introduce unrelated external content as a primary edition source.

Current content-selection rules:
- choose 7 to 10 source pieces when enough valid sources exist; 9 is ideal
- reject recent duplicate source keys outright
- reject raw Twitter/X CDN media URLs as primary source bindings
- prefer native tweet URLs over extracted tweet-media URLs, while still using tweet media as the visual image when available
- treat distinct resolved NTS tracks from the same source-map note as distinct source records
- prefer NTS streaming-source candidates in this order: YouTube watch/music URLs, Bandcamp, then SoundCloud
- reject text/data/document targets such as `.txt`, `.md`, `.json`, `.xml`, and `llm.txt`

The command still applies the local DNS-aware URL policy before either evidence fetch or browser-harness capture so private, local, text-document, or invalid targets are not opened by the automated process. Browser-harness is a capture/verification tool in this stage, not the first-pass researcher.

The run writes four review artifacts under `tmp/daily-process-runs/<run-id>/`:
- `source-candidate-evidence.json` from the Node fetch evidence pass
- `source-autoresearch-request.json` containing the exact bounded research prompt
- `source-autoresearch.json` containing the `gpt-5.5` synthesis, selected content URLs, visual-reference candidates, capture notes, and rejected patterns
- `source-research.json` containing inspected sources, selected content sources, browser-harness capture metadata, and the selected visual reference

## 3. Daily scene generation
A new scene is generated every day. Never reuse the same scene twice.
The archive keeps past editions explorable.

Generation input should include:
- mined saved-source motifs
- research-derived visual and material cues
- research-derived image references and compositional precedents when available
- desired interaction grammar
- scene-family constraints
- daily variation requirements

Prompting strategy:
- prompt for a scene first, not a homepage, product concept, or implementation spec
- default to a minimal expressionist plate: one dominant form, two secondary forms, large negative space, and quiet source anchors
- when possible, push further toward abstract expressionism: one dominant field or form, one disruptive gesture, and small source-bearing marks rather than a literal prop inventory
- describe the image itself: subject, setting, foreground, middle ground, background, camera/framing, light, palette, materials, texture, mood, and density
- do not let "world" collapse into a default office, desk, lab, archive room, or workstation unless the research explicitly demands it
- prefer abstract, artistic, expressionist, symbolic, theatrical, diagrammatic, or materially impossible environments when they better fit the research field
- treat strong source images as generation inputs when they can push composition, texture, abstraction, or formal language in a useful direction
- ask for a strong central atmosphere and multiple discoverable anchor marks
- bias toward visible anchors that can later become native interaction targets without making every source a separate prop
- translate technical source concepts into quiet visible things: marks, apertures, cuts, slits, glyphs, labels, stains, scratches, edge details, thin lights, or architectural voids
- derive the visual language from the research itself: composition, rhythm, symbolism, color logic, density, and artifact shape
- avoid generic dashboards, hero cards, floating UI, or blank composition-only spaces
- avoid safe room-like compositions that merely warehouse artifacts instead of transforming the research into a distinct visual system
- avoid dense archive walls, cabinets, desks, shelves, grids of cards, or many-prop still lifes
- keep runtime, embedding, source-window, artifact-mapping, QA, and API language out of the image prompt
- require plate-level uniqueness day to day

Good prompt ingredients:
- a short scene premise in plain visual language
- material language
- one dominant form and two secondary forms
- source-anchor families instead of a literal object inventory
- source-image references
- negative space and quiet density control
- camera/framing and scale
- compositional lineage
- lighting conditions
- emotional tone
- density zones
- discoverable objects implied by the image itself

OpenAI image-generation prompting guidance emphasizes specific visual detail, references, lighting, style, framing, and explicit constraints. In this project that means Step 3 must produce a human-readable art-direction scene, while Step 4 only wraps it with the minimum object and composition constraints needed for the runtime.

The brief-composition request is written to `tmp/daily-process-runs/<run-id>/brief-composition-request.json` for review. When a visual reference is available, the same image is attached to the `gpt-5.5` Responses call as `input_image`.

Minimal expressionist complexity budget:
- one dominant visual form
- two secondary visual forms
- 7 to 10 quiet source anchors embedded as marks, apertures, labels, slits, cuts, scratches, stains, edge details, or small lights
- at least 60 percent negative space when the source set allows it
- no more than three dominant material surfaces

The plate can support 7 to 10 source bindings without showing 7 to 10 loud objects. The source windows carry media richness; the plate should read as restrained artwork first.

## About panel generation
Every packaged edition gets an `about.json` written from the actual run data. It should always use two plain-language paragraphs:

1. A stable paragraph explaining the project: Daily Frontpage is a daily generated interactive front page, the image is the interface, visible scene elements open real sources, and editions stay explorable in the archive.
2. A changing paragraph explaining this iteration: what recent signals and sources were researched, what visual reference or source field shaped the design, what scene was generated, and how the post-plate mapping/mask pass turned visible objects into source windows.

The About panel must not use generic headings such as "Generated process." It should read like an edition note for a viewer, not an internal build log.

Each `about.json` also carries a typography profile. The generator chooses from a small self-hosted font set based on the edition mood and materials: botanical/field scenes use `DFE Fraunces`, archive/document scenes use `DFE Newsreader`, technical/signal scenes use `DFE Space Grotesk`, and assembled/experimental scenes use `DFE Bricolage Grotesque`. Body text stays on a calmer readable face, with labels handled by a restrained sans or mono face.

## 4. Native-artifact mapping
Masks must follow real visible artifacts in the plate.

Good targets:
- labels
- cards
- specimen bodies
- diagrams
- instruments
- candles
- shelves
- windows
- screens
- trays
- containers
- object clusters

Bad targets:
- empty space
- arbitrary quadrants
- generic modules
- layout-only balance zones

Current mapping strategy:
- use vision passes to identify likely native artifacts
- define 2 hero masks and around 6 module masks
- store normalized bounds and polygons in layout data
- generate SVG mask files from winning contour polygons
- write the winning contour polygons back into packaged `artifact-map.json`
- reject candidate masks that grow beyond the original artifact region or collapse into unusably tiny hit targets
- verify in debug mode against the real image
- tighten the worst offenders first

Current tools and techniques:
- vision analysis to identify artifact candidates
- normalized polygon layout data in JSON
- local candidate masks scored by edge alignment, depth consistency, leakage, area, and clickability
- OpenCV GrabCut candidates seeded from the rough artifact polygon and a foreground core prompt
- marching-squares contour extraction via `skimage.measure.find_contours`
- optional externally prompted PNG masks, such as SAM/SAM 2 output, loaded with `--prompted-mask-dir`
- SVG masks in each edition package under `assets/masks/`
- live scaffold with `debug`, `clickable`, `solo`, and `live` modes
- browser screenshot / audit review for mask truth-check

Longer-term mapping direction:
- prompted SAM/SAM 2 candidate masks using plate-vision boxes and artifact centroids, saved as PNGs and fed through the same scorer
- auto-trace pipeline for plate-specific proposal generation
- overgenerate native candidates, then prune
- keep geometry and manifestation review separate

## 5. Live scaffold
Mount the generated plate into the runtime shell.
The shell should support:
- plate switching
- mask layers
- hover-triggered media windows
- persistent playback until explicit close
- archive access
- daily edition routing

## 6. Source windows, not summaries
Pockets should not become text summaries.
They should become windows into actual source content.

Examples:
- tweet or bookmark -> native tweet URL with creative tweet presentation; raw Twitter/X CDN media is image support only, not the primary source URL
- YouTube -> hover opens playable embed
- YouTube URLs that cannot render as native embeds -> skip from future generated editions
- NTS liked track -> use the copied NTS map only as a signal, bind only a resolved streamable source, prefer YouTube, and skip unresolved tracks
- text/article -> show an actual framed source window, excerpted visually, not collapsed into a generic summary card

Interaction rule:
- hover can open the source window
- click activates it
- media keeps playing even if the pointer leaves the module
- explicit close button required

The front page should feel like a living media surface, not a note-summary dashboard.

## Source image enrichment
The source-image enrichment pass runs after first package assembly. It updates packaged `source-bindings.json` records only when the binding is missing a usable `source_image_url` or still points at an old generic local page preview.

Provider-native rules run first:
- YouTube URLs get deterministic `img.youtube.com` thumbnails from the video id, including watch, short, live, embed, youtu.be, and music.youtube.com forms.
- GitHub URLs get GitHub Open Graph preview images.
- Bandcamp URLs inspect the artist home page for a stable preview image.

For other web-like sources, the pass uses the DNS-aware source policy, fetches allowed HTML, and tries `og:image`, `twitter:image`, `itemprop=image`, first usable `<img>`, icon links, and finally the origin favicon. This is not content summarization; it is a visual enrichment step so source windows can show source-framed media instead of empty title-only previews.

## 7. Ambiance
Ambiance should be influenced by the research field, not added randomly.
Examples:
- motion systems derived from the scene lineage
- particle behavior tied to source mood
- WebGL treatments
- color drift
- subtle sound-reactive or media-reactive behavior

Ambiance is part of the edition identity.

## 8. Review contract
Step 1: `?debug=masks`
- geometry truth-check only

Step 2: `?qa=clickable`
- clean clickability review

Step 3: `?qa=solo`
- isolate one region at a time

Step 4: `?review=current-live`
- full behavior and media-window review

## 9. Archive
Every daily scene is unique and should be archived.
The archive should let people explore past editions rather than replacing history.
