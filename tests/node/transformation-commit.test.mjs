import { describe, it, expect } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { platePng } from '../fixtures/plate-png.mjs'
import { auditSourceImageFidelity } from '../../scripts/lib/source-fidelity-audit.mjs'
import { commitPublishedArtifacts } from '../../scripts/run-daily-publish-cron.mjs'

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
  const runDir = path.join(root, '.git/retained-run')
  await fs.mkdir(runDir)
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
    await expect(commitPublishedArtifacts(x.root, id, 'main', { runDir: x.runDir })).rejects.toThrow(/git commit/)
  })
  it('rejects callers with no retained run proof before commit/push', async () => {
    const x = await candidate()
    await expect(commitPublishedArtifacts(x.root, id, 'main')).rejects.toThrow(/mandatory transformation/)
    expect(() => x.git('rev-parse', '--verify', 'HEAD')).toThrow()
  })
  it('accepts exact typed proof and reaches the unchanged rejecting commit hook', async () => {
    const x = await candidate()
    await expect(commitPublishedArtifacts(x.root, id, 'main', { runDir: x.runDir })).rejects.toThrow(/git commit/)
    expect(() => x.git('rev-parse', '--verify', 'HEAD')).toThrow()
  })
  it('rejects same-orientation but different staged plate bytes after a clean filter', async () => {
    const x = await candidate()
    await fs.writeFile(path.join(x.root, '.git/filter.cjs'), `process.stdin.resume();process.stdin.on('end',()=>process.stdout.write(Buffer.from('${platePng(18, 10).toString('base64')}', 'base64')));`)
    x.git('config', 'filter.synthetic.clean', `${process.execPath} .git/filter.cjs`)
    x.git('config', 'filter.synthetic.required', 'true')
    await fs.writeFile(path.join(x.root, '.git/info/attributes'), `public/editions/${id}/assets/plate.png filter=synthetic\n`)
    await expect(commitPublishedArtifacts(x.root, id, 'main', { runDir: x.runDir })).rejects.toThrow(/mandatory transformation.*staged plate/)
    expect(() => x.git('rev-parse', '--verify', 'HEAD')).toThrow()
  })
})
