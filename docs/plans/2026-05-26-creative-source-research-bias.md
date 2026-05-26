# Creative Source Research Bias Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Shift the Daily Frontpage source field toward music, visuals, art, memes, and other visually stimulating creative material, then let autoresearch grow a coherent aesthetic world around that creative anchor.

**Architecture:** Add an explicit creative/art signal scoring layer before source inspection, teach single-anchor research to choose aesthetic anchors over infrastructure links, and make derived research search for works, artists, scenes, media references, archives, videos, and adjacent visual material. Keep the hard rule: source windows must still be real renderable surfaces, never padded summary cards.

**Tech Stack:** Node ESM scripts, Vitest node tests, existing source mining / source research pipeline, browser-harness capture, Hermes structured JSON autoresearch.

---

## Product Shape

The edition should stop treating “recent saved link” as the only center of gravity. It should act like a curator:

1. Find the most visually fertile saved signal.
2. Prefer creative channels and surfaces: music, videos, art portfolios, visual essays, memes, game visuals, animation, photography, comics, design references, fashion/material texture, archival images.
3. Downrank AI-agent infrastructure, GitHub repos, docs, product pages, SaaS landing pages, and generic tech commentary unless they carry strong visible artifacts.
4. Use the anchor as genre/aesthetic seed.
5. Research adjacent works in that genre to flesh out 6–10 real windows.
6. Generate a plate from an imagined aesthetic, not a summary of tooling discourse.

## Acceptance Criteria

- Source candidate ranking has a named creative/aesthetic score.
- Anchor selection favors art/music/visual/meme/media material over infrastructure links when both are available.
- Autoresearch prompt asks for an “aesthetic field” and adjacent works, not just evidence clustering.
- Derived search queries include terms like `works`, `visual archive`, `music video`, `artist`, `scene`, `genre`, `meme`, `lookbook`, `portfolio`, `album art`, `installation`, `animation`, `screenshots`.
- AI-agent/tooling links are downranked unless their captured page includes strong real imagery.
- Tests prove creative candidates outrank infrastructure candidates.
- Tests prove derived research query generation is aesthetic-first.
- `npm test -- tests/node/source-selection-policy.test.mjs tests/node/anchor-source-research.test.mjs` passes.
- `npm run demo:sample` still completes.

---

## Task 1: Add explicit creative/aesthetic scoring vocabulary

**Objective:** Create one central scoring function that identifies visually fertile source material.

**Files:**
- Modify: `scripts/lib/source-selection-policy.mjs`
- Test: `tests/node/source-selection-policy.test.mjs`

**Step 1: Write failing tests**

Add tests covering:

- art / music / meme / visual candidates score positive
- github / docs / api / agent infrastructure score negative
- direct image and video surfaces score positive
- product/SaaS “AI agent infrastructure” language is downranked

Example assertions:

```js
import { aestheticSignalScore } from '../../scripts/lib/source-selection-policy.mjs'

it('scores visual culture candidates higher than infrastructure candidates', () => {
  const art = aestheticSignalScore({
    url: 'https://example.com/gallery/animated-masks',
    note_title: 'surreal animation masks and album art',
    description: 'music video stills, collage, costume, visual archive',
    source_channel: 'chrome-bookmark',
  })

  const infra = aestheticSignalScore({
    url: 'https://github.com/acme/agent-framework',
    note_title: 'AI agent infra framework docs',
    description: 'API, quickstart, orchestration, tool calls, zod schemas',
    source_channel: 'chrome-bookmark',
  })

  expect(art).toBeGreaterThan(20)
  expect(infra).toBeLessThan(0)
  expect(art).toBeGreaterThan(infra + 30)
})
```

**Step 2: Run test to verify failure**

```bash
npm test -- tests/node/source-selection-policy.test.mjs
```

Expected: FAIL because `aestheticSignalScore` does not exist.

**Step 3: Implement `aestheticSignalScore`**

In `scripts/lib/source-selection-policy.mjs`, export a function near `scoreVisualCandidate`:

```js
export function aestheticSignalScore(candidate = {}) {
  const text = [
    candidate.url,
    candidate.final_url,
    candidate.source_url,
    candidate.title,
    candidate.description,
    candidate.visible_text,
    candidate.note_title,
    candidate.note_path,
    candidate.note_excerpt,
  ].filter(Boolean).join(' ').toLowerCase()

  let score = 0

  if (/(art|artist|artwork|gallery|museum|archive|visual|image|photo|photography|collage|painting|drawing|illustration|comic|zine|poster|album art|cover art|lookbook|fashion|textile|fabric|material|installation|sculpture|animation|anime|game|pixel|shader|sprite|screenshot|meme|music video|video still|film still|visualizer|playlist|mix|dj|nts|bandcamp|soundcloud|youtube)/.test(text)) score += 26
  if (/(genre|scene|aesthetic|style|visual language|motif|surface|texture|gesture|palette|costume|mask|set design|stage|club|rave|ambient|noise|jazz|punk|folk|experimental|cinema|architecture|street|storefront|signage)/.test(text)) score += 14
  if (/\.(png|jpe?g|webp|avif|gif|mp4|mov)(?:$|[?#])/.test(text)) score += 16
  if (candidate.source_channel === 'youtube-like') score += 18
  if (candidate.source_channel === 'nts-like') score += 20

  if (/(github|api|sdk|quickstart|docs|documentation|readme|zod|schema|agent framework|agentic|workflow node|orchestration|mcp|llm\.txt|benchmark|eval|deployment|inference|vector database|rag|tool call|automation pipeline)/.test(text)) score -= 28
  if (/(seo|growth channel|cold email|sales|crm|b2b|landing page|pricing|waitlist|sign up|product hunt|saas)/.test(text)) score -= 20

  return score
}
```

**Step 4: Verify pass**

```bash
npm test -- tests/node/source-selection-policy.test.mjs
```

Expected: PASS.

**Step 5: Commit**

```bash
git add scripts/lib/source-selection-policy.mjs tests/node/source-selection-policy.test.mjs
git commit -m "feat: score creative source signals"
```

---

## Task 2: Wire aesthetic scoring into candidate selection

**Objective:** Make the first inspected candidate pool over-index on creative sources before generic channel balance.

**Files:**
- Modify: `scripts/lib/source-selection-policy.mjs`
- Test: `tests/node/source-selection-policy.test.mjs`

**Step 1: Write failing test**

Add a test for `selectSourceCandidatesForInspection()`:

- Input contains 3 creative sources and 3 infrastructure sources.
- Expected top selected sources include the creative ones first.
- Infrastructure may remain only if needed to fill count.

**Step 2: Run failure**

```bash
npm test -- tests/node/source-selection-policy.test.mjs
```

Expected: FAIL because current scoring can still lift GitHub/product pages via channel score or metadata.

**Step 3: Modify `sourceSelectionScore`**

In `sourceSelectionScore(candidate, recentSourceKeys)`, add:

```js
score += aestheticSignalScore(candidate)
```

Then soften old garden-specific terms so the creative score is the primary cross-domain bias, not just native-garden / map / diagram leftovers.

**Step 4: Add a creative-first pass in `selectSourceCandidatesForInspection`**

Before the per-channel loop, add:

```js
for (const { candidate } of ranked.filter((entry) => aestheticSignalScore(entry.candidate) >= 20).slice(0, 12)) {
  if (selected.length >= Math.ceil(maxSources * 0.6)) break
  add(candidate, { allowRecent: false, domainLimit: 3, noteLimit: 4 })
}
```

This makes the first plate proof lean creative without banning other useful windows.

**Step 5: Verify**

```bash
npm test -- tests/node/source-selection-policy.test.mjs
```

Expected: PASS.

**Step 6: Commit**

```bash
git add scripts/lib/source-selection-policy.mjs tests/node/source-selection-policy.test.mjs
git commit -m "feat: prefer creative candidates for source inspection"
```

---

## Task 3: Make anchor selection aesthetic-first

**Objective:** Pick anchors that can seed a world: music, image, meme, art, video, material surface — not agent infrastructure.

**Files:**
- Modify: `scripts/lib/anchor-source-research.mjs`
- Test: `tests/node/anchor-source-research.test.mjs`

**Step 1: Write failing test**

Add a test for `selectAnchorSource()`:

- Candidate A: GitHub repo about agent nodes, high note score.
- Candidate B: music video / artist portfolio / meme image with lower note score.
- Expected anchor: Candidate B.

**Step 2: Run failure**

```bash
npm test -- tests/node/anchor-source-research.test.mjs
```

Expected: FAIL or current anchor may pick the high-scoring infrastructure candidate.

**Step 3: Import and use `aestheticSignalScore`**

Modify import:

```js
import {
  aestheticSignalScore,
  isLowValueVisualImage,
  sourceContentKey,
  sourceContentScore,
  sourceHasRenderableCardSurface,
} from './source-selection-policy.mjs'
```

In `selectAnchorSource`, after `let score = sourceContentScore(...)`, add:

```js
score += aestheticSignalScore(source) * 1.5
```

Then replace the older mixed regex boost with a tighter visual-culture boost:

```js
if (/(music|video|artist|artwork|gallery|archive|meme|animation|film|photo|fashion|textile|game|pixel|album|poster|zine|comic|installation|sculpture|drawing|painting|collage)/i.test(text)) score += 18
if (/(agent|api|docs|github|framework|infrastructure|workflow|orchestration|growth|seo|cold email)/i.test(text)) score -= 30
```

**Step 4: Verify**

```bash
npm test -- tests/node/anchor-source-research.test.mjs
```

Expected: PASS.

**Step 5: Commit**

```bash
git add scripts/lib/anchor-source-research.mjs tests/node/anchor-source-research.test.mjs
git commit -m "feat: choose aesthetic anchors for source research"
```

---

## Task 4: Change derived research queries from generic evidence to genre/world expansion

**Objective:** Make autoresearch look for adjacent works and references in the anchor’s aesthetic field.

**Files:**
- Modify: `scripts/lib/anchor-source-research.mjs`
- Test: `tests/node/anchor-source-research.test.mjs`

**Step 1: Export query builder for testability**

Change:

```js
function buildAnchorQueries(anchor, terms) {
```

to:

```js
export function buildAnchorQueries(anchor, terms) {
```

**Step 2: Write failing test**

Assert query output includes aesthetic expansion terms:

```js
const queries = buildAnchorQueries({ title: 'surreal claymation music video masks' }, ['claymation', 'mask', 'ambient'])
expect(queries.join(' ')).toMatch(/works|artist|visual archive|music video|genre|scene|album art|animation|screenshots/)
expect(queries.join(' ')).not.toMatch(/github screenshots assets/)
```

**Step 3: Replace `buildAnchorQueries` output**

Use queries like:

```js
return uniqueNonEmpty([
  quotedTitle,
  `${termString} artist works visual archive`,
  `${termString} music video stills album art`,
  `${termString} genre scene visual references`,
  `${termString} installation animation screenshots`,
  `${termString} photography collage poster zine`,
  `${termString} fashion textile material texture`,
  `${title} related artists works`,
  `${title} aesthetic references`,
  `${title} visual archive`,
]).slice(0, MAX_DERIVED_SEARCH_QUERIES)
```

Remove `github screenshots assets` from default query generation.

**Step 4: Update `visual_motifs`**

In `buildAnchorResearch`, expand motif detection:

```js
visual_motifs: terms.filter((term) => /(music|video|artist|archive|image|photo|film|mask|costume|texture|surface|gesture|palette|meme|comic|zine|poster|album|animation|game|pixel|street|sign|fashion|textile|collage|installation|sculpture|drawing|painting)/i.test(term)),
```

**Step 5: Verify**

```bash
npm test -- tests/node/anchor-source-research.test.mjs
```

Expected: PASS.

**Step 6: Commit**

```bash
git add scripts/lib/anchor-source-research.mjs tests/node/anchor-source-research.test.mjs
git commit -m "feat: expand anchor research into aesthetic fields"
```

---

## Task 5: Rewrite the autoresearch prompt around an aesthetic field

**Objective:** Teach the LLM research pass to imagine a source-world, not select boring evidence.

**Files:**
- Modify: `scripts/lib/source-research.mjs`
- Test: `tests/node/source-inspection.test.mjs` or add focused assertions to existing source research tests if present.

**Step 1: Update workflow language**

In `runSourceAutoresearch`, change `workflow` from:

```js
'llm-wiki-inspired autoresearch: read all candidate source evidence first, cluster the field, synthesize a thesis, choose sources with provenance, then hand only selected URLs to browser capture.'
```

to:

```js
'aesthetic-field autoresearch: read all candidate source evidence, find the most visually fertile creative through-line, imagine the edition as a coherent aesthetic world, choose renderable source windows with provenance, and avoid infrastructure/tooling links unless they carry strong visible artifacts.'
```

**Step 2: Add hard rules**

Add these strings to `hard_rules`:

```js
'Over-index on music, visuals, art, memes, animation, film/video, games, fashion/material texture, comics/zines, photography, archives, and other visually stimulating sources.',
'Downrank AI-agent infrastructure, SaaS/product pages, GitHub/docs/API links, SEO/growth tooling, and generic tech commentary unless the page itself contains a strong real visual artifact.',
'Treat the selected anchor as an aesthetic seed: choose adjacent works, references, artists, genres, scenes, and visual material that can flesh out a world.',
'Prefer sources that give the generated plate surfaces, gestures, edges, objects, textures, and imageable rituals.'
```

**Step 3: Extend schema**

Add fields to expected output:

```js
aesthetic_thesis: 'one sentence naming the imagined visual world',
visual_motifs: ['concrete visual motifs: surfaces, gestures, objects, palettes, textures'],
anchor_reason: 'why the selected anchor is visually fertile',
```

Keep backward compatibility by not requiring those fields downstream yet.

**Step 4: Update instructions**

Change instructions to:

```js
'You are the source-research editor for a daily interactive artwork. You are a curator of visual culture, music, memes, art, and surfaces — not a technology news summarizer.',
'Think like an aesthetic autoresearch pass: find the strongest creative through-line, imagine the plate-world it implies, then select a varied renderable source set with provenance.',
'Return strict JSON matching the requested schema. Do not include Markdown.'
```

**Step 5: Add request snapshot test**

If no existing source-research request builder is exported, factor the request creation into:

```js
export function buildSourceAutoresearchRequest(...) { ... }
```

Then test that `hard_rules` contains `Over-index on music` and `Downrank AI-agent infrastructure`.

**Step 6: Verify**

```bash
npm test -- tests/node/source-selection-policy.test.mjs tests/node/anchor-source-research.test.mjs
npm test
```

Expected: PASS.

**Step 7: Commit**

```bash
git add scripts/lib/source-research.mjs tests/node/*.test.mjs
git commit -m "feat: frame source autoresearch as aesthetic field curation"
```

---

## Task 6: Add post-capture rescue using creative image material

**Objective:** If browser-harness capture fails, recover with direct visual material from the anchor research instead of dying after two windows.

**Files:**
- Modify: `scripts/lib/source-research.mjs`
- Test: add coverage in the most appropriate existing node test or create `tests/node/source-research.test.mjs`

**Step 1: Define the behavior**

When `contentSources.length < minContentItems`, before throwing:

- Look at `imageSourceMaterial.selected_image_material`.
- Convert high-quality image materials into content-source candidates only if they have:
  - `page_url` or `image_url`
  - non-low-value `image_url`
  - lineage back to the anchor
- Capture / inspect them as direct image or page-backed windows.
- Never create summary cards.

**Step 2: Write failing test**

Test that selected image material can be transformed into renderable source candidates and counted when it has real image URLs.

**Step 3: Implement helper**

Add in `source-research.mjs`:

```js
function sourceCandidateFromImageMaterial(material, anchorSource) {
  const url = material.page_url || material.image_url
  if (!url || !material.image_url || isLowValueVisualImage(material.image_url)) return null
  return {
    url,
    source_url: url,
    final_url: url,
    title: material.title || material.caption || 'Aesthetic source material',
    description: material.visual_reason || material.caption || '',
    image_url: material.image_url,
    source_channel: 'anchor-image-material',
    source_type: 'image-material',
    window_type: 'web',
    kind: 'article',
    note_id: anchorSource?.note_id,
    note_title: anchorSource?.note_title || anchorSource?.title,
    note_path: anchorSource?.note_path,
    note_score: Math.max(60, Number(anchorSource?.note_score || 0)),
    source_lineage: material.lineage || 'anchor_image_material',
    source_reason: material.visual_reason || 'Image material discovered while researching the creative anchor.',
  }
}
```

**Step 4: Use it as a rescue pool**

Before throwing at line ~515, try these candidates through `selectContentSources` or `captureAutoresearchedSources`, preserving the real image URL. If `inspectCandidateSource` already handles image URLs, route through it; otherwise append only candidates that already satisfy `sourceHasRenderableCardSurface`.

**Step 5: Verify**

```bash
npm test
npm run demo:sample
```

Expected: PASS and sample still produces a plate.

**Step 6: Commit**

```bash
git add scripts/lib/source-research.mjs tests/node/source-research.test.mjs
git commit -m "feat: rescue source windows from anchor image material"
```

---

## Task 7: Add observability to prove the new editorial bias

**Objective:** Make run logs show why an anchor/source field was selected.

**Files:**
- Modify: `scripts/lib/source-research.mjs`
- Modify: `scripts/lib/source-selection-policy.mjs`

**Step 1: Add fields to `source-candidate-evidence.json`**

In `researchEvidenceForSource`, include:

```js
aesthetic_score: aestheticSignalScore(source),
selection_bias: aestheticSignalScore(source) >= 20 ? 'creative-art-visual' : aestheticSignalScore(source) < 0 ? 'infrastructure-or-low-visual' : 'neutral',
```

**Step 2: Add fields to `source-research.json`**

In `researchField`, include:

```js
editorial_bias: {
  mode: 'creative-aesthetic-first',
  preferred_domains: ['music', 'visual art', 'memes', 'film/video', 'games', 'fashion/materials', 'archives'],
  downranked_domains: ['ai-agent infrastructure', 'github/docs/api', 'saas/growth tooling'],
},
```

**Step 3: Verify with sample run**

```bash
npm run demo:sample
```

Expected: generated run has `source-candidate-evidence.json` with aesthetic scores and `source-research.json.editorial_bias.mode`.

**Step 4: Commit**

```bash
git add scripts/lib/source-research.mjs scripts/lib/source-selection-policy.mjs
git commit -m "chore: log creative editorial source bias"
```

---

## Task 8: End-to-end QA on a creative manifest

**Objective:** Prove the plate can be generated from creative/art/media sources and still uses real source windows.

**Files:**
- Create: `examples/signals/creative-art-signals.json`

**Step 1: Create a fixture manifest**

Use 8–12 known renderable sources across:

- YouTube music video / animation
- Bandcamp or SoundCloud artist page
- art gallery / portfolio page
- direct image archive page
- meme or visual culture page
- fashion/material/texture page
- game visual / pixel art page

Avoid login-gated X/Instagram as primary fixtures.

**Step 2: Run process**

```bash
npm run daily:process -- --input-mode manifest --signal-manifest ./examples/signals/creative-art-signals.json --date 2026-05-26
```

Expected:

- 6–10 content sources
- `source-research.json.editorial_bias.mode = creative-aesthetic-first`
- `content_sources` are mostly music/art/visual/media
- no generic summary cards

**Step 3: Build and QA**

```bash
npm run build
npm run qa:source-windows
```

Expected: PASS.

**Step 4: Manual visual inspection**

Open preview:

```bash
npm run demo:preview
```

Check:

- live mode is full-bleed artwork
- source windows sit on real marks in the plate
- windows open real media/source-framed surfaces
- no debug chrome in live mode

**Step 5: Commit fixture if useful**

```bash
git add examples/signals/creative-art-signals.json
git commit -m "test: add creative art signal manifest"
```

---

## Rollout

1. Land Tasks 1–5 first: they change editorial selection and research intent.
2. Land Task 6 only after tests prove it does not create fake windows.
3. Run one unpublished creative manifest generation.
4. Inspect the plate and source windows.
5. Run `npm run qa:source-windows`.
6. If clean, let the next cron run use the new bias.

## Risk Notes

- Do not solve this by allowing summary cards. The whole point is more real visual surfaces, not lower standards.
- Login-gated X/Instagram can remain signals, but they should not be the backbone of renderability.
- The rescue path must use image/page material with provenance, not invented references.
- Keep some diversity: “creative-first” does not mean only one domain or one artist.

## Success Definition

A good edition feels like it has an aesthetic before it has a topic. The plate should have music, image, texture, gesture, humor, and surface in its bones. Infrastructure can appear only if it earns a visible mark.
