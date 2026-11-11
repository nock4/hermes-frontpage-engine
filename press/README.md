# The press

One plain Node script that makes the daily edition. No agent, no git in the daily
path, no Mac in the daily path.

```
pick -> brief -> plate -> map -> assemble -> upload -> smoke -> park -> tell
```

| Step | What it does | Model calls |
|---|---|---|
| pick | Newest saved bookmark that is unused and has a fetchable image | 0 |
| brief | Reads the source image and writes the scene brief (also says if the image is unusable) | 1 |
| plate | Generates the landscape plate | 1 |
| map | Finds the source-bearing mark in the plate | 1 |
| assemble | Writes the edition package the viewer already reads | 0 |
| upload | Puts the files in the bucket | 0 |
| smoke | Loads the package with the viewer's own loader | 0 |
| park | Schedules it for 4:00 AM Detroit time | 0 |
| tell | One Telegram message | 0 |

A normal run makes three model calls. Each call retries once on the first
provider, then uses the second provider.

## Rules

- Only the smoke step blocks an edition: if the viewer could not load the
  package, nothing is parked.
- Weak art is published with a note in `review.json`, `press.json` and the
  Telegram message.
- If mapping fails, the middle of the plate becomes one target.
- A source the brief call rules out is never tried again. A source whose image
  could not be fetched is tried once more, then dropped.
- Code changes go through pull requests. The press never edits code.

## Going live without a scheduler

A built edition is written to the bucket and listed in `press/parked.json` with a
`go_live_at` time. The Pages Function that serves `/editions/index.json` merges
every parked edition whose time has passed, so an edition goes live at 4:00 AM
whether or not any job runs at 4:00 AM. `flip` only folds those entries into
`editions/index.json` afterwards.

Each run builds at most one edition: the earliest date from today to
today + `PRESS_LOOKAHEAD_DAYS` (default 1) that has none. Building tomorrow's
edition a day early is what gives a failed run a day to be rerun.

## Bucket layout

```
editions/index.json            the manifest
editions/<edition-id>/...      one edition package
press/candidates.json          saved bookmarks, pushed by the Mac sync
press/ledger.json              sources already used or ruled out
press/parked.json              built editions waiting for their go-live time
press/state.json               last failure notice, to avoid repeats
```

Only `editions/` is reachable from the site. With `PRESS_PREFIX=shadow/` every
key above moves under `shadow/`, so a shadow press can run in the same bucket
without touching the live keys. In GitHub Actions every run is a shadow run
until the repository variable `PRESS_MODE` is `live`, and the schedule is off
until `PRESS_SCHEDULE` is `on`.

## Commands

```bash
npm run press -- run       # flip, then build if a date is missing
npm run press -- build --date 2026-11-12
npm run press -- flip
npm run press -- status
npx tsx press/admin.mjs seed-ledger --from public/editions --dry-run
npx tsx press/admin.mjs migrate-archive --from public/editions --dry-run
PRESS_VAULT=<vault dir> npm run press:sync -- --dry-run
npm run build && npm run press:serve -- --bucket <dir>   # look at a local bucket in the viewer
```

## Configuration (environment only)

| Variable | Purpose |
|---|---|
| `PRESS_STORE` | `r2`, or `local:<dir>` for a directory laid out like the bucket |
| `PRESS_PREFIX` | Key prefix such as `shadow/`; empty for live |
| `R2_ACCOUNT_ID`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | Bucket access |
| `OPENAI_API_KEY` | First provider for text, vision and image |
| `OPENROUTER_API_KEY` | Second provider |
| `PRESS_TEXT_MODEL`, `PRESS_IMAGE_MODEL`, `PRESS_IMAGE_QUALITY` | Defaults: `gpt-5.5`, `gpt-image-2`, `medium` |
| `PRESS_FALLBACK_TEXT_MODEL`, `PRESS_FALLBACK_IMAGE_MODEL` | Second-provider models |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | Where the one message goes |
| `PRESS_SITE_URL` | If set, `flip` checks the public site after an edition goes live |
| `PRESS_SEED_INDEX` | Manifest file to start from when the bucket has none |
| `PRESS_LOOKAHEAD_DAYS` | How many days ahead to keep built (default 1) |
| `PRESS_REPLAY_DIR` | Answer every model call from recorded files (`brief.json`, `map.json`, `plate.png`) |
| `PRESS_RECORD_DIR` | Save live model answers in that layout |
| `PRESS_VAULT` | Obsidian vault directory, for the Mac sync only |

Secrets live in GitHub Actions secrets (the press) and in a private env file
outside the repository (the Mac sync). Nothing here reads a secret from a file in
the repository.

## Try it without any keys

```bash
mkdir -p /tmp/press-demo/bucket/press /tmp/press-demo/replay
cp press/fixtures/2026-11-10-alliharvard/candidates.json /tmp/press-demo/bucket/press/
cp press/fixtures/2026-11-10-alliharvard/{brief,map}.json /tmp/press-demo/replay/
cp <any landscape png> /tmp/press-demo/replay/plate.png
PRESS_STORE=local:/tmp/press-demo/bucket PRESS_REPLAY_DIR=/tmp/press-demo/replay \
  PRESS_SEED_INDEX=public/editions/index.json npm run press -- run
npm run build && npm run press:serve -- --bucket /tmp/press-demo/bucket
```

## What is deliberately not here

No review gate, no proof registry, no recovery state, no source-fidelity gate, no
dependency audit or test suite in the daily path, no code repair. Tests run on
pull requests.
