# Public setup

## Requirements
- Node `^20.19.0 || >=22.12.0`
- npm
- `OPENAI_API_KEY`
- `browser-harness` available on your `PATH` or pointed to by `BROWSER_HARNESS_PATH`

## First run

```bash
npm install
cp .env.example .env
npm run demo:sample
```

That sample command uses the repo's starter manifest so you can test the public flow without Obsidian.

## Configure your own inputs

Manifest mode:

```bash
npm run daily:process -- --input-mode manifest --signal-manifest ./path/to/signals.json
```

Markdown-folder mode:

```bash
npm run daily:process -- --input-mode markdown-folder --input-root ./path/to/notes
```

Legacy Obsidian mode:

```bash
npm run daily:process -- --input-mode obsidian-allowlist --input-root /path/to/vault
```

## Browser harness notes

From-scratch generation still uses browser-harness after source selection so Hermes can capture richer page evidence.
If `browser-harness` is not on your `PATH`, set:

```bash
BROWSER_HARNESS_PATH=/absolute/path/to/browser-harness
```

## Preview

```bash
npm run build
npm run demo:preview
```

If you intentionally need a public Cloudflare quick tunnel for remote review, use:

```bash
ALLOW_PUBLIC_TUNNEL=1 ./scripts/start-preview-tunnel.sh
```

Anyone with that URL can reach your local preview until you stop the tunnel.

## Quick verification

```bash
npm run check:setup
npm test -- tests/node/frontpage-config.test.mjs tests/node/signal-adapters.test.mjs tests/node/signal-mining.test.mjs
```
