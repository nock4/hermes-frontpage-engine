# Future plate transformation acceptance

`source_contract.must_transform` is the authoritative ordered mandatory list. Trusted code enumerates it verbatim; clause IDs include ordinal and a SHA-256 text digest. No keyword classifier, missing-detail heuristic, or model waiver decides membership. `buildSourceContract` already designates its chosen source composition moves as mandatory. Other fingerprint composition moves and visual-direction suggestions do **not** become additional acceptance clauses merely because they appear in the audit request.

Before mapping, `auditSourceImageFidelity` sends every exact clause, its ID, and a context digest binding the full contract, dominant image URL, exact owner references (payload artifact source URLs, lineage source URL and fingerprint page URL) and actual plate-byte SHA-256. The model must echo that context and return one ordered finding per clause:

```json
{
  "clause_id": "transform-<ordinal>-<text digest>",
  "clause": "exact mandatory contract text",
  "status": "fulfilled|failed|uncertain",
  "visible_evidence": "concrete visible location/form or contrary evidence",
  "context": "relevant source/plate relationship",
  "reason": "why the complete clause is or is not satisfied"
}
```

Only `fulfilled` with all three nonempty string evidence fields is accepted. Missing/duplicate/unknown/reordered/stale/misquoted/malformed findings or context, and every failed/uncertain clause, block independently of aggregate verdict and scores. A whole compound clause must be satisfied, not just its preservation half. Optional unrealized ideas and generic missing source details do not independently block this gate. There is no universal abstraction/minimalism requirement.

Existing identity/resemblance, non-overcopy, debug-mark, source-window-count, landscape, provenance and media/archive checks remain independent. The model may still misjudge pixels: this is strict validation of explicit visual findings, not a guarantee that a vision judgment is correct.

Run-only evidence: `source-fidelity-audit-request.json`, exact transport stdout in private mode-0600 `source-fidelity-audit-response.txt`, parsed original response plus unabridged `transformation_acceptance` (contract, IDs, context, plate hash, findings and blockers) in `source-fidelity-audit.json`. Fidelity always requests bounded lexical JSON duplicate-object-key rejection before parsing, including escaped key aliases, fenced and extracted JSON. Parse failures retain stdout and structured blocked diagnostics; no collapsed duplicate response becomes proof. All source/title/clause/image prose is explicitly untrusted data in the audit instructions. A blocking error carries the complete audit and acceptance as structured properties; existing recovery snapshots and diagnostics retain them without turning evidence into image captions.

Future candidate resume and the final pre-commit boundary use `ensureCurrentSourceFidelity`. The exported `commitPublishedArtifacts` also requires `{ runDir }`, validates that proof itself and compares the actual staged Git plate blob to the accepted plate hash, so alternate callers and clean filters cannot bypass the gate. They recompute normalizer decisions from saved raw response and exact current candidate bytes/contract, rather than trusting saved `pass`. Missing/old/inconsistent proof is preserved as `source-fidelity-audit.superseded-*.json` and requires a fresh bounded production audit. A fresh audit that throws stops publication; no image regeneration is performed by this boundary. Already-pushed proof-only recovery and static archive validation do not call it. Existing editions and old audits are not relabeled as new proof.

## Stage boundary and proof policy

This audit runs **before mapping**: a still plate can establish visibly distinct, artwork-native marks/edges/apertures and their material/compositional integration, not which edge actually opens a source. The absence of pasted annotations alone is not positive integration evidence. Every exact mandatory visual clause remains mandatory, including all compound requirements. Failed and uncertain findings remain blockers even when their reason mistakenly requests post-mapping behavior; fix the audit instructions, never reinterpret retained statuses.

Trusted `transformation_acceptance.audit_scope` declares `stage: pre-mapping-plate-visual`, `policy_revision: pre-map-visible-integration-v1`, and `runtime_source_window_function: not-assessed`. The descriptor is constructed by code, delivered in the actual request with explicit stage instructions, and included in the canonical context digest. It is not copied from model or source prose. Model claims of runtime success cannot establish functional acceptance; raw claims remain raw evidence only. The normalizer validates exact findings and context, not the truth of a vision observation: a model can still make an incorrect visual judgment. No keyword exemption or automatic semantic evidence classifier is introduced.

Schema version 1 remains the structural format; adding the context-bound policy revision changes the candidate proof identity. Prior-policy proof cannot silently attest this policy even with identical source, owner, clauses and plate. Future resume uses the existing supersede-and-re-audit path; the original bytes are preserved. This is candidate proof freshness, **not retroactive invalidation of accepted editions or archived audits**. Read-only archive validation is unchanged.

Post-mapping source binding/count, genuine visible-window geometry, hover/tap, preload, original-media and runtime/full-publish QA remain separate acceptance gates. Neither the visual pass nor a model assertion replaces them. No clauses are removed, retyped or promoted from optional to mandatory; no generation, budget or recovery policy changes here.

Tests in `tests/node/audit-stage-scope.test.mjs` exercise the delivered production request, trusted metadata/context, old-policy future resume and unchanged Nov7 raw-response rejection. The Nov7 fixtures retain exact historical contract and raw output; replay is offline, not a new vision verdict. Nov7's detached-face failure and universal-lettering uncertainty remain blockers independently of stage ambiguity. A later accepted edition may have a different exact contract; it is not evidence that Nov7's other clauses were fulfilled.

Tests in `tests/node/transformation-{contract-gate,resume,stage,commit}.test.mjs` are discovered by the normal `npm test` used in `qa:publish`/Runtime QA. Injected responses and test images are explicitly synthetic. Retained Nov5 contract/audit fixtures are real historical inputs, not new visual verdicts. Legacy prose/debug unit tests use an explicitly synthetic fulfilled-clause adapter so those independent checks remain isolated.
