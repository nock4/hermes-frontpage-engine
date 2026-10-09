# Decision Log

## 2026-04-28
Decision: From-scratch daily generation must use the full automated path, not a manual/external substitute.
Why: The project is a daily engine. `npm run daily:process` now owns saved-signal mining, source autoresearch, browser capture, `gpt-image-2` plate generation, post-plate vision, package assembly, masks, validation, build, and browser QA.

## 2026-04-28
Decision: Current generated editions use `gpt-5.5` for source research, brief composition, and post-plate vision, and `gpt-image-2` for image generation.
Why: The source selection, visual brief, and plate inspection steps need stronger reasoning/vision accuracy, and image generation should use the current project-standard image model.

## 2026-04-28
Decision: Saved-signal intake is restricted to recent Twitter/X bookmarks, YouTube likes, NTS liked-track source maps, and Chrome bookmarks.
Why: The generated public page should not leak unrelated personal memory-vault content or link to local/text notes.

## 2026-04-28
Decision: Generated editions must prefer 7-10 non-duplicate renderable content sources and should hard-fail below 7.
Why: Underfilled editions produced weak source spreads, and recent duplicates made the page feel repetitive. Failing early is better than packaging an invalid edition.

## 2026-04-28
Decision: NTS liked tracks are discovery signals only.
Why: The page should bind to the actual streamable source. The NTS map can point toward YouTube, Bandcamp, or SoundCloud, but unresolved NTS items should be skipped.

## 2026-04-28
Decision: Raw Twitter/X CDN media URLs are not valid primary source URLs for generated editions.
Why: Tweet media can be visually foregrounded, but source truth belongs to the native tweet/status URL.

## 2026-04-28
Decision: The current visual direction should bias further toward minimal abstract expressionism.
Why: Dense source-prop compositions were becoming too similar and too literal. The plate should read as artwork first: one dominant field/form, one disruptive gesture, large negative space, and quiet source-bearing marks.

## 2026-04-28
Decision: The project should keep the Vite 8 toolchain and Node `^20.19.0 || >=22.12.0` engine requirement.
Why: The security audit needed the Vite/esbuild/PostCSS chain updated to a zero-vulnerability install tree.

## 2026-04-23
Decision: Research should shape design and selection without introducing unrelated public sources.
Why: The actual content linked from the page should come from saved user-originated material. Automated research is useful for ranking, rejecting, clustering, capture notes, scene choice, material language, ambiance, and design direction, but it should not invent a public content feed outside the saved-source candidates.

## 2026-04-16
Decision: Do not rebuild old Blender Nockgarden literally.
Why: Keep the emotional ambition, but move through the new scene-first landing-editions process.

## 2026-04-16
Decision: Treat the front page as a scene-first world with discoverable pockets.
Why: This bridges the original vision into the current landing-editions system.

## 2026-04-16
Decision: Herbarium Bed wins the first scene-family pass.
Why: Strongest first-build candidate and best bridge from old Nockgarden emotional role.

## 2026-04-17
Decision: The real target is a new dynamic front page every day.
Why: The project is a daily engine, not a one-off homepage.

## 2026-04-17
Decision: Use native-artifact mapping for mask work.
Why: Arbitrary overlay zones keep making the page feel like an app shell over wallpaper.

## 2026-04-17
Decision: Insert an automated research step between saved-signal mining and scene generation.
Why: Research findings, especially media-driven ones, should deepen the signal field and influence both the generated scene and the final ambiance.

## 2026-04-17
Decision: Every daily scene is fully AI-generated and unique.
Why: The front page should never reuse the same scene twice, but should preserve an explorable archive.

## 2026-04-17
Decision: Front-page pockets should open source windows, not text summaries.
Why: The page should expose actual tweets, videos, streams, and source artifacts rather than flattening them into generic summary cards.

## 2026-04-17
Decision: Live mode should be chrome-free at rest.
Why: The default page must read as the scene itself, not a dashboard wrapped around artwork.

## 2026-04-17
Decision: Source windows should open on the stage near their artifacts.
Why: Opening pockets in fixed side rails breaks the scene-first illusion and feels like product chrome returning.

## 2026-04-17
Decision: Provider-native URL detection outranks weak binding metadata.
Why: A real YouTube URL should render as YouTube even if the binding metadata drifts and still says `web`.

## 2026-04-17
Decision: UX verification is required for visible runtime bugfixes.
Why: Green tests alone were not enough to catch bad live behavior like fallback cards, duplicate labels, or wrong renderer selection.

## 2026-04-18
Decision: X/Twitter status bindings should render as provider-native tweet embeds with no extra stage container chrome.
Why: Handmade social cards looked fake in-scene. The correct pattern is official `publish.twitter.com/oembed` HTML plus `platform.twitter.com/widgets.js`, stored in binding data and rendered without an outer modal shell, dark iframe backdrop, or redundant open-post button.

## 2026-04-22
Decision: Stage window placement should prefer geometry-kit anchors when an edition provides them.
Why: Bounds-only placement was too generic in cluttered scenes. Using `safe_stage_window_origin_px`, `safe_hover_origin_px`, and `preferred_expansion_label` makes stage windows more plausibly artifact-anchored without hard-coding per-scene UI exceptions.

## 2026-04-18
Decision: Visual CI should run through Argos-backed Playwright UX scenarios.
Why: Screenshot baselines are the local guardrail, but CI needs traceable visual diffs and remote screenshot review before a UI claim is trusted.

## 2026-04-18
Decision: Generate five new real archive editions after the Argos UX lane was wired.
Why: The runtime needs real daily-edition volume, not only test fixtures, to prove the engine can carry multiple scene families through the same package contract.

## 2026-10-09
Decision: Supersede Argos-backed visual CI with Playwright-native screenshot baselines.
Why: Argos carried an unpatched high-severity dependency chain. Native `toHaveScreenshot` assertions preserve fail-closed local and CI visual checks without the vulnerable upload path; traces, HTML reports, mobile audits, and independent visual review remain required.
