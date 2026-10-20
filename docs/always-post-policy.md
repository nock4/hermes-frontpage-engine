# Always-post policy and delivery ownership

Every scheduled **America/New_York** day owes an attempt to deliver one of:

1. **Verified daily edition** — only full accepted press proof, explicit independent visual pass, retained screenshot, and a matching live manifest plus edition identity qualify.
2. **Daily fallback — not a new edition** — dated today, exact last-verified edition ID/link, its retained screenshot, and an honest reason (missing accepted proof or live verification failure). Never fabricate content, mark old work new, reuse/consume archived source records, or weaken provenance, six-real-window, fidelity, media, mobile, visual or publication QA gates.

Fallback does **not** close repair, start another press, mutate the website, or roll back a healthy plate. The existing single 04:00 Eastern self-healing job remains responsible for repair. A later accepted same-day edition gets **one Recovery** update. A fresh manifest alone is not full acceptance.

## Timing and ownership

- Existing Hermes job `7d714808bf6f` remains agent-enabled at `0 4 * * *`. Its final output and failure notices are local. This avoids a second competing daily sender. Keep its detailed source/research/prompt report in the local artifacts; do not manually duplicate the watchdog's scheduled daily post.
- A frontpage-only **no-agent Hermes watchdog job**, `bf977ac15457`, runs `daily-frontpage-delivery-watchdog.sh` on `*/10 * * * *`, entering `scripts/delivery-watchdog-runner.py`. It never runs generation, an agent, or the press. Its scheduler output is local; the script owns direct supported Telegram transport. Unlike an independent OS service, it **does require the Hermes scheduler/gateway to remain running**. The installed scheduler dispatches jobs through a parallel executor (default unbounded, no frontpage serial override), so a busy self-heal agent does not itself serialize this watchdog.
- Before 07:00 Eastern, it may send an already accepted current edition. At/after 07:00 it attempts fallback if no accepted current live edition exists. While the host and scheduler are running normally, it is due at 07:00 and every ten minutes thereafter, with a **150-second whole-run bound** (remote requests 15 seconds each; Hermes transport 90 seconds). This is an attempt target, **not guaranteed external delivery or exact scheduler punctuality**.
- Explicit rollout cutoff `DFE_DELIVERY_START_DATE=2026-10-21` avoids resending Oct 20, which was already delivered. It is not a fabricated receipt.
- Independent existing GitHub publication monitor remains scheduled at 11:17/12:17/13:17 UTC (Eastern deadline evaluated in code, including DST). It opens/reopens one dated publication issue on a stale/unavailable site and closes on recovered manifest+edition proof. It does **not** prove machine startup or Telegram delivery.

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

Telegram does not offer transactional idempotency with the local ledger. If the transport times out, partially sends, or dies before recording the receipt, the intent stays `pending`/`uncertain`: **do not blindly retry** and risk duplicate photos/reports. The watchdog attempts a separately deduplicated GitHub `[Frontpage delivery] YYYY-MM-DD` alarm with the uncertainty, and preserves local error evidence. GitHub alarm failure also remains a local nonzero/log error, never a delivery claim. Full-QA recovery may still proceed after an uncertain fallback. The delivery alarm does not auto-close based on website freshness: reconcile its actual transport evidence.

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

## Uncovered risks

- Mac asleep/powered off or Hermes scheduler/gateway down: the local watchdog cannot send; it catches the current day when next running. There is no offhost Telegram service. Missed whole offline days are not silently backdated as delivered.
- If the host goes offline after publishing but before chat delivery, the offhost **publication** monitor may be green while Telegram is missing; it has no uploaded receipt/heartbeat. This gap is explicit.
- Network failure, credential expiry, Telegram/GitHub outage, delayed GitHub scheduling and ambiguous remote acknowledgment prevent an absolute guarantee. The durable ledger and remote publication alarm improve observability; they do not erase these dependencies.
- Keep the last-good site; no paid generation, archive republish, duplicate press jobs, or fabricated evidence is authorized by this policy.
