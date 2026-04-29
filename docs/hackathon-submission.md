# Hermes hackathon submission

## Project name
Hermes Frontpage Engine

## One-line pitch
A Hermes-native creative automation system that turns saved links, notes, playlists, and research trails into a new interactive front page every day.

## Overview
Hermes Frontpage Engine treats the front page like a living memory surface instead of a static dashboard. Hermes gathers source material, researches it, generates a scene, maps visible artifacts, and binds each artifact to real media. The result is a shareable interactive edition that works as both artwork and explorable archive.

## What Hermes does autonomously
- ingests source signals from manifests, markdown folders, or an Obsidian allowlist adapter
- researches and filters candidate sources
- writes the scene brief and interpretation files
- generates the plate image and artifact map
- assembles a packaged edition and validates the runtime surface

## Why this is creative software
The engine is not just making images. It composes a navigable world from a user's recent interests, then turns that world into an interface whose visible objects open real source media. The page becomes a playable collage of memory, research, and atmosphere.

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
