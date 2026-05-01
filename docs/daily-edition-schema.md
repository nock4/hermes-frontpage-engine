# Daily Edition Schema

## Purpose
Define the canonical package for one daily front-page edition.

Each edition should be self-contained enough to:
- render live
- review in debug/clickable/solo/live
- publish
- archive
- replay later

## Core rule
One day = one edition package.

## Root manifest
The root manifest lives at `public/editions/index.json`.

`current_edition_id` is the authoritative root-route pointer. The matching edition item should be the only manifest entry with `is_live: true`; generated review editions should remain `is_live: false` unless the daily process is run with `--publish`.

That package should include:
- the daily brief
- generated scene plate
- artifact map
- source bindings
- ambiance recipe
- about note with run-specific process explanation and typography profile
- post-plate analysis, interpretation, and enhancement-plan metadata when generated
- review state
- publish metadata

## Top-level edition object
```json
{
  "edition_id": "2026-04-17-herbarium-bed-v1",
  "date": "2026-04-17",
  "status": "draft|review|approved|published|archived",
  "slug": "herbarium-bed-v1",
  "title": "Herbarium Bed",
  "scene_family": "herbarium-bed",
  "brief_id": "brief-2026-04-17-a",
  "plate_id": "plate-2026-04-17-a",
  "artifact_map_id": "map-2026-04-17-a",
  "source_binding_set_id": "bindings-2026-04-17-a",
  "ambiance_recipe_id": "ambiance-2026-04-17-a",
  "review_state_id": "review-2026-04-17-a",
  "publish_state": {
    "is_live": false,
    "published_at": null,
    "archive_path": null
  }
}
```

## 1. Daily brief
Captures why this edition exists.

```json
{
  "brief_id": "brief-2026-04-17-a",
  "date": "2026-04-17",
  "signal_cluster_ids": ["cluster-botany", "cluster-archive"],
  "research_node_ids": ["node-1", "node-2"],
  "mood": "quiet archival ecology",
  "material_language": ["aged paper", "pressed flora", "handwritten labels"],
  "lighting": "soft warm dusk",
  "object_inventory": ["specimen labels", "pressed stems", "paper seams"],
  "interaction_grammar": {
    "hero_count": 2,
    "module_count": 6,
    "window_strategy": "source-window"
  },
  "negative_constraints": ["no dashboard cards", "no empty compositional zones"]
}
```

## 2. Scene plate
Stores the generated image and provenance.

```json
{
  "plate_id": "plate-2026-04-17-a",
  "asset_path": "assets/plate.png",
  "width": 1536,
  "height": 1024,
  "model": "gpt-image-2",
  "prompt_version": "prompt-v3",
  "generated_at": "2026-04-17T09:00:00Z",
  "scene_family": "herbarium-bed",
  "uniqueness_hash": "sha256-or-similar"
}
```

## 3. Artifact map
Defines hero/module geometry and semantics.

```json
{
  "artifact_map_id": "map-2026-04-17-a",
  "viewport": {
    "base_width": 1280,
    "base_height": 720,
    "aspect_ratio": "1280:720"
  },
  "default_cluster_id": "left-specimen",
  "default_artifact_id": "module-left-label",
  "artifacts": [
    {
      "id": "hero-left",
      "kind": "hero",
      "label": "Left pressed specimen",
      "artifact_type": "specimen-body",
      "cluster_id": "left-specimen",
      "bounds": {"x": 0.01, "y": 0.03, "w": 0.35, "h": 0.95},
      "polygon": [[0.02,0.08],[0.06,0.03],[0.21,0.02]],
      "z_index": 10,
      "source_binding_ids": ["binding-left-specimen"]
    }
  ]
}
```

`polygon` should represent the best available contour-hugging mask for the visible target. Bounds-only rectangles are acceptable as fallback scaffolding, but generated packages should prefer the winning mask candidate when the automated mask pass can identify one.

## 4. Source binding set
Each artifact opens a real source window.

```json
{
  "source_binding_set_id": "bindings-2026-04-17-a",
  "bindings": [
    {
      "id": "binding-left-specimen",
      "artifact_id": "module-left-label",
      "source_type": "tweet|youtube|audio|article|image|github|link",
      "source_url": "https://...",
      "window_type": "social|video|audio|image|web",
      "hover_behavior": "preview|none",
      "click_behavior": "pin-open",
      "playback_persistence": true,
      "fallback_type": "rich-preview|outbound-link",
      "embed_status": "unavailable"
    }
  ]
}
```

`embed_status` is optional. Use `"processing"` when a valid provider URL is still waiting on native embed readiness and the runtime should temporarily fall back to a source-truth linkout. Use `"unavailable"` when a provider URL is valid but the native embed is known to fail, so the runtime can preserve source truth with a direct provider fallback instead of rendering a broken player.

Generated edition constraints:
- primary `source_url` values must be unique
- generated YouTube source URLs must be known embeddable; otherwise skip that source before packaging
- raw `pbs.twimg.com` or `video.twimg.com` media URLs must not be primary `source_url` values
- Twitter/X media can appear as `source_image_url` only when the primary source is the native tweet URL
- NTS liked-track rows must resolve to direct streamable sources before packaging; do not package NTS page URLs as the displayed binding

## 5. Ambiance recipe
Stores edition-specific atmosphere.

```json
{
  "ambiance_recipe_id": "ambiance-2026-04-17-a",
  "motion_system": "soft-spore-drift",
  "color_drift": "warm-paper-breathing",
  "glow_behavior": "artifact-proximity",
  "audio_posture": "silent|ambient|reactive",
  "webgl_mode": "none|particles|shader-scene",
  "research_inputs": ["node-1", "node-2"]
}
```

## 6. About note
Explains how this specific edition was made.

```json
{
  "about_id": "about-2026-04-17-herbarium-bed-v1",
  "label": "About",
  "title": "About Herbarium Bed",
  "short_blurb": "This edition began with recent saved notes, inspected source links, and a source image that shaped the final scene.",
  "body": [
    "Stable project paragraph explaining that Daily Frontpage is a daily generated interactive front page where the image is the interface and visible scene elements open real sources.",
    "Run-specific paragraph explaining the saved signals, source research, visual reference, scene result, and post-plate mapping/mask pass for this edition."
  ],
  "typography": {
    "profile_id": "botanical-field|archive-reader|signal-technical|constructed-world",
    "heading_family": "'DFE Fraunces', 'DFE Source Serif 4', Georgia, serif",
    "body_family": "'DFE Source Serif 4', Iowan Old Style, Georgia, serif",
    "accent_family": "'DFE Inter', Inter, ui-sans-serif, system-ui, sans-serif",
    "heading_weight": 700,
    "body_weight": 430,
    "accent_weight": 720,
    "rationale": "Why this font profile fits the edition mood."
  }
}
```

Do not use generic kicker text such as `"Generated process"`. The about note should read like a viewer-facing edition note, not a build log.

The generated About record should be concise. It should reference the actual process and visuals for this edition without turning into an internal step log.

## 7. Post-plate analysis
Records what the generated image actually became before masks and interactions are finalized.

```json
{
  "inspection_mode": "openai-vision",
  "detected_objects": [],
  "usable_surfaces": [],
  "complexity_assessment": {
    "status": "minimal|watch|busy",
    "dominant_form_count": 2,
    "large_region_count": 1,
    "mapped_region_coverage": 0.38,
    "rationale": "Why the plate is acceptable or needs review."
  }
}
```

This file is not optional for from-scratch generated editions. The post-plate pass should use `gpt-5.5` vision and should treat visible abstract marks, gestures, surfaces, and edges as valid targets only when they are actually visible in the plate.

## 8. Interpretation and enhancement plan
Generated editions commonly include:

```text
interpretation.json
enhancement-plan.json
```

`interpretation.json` converts the package, analysis, geometry kit, candidate pack, and source bindings into scene ontology, artifact surface types, supported behaviors, and per-region treatment assignments.

`enhancement-plan.json` selects the runtime-safe interaction treatment bundle for the package. It should not invent behavior that is unsupported by the current runtime.

## 9. Review state
Tracks whether the edition is ready.

```json
{
  "review_state_id": "review-2026-04-17-a",
  "geometry_status": "pending|pass|fail",
  "clickability_status": "pending|pass|fail",
  "behavior_status": "pending|pass|fail",
  "editorial_status": "pending|approved|rejected",
  "notes": []
}
```

## 10. Archive metadata
Supports long-term browsing.

```json
{
  "archive_record": {
    "edition_id": "2026-04-17-herbarium-bed-v1",
    "date": "2026-04-17",
    "scene_family": "herbarium-bed",
    "motif_tags": ["botany", "archive", "paper"],
    "preview_asset": "assets/previews/2026-04-17-herbarium-bed-v1.jpg",
    "archive_slug": "2026-04-17-herbarium-bed-v1"
  }
}
```

## File layout recommendation
```text
editions/
  2026-04-17-herbarium-bed-v1/
    edition.json
    brief.json
    artifact-map.json
    source-bindings.json
    ambiance.json
    about.json
    analysis.json
    interpretation.json
    enhancement-plan.json
    review.json
    assets/
      plate.png
      preview.png
      masks/*.svg
```

## Validation rules
- one edition per date
- one unique plate per edition
- all artifact ids unique
- all source bindings must resolve to real source URLs
- all artifacts must reference real bindings when interactive
- generated packages should have 7-10 non-duplicate source bindings when enough valid saved-source material exists
- generated packages must not use raw Twitter/X CDN media as a primary source URL
- generated YouTube bindings must be embeddable or be excluded before packaging
- about notes must reference edition-specific process details, not generic pipeline copy
- published edition must have review pass states
- archive package must be complete before live pointer changes
