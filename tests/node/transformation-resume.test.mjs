import { describe, it, expect } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import * as fidelity from '../../scripts/lib/source-fidelity-audit.mjs'
import * as cron from '../../scripts/run-daily-publish-cron.mjs'
const contract = { mode: 'source-image', dominant_source_image_url: 'https://example.org/source.jpg', must_transform: ['Separate cloth and cascade.'] }
// SYNTHETIC injected transport, not a vision run.
async function exercise(owner = null) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dfe-transform-resume-'))
  const platePath = path.join(dir, 'plate.png')
  await fs.writeFile(platePath, 'synthetic plate bytes')
  const payload = { source_contract: structuredClone(contract), source_image_fingerprints: [{ image_url: contract.dominant_source_image_url }] }
  if (owner) {
    payload.source_image_fingerprints[0].page_url = owner
    payload.lineage = { source_url: owner }
    payload.artifacts = [{ source_url: owner }]
  }
  const audit = await fidelity.auditSourceImageFidelity({ payload, platePath }, dir, {
    writeJson: (file, value) => fs.writeFile(file, JSON.stringify(value)), createContactSheetImpl: async () => {},
    openAiJsonImpl: async request => {
      const prompt = JSON.parse(request.input[0].content[0].text)
      return { verdict: 'pass', resemblance_score: 0.9, framing_score: 0.9, object_relationship_score: 0.9, context_score: 0.9, transformation_score: 0.9,
        transformation_context_id: prompt.transformation_context_id, transformation_findings: prompt.required_transformations.map(clause => ({ ...clause, status: 'fulfilled', visible_evidence: 'SYNTHETIC: left and right masses with a gap', context: 'SYNTHETIC source contours', reason: 'SYNTHETIC separated groupings' })) }
    },
  })
  return { audit, payload, platePath, runDir: dir }
}
describe('future candidate resume/publication boundary (synthetic)', () => {
  it('requires a fresh audit on a real resume after exact owner A to B swap with identical image/contract/plate', async () => {
    const x = await exercise('https://example.org/owner-a')
    expect((await fidelity.ensureCurrentSourceFidelity(x, { audit: async () => { throw new Error('unexpected owner-A audit') } })).pass).toBe(true)
    x.payload.source_image_fingerprints[0].page_url = x.payload.lineage.source_url = x.payload.artifacts[0].source_url = 'https://example.org/owner-b'
    let calls = 0
    await expect(fidelity.ensureCurrentSourceFidelity(x, { audit: async () => { calls++; throw new Error('owner-B requires fresh audit') } })).rejects.toThrow('owner-B requires fresh audit')
    expect(calls).toBe(1)
  })
  it('reads the exact retained payload and staged candidate bytes at the cron boundary', async () => {
    const x = await exercise('https://example.org/owner-a')
    const worktreeDir = path.join(x.runDir, 'worktree')
    const editionId = '2026-11-06-synthetic-v1'
    const target = path.join(worktreeDir, 'public/editions', editionId, 'assets/plate.png')
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.copyFile(x.platePath, target)
    const directory = path.dirname(path.dirname(target))
    await fs.writeFile(path.join(x.runDir, 'edition-package-summary.json'), JSON.stringify({ edition_id: editionId, edition_dir: directory }))
    await fs.writeFile(path.join(directory, 'edition.json'), JSON.stringify({ edition_id: editionId, artifact_map_id: 'map-a', source_binding_set_id: 'bindings-a' }))
    await fs.writeFile(path.join(directory, 'artifact-map.json'), JSON.stringify({ artifact_map_id: 'map-a', artifacts: [{ id: 'a', source_binding_ids: ['b'] }] }))
    await fs.writeFile(path.join(directory, 'source-bindings.json'), JSON.stringify({ source_binding_set_id: 'bindings-a', bindings: [{ id: 'b', artifact_id: 'a', source_url: x.payload.artifacts[0].source_url, source_image_url: contract.dominant_source_image_url }] }))
    await fs.writeFile(path.join(x.runDir, 'daily-generation-payload.json'), JSON.stringify(x.payload))
    expect(typeof cron.ensureCandidateSourceFidelity).toBe('function')
    expect((await cron.ensureCandidateSourceFidelity({ worktreeDir, runDir: x.runDir, editionId })).pass).toBe(true)
    await fs.writeFile(target, 'changed staged plate')
    await expect(cron.ensureCandidateSourceFidelity({ worktreeDir, runDir: x.runDir, editionId }, { audit: async () => { throw new Error('must re-audit actual changed plate') } })).rejects.toThrow('changed plate')
  })
  it('reuses only current exact clause/plate/context proof, not legacy aggregate pass', async () => {
    const x = await exercise()
    expect(typeof fidelity.ensureCurrentSourceFidelity).toBe('function')
    const audit = () => { throw new Error('unexpected provider call for current exact proof') }
    expect((await fidelity.ensureCurrentSourceFidelity(x, { audit })).pass).toBe(true)
    await fs.writeFile(path.join(x.runDir, 'source-fidelity-audit.json'), JSON.stringify({ verdict: 'pass', pass: true }))
    let calls = 0
    await expect(fidelity.ensureCurrentSourceFidelity(x, { audit: async () => { calls++; throw new Error('fresh typed audit blocks detached hem') } })).rejects.toThrow('detached hem')
    expect(calls).toBe(1)
    expect((await fs.readdir(x.runDir)).some(file => file.startsWith('source-fidelity-audit.superseded-'))).toBe(true)
  })
  it.each(['plate', 'contract', 'context', 'findings', 'forged-pass'])('does not publish stale or inconsistent %s proof', async scenario => {
    const x = await exercise()
    expect(typeof fidelity.ensureCurrentSourceFidelity).toBe('function')
    if (scenario === 'plate') await fs.writeFile(x.platePath, 'different candidate bytes')
    if (scenario === 'contract') x.payload.source_contract.must_transform.push('Keep a detached copper curve.')
    if (scenario === 'context') x.audit.transformation_acceptance.context_id = 'old'
    if (scenario === 'findings') x.audit.transformation_acceptance.findings[0].clause += ' stale'
    if (scenario === 'forged-pass') x.audit.raw_response.transformation_findings[0].status = 'failed'
    await fs.writeFile(path.join(x.runDir, 'source-fidelity-audit.json'), JSON.stringify(x.audit))
    let calls = 0
    await expect(fidelity.ensureCurrentSourceFidelity(x, { audit: async () => { calls++; throw new Error('fresh audit required') } })).rejects.toThrow('fresh audit required')
    expect(calls).toBe(1)
  })
})
