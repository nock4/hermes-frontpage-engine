# The press

One plain Node script that makes the daily edition, run on the Mac by launchd.
No agent drives it and it needs no API keys: every model call goes through
Hermes on Nick's subscriptions. An edition is published the way it always has
been, as files in this repository, with one commit and push per run.

```
pick -> brief -> plate -> map -> assemble -> write -> smoke -> park -> push -> tell
```

| Step | What it does | Model calls |
|---|---|---|
| pick | Newest saved bookmark that is unused and has a fetchable image | 0 |
| brief | Reads the source image and writes the scene brief (also says if the image is unusable) | 1 |
| plate | Generates the landscape plate | 1 |
| map | Finds the source-bearing mark in the plate | 1 |
| assemble | Writes the edition package the viewer already reads | 0 |
| write | Writes the files under `public/editions/` | 0 |
| smoke | Loads the package with the viewer's own loader | 0 |
| park | Schedules it for 4:00 AM Detroit time | 0 |
| push | One commit and `git push` | 0 |
| tell | One Telegram message | 0 |

A normal run makes three model calls, all through Hermes on this Mac:

- **plate**: the Hermes image provider (the profile's `image_gen`, today
  `gpt-image-2-medium` on the ChatGPT subscription), called through
  `scripts/lib/hermes_image_generate.py`, the helper the old press already uses.
- **brief** and **map**: one bounded `hermes chat` question each (`--oneshot`,
  `--ignore-rules`, the vision tool only, at most three turns), answered by the
  profile's models (today Claude Opus on the Claude subscription). Hermes reads
  the image with its vision tool, so the model that sees the image answers.

Each call is tried twice. If it still fails the build stops with one Telegram
message and the next scheduled run tries again: an edition is built a day
ahead, so it has several retries before it would be late. There is no second
provider.

Why `hermes chat` and not a direct call for brief and map: Hermes' one-call
client (`agent.auxiliary_client.call_llm`) cannot be loaded from a helper
script on this Mac, because it restarts into Hermes' managed Python, which the
helper's interpreter cannot import. The image provider does not have that
problem. The bounded CLI question is the supported surface that reaches the
same subscription.

The trade-offs of running on the Mac:

- A Mac that is off or asleep at run time skips that run. launchd runs a missed
  job when the Mac wakes and the one-day head start covers a missed day, but a
  Mac that is off for more than a day means a late or missing edition.
- The press depends on Hermes being installed and signed in to both
  subscriptions, and on the image helper, which imports Hermes internals. A
  Hermes update can break either; the failure shows up as one Telegram message.

## Rules

- Only the smoke step blocks an edition: if the viewer could not load the
  package, nothing is parked and its files are removed.
- Weak art is published with a note in `review.json`, `press.json` and the
  Telegram message.
- If mapping fails, the middle of the plate becomes one target.
- A source the brief call rules out is never tried again. A source whose image
  could not be fetched is tried once more, then dropped.
- Code changes go through pull requests. The press never edits code.

## Going live without a scheduler

A built edition is committed under `public/editions/` and listed in
`public/press/parked.json` with a `go_live_at` time. The site's manifest
(`/editions/index.json`) is served through a small Pages Function that adds
every parked edition whose time has passed, so an edition goes live at 4:00 AM
whether or not anything runs at 4:00 AM. The next run folds those entries into
`public/editions/index.json`.

A parked edition's files are public from the moment they are pushed; only the
manifest hides it until its time.

Each run builds at most one edition: the earliest date from today to
today + `PRESS_LOOKAHEAD_DAYS` (default 1) that has none. Building tomorrow's
edition a day early is what gives a failed run a day to be rerun.

## Publishing, and shadow runs

The branch of the checkout the press runs in decides what a push means:

- on `main` the push is the publish (Cloudflare Pages deploys `main`);
- on any other branch (for example `press-shadow`) it is a shadow run. The
  edition is parked on that branch only, the manifest is left alone so the
  branch keeps merging cleanly with `main`, Telegram messages are tagged
  `[shadow]`, and the branch's Pages preview shows the result.

`main` requires the `runtime-qa` check, which only GitHub Actions can report,
so a direct push of an edition commit is accepted only because Nick's account
may bypass that rule. That is how the old press has pushed every edition. The
only route with no bypass is a pull request per edition, merged after the
check passes.

## Where things live

```
public/editions/index.json       the manifest
public/editions/<edition-id>/    one edition package
public/press/parked.json         built editions waiting for their go-live time
press/data/ledger.json           sources already used or ruled out (committed)
press/data/candidates.json       saved bookmarks read from the vault (not committed)
press/data/state.json            last failure notice, to avoid repeats (not committed)
```

The bookmark list stays out of git because this repository is public.

## Commands

```bash
npm run press -- run       # flip, then build if a date is missing
npm run press -- build --date 2026-11-12
npm run press -- flip
npm run press -- status
npx tsx press/admin.mjs seed-ledger --from public/editions --dry-run
PRESS_VAULT=<vault dir> npm run press:sync -- --dry-run
```

## Configuration (environment only)

| Variable | Purpose |
|---|---|
| `PRESS_REPO` | Checkout to write into and push from (default: the current directory) |
| `PRESS_STORE` | `local:<dir>` to write every file into one directory instead, with no git (tests, demos) |
| `PRESS_HERMES_PROFILE` | Hermes profile whose models are used (default `frontpage`) |
| `PRESS_HERMES_BIN`, `PRESS_HERMES_PYTHON`, `HERMES_AGENT_DIR` | Where Hermes lives, if not `~/.local/bin/hermes` and `~/Projects/hermes/hermes-agent` |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | Where the one message goes |
| `PRESS_SITE_URL` | If set, `flip` checks the public site after an edition goes live |
| `PRESS_SEED_INDEX` | Manifest file to start from when a `local:` directory has none |
| `PRESS_LOOKAHEAD_DAYS` | How many days ahead to keep built (default 1) |
| `PRESS_REPLAY_DIR` | Answer every model call from recorded files (`brief.json`, `map.json`, `plate.png`) |
| `PRESS_RECORD_DIR` | Save live model answers in that layout |
| `PRESS_VAULT` | Obsidian vault directory the bookmark list is read from |

The only secret is the Telegram bot token, kept in a private env file outside
the repository. Pushing uses the git credentials already on the Mac. Which
models Hermes uses is set in the Hermes profile, not here.

## Install on the Mac

Nothing in this repository installs itself. One launchd job does everything:
`press/launchd/job.sh` updates the checkout from `main`, reads the bookmark
list from the vault, then runs the press. The template
`press/launchd/com.nockgarden.frontpage-press.plist` runs it six times a day
(06:20 to 21:20). The first run that finds tomorrow's edition missing builds
it; the rest are no-ops or retries.

```bash
git worktree add ../frontpage-press-live -b press-shadow origin/main   # a checkout only the press uses
cd ../frontpage-press-live && npm ci
npx tsx press/admin.mjs seed-ledger --from public/editions             # mark what the archive already used
```

Then write the private env file, fill `REPO_DIR` and `ENV_FILE` into the
plist, copy it to `~/Library/LaunchAgents/` and load it. To go live, stop the
old press and switch that checkout to `main`.

## Try it without Hermes or git

```bash
mkdir -p /tmp/press-demo/out/press /tmp/press-demo/replay
cp press/fixtures/2026-11-10-alliharvard/candidates.json /tmp/press-demo/out/press/
cp press/fixtures/2026-11-10-alliharvard/{brief,map}.json /tmp/press-demo/replay/
cp <any landscape png> /tmp/press-demo/replay/plate.png
PRESS_STORE=local:/tmp/press-demo/out PRESS_REPLAY_DIR=/tmp/press-demo/replay \
  PRESS_SEED_INDEX=public/editions/index.json npm run press -- run
```

## What is deliberately not here

No review gate, no proof registry, no recovery state, no source-fidelity gate, no
dependency audit or test suite in the daily path, no code repair. Tests run on
pull requests.
