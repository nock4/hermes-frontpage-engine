# Always-post policy and delivery ownership

Every scheduled **America/New_York** day owes an attempt to deliver one of:

1. **Verified daily edition** — only full accepted press proof, explicit independent visual pass, retained screenshot, and a matching live manifest plus edition identity qualify.
2. **Daily fallback — not a new edition** — dated today, exact last-verified edition ID/link, its retained screenshot, and an honest reason (missing accepted proof or live verification failure). Never fabricate content, mark old work new, reuse/consume archived source records, or weaken provenance, real-independent-source, fidelity, media, mobile, visual or publication QA gates. The authorized count contract is minimum 1, desired 6, maximum 10; zero remains invalid.

Fallback does **not** close repair, start another press, mutate the website, or roll back a healthy plate. The existing single 04:00 Eastern self-healing job remains responsible for repair. A later accepted same-day edition gets **one Recovery** update. A fresh manifest alone is not full acceptance.

## Timing and ownership

- Existing Hermes job `7d714808bf6f` remains agent-enabled at `0 4 * * *`. Its final output and failure notices are local. This avoids a second competing daily sender. Keep its detailed source/research/prompt report in the local artifacts; do not manually duplicate the watchdog's scheduled daily post.
- A frontpage-only **no-agent Hermes watchdog job**, `bf977ac15457`, runs `daily-frontpage-delivery-watchdog.sh` on `*/10 * * * *`, entering `scripts/delivery-watchdog-runner.py`. It never runs generation, an agent, or the press. Its scheduler output is local; the script owns direct supported Telegram transport. Unlike an independent OS service, it **does require the Hermes scheduler/gateway to remain running**. The installed scheduler dispatches jobs through a parallel executor (default unbounded, no frontpage serial override), so a busy self-heal agent does not itself serialize this watchdog.
- Before 07:00 Eastern, it may send an already accepted current edition. At/after 07:00 it attempts fallback if no accepted current live edition exists. While the host and scheduler are running normally, it is due at 07:00 and every ten minutes thereafter, with a **150-second delivery bound plus at most 40 seconds for telemetry** (remote requests 15 seconds each; Hermes transport 90 seconds). This is an attempt target, **not guaranteed external delivery or exact scheduler punctuality**.
- Explicit rollout cutoff `DFE_DELIVERY_START_DATE=2026-10-21` avoids resending Oct 20, which was already delivered. It is not a fabricated receipt.
- Independent existing GitHub monitor runs hourly at minute 17 (Eastern deadline evaluated in code, including DST). It opens/reopens one dated publication issue on a stale/unavailable site and closes on recovered manifest+edition proof. Its separate delivery step also checks the nonsecret host attestation described below; publication alone never proves Telegram delivery.

## Register accepted proof

Normal CLI acceptance registers the proof after the existing checker succeeds **and** explicit independent visual pass is present:

```sh
npm run press:proof -- --log <exact-accepted-log> --output <proof.json> --adversarial-visual-qa pass
```

Never manufacture a visual pass. Existing accepted proofs can be registered without generation:

```sh
python3 scripts/delivery-watchdog-runner.py --accept-proof <accepted-proof.json>
python3 scripts/delivery-watchdog-runner.py --dry-run
```

The registry, screenshots, prompt documents, receipts and alarms live in `~/.hermes/profiles/frontpage/delivery/`, **outside disposable tmp/cache**. Registration copies the accepted screenshot and exact scene prompt. Subsequent reads recheck full proof, independent visual status and screenshot SHA-256. The fallback links the exact accepted edition using `?edition=...` and labels the screenshot retained proof, not a current availability claim. If the registry is lost/corrupt, send honest text explaining screenshot unavailability rather than inventing one.

## Transport, idempotency and recovery

Delivery uses supported `hermes -p frontpage send --to telegram:2142213564 --json --file -` and the profile's existing credentials; no token copies, new account or core/default-profile changes. Success requires `success:true`, Telegram platform, exact chat ID and a message ID. This is a transport receipt, not proof Nick read the message. The strict Hermes media path reports partial/dropped attachments as failure.

The Python entrypoint takes a nonblocking OS `flock` (crash-safe). Each date/type receipt contains run identity. Pending intent is atomically persisted **before** sending; sent receipts prevent repeated sends even if reruns use a different press run ID. A fallback and its recovery are distinct types. Operational calls should use the Python entrypoint, not concurrently invoke the Node CLI directly.

Telegram does not offer transactional idempotency with the local ledger. If the transport times out, partially sends, or dies before recording the receipt, the intent stays `pending`/`uncertain`: **do not blindly retry** and risk duplicate photos/reports. The watchdog preserves local error evidence and uploads only allowlisted receipt status. The offhost workflow is the sole writer of `[Frontpage delivery] YYYY-MM-DD` alarms. Upload failure is a local nonzero error and subsequently becomes stale telemetry, never a delivery claim. Full-QA recovery may still proceed after an uncertain fallback. The delivery alarm closes only with a host-attested daily transport receipt and no uncertain same-day intents, never website freshness.

To resolve an uncertain intent:

1. Inspect the exact dated receipt and platform target; determine whether text/media actually arrived. Retain the original evidence.
2. If delivered, reconcile the receipt with real message IDs and documented evidence; never promote it from assumption. If definitely not delivered, explicitly authorize one retry after preserving the old receipt under a unique evidence filename. An ambiguous result requires a human/operator decision, not automatic duplicate sends.
3. Close the exact GitHub delivery alarm with transport evidence and read back the target state. Keep publication repair open until accepted independently.

## Installation and verification

```sh
# Installation: copy the thin wrapper under the frontpage profile scripts;
# do not create a duplicate if bf977ac15457 already exists.
hermes -p frontpage cron list
hermes -p frontpage cron run bf977ac15457
python3 scripts/delivery-watchdog-runner.py --diagnostic
```

For recreation only: `hermes -p frontpage cron create '*/10 * * * *' --name 'Frontpage delivery watchdog (no generation)' --script daily-frontpage-delivery-watchdog.sh --no-agent --deliver local --failure-deliver local --workdir /Users/nickgeorge-studio/Projects/hermes-frontpage-engine`. Read back the exact job and verify `no_agent:true`, local delivery, script and schedule. The thin installed wrapper simply executes the versioned `scripts/cron/daily-frontpage-delivery-watchdog.sh`.

An independent launchd watchdog was considered, but this supervised runtime **explicitly blocks launchctl bootstrap**. No LaunchAgent was installed and the guard was not bypassed. A separate user-authorized shell could install independent OS supervision later; it is not claimed here.

The diagnostic has its own date/type key, uses the accepted screenshot and an explicit diagnostic heading, and never writes a production delivery receipt or changes the website. Repeating it must retain the same transport receipt, not send again. Only after watchdog/transport verification should the existing press delivery be set to local; preserve the original job configuration before the edit.

## Offhost delivery observation (not offhost delivery)

After each ordinary watchdog invocation, under the same local flock, `delivery-attestation.mjs` writes and reads back the GitHub repository Actions variable `DFE_DELIVERY_ATTESTATION` using the existing authorized `gh` integration. Dry runs, diagnostics and proof registration do not upload. The strict allowlist contains only schema version, Eastern date, UTC heartbeat, accepted-current-proof boolean, and production receipt type/status. No chat/message IDs, paths, text, error strings, screenshot, prompt, token or run identity leave the host. This is a host assertion, not an independently fetched Telegram receipt or cryptographic signature.

The serialized existing offhost workflow independently evaluates this even if publication fails. After 07:00 Eastern from Oct 21, it distinguishes no/invalid heartbeat, heartbeat older than 30 minutes, fresh heartbeat with absent daily receipt, and explicit uncertain send intent. A current published edition or accepted proof cannot substitute for a receipt. A recorded same-day sent fallback/edition/recovery satisfies the daily post even if the host later stops, unless another same-day intent is uncertain. Unknown send outcomes are never labeled definitely failed. The workflow runs hourly, subject to GitHub schedule delays; alarms are not a 07:00 delivery guarantee.

Ownership is deliberately asymmetric: **Mac alone sends Telegram and writes telemetry; GitHub alone writes delivery issues.** Neither a stale heartbeat nor an issue grants a remote send lease. API partitions therefore cannot create a competing sender. Issue reconciliation uses one dated title, full paginated listing, readback and bounded visibility checks; no exactly-once claim is made across uncertain API acknowledgments. Existing-open incidents do not receive repeated comments; current classifications are retained in each Actions artifact. Old dated incidents remain open for manual historical reconciliation; a later day's receipt cannot close them.

The repository is public. Repository secret-name discovery and environment-name discovery found zero configured Actions secrets/environments; no secret values were read or exported. Supported Hermes messaging credentials are profile/machine scoped (official messaging documentation), so local credentials do not magically exist on Actions. **Required decision for actual offhost Telegram: approve provisioning dedicated Telegram bot/target secrets on GitHub and migrating all daily-send ownership to the remote service (rather than adding a second fallback sender).** Do not transfer credentials or enable that sender without approval. Public issues/Actions notifications are monitoring, not delivery of the daily post.

## Uncovered risks

- Mac asleep/powered off or Hermes scheduler/gateway down: the local watchdog cannot send; it catches the current day when next running. There is no offhost Telegram service. Missed whole offline days are not silently backdated as delivered.
- If the host goes offline after publishing but before chat delivery, the independent delivery step alarms even when publication is green. It cannot itself send Telegram or distinguish a powered-off Mac from a scheduler/upload/network failure.
- Network failure, credential expiry, Telegram/GitHub outage, delayed GitHub scheduling and ambiguous remote acknowledgment prevent an absolute guarantee. The durable ledger and remote publication alarm improve observability; they do not erase these dependencies.
- Keep the last-good site; no paid generation, archive republish, duplicate press jobs, or fabricated evidence is authorized by this policy.
