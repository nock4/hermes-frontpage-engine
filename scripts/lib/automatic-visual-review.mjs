import fs from 'node:fs/promises'
import path from 'node:path'
import { independentReviewExpectation, recordIndependentVisualReview, assertIndependentVisualReview } from './independent-visual-review.mjs'
import { collectReviewEvidence } from './review-evidence.mjs'
import { reviewWithHermes } from './hermes-review-adapter.mjs'
import { isDeepStrictEqual } from 'node:util'
import { randomUUID } from 'node:crypto'

export async function prepareAutomaticEvidence(options, { capture = collectReviewEvidence } = {}) {
  const directory = path.join(options.runDir, 'automatic-review')
  try { return JSON.parse(await fs.readFile(path.join(directory, 'evidence.json'), 'utf8')) } catch (error) { if (error.code !== 'ENOENT') throw error }
  // A failed capture precedes ALL provider I/O. Preserve it, then recapture the
  // SAME good package after runtime/build repair; this is not another vote.
  try { await fs.access(path.join(directory, 'hermes.stdout.jsonl')); throw Error('Missing evidence for an already launched reviewer; reconcile retained original session, never recapture/reroll') } catch (error) { if (error.code !== 'ENOENT') throw error }
  try { await fs.rename(directory, path.join(options.runDir, `automatic-review-capture-failed-${randomUUID()}`)) } catch (error) { if (error.code !== 'ENOENT') throw error }
  return capture(options)
}
async function automaticReviewer(options, transport, launchOriginal) {
  return reviewWithHermes(options, transport, launchOriginal)
}
export async function ensureAutomaticReview(options, { review = automaticReviewer, transport } = {}) {
  const canonical = path.join(options.runDir, 'independent-visual-review.json')
  try {
    const disposition = JSON.parse(await fs.readFile(path.join(options.runDir, 'CANDIDATE-DISPOSITION.json'), 'utf8'))
    if (disposition.disposition !== 'PASS' || disposition.publication_authorized !== true) throw Object.assign(Error('independent visual review: canonical disposition BLOCK; preserve adverse findings and route actual repair through existing owner'), { code: 'REVIEW_PRIOR_BLOCK' })
  } catch (error) { if (error.code !== 'ENOENT') throw error }
  let report
  try { report = JSON.parse(await fs.readFile(canonical, 'utf8')) } catch (error) { if (error.code !== 'ENOENT') throw error }
  if (!report) {
    if (review === automaticReviewer) {
      try { await prepareAutomaticEvidence(options) } catch (error) { error.code ||= 'REVIEW_CAPTURE_REPAIR'; throw error }
    }
    const request = path.join(options.runDir, 'automatic-review-request.json')
    const binding = independentReviewExpectation(options)
    let launchOriginal = false
    try {
      await fs.writeFile(request, JSON.stringify({ binding, status: 'requested' }, null, 2), { flag: 'wx', mode: 0o600 })
      launchOriginal = true // proof this owner created the original request, not raw absence
    } catch (error) {
      if (error.code !== 'EEXIST') throw error
      const previous = JSON.parse(await fs.readFile(request, 'utf8'))
      if (!isDeepStrictEqual(previous.binding, binding)) throw Error('Independent review request changed/stale; never reroll')
      if (review !== automaticReviewer) throw Error('independent review incomplete/interrupted; reconcile retained raw response, never reroll this candidate')
      // The transport owner reconciles the exact admitted turn. Viewer timeout
      // or raw-file presence/absence never establishes terminal execution.
    }
    let reportPath
    try { reportPath = await review(options, transport, launchOriginal) } catch (error) {
      error.code ||= 'INDEPENDENT_REVIEW_PROVIDER'
      error.requestPath = request
      throw error
    }
    // A genuine late canonical result outranks transport recovery. Never replace
    // it with another report (including when another owner wins this wx race).
    try { report = JSON.parse(await fs.readFile(canonical, 'utf8')) } catch (error) {
      if (error.code !== 'ENOENT') throw error
      try { report = recordIndependentVisualReview(options, reportPath) } catch (error) {
        if (error.code !== 'EEXIST') throw error
        report = JSON.parse(await fs.readFile(canonical, 'utf8'))
      }
    }
  }
  if (!isDeepStrictEqual(report.binding, independentReviewExpectation(options))) throw Error('Independent review binding is stale; preserve original verdict and repair exact candidate context')
  if (report.verdict === 'BLOCK') {
    const action = { kind: 'repair-or-replace', run_dir: options.runDir, edition_id: options.editionId,
      binding: report.binding, adverse_findings: report.adverse_findings, findings: report.findings,
      constraints: 'Preserve BLOCK. Repair source-grounded artwork in a NEW run or use a fresh UNUSED owner within the SAME aggregate day/source budget. Never regenerate for pending review or proof/runtime failures. Full QA and a new independent review required. No manual approval queue.' }
    const file = path.join(options.runDir, 'automatic-review-action.json')
    try { await fs.writeFile(file, JSON.stringify(action, null, 2), { flag: 'wx', mode: 0o600 }) } catch (error) { if (error.code !== 'EEXIST') throw error }
    const error = Object.assign(Error(`Independent BLOCK: automatic press owner must execute ${file}`), { code: 'INDEPENDENT_REVIEW_RECOVERY', action, actionPath: file })
    throw error
  }
  return assertIndependentVisualReview(options)
}
