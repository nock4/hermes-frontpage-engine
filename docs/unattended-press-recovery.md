# Unattended press ownership and recovery

## Entrypoints

The frontpage profile's two shell scripts delegate to versioned `scripts/cron/` scripts. `daily:publish:cron`, direct Node invocation, the base wrapper, and selfheal all validate the same kernel lock. The lock root is the primary Git common-directory owner, including from a linked worktree. Exit 75 means another owner; never remove the lock file. Metadata age does not grant ownership. The supervisor creates an independent guardian before starting commands, kills the owned process group on timeout/interruption/parent death/early exit, and retains outcome records under `tmp/press-owner/runs/`. The default whole-script bound is 6600 seconds, below Hermes's 7200-second script envelope. Deliberately daemonized children escaping the owned process group and machine sleep/host failure remain OS limits.

## Exact recovery state

Every publish invocation writes a unique `tmp/cron-checkpoints/*.json` and append-only checkpoint history. The final JSON and selfheal output name the exact path. `stage`, `latest_run_dir`, `local_edition_id`, `commit`, `push_succeeded`, and `remote_matches` are separate facts. `command_completed` or scheduler `ok` never means publication or live playback.

Before worktree refresh, `tmp/retained-cron/<id>/` preserves run artifacts and changed/untracked edition bytes. `git-recovery.json` records durable HEAD and index-tree refs, preserving staged content even when working bytes differ. Preservation failure blocks deletion. Retention is deliberately not pruned automatically; inspect disk usage and archive deliberately.

- **Packaged candidate / failed QA:** `bash scripts/cron/daily-frontpage-cron.sh --resume-candidate <checkpoint>` skips worktree refresh and generation, validates exact package provenance, reruns full QA and every normal publication gate. Repair code in the retained worktree deliberately if required; this command does not silently copy dirty primary code into it.
- **Already pushed / failed deployment, CI or attachments:** `bash scripts/cron/daily-frontpage-cron.sh --proof-only <checkpoint>` does no harvest, generation, QA regeneration, commit, or push. It freshly verifies the recorded remote edition and published commit CI, then captures attachments. Its new checkpoint never overwrites its input.
- **Fidelity:** existing bounded audit-guided recovery now snapshots failed bytes/prompt/audit before overwriting them.
- **Mapping:** one provider-inspection retry on the same plate; zero real observations get at most one same-source correction, with exact mapping diagnostics passed to the real-mark planner. One real independently owned window is valid; six is desired, not a repair threshold. Correction still must pass fidelity, real detection, package floor, original-media, provenance, full archive and publication gates. A failed correction is retained and blocked, not fed into blind source reselection.

## Safe scheduler proof (no new paid edition)

For an operator-authorized proof of the existing job, write the absolute already-published checkpoint path as the sole content of `tmp/next-cron-proof-only`, then invoke **existing** job `7d714808bf6f`. Selfheal atomically claims this one-use request under the lock and passes `--proof-only`. Blank or invalid requests fail closed. This tests scheduler → wrapper → remote/CI → screenshot/source/prompt → agent/report/delivery; it does **not** prove the next genuine unattended generation. Claimed request remains under `tmp/self-healing-cron/`.

The job remains `no_agent: false`: the pre-run collector intentionally returns zero so the recovery agent receives failures. Its output explicitly says publication unverified until the agent checks the checkpoint and proof. The agent must write a run-specific outcome including scheduler execution ID, exact checkpoint, edition, publication/CI, independent visual review, actual-provider playback (or still-image applicability), attachment paths, remaining blocker and logs. Missing outcome, zero tool calls, or a prompt dump is **not** verified unattended success, regardless of scheduler `last_status`.

## Verification

Deterministic injections: `npx vitest run tests/node/press-owner.test.mjs tests/node/cron-shell-wrapper.test.mjs tests/node/cron-recovery-state.test.mjs tests/node/mapping-recovery.test.mjs tests/node/real-mark-plan.test.mjs`.
Full unchanged gates: `npm run qa:publish`.
Do not count fixtures as provider evidence. Do not generate multiple paid editions to claim burn-in. Keep source caches outside disposable worktrees; cached observations are nominations, not transferable admission stamps. Real vault metadata probes should clone the cache so diagnostics do not consume tomorrow's queue.
