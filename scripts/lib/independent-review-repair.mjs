// Critique-directed SAME-SOURCE repair. No intake, reserve, override consumption,
// eligibility stamps or source-budget reset. The existing owner handles runtime
// defects or genuinely necessary unused-source replacement from retained action.
import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { execFile, execFileSync } from 'node:child_process'
import { promisify, isDeepStrictEqual } from 'node:util'
import { parseArgs } from './cli-options.mjs'
import { requireOpenAiKey } from './runtime-env.mjs'
import { generateScenePlate } from './scene-generation.mjs'
import { auditSourceImageFidelity } from './source-fidelity-audit.mjs'
import { inspectGeneratedPlate } from './plate-analysis.mjs'
import { assembleEditionPackage } from './edition-package-assembly.mjs'
import { planRealMarks } from './real-mark-plan.mjs'
import { assertLandscapePlate } from './landscape-policy.mjs'
import { existingPackageSteps } from '../pipeline/package-steps.mjs'
import { MIN_SOURCE_WINDOWS, MAX_SOURCE_WINDOWS } from '../../src/lib/sourceWindowCountContract.mjs'

const read = async file => JSON.parse(await fs.readFile(file, 'utf8'))
const writeJson = async (file, value) => fs.writeFile(file, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 })
async function optional(file) { try { return await read(file) } catch (error) { if (error.code !== 'ENOENT') throw error } }
async function exclusiveJson(file, value) {
  const handle = await fs.open(file, 'wx', 0o600)
  try { await handle.writeFile(JSON.stringify(value, null, 2)); await handle.sync() } finally { await handle.close() }
}
async function guardedPlan(candidate, action, nextRunDir, input, replan) {
  const requestFile = path.join(nextRunDir, 'repair-planning-request.json')
  const resultFile = path.join(nextRunDir, 'repair-planning-result.json')
  const context = { candidate, action, next_run_dir: nextRunDir, payload: input.payload, researchField: input.researchField, model: input.model ?? null }
  const context_sha256 = createHash('sha256').update(JSON.stringify(context)).digest('hex')
  const request = { schema_version: 1, context_sha256, context }
  const reconcile = () => Error(`Repair planning outcome requires exact reconciliation: reconcile ${requestFile} with retained real-mark-plan.* diagnostics/session; never remove the guard or submit a fresh request`)
  let claimed = false
  try { await exclusiveJson(requestFile, request); claimed = true } catch (error) { if (error.code !== 'EEXIST') throw error }
  if (!claimed) {
    let previous, result
    try { previous = await read(requestFile); result = await optional(resultFile) } catch { throw reconcile() }
    if (!isDeepStrictEqual(previous, request) || !result || result.context_sha256 !== context_sha256 || !result.payload || result.payload_sha256 !== createHash('sha256').update(JSON.stringify(result.payload)).digest('hex')) throw reconcile()
    return result.payload
  }
  const payload = await replan(input, { record: async (kind, value) => {
    if (!/^[a-z]+(?:\.[a-z]+)*$/.test(kind)) throw Error('Unsafe planning diagnostic name')
    await exclusiveJson(path.join(nextRunDir, `real-mark-plan.${kind}.json`), value)
  } })
  if (!isDeepStrictEqual(payload.source_contract, input.payload.source_contract) || !isDeepStrictEqual(payload.artifacts.map(row => row.source_url), input.payload.artifacts.map(row => row.source_url))) throw Error('Critique repair changed mandatory source/contract ownership')
  await exclusiveJson(resultFile, { context_sha256, payload_sha256: createHash('sha256').update(JSON.stringify(payload)).digest('hex'), payload })
  return payload
}
async function postprocess(options, editionId, runDir) {
  const generationName = path.basename(runDir)
  const steps = existingPackageSteps(options, [editionId], generationName)
  steps.splice(2, 0, { command: ['npm', ['run', 'prepare:source-visuals', '--', '--edition', editionId]] })
  for (const { command: [command, args] } of steps) await promisify(execFile)(command, args, { cwd: options.root, maxBuffer: 32 * 1024 * 1024, timeout: 180000 })
}
export async function repairRejectedCandidate(candidate, action, nextRunDir, adapters = {}) {
  const root = candidate.worktreeDir
  const completed = await optional(path.join(nextRunDir, 'repair-complete.json'))
  if (completed) return completed
  await fs.mkdir(nextRunDir, { recursive: true, mode: 0o700 })
  const generationOptions = adapters.generationOptions || { ...parseArgs(['--date', candidate.editionId.slice(0, 10), '--publish']), root }
  const { key: apiKey } = requireOpenAiKey({ root, required: false })
  let payload = await optional(path.join(nextRunDir, 'daily-generation-payload.json'))
  const original = await read(path.join(candidate.runDir, 'daily-generation-payload.json'))
  const researchField = await read(path.join(candidate.runDir, 'source-research.json'))
  const signalHarvest = await read(path.join(candidate.runDir, 'signal-harvest.json'))
  for (const name of ['source-research.json', 'signal-harvest.json', 'bookmark-acquisition.json', 'source-intake-snapshot.json', 'source-audio-material.json', 'source-image-fingerprints.json']) {
    try { await fs.copyFile(path.join(candidate.runDir, name), path.join(nextRunDir, name), 1) } catch (error) { if (!['ENOENT', 'EEXIST'].includes(error.code)) throw error }
  }
  if (!payload) {
    const critique = [...action.adverse_findings, ...action.findings.filter(row => row.status !== 'fulfilled').map(row => `${row.clause_id}: ${row.reason}`)]
    payload = { ...original, independent_review_repair: { rejected_run_dir: candidate.runDir, critique: action },
      scene_prompt: `${original.scene_prompt || ''}\nIndependent visual rejection repair, not a reroll: change the failed composition using the SAME admitted owning source. Preserve every mandatory transformation and source identity; do not copy the original. Address ALL these observed defects as visible source-derived artwork, not text/debug annotations: ${critique.join('; ')}` }
    if (original.source_image_fingerprints?.some(row => row.image_url)) {
      payload = await guardedPlan(candidate, action, nextRunDir, { payload, researchField, apiKey, model: generationOptions.model }, adapters.replan || planRealMarks)
    }
    if (!isDeepStrictEqual(payload.source_contract, original.source_contract) || !isDeepStrictEqual(payload.artifacts.map(row => row.source_url), original.artifacts.map(row => row.source_url))) throw Error('Critique repair changed mandatory source/contract ownership')
    await writeJson(path.join(nextRunDir, 'daily-generation-payload.json'), payload)
    await writeJson(path.join(nextRunDir, 'source-contract.json'), payload.source_contract)
  }
  let plate = await optional(path.join(nextRunDir, 'repair-generated.json'))
  if (!plate) {
    const requested = path.join(nextRunDir, 'repair-generation-request.json')
    try { await fs.writeFile(requested, JSON.stringify({ rejected_run_dir: candidate.runDir }), { flag: 'wx', mode: 0o600 }) } catch (error) {
      if (error.code === 'EEXIST') throw Error('Repair generation interrupted with unknown outcome; retain exact request/bytes and reconcile, never silently generate twice')
      throw error
    }
    plate = await (adapters.generate || generateScenePlate)({ payload, apiKey, imageModel: generationOptions.imageModel, imageBackend: generationOptions.imageBackend, imageSize: generationOptions.imageSize, imageQuality: generationOptions.imageQuality }, nextRunDir, { writeJson })
    await assertLandscapePlate(plate.outputPath)
    await writeJson(path.join(nextRunDir, 'repair-generated.json'), plate)
  }
  if (!await optional(path.join(nextRunDir, 'repair-audited.json'))) {
    try { await fs.writeFile(path.join(nextRunDir, 'repair-audit-request.json'), JSON.stringify({ rejected_run_dir: candidate.runDir }), { flag: 'wx', mode: 0o600 }) } catch (error) {
      if (error.code === 'EEXIST') throw Error('Prior primary audit failed or audit interrupted; retain its result and repair the actual cause, never reroll unchanged candidate toward PASS')
      throw error
    }
    await (adapters.audit || auditSourceImageFidelity)({ payload, platePath: plate.outputPath, apiKey, model: generationOptions.model }, nextRunDir, { writeJson })
    await writeJson(path.join(nextRunDir, 'repair-audited.json'), { complete: true })
  }
  let analysis = await optional(path.join(nextRunDir, 'repair-mapped.json'))
  if (!analysis) {
    try { await fs.writeFile(path.join(nextRunDir, 'repair-map-request.json'), JSON.stringify({ rejected_run_dir: candidate.runDir }), { flag: 'wx', mode: 0o600 }) } catch (error) {
      if (error.code === 'EEXIST') throw Error('Prior primary map failed or map interrupted; retain its result and repair the actual cause, never silently repeat provider work')
      throw error
    }
    analysis = await (adapters.map || inspectGeneratedPlate)({ payload, researchField, platePath: plate.outputPath, apiKey, model: generationOptions.model }, nextRunDir, { writeJson, minContentItems: MIN_SOURCE_WINDOWS, maxContentItems: MAX_SOURCE_WINDOWS })
    await writeJson(path.join(nextRunDir, 'repair-mapped.json'), analysis)
  }
  let pkg = await optional(path.join(nextRunDir, 'edition-package-summary.json'))
  if (!pkg) {
    const result = await (adapters.assemble || assembleEditionPackage)({ root, options: generationOptions, payload, researchField, signalHarvest, plate, analysis, runDir: nextRunDir })
    pkg = { edition_id: result.editionId }
  }
  await (adapters.postprocess || postprocess)({ ...generationOptions, root }, pkg.edition_id, nextRunDir)
  if (pkg.edition_id !== candidate.editionId) {
    // Never delete a tracked/published edition. The rejected, untracked package
    // was copied in full into the old run BEFORE repair by the owner coordinator.
    const oldRelative = `public/editions/${candidate.editionId}`
    if (execFileSync('git', ['ls-files', '--', oldRelative], { cwd: root, encoding: 'utf8' }).trim()) throw Error('Refusing to retire a tracked/published candidate')
    const snapshot = path.join(candidate.runDir, 'rejected-package')
    await fs.access(path.join(snapshot, 'assets/plate.png'))
    const manifestPath = path.join(root, 'public/editions/index.json')
    const manifest = await read(manifestPath)
    manifest.editions = manifest.editions.filter(row => row.edition_id !== candidate.editionId)
    await writeJson(manifestPath, manifest)
    await fs.rm(path.join(root, oldRelative), { recursive: true })
  }
  const result = { worktreeDir: root, runDir: nextRunDir, editionId: pkg.edition_id }
  await writeJson(path.join(nextRunDir, 'repair-complete.json'), result)
  return result
}
