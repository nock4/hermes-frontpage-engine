# Independent final-candidate visual acceptance

The normal press automatically obtains a separate independent visual review after full QA. Its default producer is a foreground `hermes -p frontpage chat --oneshot --query-file … --format stream-json --model gpt-6.1-sol --toolsets vision --max-turns 16 --reasoning low` session. It captures the exact final plate/source and every desktop, mobile portrait and mobile landscape opened source surface, retains raw stdout/stderr and the actual returned session ID, then records the complete findings through the unchanged strict validator. The existing `press:review context|record|validate` commands remain local diagnostic/recording tools; they do not themselves call a provider or authenticate an identity. Reviewer provenance is process/session evidence plus **operator attestation**, not cryptographic independence. SHA-256 establishes retained-byte correspondence, not reviewer trust or truth of prose.

## Boundary and applicability

Every future invocation of `commitPublishedArtifacts` requires `runDir/independent-visual-review.json`, before staging and again against actual staged plate/preview/edition/map/bindings bytes immediately before commit/push. Normal fresh cron and `--resume-candidate` converge on this exported boundary. Primary source-fidelity PASS is still required when applicable and never substitutes for this receipt. Current primary proof normalization/re-audit, exact owner correspondence, complete ordered transformation clauses, full pixel decode, provenance and QA remain unchanged.

Source-field mode explicitly skips only source-image primary transformation scoring. It still requires independent final plate and opened desktop/mobile source-surface acceptance. No `null` source field, edition date, local `approved`/`live` flag or `proof_only` claim exempts a new candidate. Package assembly's `publish` flags describe candidate-local metadata in the isolated, nonserved cron worktree; they do not mean independent approval or remote publication. The irreversible boundary remains commit/push.

Already-pushed cron `--proof-only` continues remote/CI observation without generation/commit or archive-wide retrofit. New `press:proof` and delivery registration always validate the receipt, regardless of a supplied `--adversarial-visual-qa pass`. Missing labels are not green. For read-only delivery observation only, `legacy-accepted-proof-hashes.json` pins the exact 19 already-registered records through the accepted November 8 edition; changed bytes, new registration and unpublished candidates cannot use that exemption. This allowlist does not authorize any edition or plate. Existing accepted records/screenshots/November 8 bytes are not rewritten.

## Default unattended continuation (existing press owner)

Both normal fresh generation and `--resume-candidate` enter `completeCandidatePublication`:

1. Full `qa:publish`, exact package/run/source correspondence, actual-media editorial admission and current source fidelity run before review/publication.
2. Missing review is obtained automatically. An exact retained PASS is reused; a good plate awaiting review never triggers intake or generation. Raw completed reviewer output can be recorded after interruption without obtaining a second vote. Missing/incomplete/failed provider output remains an honest blocker, not synthetic approval.
3. Genuine plate/mandatory-transformation BLOCK is durable. The owner snapshots the complete rejected package, charges the persistent day repair allowance **before** provider I/O, and performs a same-source critique-directed repair in a new run. This reuses byte-identical research/harvest/acquisition-budget records, retains all mandatory clauses/ownership, and uses the existing generation, real-mark planning, source-fidelity, actual-object mapping, package, visual-surface and mask routines. It does not harvest, reset source budgets, consume another override or confer fresh eligibility.
4. The replacement must have changed plate bytes, the same source owner and exact mandatory contract. It repeats full QA and receives a new independent review before the unchanged working/staged/commit/push gates. Old BLOCK/raw evidence survive; explicit byte-bound successor links let normal recovery discovery and old checkpoints find the replacement rather than repeatedly selecting the rejected candidate.
5. Opened-source-only BLOCK preserves a good plate and emits `REVIEW_RUNTIME_REPAIR` with the retained critique to the **same existing 4am owner**, not Nick or a manual approval queue. That agent repairs the actual runtime, tests it and resumes the same checkpoint. An unchanged runtime cannot obtain another vote. Once runtime source bytes change, continuation automatically forks a new review context with the same plate, reruns full QA and obtains fresh evidence/review. Ordinary runtime/full-QA failures before review and proof-only failures likewise never cause generation.
6. There are at most **three charged repair contexts per publication day**, persisted outside the disposable candidate run; restarting the owner does not replenish them. Provider/generation requests and completed stage markers prevent duplicate image generation/review after interruption. Unknown outcomes require exact retained-session/result reconciliation, not silent retries or recursive cron replacement. The existing owner still owns any code repair or genuinely necessary unused-source selection under the original aggregate source/day budget. This is not an absolute daily-publication guarantee when external dependencies or hard execution limits are exhausted.

`automatic-review-request.json`, `automatic-review/evidence.json`, raw `hermes.stdout.jsonl` / `hermes.stderr.txt`, the canonical receipt, `automatic-review-action.json`, `rejected-package/`, explicit successor links and `tmp/cron-review-continuation/YYYY-MM-DD.json` are retained evidence/state, not an approval queue. Do not delete/reset them to advance the pipeline. A successful subprocess exit alone is never an accepted verdict.

The installed gateway-backed Hermes CLI currently lists but rejects `--image` and `--run-budget`; the adapter deliberately uses supported read-only vision tools on exact retained local paths and an outer foreground subprocess timeout instead. Per-session `--reasoning low` avoids inheriting a high-reasoning turn that the host's short idle-SSE watchdog repeatedly kills; model, provider, profile configuration and all acceptance clauses remain unchanged. The gateway can stream the complete final JSON while leaving terminal `result.text` empty: only the final assistant deltas after the last tool result are faithfully reconstructed, with the complete original stream retained. A PASS additionally requires actual successful full-resolution vision calls for every authoritative image. An accepted gateway session may outlive a timed-out CLI viewer; that is an **unknown, still-blocking review**, not completion or permission to submit a new vote. The same owner must reconcile/interrupt the exact retained session before ending recovery. No approval bypass, configuration/authentication change, new job or second-model voting is used.

The real adapter smoke used explicitly synthetic red placeholder artwork with deliberately absent source windows. Its separate reviewer actually inspected five images and returned BLOCK with eleven retained adverse findings; this validates producer/transport/recording, **not** a real edition's visual acceptance. The isolated local-bare-Git integration uses clearly synthetic review/repair adapters, real changed PNG pixels, the normal/resume shared completion boundary and real staged/commit/push/readback gates. It is not production publication proof.

## Diagnostic external review → record → resume (not the default handoff)

1. Run the normal press under its existing owner. It assembles the candidate and runs full QA. Missing independent evidence fails closed before `git add`/commit/push; the exact checkpoint, package and run remain available. Do **not** regenerate a good candidate or run another fresh press to evade a missing/negative review.
2. From the same retained worktree, obtain the exact binding for the external reviewer:

   ```sh
   npm run --silent press:review -- context --worktree "$WORKTREE" --run-dir "$RUN_DIR" --edition "$EDITION_ID" > "$RUN_DIR/review-context.json"
   ```

   Context output is identity/criteria only, **not an approval template**. Give the reviewer the actual complete plate, actual source image where available, complete source contract and existing desktop/mobile opened-surface evidence. Require every compound clause in full; no primary-model self-review or pass by aggregate score. Runtime-function claims require actual runtime evidence, not still-image inference.
3. Retain the actual external report/transcript and visual evidence under the run directory. Preserve every adverse finding. The external reviewer/operator supplies `external-review-report.json` with this exact schema (unknown keys, duplicate JSON keys and unsafe references fail):

   - `schema_version: 1`
   - `binding`: the complete unchanged object emitted by `context`
   - `reviewer`: `{kind: "human"|"subagent", id, delegation_id, session_id}`; all identifiers are nonempty strings identifying the actual review, not invented attestations. A human can use a meaningful operator/review-session reference for delegation.
   - `verdict: "PASS"|"BLOCK"`
   - `findings`: exactly one row per `binding.required_clauses`, same order and exact `clause_id`/`clause`; add `status: "fulfilled"|"failed"|"uncertain"`, nonempty `visible_evidence`, `context`, `reason`. PASS requires **all fulfilled**.
   - `adverse_findings`: array of retained adverse finding strings; PASS requires empty. Do not hide contrary findings in a positive label. The tool checks structured semantics, not the truth/completeness of arbitrary prose.
   - `evidence`: nonempty array of `{path, sha256, role}` for real retained raw external report/transcript and screenshots. Paths are relative within the exact run, never absolute/traversing/escaping symlinks; bytes must exist and match. A generic operator assertion is not independent evidence.
   - `source_snapshot`: `{path, sha256, unavailable_reason}`. Retain/hash the actual reviewed source-image bytes when available. For no retained source bytes use null path/hash and a specific honest reason; this is **not** source-byte proof. Never download a potentially changed URL and pretend its bytes were reviewed earlier. Source URL, owner, complete contract and payload bytes are always bound; snapshot bytes, when supplied, are additionally checked. A source-field review must explicitly explain source-image nonapplicability, not invent a primary vision pass.

4. Record once (no overwrite/waiver command):

   ```sh
   npm run press:review -- record --worktree "$WORKTREE" --run-dir "$RUN_DIR" --edition "$EDITION_ID" --report "$RUN_DIR/external-review-report.json"
   npm run press:review -- validate --worktree "$WORKTREE" --run-dir "$RUN_DIR" --edition "$EDITION_ID"
   ```

   BLOCK is recordable and sticky. Validation/publication fails on it. `CANDIDATE-DISPOSITION.json` with BLOCK/false authorization also wins over PASS. Primary re-audit/recovery never writes or erases either record. A changed candidate needs a new retained review/run; do not erase an old BLOCK or move an identical failed plate to another run to evade it. Nick override/review reversal is deliberately unsupported.
5. Resume the **existing packaged candidate**, using the preserved checkpoint (existing owner/provenance/full-QA gates rerun, no intake/image generation):

   ```sh
   bash scripts/cron/daily-frontpage-cron.sh --resume-candidate "$CHECKPOINT"
   ```

   This operational command can commit/push and must only be run with publication authorization. It was **not run on a real candidate during this repair**. Offline tests exercise the context/record/validate commands and the real exported publication boundary with a rejecting Git hook, plus existing local-only push-failure recovery.
6. After actual publication, run the existing live proof and `press:proof --adversarial-visual-qa pass`. New delivery registration copies the exact review, raw evidence, source snapshot if present, payload and reviewed candidate files to a durable delivery-only snapshot. Read-only latest-accepted/fallback validates that snapshot after disposable worktree cleanup; it cannot be used for a new commit or new registration. Fallback remains communication about the last accepted edition, never acceptance of another plate.

## Limits and operating trust

Local files are writable by the operator. The receipt is neither a signature nor protection against a malicious operator forging reviewer metadata, evidence or a complete registry. The gate enforces explicit retained review, exact bytes, structured negatives and fail-closed conflicts within the supported press path. It does not infer genuine independence from a JSON `kind`, interpret arbitrary report prose, police deliberate manual Git bypasses, scan/retrofit archive editions, or authorize generation/release. A reviewer must actually inspect the supplied evidence; a host must retain it. Failed/partial durable snapshot writes remain diagnostics, not accepted proof. Existing older operational checkouts do not acquire this gate until explicitly updated.
