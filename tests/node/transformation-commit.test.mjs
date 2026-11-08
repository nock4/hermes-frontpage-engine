import { syntheticReview } from '../fixtures/independent-review.mjs'
import { assertIndependentVisualReview, recordIndependentVisualReview } from '../../scripts/lib/independent-visual-review.mjs'
import { buildPublishProof, checkPressProof } from '../../scripts/lib/press-proof.mjs'
import { acceptProof } from '../../scripts/delivery-watchdog.mjs'
import { runCheckPressProof } from '../../scripts/check-press-proof.mjs'
import { describe, it, expect } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { platePng } from '../fixtures/plate-png.mjs'
import { auditSourceImageFidelity } from '../../scripts/lib/source-fidelity-audit.mjs'
import { commitPublishedArtifacts, ensureCandidateSourceFidelity } from '../../scripts/run-daily-publish-cron.mjs'
import { readCandidateCheckpoint } from '../../scripts/lib/cron-recovery-state.mjs'

const id = '2026-11-06-synthetic-transformation-v1'
async function candidate() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dfe-transform-commit-'))
  const assets = path.join(root, 'public/editions', id, 'assets')
  await fs.mkdir(assets, { recursive: true })
  for (const name of ['plate.png', 'preview.png']) await fs.writeFile(path.join(assets, name), platePng())
  await fs.writeFile(path.join(root, 'public/editions/index.json'), JSON.stringify({ current_edition_id: id, editions: [{ edition_id: id, is_live: true, path: `/editions/${id}`, preview_asset_path: `/editions/${id}/assets/preview.png` }] }))
  await fs.writeFile(path.join(assets, '../edition.json'), JSON.stringify({ edition_id: id, plate_asset_path: `/editions/${id}/assets/plate.png` }))
  const git = (...args) => execFileSync('git', args, { cwd: root, stdio: 'pipe' })
  git('init', '-q'); git('config', 'user.email', 'synthetic@example.invalid'); git('config', 'user.name', 'Synthetic fixture'); git('config', 'status.showUntrackedFiles', 'all')
  // No remote, and commit hook is a safety stop even if a gate regresses.
  await fs.writeFile(path.join(root, '.git/hooks/pre-commit'), '#!/bin/sh\necho SYNTHETIC_COMMIT_HOOK >&2\nexit 1\n', { mode: 0o755 })
  const runDir = path.join(root, 'tmp/daily-process-runs/retained-synthetic-run')
  await fs.mkdir(runDir, { recursive: true })
  await fs.writeFile(path.join(root, '.git/info/exclude'), 'tmp/\n')
  const source = 'https://example.org/synthetic-source.jpg'
  const owner = 'https://example.org/owner-a'
  const payload = { artifacts: [{ source_url: owner }], source_image_fingerprints: [{ image_url: source, page_url: owner }], source_contract: { mode: 'source-image', dominant_source_image_url: source, must_transform: ['Separate the source forms.'] } }
  await fs.writeFile(path.join(runDir, 'edition-package-summary.json'), JSON.stringify({ edition_id: id, edition_dir: path.dirname(assets) }))
  await fs.writeFile(path.join(assets, '../edition.json'), JSON.stringify({ edition_id: id, plate_asset_path: `/editions/${id}/assets/plate.png`, artifact_map_id: `map-${id}`, source_binding_set_id: `bindings-${id}` }))
  await fs.writeFile(path.join(assets, '../artifact-map.json'), JSON.stringify({ artifact_map_id: `map-${id}`, artifacts: [{ id: 'artifact-a', source_binding_ids: ['binding-a'] }] }))
  await fs.writeFile(path.join(assets, '../source-bindings.json'), JSON.stringify({ source_binding_set_id: `bindings-${id}`, bindings: [{ id: 'binding-a', artifact_id: 'artifact-a', source_url: owner, source_image_url: source }] }))
  await fs.writeFile(path.join(runDir, 'daily-generation-payload.json'), JSON.stringify(payload))
  await auditSourceImageFidelity({ payload, platePath: path.join(assets, 'plate.png') }, runDir, {
    writeJson: (p, v) => fs.writeFile(p, JSON.stringify(v)), createContactSheetImpl: async () => {},
    openAiJsonImpl: async request => {
      const prompt = JSON.parse(request.input[0].content[0].text)
      return { verdict: 'pass', resemblance_score: 0.9, framing_score: 0.9, object_relationship_score: 0.9, context_score: 0.9, transformation_score: 0.9,
        transformation_context_id: prompt.transformation_context_id, transformation_findings: prompt.required_transformations.map(row => ({ ...row, status: 'fulfilled', visible_evidence: 'SYNTHETIC separated left/right forms.', context: 'SYNTHETIC source relationship.', reason: 'SYNTHETIC positive test finding, not real vision.' })) }
    },
  })
  return { root, runDir, git }
}
describe('exported commit boundary cannot bypass future typed acceptance (synthetic)', () => {
  it('primary PASS without independent receipt stops before staging or commit', async () => {
    const x = await candidate()
    await expect(commitPublishedArtifacts(x.root, id, 'main', { runDir: x.runDir })).rejects.toThrow(/independent visual review/)
    expect(x.git('diff', '--cached', '--name-only').toString()).toBe('')
    expect(() => x.git('rev-parse', '--verify', 'HEAD')).toThrow()
  })
  it('primary PASS cannot override retained canonical BLOCK', async () => {
    const x = await candidate()
    await fs.writeFile(path.join(x.runDir, 'CANDIDATE-DISPOSITION.json'), JSON.stringify({ disposition: 'BLOCK', publication_authorized: false }))
    await expect(commitPublishedArtifacts(x.root, id, 'main', { runDir: x.runDir })).rejects.toThrow(/independent visual review.*BLOCK/)
    expect(x.git('diff', '--cached', '--name-only').toString()).toBe('')
  })
  it('rejects an unrelated SKIPPED run for a source-image candidate before the guard hook', async () => {
    const x = await candidate()
    const unrelated = path.join(x.root, '.git/unrelated')
    await fs.mkdir(unrelated)
    await fs.writeFile(path.join(unrelated, 'daily-generation-payload.json'), JSON.stringify({ source_contract: { mode: 'skipped-no-valid-dominant-source-image' }, source_image_fingerprints: [] }))
    await expect(commitPublishedArtifacts(x.root, id, 'main', { runDir: unrelated })).rejects.toThrow(/mandatory transformation.*correspondence/)
    expect(() => x.git('rev-parse', '--verify', 'HEAD')).toThrow()
  })
  it('rejects owner-swapped retained proof at the actual commit boundary before the guard hook', async () => {
    const x = await candidate()
    const file = path.join(x.runDir, 'daily-generation-payload.json')
    const payload = JSON.parse(await fs.readFile(file, 'utf8'))
    payload.artifacts[0].source_url = payload.source_image_fingerprints[0].page_url = 'https://example.org/owner-b'
    payload.lineage = { source_url: 'https://example.org/owner-b' }
    await fs.writeFile(file, JSON.stringify(payload))
    await expect(commitPublishedArtifacts(x.root, id, 'main', { runDir: x.runDir })).rejects.toThrow(/mandatory transformation.*correspondence/)
  })
  it('preserves legitimate corresponding source-field skip without an editorial pass', async () => {
    const x = await candidate()
    const file = path.join(x.runDir, 'daily-generation-payload.json')
    const payload = JSON.parse(await fs.readFile(file, 'utf8'))
    payload.source_contract = { mode: 'skipped-no-valid-dominant-source-image' }
    payload.source_image_fingerprints = []
    await fs.writeFile(file, JSON.stringify(payload))
    await syntheticReview({ worktreeDir: x.root, runDir: x.runDir, editionId: id })
    await expect(commitPublishedArtifacts(x.root, id, 'main', { runDir: x.runDir })).rejects.toThrow(/git commit/)
  })
  it('rejects callers with no retained run proof before commit/push', async () => {
    const x = await candidate()
    await expect(commitPublishedArtifacts(x.root, id, 'main')).rejects.toThrow(/mandatory transformation/)
    expect(() => x.git('rev-parse', '--verify', 'HEAD')).toThrow()
  })
  it('accepts exact typed proof and reaches the unchanged rejecting commit hook', async () => {
    const x = await candidate()
    await syntheticReview({ worktreeDir: x.root, runDir: x.runDir, editionId: id })
    await expect(commitPublishedArtifacts(x.root, id, 'main', { runDir: x.runDir })).rejects.toThrow(/git commit/)
    expect(() => x.git('rev-parse', '--verify', 'HEAD')).toThrow()
  })
  it('rejects same-orientation but different staged plate bytes after a clean filter', async () => {
    const x = await candidate()
    await syntheticReview({ worktreeDir: x.root, runDir: x.runDir, editionId: id })
    await fs.writeFile(path.join(x.root, '.git/filter.cjs'), `process.stdin.resume();process.stdin.on('end',()=>process.stdout.write(Buffer.from('${platePng(18, 10).toString('base64')}', 'base64')));`)
    x.git('config', 'filter.synthetic.clean', `${process.execPath} .git/filter.cjs`)
    x.git('config', 'filter.synthetic.required', 'true')
    await fs.writeFile(path.join(x.root, '.git/info/attributes'), `public/editions/${id}/assets/plate.png filter=synthetic\n`)
    await expect(commitPublishedArtifacts(x.root, id, 'main', { runDir: x.runDir })).rejects.toThrow(/mandatory transformation.*staged plate/)
    expect(() => x.git('rev-parse', '--verify', 'HEAD')).toThrow()
  })

  it.each(['run_dir', 'source_image_url', 'source_owner', 'source_contract', 'policy_revision', 'stage', 'primary_policy_revision', 'candidate_files'])('rejects stale receipt %s', async field => {
    const x = await candidate(), options = { worktreeDir: x.root, runDir: x.runDir, editionId: id }
    const { report } = await syntheticReview(options)
    report.binding[field] = 'stale'
    await fs.writeFile(path.join(x.runDir, 'independent-visual-review.json'), JSON.stringify(report))
    await expect(commitPublishedArtifacts(x.root, id, 'main', { runDir: x.runDir })).rejects.toThrow(/independent visual review.*stale/)
  })
  it.each(['failed', 'uncertain', 'reordered', 'adverse', 'primary', 'duplicate', 'proto', 'traversal', 'hash', 'symlink', 'missing'])('rejects unsafe or contradictory review: %s', async fault => {
    const x = await candidate(), options = { worktreeDir: x.root, runDir: x.runDir, editionId: id }
    const { report } = await syntheticReview(options)
    if (['failed', 'uncertain'].includes(fault)) report.findings[2].status = fault
    if (fault === 'reordered') report.findings.reverse()
    if (fault === 'adverse') report.adverse_findings.push('Required face detachment failed.')
    if (fault === 'primary') report.reviewer.kind = 'primary-model'
    if (fault === 'traversal') report.evidence[0].path = '../outside.txt'
    if (fault === 'hash') await fs.writeFile(path.join(x.runDir, report.evidence[0].path), 'tampered')
    if (fault === 'missing') await fs.unlink(path.join(x.runDir, report.evidence[0].path))
    if (fault === 'symlink') {
      const file = path.join(x.runDir, report.evidence[0].path)
      await fs.rename(file, path.join(x.root, '.git/outside.txt'))
      await fs.symlink(path.join(x.root, '.git/outside.txt'), file)
    }
    let raw = JSON.stringify(report)
    if (fault === 'duplicate') raw = raw.replace('"verdict":"PASS"', '"verdict":"BLOCK","verdict":"PASS"')
    if (fault === 'proto') raw = raw.replace('"schema_version":1', '"schema_version":1,"__proto__":{}')
    await fs.writeFile(path.join(x.runDir, 'independent-visual-review.json'), raw)
    expect(() => assertIndependentVisualReview(options)).toThrow(/independent visual review/)
  })
  it('retains BLOCK immutably across primary PASS and refuses replacement', async () => {
    const x = await candidate(), options = { worktreeDir: x.root, runDir: x.runDir, editionId: id }
    const { report, file } = await syntheticReview(options, { record: false })
    report.verdict = 'BLOCK'; report.findings[2].status = 'failed'; report.adverse_findings.push('Synthetic face detachment failure.')
    await fs.writeFile(file, JSON.stringify(report)); recordIndependentVisualReview(options, file)
    const before = await fs.readFile(path.join(x.runDir, 'independent-visual-review.json'))
    const primaryFile = path.join(x.runDir, 'source-fidelity-audit.json')
    const savedPrimary = await fs.readFile(primaryFile)
    await fs.writeFile(primaryFile, '{}')
    let audits = 0
    await ensureCandidateSourceFidelity(options, { audit: async () => { audits++; await fs.writeFile(primaryFile, savedPrimary) } })
    expect(audits).toBe(1)
    await expect(commitPublishedArtifacts(x.root, id, 'main', { runDir: x.runDir })).rejects.toThrow(/independent visual review.*BLOCK/)
    report.verdict = 'PASS'; report.findings[2].status = 'fulfilled'; report.adverse_findings = []
    await fs.writeFile(file, JSON.stringify(report))
    expect(() => recordIndependentVisualReview(options, file)).toThrow(/EEXIST/)
    expect(await fs.readFile(path.join(x.runDir, 'independent-visual-review.json'))).toEqual(before)
  })
  it('source-field applicability does not waive independent review', async () => {
    const x = await candidate()
    await fs.writeFile(path.join(x.runDir, 'daily-generation-payload.json'), JSON.stringify({ artifacts: [{ source_url: 'https://example.org/owner-a' }], source_contract: { mode: 'skipped-no-valid-dominant-source-image' }, source_image_fingerprints: [] }))
    await expect(commitPublishedArtifacts(x.root, id, 'main', { runDir: x.runDir })).rejects.toThrow(/independent visual review/)
  })
  it('rejects changed staged bindings even when plate and primary PASS are unchanged', async () => {
    const x = await candidate(), options = { worktreeDir: x.root, runDir: x.runDir, editionId: id }
    await syntheticReview(options)
    await fs.writeFile(path.join(x.root, '.git/filter.cjs'), `let b='';process.stdin.on('data',x=>b+=x);process.stdin.on('end',()=>{const v=JSON.parse(b);v.synthetic_extra='changed';process.stdout.write(JSON.stringify(v))});`)
    x.git('config', 'filter.synthetic.clean', `${process.execPath} .git/filter.cjs`)
    await fs.writeFile(path.join(x.root, '.git/info/attributes'), `public/editions/${id}/source-bindings.json filter=synthetic\n`)
    await expect(commitPublishedArtifacts(x.root, id, 'main', { runDir: x.runDir })).rejects.toThrow(/independent visual review.*stale/)
  })
  it('press proof cannot green from missing label or a claimed pass without canonical receipt', async () => {
    const x = await candidate()
    for (const label of [undefined, 'pass']) {
      const proof = buildPublishProof({ summary: { ok: true, local_edition_id: id, local_publish_status: 'live', remote_matches: true, push_succeeded: true, worktree_dir: x.root, latest_run_dir: x.runDir },
        liveProof: { pageEditionId: id, loadedPlateImageCount: 1, artifactCount: 1, plate: { src: `/editions/${id}/assets/plate.png`, naturalWidth: 1536, naturalHeight: 1024 } },
        screenshotPath: 'synthetic.png', promptPath: 'synthetic.txt', qa: { qaPublishPassed: true, adversarialVisualQa: label } })
      expect(checkPressProof(proof).green).toBe(false)
      await expect(acceptProof({ ...proof, status: 'green' }, path.join(x.root, '.git/registry'))).rejects.toThrow()
    }
  })
  it('offline supported context -> external report -> record -> validate -> resume commit boundary', async () => {
    const x = await candidate(), options = { worktreeDir: x.root, runDir: x.runDir, editionId: id }
    const cli = path.resolve('scripts/independent-visual-review.mjs')
    const args = ['--worktree', x.root, '--run-dir', x.runDir, '--edition', id]
    const checkpoint = path.join(x.runDir, 'checkpoint.json')
    await fs.writeFile(checkpoint, JSON.stringify({ worktree_dir: x.root, latest_run_dir: x.runDir, local_edition_id: id, push_succeeded: false }))
    const recovered = await readCandidateCheckpoint(checkpoint, x.root)
    await expect(commitPublishedArtifacts(recovered.worktree_dir, id, 'main', { runDir: recovered.latest_run_dir })).rejects.toThrow(/independent visual review/)
    const context = JSON.parse(execFileSync(process.execPath, [cli, 'context', ...args], { encoding: 'utf8' }))
    const { report, file } = await syntheticReview(options, { record: false })
    expect(context).toEqual(report.binding)
    execFileSync(process.execPath, [cli, 'record', ...args, '--report', file])
    expect(JSON.parse(execFileSync(process.execPath, [cli, 'validate', ...args], { encoding: 'utf8' })).verdict).toBe('PASS')
    await expect(commitPublishedArtifacts(x.root, id, 'main', { runDir: x.runDir })).rejects.toThrow(/git commit/)
    expect(() => execFileSync(process.execPath, [cli, 'record', ...args, '--report', file], { stdio: 'pipe' })).toThrow()
  })
  it('supported press:proof rereads receipt and rejects contradictory BLOCK despite pass flag', async () => {
    const x = await candidate(), options = { worktreeDir: x.root, runDir: x.runDir, editionId: id }
    await syntheticReview(options)
    const summary = { ok: true, local_edition_id: id, local_publish_status: 'live', remote_matches: true, push_succeeded: true, worktree_dir: x.root, latest_run_dir: x.runDir }
    const log = path.join(x.runDir, 'cron.log')
    await fs.writeFile(log, [JSON.stringify(summary), 'qa:publish Test Files 1 passed', 'Screenshot: synthetic.png', 'Actual plate prompt: synthetic.txt', `Live preload proof: ${JSON.stringify({ pageEditionId: id, artifactCount: 1, loadedPlateImageCount: 1, plate: { src: `/editions/${id}/assets/plate.png`, naturalWidth: 1536, naturalHeight: 1024 } })}`].join('\n'))
    expect((await runCheckPressProof({ log, adversarialVisualQa: 'pass' })).checked.green).toBe(true)
    await fs.writeFile(path.join(x.runDir, 'CANDIDATE-DISPOSITION.json'), JSON.stringify({ disposition: 'BLOCK', publication_authorized: false }))
    expect((await runCheckPressProof({ log, adversarialVisualQa: 'pass' })).checked.green).toBe(false)
  })
})
