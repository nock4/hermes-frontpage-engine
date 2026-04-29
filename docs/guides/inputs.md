# Input modes

Hermes Frontpage Engine can start from three input adapters.

## 1. Manifest mode

Best for quick setup and hackathon demos.

Example:

```json
[
  {
    "title": "Example source",
    "url": "https://example.com/article",
    "source_channel": "manual-curation",
    "captured_at": "2026-04-28"
  }
]
```

Run it:

```bash
npm run daily:process -- --input-mode manifest --signal-manifest ./examples/signals/sample-signals.json
```

Supported fields:
- `title`
- `url` or `urls`
- `source_channel`
- `captured_at` or `note_date`
- `excerpt`
- `text`
- `metadata`

## 2. Markdown-folder mode

Point the engine at a local folder of markdown notes.
Each note can include frontmatter like:

```yaml
---
title: My note
source_channel: research-note
note_date: 2026-04-28
---
```

Any URLs in the note body are extracted automatically.

Run it:

```bash
npm run daily:process -- --input-mode markdown-folder --input-root ./examples/signals/sample-notes
```

## 3. Obsidian allowlist mode

This preserves the original Nick workflow.
It scans the existing saved-signal allowlist only:
- `Inbox/tweets`
- `Inbox/youtube`
- `Inbox/nts-liked-tracks-source-map*.md`
- `Resources/Chrome Bookmarks.md`
- `Resources/Collections/Chrome Bookmarks.md`
- `Resources/Collections/YouTube Likes.md`

Run it:

```bash
npm run daily:process -- --input-mode obsidian-allowlist --input-root /path/to/your/vault
```

Legacy alias:

```bash
npm run daily:process -- --vault /path/to/your/vault
```
