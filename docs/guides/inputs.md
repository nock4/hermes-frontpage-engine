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

## Next-run inspiration override manifest

This is separate from the normal input adapters. It is a temporary manifest that biases the next generation run with a specific image while still letting the engine research from the normal saved-signal field.

Default path:

```text
tmp/next-run-inspiration-override.json
```

Typical writer command:

```bash
npm run daily:set-inspiration-override -- \
  --image /absolute/path/to/seed.jpg \
  --title "urgent trend seed" \
  --bias-terms election,breaking \
  --note "Keep source discovery broad."
```

Manifest shape:

```json
{
  "active": true,
  "title": "urgent trend seed",
  "note": "Keep source discovery broad.",
  "source": "telegram",
  "source_url": "telegram://message/123",
  "received_at": "2026-05-02T12:00:00.000Z",
  "prompt_bias_terms": ["election", "breaking"],
  "consume_after_success": true,
  "image_path": "/absolute/path/to/seed.jpg"
}
```

Use `image_url` instead of `image_path` when the image lives at a remote URL or a data URL.

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
