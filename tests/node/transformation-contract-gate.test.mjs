import { describe, it, expect } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { auditSourceImageFidelity } from '../../scripts/lib/source-fidelity-audit.mjs'

import { buildSourceFidelityRecoveryPayload } from '../../scripts/pipeline/run-from-scratch-mode.mjs'

const fixture = new URL('../fixtures/transformation-contract-nov5/', import.meta.url)
const contract = JSON.parse(await fs.readFile(new URL('source-contract.json', fixture), 'utf8'))
const oldAudit = JSON.parse(await fs.readFile(new URL('source-fidelity-audit.json', fixture), 'utf8'))
// All findings below are SYNTHETIC injected test responses, not new vision evidence.
async function exercise(change = x => x, { sourceContract = contract, rawLegacy = false } = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dfe-transform-synthetic-'))
  const platePath = path.join(dir, 'plate.png')
  await fs.writeFile(platePath, 'SYNTHETIC TEST PLATE BYTES, NOT AN IMAGE')
  let prompt
  const result = auditSourceImageFidelity({ payload: {
    source_contract: sourceContract,
    source_image_fingerprints: [{ image_url: contract.dominant_source_image_url, composition_moves: ['Optional: keep an orange cup'] }],
    visual_direction: { visual_compositional_moves: ['Optional: use a central axis'] },
  }, platePath }, dir, {
    writeJson: (file, value) => fs.writeFile(file, JSON.stringify(value)),
    createContactSheetImpl: async ({ outputPath }) => outputPath,
    openAiJsonImpl: async (request) => {
      prompt = JSON.parse(request.input[0].content[0].text)
      const raw = rawLegacy ? structuredClone(oldAudit) : {
        ...oldAudit, missing_critical_elements: ['Optional orange cup absent'], drift_risks: [], rationale: 'Recognizable source-derived material in a changed spatial structure.',
        transformation_context_id: prompt.transformation_context_id,
        transformation_findings: (prompt.required_transformations || contract.must_transform.map((clause, i) => ({ clause_id: `synthetic-red-${i}`, clause }))).map(entry => ({ ...entry, status: 'fulfilled', visible_evidence: 'SYNTHETIC: separated cloth at lower right, cascade at left with a dark gap.', context: 'SYNTHETIC: source contours remain recognizable.', reason: 'SYNTHETIC: the exact requested change is visible.' })),
      }
      return change(raw, prompt)
    },
  })
  let error
  let audit
  try { audit = await result } catch (e) { error = e }
  audit ||= JSON.parse(await fs.readFile(path.join(dir, 'source-fidelity-audit.json'), 'utf8'))
  return { audit, error, prompt, platePath, dir, payload: { source_contract: sourceContract, source_image_fingerprints: [{ image_url: contract.dominant_source_image_url }] } }
}

describe('future mandatory transformation gate (synthetic injection unless explicitly retained legacy)', () => {
  it('reproduces the retained Nov5 old pass with explicit mandatory misses through the production adapter/normalizer', async () => {
    const { error, audit } = await exercise(x => x, { rawLegacy: true })
    expect(error?.message).toMatch(/mandatory transformation/)
    expect(audit.pass).toBe(false)
    expect(audit.resemblance_score).toBe(0.88)
    expect(audit.transformation_score).toBe(0.76)
    expect(audit.missing_critical_elements).toEqual(oldAudit.missing_critical_elements)
    expect(audit.rationale).toBe(oldAudit.rationale)
  })
  it('enumerates exact must_transform clauses only, stable IDs/order, with bound context and fulfilled positive evidence', async () => {
    const a = await exercise(), b = await exercise()
    expect(a.error).toBeUndefined()
    expect(a.prompt.required_transformations?.map(c => c.clause)).toEqual(contract.must_transform)
    expect(a.prompt.required_transformations).toEqual(b.prompt.required_transformations)
    expect(new Set(a.prompt.required_transformations.map(c => c.clause_id)).size).toBe(contract.must_transform.length)
    expect(a.audit.transformation_acceptance?.pass).toBe(true)
    expect(a.audit.transformation_acceptance.required_clauses).toEqual(a.prompt.required_transformations)
    expect(a.audit.transformation_acceptance.context_id).toBe(a.prompt.transformation_context_id)
    expect(a.prompt.rules.join(' ')).toContain('Optional')
    expect(a.audit.missing_critical_elements).toEqual(['Optional orange cup absent'])
  })
  it.each(['failed', 'uncertain', 'waived', 'unknown', null])('blocks mandatory %s despite accepted aggregate scores and preserves full findings/recovery context', async status => {
    const { audit, error } = await exercise(raw => {
      raw.transformation_findings[4] = { ...raw.transformation_findings[4], status, visible_evidence: oldAudit.missing_critical_elements[0], context: 'The figure remains continuous inside a woodland scene.', reason: 'No detached hem; old self-waiver must not count.', waiver: 'overall scores suffice' }
      return raw
    })
    expect(error?.message).toMatch(/mandatory transformation/)
    expect(error.message).toContain('No detached hem')
    expect(error.audit).toEqual(audit)
    expect(error.transformationAcceptance.findings).toEqual(audit.transformation_acceptance.findings)
    expect(audit.pass).toBe(false)
    expect(audit.transformation_acceptance.findings[4].status).toBe(status)
    expect(buildSourceFidelityRecoveryPayload({}, audit).source_fidelity_recovery_diagnostics[0]).toEqual(audit)
  })
  it.each(['missing', 'duplicate', 'unknown', 'stale-id', 'quote', 'reordered', 'malformed', 'empty-evidence', 'typed-evidence', 'empty-context', 'empty-reason', 'stale-context'])('fails closed for %s response', async scenario => {
    const { audit, error } = await exercise(raw => {
      const rows = raw.transformation_findings
      if (scenario === 'missing') rows.pop()
      if (scenario === 'duplicate') rows.push(rows[0])
      if (scenario === 'unknown') rows.push({ ...rows[0], clause_id: 'unknown' })
      if (scenario === 'stale-id') rows[0].clause_id = 'transform-old'
      if (scenario === 'quote') rows[0].clause += ' changed'
      if (scenario === 'reordered') rows.reverse()
      if (scenario === 'malformed') raw.transformation_findings = { fulfilled: true }
      if (scenario === 'empty-evidence') rows[0].visible_evidence = ' '
      if (scenario === 'typed-evidence') rows[0].visible_evidence = { text: 'not a string' }
      if (scenario === 'empty-context') rows[0].context = ''
      if (scenario === 'empty-reason') rows[0].reason = ''
      if (scenario === 'stale-context') raw.transformation_context_id = 'old-context'
      return raw
    })
    expect(error?.message).toMatch(/mandatory transformation/)
    expect(audit.transformation_acceptance.pass).toBe(false)
    expect(audit.transformation_acceptance.findings).toBeDefined()
  })
  it.each([undefined, { ...contract, must_transform: [] }, { ...contract, must_transform: [42] }, { ...contract, dominant_source_image_url: 'https://wrong.example/image.jpg' }])('blocks missing/malformed/mismatched contracts instead of legacy fallback', async sourceContract => {
    // Explicit undefined must not use the helper default.
    const { audit, error } = await exercise(x => x, { sourceContract: sourceContract ?? null })
    expect(error?.message).toMatch(/mandatory transformation/)
    expect(audit.pass).toBe(false)
  })
  it('does not let fulfilled clauses override existing debug-mark or resemblance gates', async () => {
    const { error, audit } = await exercise(raw => ({ ...raw, resemblance_score: 0.1, forbidden_debug_marks: ['hollow target at lower edge'] }))
    expect(error).toBeDefined()
    expect(audit.transformation_acceptance.pass).toBe(true)
    expect(audit.blockers).toContain('forbidden generated debug marks')
    expect(audit.blockers).toContain('resemblance_score 0.1 < 0.62')
  })
})
