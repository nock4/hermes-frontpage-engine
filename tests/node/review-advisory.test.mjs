import { describe, it, expect } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { syntheticProofContext, syntheticReview } from '../fixtures/independent-review.mjs'
import { continueReviewedPublication } from '../../scripts/lib/review-continuation.mjs'
import { acceptProof, latestAccepted } from '../../scripts/delivery-watchdog.mjs'
import { buildPublishProof, checkPressProof } from '../../scripts/lib/press-proof.mjs'

// Policy since 2026-11-10: the independent review records a verdict and never
// gates publication. A BLOCK, a failed or stalled reviewer, and a missing
// report all publish the candidate that passed prepare().
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'review-advisory-SYNTHETIC-'))
  const editionId = '2099-01-01-synthetic-v1'
  const context = await syntheticProofContext(editionId, root)
  const candidate = { worktreeDir: root, runDir: context.latest_run_dir, editionId }
  await fs.rm(path.join(candidate.runDir, 'independent-visual-review.json'))
  return { candidate, statePath: path.join(root, 'state.json') }
}
const passReport = async options => (await syntheticReview(options, { record: false })).file
const blockReport = async options => {
  const file = await passReport(options)
  const report = JSON.parse(await fs.readFile(file))
  report.verdict = 'BLOCK'; report.findings[0].status = 'failed'; report.adverse_findings = ['SYNTHETIC source identity lost']
  await fs.writeFile(file, JSON.stringify(report))
  return file
}
async function publishWith(review) {
  const { candidate, statePath } = await fixture()
  const stages = []
  let prepared = 0, repairs = 0, published = 0
  const result = await continueReviewedPublication(candidate, {
    statePath, review,
    prepare: async () => { prepared++ },
    repair: async () => { repairs++; throw Error('SYNTHETIC repair must never run') },
    publish: async () => { published++; return { commit: 'SYNTHETIC', push_succeeded: true } },
    checkpoint: async stage => { stages.push(stage) },
  })
  const retained = JSON.parse(await fs.readFile(path.join(candidate.runDir, 'independent-review-advisory.json'), 'utf8'))
  return { result, stages, prepared, repairs, published, retained, candidate }
}

describe('independent review is advisory', () => {
  it('publishes on PASS and records the verdict', async () => {
    const { result, published, retained, stages } = await publishWith(passReport)
    expect(published).toBe(1)
    expect(result).toMatchObject({ push_succeeded: true, review_advisory: { verdict: 'PASS' } })
    expect(retained.verdict).toBe('PASS')
    expect(stages).toEqual(['qa-publish', 'independent-review', 'commit-publish'])
  })

  it('publishes on BLOCK, keeps the adverse review, and never repairs or regenerates', async () => {
    const { result, published, repairs, prepared, retained, stages, candidate } = await publishWith(blockReport)
    expect([published, repairs, prepared]).toEqual([1, 0, 1])
    expect(result.review_advisory).toMatchObject({ verdict: 'BLOCK', code: 'INDEPENDENT_REVIEW_RECOVERY' })
    expect(retained.verdict).toBe('BLOCK')
    expect(JSON.parse(await fs.readFile(path.join(candidate.runDir, 'independent-visual-review.json'), 'utf8')).verdict).toBe('BLOCK')
    expect(stages).toEqual(['qa-publish', 'independent-review', 'independent-review-advisory', 'commit-publish'])
  })

  it('publishes when the reviewer stalls or fails, and says why', async () => {
    const { result, published, retained } = await publishWith(async () => { throw Error('SYNTHETIC stream idle: no SSE events for 12s') })
    expect(published).toBe(1)
    expect(result.review_advisory).toMatchObject({ verdict: 'UNAVAILABLE', code: 'INDEPENDENT_REVIEW_PROVIDER' })
    expect(retained.reason).toContain('no SSE events for 12s')
  })

  it('still refuses to publish when prepare (QA) fails', async () => {
    const { candidate, statePath } = await fixture()
    let published = 0
    await expect(continueReviewedPublication(candidate, {
      statePath, review: passReport,
      prepare: async () => { throw Error('SYNTHETIC qa:publish failed') },
      publish: async () => { published++ },
    })).rejects.toThrow('qa:publish failed')
    expect(published).toBe(0)
  })

  it('does not publish twice after a restart', async () => {
    const { candidate, statePath } = await fixture()
    let published = 0
    const adapters = { statePath, review: blockReport, prepare: async () => {}, publish: async () => { published++; return { commit: 'SYNTHETIC', push_succeeded: true } } }
    await continueReviewedPublication(candidate, adapters)
    const again = await continueReviewedPublication(candidate, adapters)
    expect(published).toBe(1)
    expect(again.commit).toBe('SYNTHETIC')
  })

  it('proof and delivery accept a green publication that has no review at all', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'review-advisory-proof-SYNTHETIC-'))
    const id = '2026-10-20-art-v1'
    const screenshot = path.join(root, 'source.png'), prompt = path.join(root, 'prompt.txt')
    await fs.writeFile(screenshot, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXioAAAAASUVORK5CYII=', 'base64'))
    await fs.writeFile(prompt, 'SYNTHETIC prompt')
    const context = await syntheticProofContext(id)
    await fs.rm(path.join(context.latest_run_dir, 'independent-visual-review.json'))
    const proof = buildPublishProof({ summary: { ok: true, push_succeeded: true, remote_matches: true, local_edition_id: id, checkpoint_path: 'fixture-run', ...context }, liveProof: { expectedEditionId: id, pageEditionId: id, loadedPlateImageCount: 1, plate: { src: `https://daily.nockgarden.com/editions/${id}/assets/plate.png`, naturalWidth: 1440, naturalHeight: 900 } }, screenshotPath: screenshot, promptPath: prompt, qa: { qaPublishPassed: true, adversarialVisualQa: 'pass' } })
    expect(checkPressProof(proof)).toEqual({ green: true, blockers: [] })
    const accepted = await acceptProof(proof, path.join(root, 'durable'))
    expect(accepted).toMatchObject({ acceptance_policy: 'independent-review-advisory-v1', independent_review_archive: null, edition_id: id })
    expect((await latestAccepted(path.join(root, 'durable')))?.edition_id).toBe(id)
  })

  it('delivers a live, CI-green edition when adversarial visual QA never ran, but not when it failed', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'visual-qa-advisory-SYNTHETIC-'))
    const id = '2026-10-21-art-v1'
    const screenshot = path.join(root, 'source.png'), prompt = path.join(root, 'prompt.txt')
    await fs.writeFile(screenshot, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXioAAAAASUVORK5CYII=', 'base64'))
    await fs.writeFile(prompt, 'SYNTHETIC prompt')
    const context = await syntheticProofContext(id)
    const build = qa => buildPublishProof({ summary: { ok: true, push_succeeded: true, remote_matches: true, local_edition_id: id, checkpoint_path: 'fixture-run', ...context }, liveProof: { expectedEditionId: id, pageEditionId: id, loadedPlateImageCount: 1, plate: { src: `https://daily.nockgarden.com/editions/${id}/assets/plate.png`, naturalWidth: 1440, naturalHeight: 900 } }, screenshotPath: screenshot, promptPath: prompt, qa })
    const failed = build({ qaPublishPassed: true, adversarialVisualQa: 'fail' })
    expect(checkPressProof(failed).blockers).toContain('adversarial visual QA failed')
    await expect(acceptProof(failed, path.join(root, 'durable'))).rejects.toThrow(/must not have failed/)
    const unreviewed = build({ qaPublishPassed: true })
    expect(unreviewed.status).toBe('green')
    expect(checkPressProof(unreviewed)).toEqual({ green: true, blockers: [] })
    await acceptProof(unreviewed, path.join(root, 'durable'))
    expect((await latestAccepted(path.join(root, 'durable'), id))?.edition_id).toBe(id)
  })
})
