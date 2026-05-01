# Hermes hackathon submission

## Project name
Hermes Frontpage Engine

## Live demo
- https://daily.nockgarden.com/

## One-line pitch
A Hermes-native creative system that turns saved links, notes, playlists, and research trails into a new interactive front page every day.

## Short description
Hermes Frontpage Engine treats the front page like a living memory surface instead of a static dashboard. Hermes gathers source material, researches it, generates a scene, maps visible artifacts, and binds each artifact to real media. The result is a shareable interactive edition that works as both artwork and explorable archive.

## What Hermes does autonomously
- ingests source signals from manifests, markdown folders, or an Obsidian allowlist adapter
- researches and filters candidate sources
- writes the scene brief and interpretation files
- generates the plate image and artifact map
- assembles a packaged edition and validates the runtime surface
- runs QA over edition packaging, source windows, and runtime behavior

## Why this is creative software
The engine is not just making images. It composes a navigable world from a user's recent interests, then turns that world into an interface whose visible objects open real source media. The page becomes a playable collage of memory, research, and atmosphere.

## What judges should try
1. open the live demo
2. click visible marks in the artwork to open source windows
3. open `ABOUT` to see the generation narrative
4. open `ARCHIVE` to browse prior editions and verify it is a repeatable engine, not a one-off page

## Why it fits the Hermes creative hackathon
- Hermes is driving the full workflow, not just a single prompt step
- the project turns research and saved signals into a novel interactive medium
- the output is a working creative artifact with real source provenance
- it demonstrates agentic orchestration, packaging, QA, and presentation in one system

## Demo instructions
```bash
npm install
cp .env.example .env
npm run demo:sample
npm run demo:preview
```

## Stretch goals after hackathon
- more public input adapters
- recurring scheduled generation with Hermes cronjobs
- multi-provider research and image backends
- community edition templates for music, writing, and archival practice
