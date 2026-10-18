# Publication reliability operations

The existing press owner/kernel lock remains the only publication owner. No new Mac cron job is installed.

## Recovery and outcome records

`daily:publish:cron` now inspects exact JSON checkpoints under `tmp/cron-checkpoints` while holding that lock. Successive records for the same exact run directory collapse by recorded update time. A single same-date candidate resumes through the existing full QA/provenance/staged-byte gates; a pushed candidate uses proof-only. A completed current-day publication also uses proof-only rather than buying another plate. Completed older publications do not satisfy today. Unresolved old-date, absent-identity, or multiple candidate states fail closed for operator reconciliation; no evidence is automatically deleted. Explicit `--resume-candidate` / `--proof-only` remain operator recovery controls.

A package written just before interruption can provide the checkpoint's missing edition identity, but only under the exact retained worktree run directory. A machine-owned atomic record in `tmp/cron-outcomes` separates `execution` from `publication` (`verified`, `other-date`, `unverified`) and explicitly leaves agent and scheduler delivery unknown. These records are not a heartbeat. Abrupt process death or a completely full disk may prevent the final outcome write; absence is not success.

Legacy pushed checkpoints can be used for proof even when publication was manually recovered in the primary repository. Uncheckpointed historical artifacts are not guessed by mtime. Do not claim automated regeneration from every pre-package failure: these require operator repair of the retained state.

## Network and disk

Each remote manifest HTTPS attempt has a 15-second wall-clock deadline that destroys the request, including hangs before headers or during the body; response size is capped at 4 MiB. Existing bounded polling preserves exact expected edition identity; permanent HTTP 4xx (except 408/429) stops polling.

Cron refresh/generation requires 5 GiB available on both repository and worktree destination. Evidence preservation additionally measures the recursive evidence bytes without following symlinks, and requires those bytes plus 5 GiB on the archive destination before making a copy. Copy failure (including ENOSPC) aborts before worktree removal; partial copies are retained, never auto-pruned. This is a preflight, not a reservation against other processes consuming space. Direct standalone `daily:process` is not covered by the cron-only preflight.

## Off-host monitor

`.github/workflows/publication-deadline-monitor.yml` runs on GitHub independently of the Mac. Default deadline: **07:00 America/New_York**, evaluated with IANA timezone/DST rules. Scheduled checks: **11:17, 12:17, 13:17 UTC daily**; checks before the local deadline do not alert. Change repository variable `DFE_PUBLICATION_DEADLINE` (`HH:mm`) to change the local deadline; if moving it beyond the configured UTC check window, also update the schedule. GitHub can delay scheduled runs; this is not a guaranteed exact-minute alarm.

It checks the public current manifest, unique canonical live record and current Eastern date, then fetches that exact edition's `edition.json` identity. Without a machine heartbeat it reports **start state unknown**, not “cron did not start.” This proves available remote publication metadata, not playback/fidelity, served image bytes, or all QA gates. Optional `DFE_EXPECTED_EDITION_ID` lets a direct diagnostic assert a known exact ID.

Alert destination: an issue in **nock4/hermes-frontpage-engine**, title `[Frontpage publication] YYYY-MM-DD`, plus a failed GitHub Actions run. Notifications depend on the account's existing GitHub watch/Actions preferences; no Telegram/email delivery is promised. Concurrency serializes checks; exact issue title lookup across open and closed issues deduplicates each date. No new credentials/services: only the workflow's repository-scoped token (`contents:read`, `issues:write`). `workflow_dispatch` defaults to diagnostic/read-only, exercises real remote metadata and produces a job summary without opening an issue.

## Remaining scope

Prepared artwork reserve is **not implemented** by this layer. Existing observation metadata is not a reserve and must never bypass current byte validation, bookmark provenance, six-real-window gates, or the full one-use archive ledger. No paid editions or source-only preparation were run for this change. New genuinely unattended generation and real missed-day alert creation remain distinct from manual proof-only and read-only workflow diagnostics.
