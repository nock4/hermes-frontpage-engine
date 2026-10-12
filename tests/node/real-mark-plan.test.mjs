import { describe, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { buildSceneImagePrompt } from '../../scripts/lib/scene-generation.mjs'
import { buildSourceFidelityRecoveryPayload, runFromScratchMode } from '../../scripts/pipeline/run-from-scratch-mode.mjs'

const provider = vi.hoisted(() => vi.fn())
vi.mock('../../scripts/lib/openai-json.mjs', () => ({ openAiJson: provider }))

import { planRealMarks } from '../../scripts/lib/real-mark-plan.mjs'

const marks = ['ridged gold return', 'ragged-band fold mouth', 'frayed strand crossing', 'raised pigment junction', 'suspended pleat gap', 'chalk-reflection break']
const payload = {
  scene_prompt: 'A projecting gold threshold and checked cloth. '.repeat(12),
  source_image_fingerprints: [{ image_url: 'https://example.org/source.jpg', width: 843, height: 660, preserve_cues: ['gold relief and checked cloth'], visual_summary: 'Museum photograph with cloth and gold frame.' }],
  artifacts: marks.map((mark, i) => ({ label: `Internal label ${i}`, artifact_type: 'internal-type', role: 'source-bearing detail', source_url: `https://example.org/work/${i}`, visual_description: mark })),
}

// Synthetic affirmative inspections are explicit test inputs, not production stamps.
const researchField = {
  content_sources: payload.artifacts.map((a) => ({ url: a.source_url, title: a.visual_description, image_url: `${a.source_url}.jpg` })),
  autoresearch: { source_decisions: payload.artifacts.map((a, i) => ({
    url: a.source_url, role: 'content', confidence: 'high', why: 'Synthetic actual-media inspection fixture',
    inspection: {
      version: 1, inspector: 'creative-artifact-vision', status: 'verified', confidence: 'high',
      source_url: a.source_url, media_url: `${a.source_url}.jpg`, artifact_kind: 'artwork',
      capture_sha256: String(i).repeat(64), capture_path: `/test-only/capture-${i}.jpeg`,
      observation: `Visible owner ${i}: folded metallic-looking surfaces; attribution is not established by pixels.`,
      caveats: ['The saved note claims leather, which the visible surface does not support.'],
    },
  })) },
}
const replacement = () => ({
  scene_prompt: 'Recomposed gold arcs and checked silhouettes share an open pale field.',
  material_language: ['source-derived cloth and gold relief'], lighting: 'diffuse source light',
  composition_archetype: 'interlocked fragments', camera_plate_grammar: 'oblique source-native relief',
  visual_compositional_moves: ['separate figure masses and redirect the gold boundary'],
  negative_constraints: ['No same-photo restaging or debug marks.'],
  artifacts: payload.artifacts.map((a, i) => ({ source_url: a.source_url, visual_description: `Distinct recomposed cloth edge ${String.fromCharCode(97 + i)}`, role: `Derived from ${a.visual_description}` })),
})

describe('bounded scene and ownership replan', () => {
  it('carries exact owner/media inspection provenance, caveats and prior roles without unrelated images', async () => {
    const field = structuredClone(researchField)
    const original = structuredClone(field)
    const unrelated = { image_url: 'https://example.org/unrelated.jpg', alt: 'UNRELATED SCULPTURE' }
    field.sources = field.content_sources.map((s) => ({ ...s, image_candidates: [unrelated], editorial_evidence: [{ image_candidates: [unrelated] }] }))
    const stale = structuredClone(field.autoresearch.source_decisions[0])
    stale.inspection.media_url = unrelated.image_url
    stale.inspection.observation = 'STALE MEDIA OBSERVATION'
    const ambiguous = structuredClone(field.autoresearch.source_decisions[0])
    ambiguous.inspection.status = 'ambiguous'
    ambiguous.inspection.observation = 'AMBIGUOUS OBSERVATION'
    field.autoresearch.source_decisions.unshift(stale, ambiguous)
    const before = structuredClone(field)
    const request = vi.fn().mockResolvedValue(replacement())
    await planRealMarks({ payload, researchField: field }, { request })
    const input = JSON.parse(request.mock.calls[0][0].input)
    for (const [i, source] of input.sources.entries()) {
      expect(source.prior_role).toBe(payload.artifacts[i].role)
      expect(source.evidence.source_decisions).toEqual([original.autoresearch.source_decisions[i]])
      expect(source.evidence.image_url).toBe(original.content_sources[i].image_url)
    }
    expect(request.mock.calls[0][0].input).not.toMatch(/image_candidates|UNRELATED SCULPTURE|unrelated\.jpg|STALE MEDIA OBSERVATION|AMBIGUOUS OBSERVATION/)
    expect(field).toEqual(before)
  })

  it.each(['missing', 'wrong owner', 'wrong media', 'ambiguous', 'low confidence', 'missing capture', 'rejected'])('fails before transport without attributable affirmative inspection: %s', async (scenario) => {
    const field = structuredClone(researchField)
    const decision = field.autoresearch.source_decisions[0]
    if (scenario === 'missing') delete field.autoresearch
    if (scenario === 'wrong owner') decision.inspection.source_url = field.content_sources[1].url
    if (scenario === 'wrong media') decision.inspection.media_url = field.content_sources[1].image_url
    if (scenario === 'ambiguous') decision.inspection.status = 'ambiguous'
    if (scenario === 'low confidence') decision.confidence = 'low'
    if (scenario === 'missing capture') delete decision.inspection.capture_sha256
    if (scenario === 'rejected') field.autoresearch.source_decisions.push({ url: decision.url, role: 'reject' })
    const request = vi.fn()
    await expect(planRealMarks({ payload, researchField: field }, { request })).rejects.toThrow(/Real-mark plan/)
    expect(request).not.toHaveBeenCalled()
  })

  it.each([['overcopy'], ['lost source silhouettes']])('replaces stale scene materials and mapping checklist together: %s', async (blockers) => {
    const stale = { ...payload, material_language: ['incompatible chalk cube'], effect_direction: { prompt_sentence: 'incompatible chalk cube' }, visual_direction: { composition_archetype: 'incompatible chalk cube' } }
    const recovery = buildSourceFidelityRecoveryPayload(stale, { blockers })
    const request = vi.fn().mockResolvedValue(replacement())
    const result = await planRealMarks({ payload: recovery, researchField }, { request })
    expect(request).toHaveBeenCalledTimes(1)
    expect(JSON.parse(request.mock.calls[0][0].input).sources.map((s) => s.source_url)).toEqual(payload.artifacts.map((a) => a.source_url))
    expect(result.artifacts.map((a) => a.source_url)).toEqual(payload.artifacts.map((a) => a.source_url))
    expect(result.artifacts).not.toEqual(stale.artifacts)
    expect(result.real_mark_plan).toMatchObject({ status: 'planned', geometry_status: 'unverified' })
    expect(result.source_contract.mode).toBe('source-image')
    expect(result.source_image_fingerprints).toEqual(payload.source_image_fingerprints)
    const prompt = buildSceneImagePrompt(result)
    expect(prompt).not.toContain('incompatible chalk cube')
    for (const artifact of result.artifacts) expect(prompt).toContain(artifact.visual_description)
    expect(result.artifacts.every((a) => !a.bounds && !a.polygon)).toBe(true)
    expect(stale.artifacts).toEqual(payload.artifacts)
  })

  it.each([
    ['dropped source', (r) => r.artifacts.pop()],
    ['new owner', (r) => { r.artifacts[0].source_url = 'https://different.org/work' }],
    ['duplicate owner', (r) => { r.artifacts[0].source_url = r.artifacts[1].source_url }],
    ['fabricated geometry', (r) => { r.artifacts[0].bounds = { x: 0, y: 0, w: 1, h: 1 } }],
    ['duplicate marks', (r) => { r.artifacts[0].visual_description = r.artifacts[1].visual_description }],
    ['debug marks', (r) => { r.artifacts[0].visual_description = 'numbered target ring' }],
    ['oversized mark', (r) => { r.artifacts[0].visual_description = 'x'.repeat(81) }],
    ['oversized scene', (r) => { r.scene_prompt = 'x'.repeat(421) }],
  ])('fails closed on %s without a second planning attempt', async (_, mutate) => {
    const response = replacement(); mutate(response)
    const request = vi.fn().mockResolvedValue(response)
    await expect(planRealMarks({ payload, researchField }, { request })).rejects.toThrow(/Real-mark plan/)
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('retains the reconciled connected-space scene instead of silently replacing it after planning', async () => {
    const connected = { ...payload, source_image_fingerprints: [{ ...payload.source_image_fingerprints[0], composition_moves: ['Bring cobalt waters into one connected negative-space channel.'] }] }
    const result = await planRealMarks({ payload: connected, researchField }, { request: vi.fn().mockResolvedValue(replacement()) })
    expect(buildSceneImagePrompt(result)).toContain(result.scene_prompt)
    expect(buildSceneImagePrompt(result)).toContain('one connected negative-space channel')
    expect(buildSceneImagePrompt(result)).toContain('no paper edges, curled flaps')
  })

  it('blocks connected-space plans that try to revive paper-panel conversion', async () => {
    const connected = { ...payload, source_image_fingerprints: [{ ...payload.source_image_fingerprints[0], composition_moves: ['Bring cobalt waters into one connected negative-space channel.'] }] }
    const response = replacement(); response.material_language = ['curled paper panels']
    const result = await planRealMarks({ payload: connected, researchField }, { request: vi.fn().mockResolvedValue(response) })
    expect(() => buildSceneImagePrompt(result)).toThrow(/Real-mark plan.*connected/)
  })

  it('does not plan below six owners or invent absent research', async () => {
    const request = vi.fn()
    await expect(planRealMarks({ payload: { ...payload, artifacts: payload.artifacts.slice(0, 5) }, researchField }, { request })).rejects.toThrow(/6–10/)
    await expect(planRealMarks({ payload, researchField: { ...researchField, content_sources: researchField.content_sources.slice(0, 5) } }, { request })).rejects.toThrow(/absent/)
    expect(request).not.toHaveBeenCalled()
  })

  it('retains request and rejected response diagnostics without credentials', async () => {
    const response = replacement(); response.artifacts.pop()
    const record = vi.fn()
    await expect(planRealMarks({ payload, researchField, apiKey: 'test-not-a-real-key' }, { request: vi.fn().mockResolvedValue(response), record })).rejects.toThrow(/count changed/)
    expect(record).toHaveBeenCalledTimes(2)
    expect(record.mock.calls[0][0]).toBe('request')
    expect(record.mock.calls[1]).toEqual(['response', response])
    expect(record.mock.calls[0][1]).not.toHaveProperty('apiKey')
    expect(JSON.stringify(record.mock.calls)).not.toContain('test-...key')
    expect(JSON.parse(record.mock.calls[0][1].input).sources).toHaveLength(6)
  })

  it('does not retry or silently fall back after provider failure', async () => {
    const request = vi.fn().mockRejectedValue(new Error('provider unavailable'))
    const record = vi.fn()
    await expect(planRealMarks({ payload, researchField }, { request, record })).rejects.toThrow('provider unavailable')
    expect(request).toHaveBeenCalledTimes(1)
    expect(record).toHaveBeenCalledTimes(1)
    expect(record.mock.calls[0][0]).toBe('request')
  })

  it('awaits diagnostic persistence before transport and rejected-plan validation', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dfe-real-mark-plan-'))
    const response = replacement(); response.artifacts.pop()
    const file = (kind) => path.join(dir, `${kind}.json`)
    const record = async (kind, value) => fs.writeFile(file(kind), JSON.stringify(value))
    const request = vi.fn(async () => {
      const saved = JSON.parse(await fs.readFile(file('request'), 'utf8'))
      expect(saved).not.toHaveProperty('apiKey')
      expect(JSON.parse(saved.input).sources).toHaveLength(6)
      return response
    })
    try {
      await expect(planRealMarks({ payload, researchField }, { request, record })).rejects.toThrow(/count changed/)
      expect(JSON.parse(await fs.readFile(file('response'), 'utf8'))).toEqual(response)
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('fails before the provider when request diagnostics cannot be persisted', async () => {
    const request = vi.fn()
    const record = vi.fn().mockRejectedValue(new Error('disk unavailable'))
    await expect(planRealMarks({ payload, researchField }, { request, record })).rejects.toThrow('disk unavailable')
    expect(request).not.toHaveBeenCalled()
  })
})

describe('real-mark planning contract', () => {
  it.each(['valid', 'invalid initial', 'invalid recovery'])('production orchestration persists planning and gates image/mapping calls: %s', async (scenario) => {
    const initialResponse = replacement()
    const recoveryResponse = { ...replacement(), scene_prompt: 'New grouped gold fragments and separated checked silhouettes.' }
    if (scenario === 'invalid initial') initialResponse.artifacts.pop()
    if (scenario === 'invalid recovery') recoveryResponse.artifacts.pop()
    provider.mockReset().mockResolvedValueOnce(initialResponse).mockResolvedValueOnce(recoveryResponse)
    const writes = new Map()
    const images = []
    const audit = { blockers: ['overcopy'] }
    const stop = new Error('stop before mapping provider or assembly')
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {})
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const previous = process.env.DFE_SOURCE_FIDELITY_AUTO_RECOVERY
    const previousAttempts = process.env.DFE_SOURCE_FIDELITY_RECOVERY_ATTEMPTS
    process.env.DFE_SOURCE_FIDELITY_AUTO_RECOVERY = '1'
    process.env.DFE_SOURCE_FIDELITY_RECOVERY_ATTEMPTS = '1'
    try {
      const run = runFromScratchMode({
        root: '/test-only', options: { generationName: 'contract', date: '2026-10-11', useSampleSignals: true, inputMode: 'manifest', skipMask: true, imageSize: '1536x1024' },
        fs: { mkdir: async () => {}, writeFile: async (file, value) => writes.set(file, value), readFile: async () => JSON.stringify(audit) },
        requireOpenAiKey: () => ({ loaded: {} }), chooseDiversityDirective: () => '',
        mineSignals: async () => ({ notes_selected: [], source_candidates: [] }),
        inspectSourceCandidates: async () => researchField,
        composeDailyPayload: async () => structuredClone(payload),
        imageAspectRatioFromSize: () => 'landscape',
        generateScenePlate: async ({ payload: plan }) => { images.push(structuredClone(plan)); buildSceneImagePrompt(plan); return { outputPath: '/test-only/plate.png' } },
        auditSourceImageFidelity: vi.fn().mockRejectedValueOnce(new Error('overcopy')).mockResolvedValueOnce({ pass: true }),
        inspectGeneratedPlate: async ({ payload: plan }) => { expect(plan).toEqual(images[1]); throw stop },
        runInternal: async (step, command, run) => { if (step.name !== 'Prepare source audio material') return run() },
      })
      if (scenario !== 'valid') {
        await expect(run).rejects.toThrow(/owning source count changed/)
        const initialFailure = scenario === 'invalid initial'
        expect(provider).toHaveBeenCalledTimes(initialFailure ? 1 : 2)
        expect(images).toHaveLength(initialFailure ? 0 : 1)
        const prefix = '/test-only/tmp/daily-process-runs/contract/real-mark-plan'
        const suffix = initialFailure ? '' : '.source-fidelity-recovery-1'
        expect(JSON.parse(writes.get(`${prefix}${suffix}.response.json`))).toEqual(initialFailure ? initialResponse : recoveryResponse)
        expect(JSON.parse(writes.get(`${prefix}${suffix}.request.json`))).not.toHaveProperty('apiKey')
        return
      }
      await expect(run).rejects.toBe(stop)
      expect(provider).toHaveBeenCalledTimes(2)
      expect(images).toHaveLength(2)
      expect(images[1].scene_prompt).not.toBe(images[0].scene_prompt)
      expect(images[1].source_fidelity_recovery_diagnostics).toEqual([audit])
      const recovery = JSON.parse(writes.get('/test-only/tmp/daily-process-runs/contract/daily-generation-payload.source-fidelity-recovery-1.json'))
      expect(recovery).toEqual(images[1])
      expect(recovery.real_mark_plan.geometry_status).toBe('unverified')
      const prefix = '/test-only/tmp/daily-process-runs/contract/real-mark-plan'
      for (const suffix of ['', '.source-fidelity-recovery-1']) {
        const request = JSON.parse(writes.get(`${prefix}${suffix}.request.json`))
        const response = JSON.parse(writes.get(`${prefix}${suffix}.response.json`))
        expect(request).not.toHaveProperty('apiKey')
        expect(JSON.parse(request.input).sources).toHaveLength(6)
        expect(response.artifacts).toEqual(replacement().artifacts)
      }
      expect(JSON.parse(JSON.parse(writes.get(`${prefix}.source-fidelity-recovery-1.request.json`)).input).recovery_diagnostics).toEqual([audit])
    } finally {
      consoleLog.mockRestore(); consoleWarn.mockRestore()
      if (previous === undefined) delete process.env.DFE_SOURCE_FIDELITY_AUTO_RECOVERY
      else process.env.DFE_SOURCE_FIDELITY_AUTO_RECOVERY = previous
      if (previousAttempts === undefined) delete process.env.DFE_SOURCE_FIDELITY_RECOVERY_ATTEMPTS
      else process.env.DFE_SOURCE_FIDELITY_RECOVERY_ATTEMPTS = previousAttempts
    }
  })

  it('delivers every planned visual mark beyond the scene budget without leaking binding labels', () => {
    const prompt = buildSceneImagePrompt(payload)
    for (const mark of marks) expect(prompt).toContain(mark)
    expect(prompt).not.toMatch(/Internal label|internal-type|https:\/\/example.org\/work/)
    expect(prompt).toContain('at least six distinct')
    expect(prompt).toContain('No visible annotation glyphs or QA chrome')
    expect(prompt.split('\nTRANSFORM\n')[1].split('\nCOMPOSITION\n')[0].length).toBeLessThanOrEqual(420)
    expect(prompt.split('\nANCHORS\n')[1].split('\nLIMITS\n')[0].length).toBeLessThanOrEqual(1400)
  })

  it.each([['overcopy'], ['lost source silhouettes']])('invalidates a plan whenever fidelity recovery can change the scene: %s', (blockers) => {
    const next = buildSourceFidelityRecoveryPayload(payload, { blockers })
    expect(next.real_mark_plan?.status).toBe('needs-replan')
    expect(() => buildSceneImagePrompt(next)).toThrow(/real-mark.*replan/i)
    expect(next.artifacts).toEqual(payload.artifacts)
  })
})
