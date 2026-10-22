# Daily Frontpage Engine Architecture

## Goal
Build a daily edition engine that turns recent saved-source signals into a fully AI-generated front page scene every day.

The product is not a static homepage. It is a living interactive artwork with a stable runtime shell and a new world each day.

Primary product rules:
- mood and world come first
- every day gets a new scene
- scenes are fully AI-generated and never reused
- interaction targets must map to visible native artifacts in the scene
- pockets should open real source windows and embeds, not summary cards
- each edition should be reviewable, publishable, and permanently archivable

## Daily Pipeline
1. Signal mining
   - ingest recent saved-source Markdown from the allowlist: Twitter/X bookmarks, YouTube likes, NTS liked-track source maps, and Chrome bookmarks
   - extract taste signals: tone, materials, objects, media types, unresolved fascinations, and world candidates
   - avoid reading unrelated personal memory-vault material

2. Automated research
   - gather evidence from saved-source candidates with Node fetch and the DNS-aware URL policy
   - ask `gpt-5.5` for an autoresearch-style synthesis over that evidence
   - use browser-harness after synthesis to capture selected pages/images
   - choose public source bindings only from saved-source candidates, not unrelated web discoveries

3. Daily scene brief
   - translate the signal field plus research field into one brief for the day
   - define atmosphere, source-anchor families, material language, lighting, density zones, interaction affordances, and edition constraints
   - attach one artistic/material source image reference when available

4. Scene generation
   - generate one brand new AI scene plate for the date with `gpt-image-2`
   - bias toward abstract expressionist plates with one dominant field/form, one disruptive gesture, large negative space, and 1–10 quiet independently owned source anchors (6 desired, never required)

5. Native-artifact mapping
   - inspect the actual generated plate with `gpt-5.5` vision
   - detect and select real marks, labels, gestures, surfaces, screens, diagrams, containers, and other visible artifacts
   - store normalized polygons, bounds, roles, and interaction metadata for each pocket
   - run local contour/depth/mask scoring and write accepted SVG masks back into the edition package

6. Live scaffold mount
   - place the daily plate and artifact map into the runtime shell
   - attach hover, click, playback persistence, close behavior, archive routing, and edition metadata

7. Source window attachment
   - bind each mapped pocket to a source artifact derived from the saved-source allowlist
   - keep source presentation native to the underlying media when possible
   - reject raw Twitter/X CDN media as primary source URLs; use native tweet URLs with media foregrounded when available
   - skip YouTube videos that cannot render as native embeds
   - resolve NTS liked tracks to streamable YouTube, Bandcamp, or SoundCloud sources before packaging

8. Ambiance pass
   - derive motion, particles, audio behavior, color drift, and other ambient systems from the day’s research field and scene identity

9. Review and publish
   - run geometry review, interaction review, behavior review, and editorial approval
   - publish the edition only after artifact truth, media validity, and mood quality clear the review gate

10. Archive
   - freeze the edition package, publish metadata, and source bindings into the permanent archive
   - preserve replayability without overwriting prior days

## System Components
- Signal Miner
  - ingests recent allowlisted saved-signal material and emits structured signal clusters

- Research Expander
  - deepens saved-source candidates into a richer research field with evidence, rejected patterns, capture notes, and media candidates

- Brief Composer
  - converts signals plus research into a single daily creative direction packet using `gpt-5.5`

- Scene Generator
  - produces the daily AI scene plate with `gpt-image-2` and supporting generation metadata

- Artifact Mapper
  - identifies visible native artifacts, marks, and surfaces, then outputs interaction geometry plus semantic roles

- Edition Assembler
  - combines plate, artifact map, source bindings, ambiance recipe, About record, interpretation, enhancement plan, and edition metadata into one edition package

- Runtime Shell
  - renders the live front page, mask layers, source windows, ambiance systems, and archive navigation

- Review Console
  - supports mask debug, clickable QA, solo inspection, and full live review modes

- Publisher
  - promotes an approved edition to current live status and updates archive indexes

- Archive Store
  - keeps immutable daily edition packages, media references, previews, and retrieval indexes

## Data Model
Core entities:

- Signal
  - id
  - source type
  - source reference
  - captured date
  - motifs
  - tone
  - media type
  - score

- Research Node
  - id
  - linked signal ids
  - source url
  - source kind
  - lineage tags
  - extracted cues
  - embeddability status
  - browser-harness capture status
  - duplicate/recent-source status

- Daily Brief
  - date
  - brief id
  - driving clusters
  - mood statement
  - material language
  - object inventory
  - source-anchor families
  - interaction grammar
  - scene constraints
  - ambiance cues
  - visual reference image and rationale

- Scene Plate
  - edition id
  - generation timestamp
  - image asset
  - generation prompt record
  - model metadata
  - scene family

- Artifact Map Item
  - item id
  - edition id
  - role
  - visible artifact type
  - normalized bounds
  - polygon
  - z-index
  - interaction mode
  - bound source ids

- Source Binding
  - binding id
  - artifact item id
  - source url
  - window type
  - playback behavior
  - fallback behavior
  - source image URL
  - embed status

- About Record
  - edition id
  - stable project paragraph
  - run-specific process paragraph
  - typography profile

- Ambiance Recipe
  - edition id
  - motion system
  - visual effects
  - audio rules
  - reactivity hooks

- Edition Package
  - edition id
  - date
  - status
  - brief id
  - scene plate id
  - artifact map version
  - source binding set
  - ambiance recipe id
  - review state
  - publish metadata
  - analysis / interpretation / enhancement metadata when generated

## Archive Model
The archive should be edition-native, not a screenshot graveyard.

Archive requirements:
- one immutable package per date
- preserve plate, artifact geometry, source bindings, ambiance recipe, and publish metadata together
- support replay of the original interaction model as closely as possible
- keep editions browsable by date, scene family, motif cluster, and source lineage
- expose current live edition separately from historical editions
- allow archive previews without flattening the full edition into a static summary card

Recommended archive layers:
- Current index: pointer to the active live edition
- Edition registry: canonical record for every published day
- Asset store: plate images, masks, previews, and related media artifacts
- Source manifest: durable references and fallback snapshots for external media
- Archive UI: browse, filter, and reopen old editions

## Publish Flow
1. Assemble candidate edition for a target date
2. Validate scene uniqueness against archive history
3. Validate artifact map quality against the visible plate
4. Validate source bindings, embed behavior, and fallbacks
   - fail on raw Twitter/X CDN primary URLs, duplicate source keys, invalid/private/text-document URLs, missing media, and non-embeddable generated YouTube sources
5. Review ambiance coherence and overall mood quality
6. Approve edition and mark it publishable
7. Publish by switching the live pointer to the new edition package
8. Write archive records and retain the prior live edition unchanged
9. Generate lightweight preview assets and archive indexes
10. Expose the new edition in live and archive surfaces

## Key Constraints
- World first: the interface must read as a scene before it reads as software
- Daily uniqueness: no plate reuse and no near-duplicate daily editions
- Native artifacts only: interactions must anchor to visible objects in the generated image
- Abstract marks count when they are actually visible and source-bearing; arbitrary rectangles over empty space do not
- Real sources over summaries: windows should reveal actual source media or source-framed content
- Saved-source truth: generated editions use the saved-source allowlist, not the broader personal vault or unrelated web research
- Stable shell, variable edition: runtime behavior stays coherent while scene identity changes daily
- Research-grounded ambiance: motion and atmosphere should come from the signal and research field, not generic effects
- Human review before publish: final approval remains editorial even if generation is automated
- Archive permanence: publishing a new day must never destroy or overwrite prior editions
- Graceful degradation: external media failures need fallbacks without collapsing the edition
- Save-ready packaging: each edition must be serializable as a complete artifact for replay, audit, and archive
