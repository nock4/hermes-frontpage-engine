# Independent final-candidate visual acceptance

`press:review` is a local recording/validation tool, not a reviewer. It never calls a provider, generates a plate, votes with the primary vision worker, or authenticates an identity. The Hermes press owner must obtain an actual separate human/subagent review, retain the raw report/transcript and screenshots, then record its findings. Reviewer kind/id/delegation/session are **operator-attested provenance**, not cryptographically proved independence. SHA-256 establishes retained-byte correspondence, not reviewer trust or truth of prose.

## Boundary and applicability

Every future invocation of `commitPublishedArtifacts` requires `runDir/independent-visual-review.json`, before staging and again against actual staged plate/preview/edition/map/bindings bytes immediately before commit/push. Normal fresh cron and `--resume-candidate` converge on this exported boundary. Primary source-fidelity PASS is still required when applicable and never substitutes for this receipt. Current primary proof normalization/re-audit, exact owner correspondence, complete ordered transformation clauses, full pixel decode, provenance and QA remain unchanged.

Source-field mode explicitly skips only source-image primary transformation scoring. It still requires independent final plate and opened desktop/mobile source-surface acceptance. No `null` source field, edition date, local `approved`/`live` flag or `proof_only` claim exempts a new candidate. Package assembly's `publish` flags describe candidate-local metadata in the isolated, nonserved cron worktree; they do not mean independent approval or remote publication. The irreversible boundary remains commit/push.

Already-pushed cron `--proof-only` continues remote/CI observation without generation/commit or archive-wide retrofit. New `press:proof` and delivery registration always validate the receipt, regardless of a supplied `--adversarial-visual-qa pass`. Missing labels are not green. For read-only delivery observation only, `legacy-accepted-proof-hashes.json` pins the exact 19 already-registered records through the accepted November 8 edition; changed bytes, new registration and unpublished candidates cannot use that exemption. This allowlist does not authorize any edition or plate. Existing accepted records/screenshots/November 8 bytes are not rewritten.

## Supported pause → external review → record → resume

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
