# Research-to-Scene Pipeline Spec

## Purpose
Turn recent saved-source signals into a ranked research field that can drive one daily scene, its pockets, and its ambiance.

## Inputs
- recent Markdown records from the saved-signal allowlist:
  - Twitter/X bookmarks
  - YouTube likes
  - NTS liked-track source maps
  - Chrome bookmarks
- attached or linked media: images, video, audio, screenshots, and source-page lead media
- lightweight history from recent editions to avoid repeating yesterday's dominant motif

## 1. Mine saved signals from the allowlist
Extract atoms, not summaries.

For each candidate signal, capture:
- source note/link id and timestamp
- source channel: `twitter-bookmark`, `youtube-like`, `nts-like`, or `chrome-bookmark`
- motif terms: objects, materials, organisms, tools, symbols, spaces
- tone terms: moods, energies, tensions
- media evidence: image/video/audio present, plus URLs
- recurrence signals: repeated mentions, backlinks, tag overlap, temporal clustering
- open threads: unfinished fascinations, questions, or return visits

Do not mine the broader personal vault for public source content. Source selection begins with explicit saved-content paths only.

## 2. Enrich each cluster with automated research
Current order:
1. collect candidate URLs only from the saved-signal allowlist
2. reject private/local/text-document targets before fetch or capture
3. gather source evidence with Node fetch: final URL, title, description, visible text, source type, note provenance, images, and YouTube embeddability
4. pass the evidence to `gpt-5.5` for an autoresearch-style synthesis: read all candidates, cluster the field, identify the through-line, reject weak/duplicate sources, and choose source candidates with provenance
5. use browser-harness only after synthesis to capture and verify selected pages/images
6. select one artistic or material-rich source image for the brief
7. accept 1–10 independently owned renderable sources, with 6 desired but never required; zero fails. Stop normal acquisition at the first strong unused pixel-verified artwork, then deepen its research rather than buying six sources.

Research record per cluster:
- visual cues: shapes, silhouettes, compositions, density
- material cues: surfaces, weathering, fabrication, textures
- ambient cues: lighting, weather, sound, motion behavior
- object inventory: artifacts that could become native mask targets
- image references: specific source images, artworks, diagrams, scans, screenshots, or layouts that could directly shape the generation prompt
- source windows: saved-source URLs worth exposing directly in-scene
- risk flags: overfamiliar, too literal, weak media support, hard-to-render

Source selection rules:
- NTS liked-track map rows are discovery signals; bind only to resolved YouTube, Bandcamp, or SoundCloud sources
- YouTube sources must pass the embeddability check or be skipped from generated editions
- native tweet URLs are preferred over raw Twitter/X media URLs
- raw `pbs.twimg.com` / `video.twimg.com` URLs can support tweet imagery but cannot be primary source bindings
- recent source duplicates are ineligible
- distinct resolved NTS tracks from one source-map note may fill separate source windows

## 3. Let media findings shape the edition
Media evidence has priority over abstract topic similarity.

Use media findings to steer:
- scene brief: world type, camera stance, spatial depth, hero objects, clutter level
- pocket planning: which real artifacts can host source windows
- ambiance: motion grammar, particles, color drift, sound-reactive behavior, playback tone

Rule: if research changes how the scene should look, move, or sound, it belongs in the brief.
Rule: if source images reveal a stronger formal language than a literal room/world metaphor, prefer the image-led direction.

## 4. Score and select motifs
Score each cluster 1-5 on:
- resonance: how strongly it reflects recent saved-source attention
- visual potency: image/world-building strength
- media richness: quality and variety of inspectable sources
- artifactability: number of plausible native interaction targets
- ambiance yield: ability to drive motion, lighting, sound, atmosphere
- novelty: distance from the last few editions
- coherence: can become one scene without collapsing into collage

Suggested weighted score:
`total = 0.25 resonance + 0.2 visual_potency + 0.15 media_richness + 0.15 artifactability + 0.1 ambiance_yield + 0.1 novelty + 0.05 coherence`

Selection rule:
- choose 1 primary cluster
- optionally merge 1 secondary cluster only if it increases contrast or depth without breaking coherence
- reject clusters with weak media evidence or no believable artifact targets

## 5. Outputs for scene generation
Produce one save-ready package per edition:

### A. Scene brief
- edition title or working name
- one-paragraph world description
- visual direction: composition, palette, lighting, materials, scale
- formal direction: abstraction level, symbolism, collage/diagram tendencies, and whether the result should resist office/desk-like staging
- source-anchor families: 7-10 quiet marks, apertures, labels, slits, cuts, scratches, stains, edge details, or small lights
- interaction grammar: 2 hero pockets + 5-8 secondary pockets when enough valid sources exist
- negative constraints: what to avoid repeating or rendering generically

### B. Research field
- ranked motif list with scores
- supporting references and lineage notes
- extracted media cues
- shortlisted source-image references for generation input
- shortlist of source URLs for pockets

### C. Ambiance brief
- motion rules
- color/lighting behavior
- audio or playback posture
- any media-reactive behaviors

### D. Generation payload
```json
{
  "date": "YYYY-MM-DD",
  "primary_cluster": "...",
  "secondary_cluster": "...",
  "scene_brief": "...",
  "visual_cues": ["..."],
  "material_cues": ["..."],
  "ambient_cues": ["..."],
  "object_inventory": ["one dominant form", "two secondary forms", "quiet source-anchor families"],
  "complexity_budget": {
    "mode": "minimal-expressionist",
    "negative_space": "at least 60% when the source set allows it",
    "material_limit": 3,
    "anchor_strategy": "7-10 subtle marks, apertures, labels, slits, cuts, scratches, stains, edge details, or small lights"
  },
  "pocket_targets": [
    {"artifact": "...", "source_url": "...", "media_type": "video|image|audio|article"}
  ],
  "motif_scores": {
    "resonance": 0,
    "visual_potency": 0,
    "media_richness": 0,
    "artifactability": 0,
    "ambiance_yield": 0,
    "novelty": 0,
    "coherence": 0,
    "total": 0
  },
  "negative_constraints": ["..."]
}
```

## Acceptance check
Before handing off to image generation, verify:
- the brief names concrete objects, materials, and lighting
- the brief also states the desired abstraction / formal language, not just a literal room type
- at least 1 and at most 10 viable independently owned source-window targets exist; 6 is desired
- targets correspond to actual visible marks, not duplicate-source regions or equal-weight props
- the image prompt preserves a minimal expressionist complexity budget: one dominant form, one disruptive gesture, quiet anchors, and large negative space
- primary source URLs are unique and do not include raw Twitter/X CDN media
- ambiance is derived from research, not random styling
- the chosen motif is distinct from recent editions
- the composition is not falling back to a generic office/desk scene unless that literalism is intentional
- the scene still reads as one world, not a moodboard
