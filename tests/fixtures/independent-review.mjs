import os from 'node:os'
import { platePng } from './plate-png.mjs'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { independentReviewExpectation, recordIndependentVisualReview } from '../../scripts/lib/independent-visual-review.mjs'

// Explicitly synthetic offline acceptance, never a real independent vision result.
export async function syntheticReview(options, { record = true } = {}) {
  const evidence = Buffer.from('SYNTHETIC TEST ONLY: external review transcript; no provider inspection or real editorial approval.\n')
  await fs.writeFile(path.join(options.runDir, 'synthetic-review-transcript.txt'), evidence)
  const binding = independentReviewExpectation(options)
  const report = { schema_version: 1, binding,
    reviewer: { kind: 'subagent', id: 'SYNTHETIC-REVIEWER', delegation_id: 'SYNTHETIC-DELEGATION', session_id: 'SYNTHETIC-SESSION' },
    verdict: 'PASS', findings: binding.required_clauses.map(row => ({ ...row, status: 'fulfilled', visible_evidence: 'SYNTHETIC visible evidence.', context: 'SYNTHETIC context.', reason: 'SYNTHETIC fixture only.' })), adverse_findings: [],
    evidence: [{ path: 'synthetic-review-transcript.txt', sha256: createHash('sha256').update(evidence).digest('hex'), role: 'raw independent transcript (synthetic)' }],
    source_snapshot: { path: null, sha256: null, unavailable_reason: 'Synthetic test fixture: no source image fetched.' } }
  const file = path.join(options.runDir, 'synthetic-report.json')
  await fs.writeFile(file, JSON.stringify(report))
  if (record) recordIndependentVisualReview(options, file)
  return { report, file }
}

export async function syntheticProofContext(editionId, root = null, runDir = null) {
  root ||= await fs.mkdtemp(path.join(os.tmpdir(), 'synthetic-independent-proof-'))
  runDir ||= path.join(root, '.retained-synthetic-run')
  const dir = path.join(root, 'public/editions', editionId)
  await fs.mkdir(path.join(dir, 'assets'), { recursive: true })
  await fs.mkdir(runDir, { recursive: true })
  const owner = 'https://example.org/synthetic-owner'
  await fs.writeFile(path.join(runDir, 'edition-package-summary.json'), JSON.stringify({ edition_id: editionId, edition_dir: dir }))
  await fs.writeFile(path.join(runDir, 'daily-generation-payload.json'), JSON.stringify({ artifacts: [{ source_url: owner }], source_contract: { mode: 'skipped-no-valid-dominant-source-image' }, source_image_fingerprints: [] }))
  await fs.writeFile(path.join(dir, 'edition.json'), JSON.stringify({ edition_id: editionId, plate_asset_path: `/editions/${editionId}/assets/plate.png`, artifact_map_id: 'synthetic-map', source_binding_set_id: 'synthetic-bindings' }))
  await fs.writeFile(path.join(dir, 'artifact-map.json'), JSON.stringify({ artifact_map_id: 'synthetic-map', artifacts: [{ id: 'a', source_binding_ids: ['b'] }] }))
  await fs.writeFile(path.join(dir, 'source-bindings.json'), JSON.stringify({ source_binding_set_id: 'synthetic-bindings', bindings: [{ id: 'b', artifact_id: 'a', source_url: owner }] }))
  for (const name of ['plate.png', 'preview.png']) await fs.writeFile(path.join(dir, 'assets', name), platePng())
  await syntheticReview({ worktreeDir: root, runDir, editionId })
  return { worktree_dir: root, latest_run_dir: runDir }
}
