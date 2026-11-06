import fs from 'node:fs/promises'
import { createHash } from 'node:crypto'

const digest = value => createHash('sha256').update(value).digest('hex')
const text = value => typeof value === 'string' && value.trim().length > 0
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]))
  return value
}

// Membership comes ONLY from the exact contract field, never regex/prose/model
// inference. Optional fingerprint/visual-direction suggestions are not clauses.
export async function transformationExpectation(payload, platePath) {
  const source = payload?.source_image_fingerprints?.find(entry => entry?.image_url)?.image_url
  const contract = payload?.source_contract
  const blockers = []
  if (!contract || contract.mode !== 'source-image') blockers.push('missing source-image contract')
  if (contract?.dominant_source_image_url !== source) blockers.push('contract/source image mismatch')
  const clauses = contract?.must_transform
  if (!Array.isArray(clauses) || !clauses.length || clauses.some(clause => !text(clause))) blockers.push('invalid nonempty must_transform string list')
  const required = Array.isArray(clauses) && clauses.every(text)
    ? clauses.map((clause, index) => ({ clause_id: `transform-${index + 1}-${digest(clause).slice(0, 16)}`, clause })) : []
  let plateHash = null
  try { plateHash = digest(await fs.readFile(platePath)) } catch (error) { blockers.push(`plate bytes unavailable: ${error.message}`) }
  const sourceOwner = { artifact_source_urls: (payload?.artifacts || []).map(entry => entry?.source_url ?? null), lineage_source_url: payload?.lineage?.source_url ?? null, fingerprint_page_url: payload?.source_image_fingerprints?.find(entry => entry?.image_url)?.page_url ?? null }
  const binding = { source_owner: sourceOwner, source_image_url: source, source_contract: contract ?? null, plate_sha256: plateHash, required_clauses: required }
  return { schema_version: 1, ...binding, context_id: digest(JSON.stringify(canonical(binding))), blockers }
}

export function normalizeTransformationAcceptance(raw, expected) {
  const blockers = [...expected.blockers]
  const findings = raw?.transformation_findings ?? null
  if (raw?.transformation_context_id !== expected.context_id) blockers.push('missing or mismatched transformation context ID')
  if (!Array.isArray(findings)) blockers.push('missing or malformed transformation findings list')
  else {
    if (findings.length !== expected.required_clauses.length) blockers.push('transformation finding count mismatch')
    const seen = new Set()
    for (let index = 0; index < findings.length; index++) {
      const row = findings[index]
      const clause = expected.required_clauses[index]
      const label = row?.clause_id || `row ${index + 1}`
      if (!row || typeof row !== 'object' || Array.isArray(row)) { blockers.push(`${label}: malformed finding`); continue }
      if (seen.has(row.clause_id)) blockers.push(`${label}: duplicate clause ID`)
      seen.add(row.clause_id)
      if (!clause || row.clause_id !== clause.clause_id || row.clause !== clause.clause) blockers.push(`${label}: unknown, stale, reordered or mismatched exact clause`)
      for (const key of ['visible_evidence', 'context', 'reason']) if (!text(row[key])) blockers.push(`${label}: malformed or empty ${key}`)
      if (row.status !== 'fulfilled') blockers.push(`${label}: ${String(row.status)}; clause=${JSON.stringify(row.clause)}; visible_evidence=${JSON.stringify(row.visible_evidence)}; context=${JSON.stringify(row.context)}; reason=${JSON.stringify(row.reason)}`)
    }
  }
  return { ...expected, findings: structuredClone(findings), pass: blockers.length === 0, blockers }
}
