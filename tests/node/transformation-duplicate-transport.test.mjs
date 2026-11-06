import { it, expect } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { auditSourceImageFidelity } from '../../scripts/lib/source-fidelity-audit.mjs'
import { transformationExpectation } from '../../scripts/lib/transformation-acceptance.mjs'

// Deliberately false transport fixtures. Never interpreted as actual media evidence.
it.each(['status', 'escaped-status', 'findings', 'context', 'fenced', 'extracted'])('blocks conflicting duplicate %s keys through the actual subprocess adapter', async scenario => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dfe-duplicate-json-'))
  const platePath = path.join(dir, 'plate.png')
  await fs.writeFile(platePath, 'SYNTHETIC transport bytes; no real media or provider')
  const image = 'https://example.org/source.jpg'
  const payload = { artifacts: [{ source_url: 'https://example.org/owner' }], source_image_fingerprints: [{ image_url: image }], source_contract: { mode: 'source-image', dominant_source_image_url: image, must_transform: ['Separate forms.'] } }
  const context = await transformationExpectation(payload, platePath)
  const row = { ...context.required_clauses[0], status: 'fulfilled', visible_evidence: 'SYNTHETIC false finding', context: 'SYNTHETIC', reason: 'SYNTHETIC' }
  let stdout = JSON.stringify({ verdict: 'pass', resemblance_score: 0.9, framing_score: 0.9, object_relationship_score: 0.9, context_score: 0.9, transformation_score: 0.9, transformation_context_id: context.context_id, transformation_findings: [row] })
  if (['status', 'escaped-status', 'fenced', 'extracted'].includes(scenario)) stdout = stdout.replace('"status":"fulfilled"', `"status":"failed",${scenario === 'escaped-status' ? '"st\\u0061tus"' : '"status"'}:"fulfilled"`)
  if (scenario === 'findings') stdout = stdout.replace('"transformation_findings":', '"transformation_findings":[],"transformation_findings":')
  if (scenario === 'context') stdout = stdout.replace('"transformation_context_id":', '"transformation_context_id":"wrong","transformation_context_id":')
  if (scenario === 'fenced') stdout = '```json\n' + stdout + '\n```'
  if (scenario === 'extracted') stdout = 'response follows\n' + stdout + '\nend'
  stdout += '\n'
  const bin = path.join(dir, 'false-hermes')
  await fs.writeFile(bin, `#!${process.execPath}\nprocess.stdin.resume(); process.stdin.on('end', () => process.stdout.write(${JSON.stringify(stdout)}));\n`, { mode: 0o700 })
  const previous = process.env.HERMES_BIN
  process.env.HERMES_BIN = bin
  try {
    await expect(auditSourceImageFidelity({ payload, platePath }, dir, { writeJson: (file, value) => fs.writeFile(file, JSON.stringify(value)), createContactSheetImpl: async () => {} })).rejects.toThrow(/duplicate.*key/i)
    const audit = JSON.parse(await fs.readFile(path.join(dir, 'source-fidelity-audit.json'), 'utf8'))
    expect(audit.pass).toBe(false)
    expect(audit.inspection_mode).toBe('vision-error')
    const raw = path.join(dir, 'source-fidelity-audit-response.txt')
    expect(await fs.readFile(raw, 'utf8')).toBe(stdout)
    expect((await fs.stat(raw)).mode & 0o777).toBe(0o600)
  } finally {
    if (previous === undefined) delete process.env.HERMES_BIN
    else process.env.HERMES_BIN = previous
  }
})
