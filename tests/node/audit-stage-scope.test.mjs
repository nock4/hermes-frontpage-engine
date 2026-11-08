import { describe, it, expect } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { createHash } from 'node:crypto'
import { auditSourceImageFidelity, ensureCurrentSourceFidelity } from '../../scripts/lib/source-fidelity-audit.mjs'
import { transformationExpectation, normalizeTransformationAcceptance } from '../../scripts/lib/transformation-acceptance.mjs'
const fixture = new URL('../fixtures/transformation-contract-nov7/', import.meta.url)
const contract = JSON.parse(await fs.readFile(new URL('source-contract.json', fixture), 'utf8'))
const nov7 = JSON.parse(await fs.readFile(new URL('source-fidelity-audit-response.txt', fixture), 'utf8'))
const canonical = x => Array.isArray(x) ? x.map(canonical) : x && typeof x === 'object' ? Object.fromEntries(Object.keys(x).sort().map(k => [k, canonical(x[k])])) : x
const hash = x => createHash('sha256').update(JSON.stringify(canonical(x))).digest('hex')
// Injected responses are SYNTHETIC; retained Nov7 raw findings are not rewritten.
async function exercise(change = x => x) {
  const runDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dfe-audit-scope-'))
  const platePath = path.join(runDir, 'plate.png')
  await fs.writeFile(platePath, 'SYNTHETIC plate bytes')
  const payload = { source_contract: structuredClone(contract), artifacts: [{ source_url: 'https://x.com/billdifferen/status/2118209787368235373' }], source_image_fingerprints: [{ image_url: contract.dominant_source_image_url }] }
  let request, prompt, result, error
  try {
    result = await auditSourceImageFidelity({ payload, platePath }, runDir, {
      writeJson: (f, v) => fs.writeFile(f, JSON.stringify(v)), createContactSheetImpl: async () => {},
      openAiJsonImpl: async r => {
        request = r; prompt = JSON.parse(r.input[0].content[0].text)
        return change({ verdict: 'pass', resemblance_score: 0.9, framing_score: 0.9, object_relationship_score: 0.9, context_score: 0.9, transformation_score: 0.9,
          transformation_context_id: prompt.transformation_context_id,
          transformation_findings: prompt.required_transformations.map(c => ({ ...c, status: 'fulfilled', visible_evidence: 'SYNTHETIC: cream strip passes beneath blue letter contour at center; irregular print wear crosses both edges.', context: 'SYNTHETIC: displaced printed divisions in a new arrangement.', reason: 'SYNTHETIC: visible integration, not interaction evidence.' })),
        }, prompt)
      },
    })
  } catch (e) { error = e }
  result ||= JSON.parse(await fs.readFile(path.join(runDir, 'source-fidelity-audit.json'), 'utf8'))
  return { request, prompt, result, error, payload, platePath, runDir }
}
describe('trusted pre-mapping visual stage (synthetic transport except retained raw replay)', () => {
  it('delivers explicit stage instructions through the actual production request, without changing mandatory clauses', async () => {
    const x = await exercise()
    expect(x.error).toBeUndefined()
    expect(x.prompt.audit_scope).toEqual({ policy_revision: 'pre-map-visible-integration-v1', stage: 'pre-mapping-plate-visual', runtime_source_window_function: 'not-assessed' })
    expect(x.request.instructions).toContain('pre-mapping')
    expect(x.prompt.rules.join(' ')).toContain('Visibly distinct artwork-native edges')
    expect(x.prompt.rules.join(' ')).toContain('hover, tap, preload')
    expect(x.prompt.rules.join(' ')).toContain('not evidence of functional source windows')
    expect(x.prompt.required_transformations.map(c => c.clause)).toEqual(contract.must_transform)
    expect(x.result.transformation_acceptance.audit_scope).toEqual(x.prompt.audit_scope)
  })
  it('binds trusted scope/revision into context without changing IDs, and does not let model scope claim runtime acceptance', async () => {
    const x = await exercise(raw => ({ ...raw, audit_scope: { runtime_source_window_function: 'passed' }, runtime_source_window_function: 'passed' }))
    const expected = await transformationExpectation(x.payload, x.platePath)
    const { audit_scope, schema_version, context_id, blockers, ...oldBinding } = expected
    expect(context_id).not.toBe(hash(oldBinding))
    expect(expected.required_clauses).toEqual(nov7.transformation_findings.map(({ clause_id, clause }) => ({ clause_id, clause })))
    expect(x.result.transformation_acceptance.audit_scope?.runtime_source_window_function).toBe('not-assessed')
    expect(x.result.raw_response.runtime_source_window_function).toBe('passed') // raw evidence is retained, never trusted metadata
    const forged = { ...x.result.raw_response, transformation_context_id: hash({ ...oldBinding, audit_scope: { ...audit_scope, runtime_source_window_function: 'passed' } }) }
    expect(normalizeTransformationAcceptance(forged, expected).pass).toBe(false)
  })
  it('does not substitute model runtime success for missing visible evidence', async () => {
    const x = await exercise(raw => { raw.runtime_source_window_function = 'passed'; raw.transformation_findings[2].visible_evidence = ''; raw.transformation_findings[2].reason = 'Hover and source preload passed.'; return raw })
    expect(x.result.pass).toBe(false)
    expect(x.result.transformation_acceptance.audit_scope.runtime_source_window_function).toBe('not-assessed')
    expect(x.error.message).toContain('empty visible_evidence')
  })
  it('invalidates a forged trusted scope on future resume', async () => {
    const x = await exercise()
    x.result.transformation_acceptance.audit_scope.runtime_source_window_function = 'passed'
    await fs.writeFile(path.join(x.runDir, 'source-fidelity-audit.json'), JSON.stringify(x.result))
    await expect(ensureCurrentSourceFidelity(x, { audit: async () => { throw new Error('forged scope requires fresh audit') } })).rejects.toThrow('forged scope requires fresh audit')
  })
  it.each(['failed', 'uncertain'])('never softens %s even when reason asks for post-map function', async status => {
    const x = await exercise(raw => { raw.transformation_findings[2].status = status; raw.transformation_findings[2].reason = 'Cannot verify which edge is an actual functional window before mapping.'; return raw })
    expect(x.result.pass).toBe(false)
    expect(x.result.transformation_acceptance.findings[2].status).toBe(status)
    expect(x.error.message).toContain('mandatory transformation')
  })
  it('keeps unchanged retained Nov7 raw misses blocked, including detached-face and universal-lettering clauses', async () => {
    const before = JSON.stringify(nov7)
    const x = await exercise(() => nov7)
    expect(x.result.pass).toBe(false)
    expect(x.result.raw_response).toEqual(nov7)
    for (const i of [2, 3, 5]) expect(x.result.transformation_acceptance.blockers.join(' ')).toContain(nov7.transformation_findings[i].clause_id)
    expect(JSON.stringify(nov7)).toBe(before)
  })
  it('requires fresh future-candidate proof for an otherwise complete old-policy pass and preserves it byte-exact', async () => {
    const x = await exercise()
    const expected = await transformationExpectation(x.payload, x.platePath)
    const { audit_scope, schema_version, context_id, blockers, ...oldBinding } = expected
    const prior = structuredClone(x.result)
    prior.raw_response.transformation_context_id = hash(oldBinding)
    prior.transformation_acceptance = { schema_version: 1, ...oldBinding, context_id: hash(oldBinding), blockers: [], findings: prior.raw_response.transformation_findings, pass: true }
    const bytes = JSON.stringify(prior)
    await fs.writeFile(path.join(x.runDir, 'source-fidelity-audit.json'), bytes)
    let calls = 0
    await expect(ensureCurrentSourceFidelity(x, { audit: async () => { calls++; throw new Error('fresh scoped audit required') } })).rejects.toThrow('fresh scoped audit required')
    expect(calls).toBe(1)
    const superseded = (await fs.readdir(x.runDir)).filter(f => f.startsWith('source-fidelity-audit.superseded-'))
    expect(superseded).toHaveLength(1)
    expect(await fs.readFile(path.join(x.runDir, superseded[0]), 'utf8')).toBe(bytes)
  })
})
