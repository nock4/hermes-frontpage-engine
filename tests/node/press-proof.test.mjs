import { describe, expect, it } from 'vitest'

import {
  buildPublishProof,
  checkPressProof,
  classifyPressState,
  extractLastPublishSummary,
} from '../../scripts/lib/press-proof.mjs'

describe('press proof contract', () => {
  it('marks a publish green only when remote, screenshot, preload, QA, and edition match proof all hold', () => {
    const proof = buildPublishProof({
      summary: {
        ok: true,
        local_edition_id: '2026-07-27-mint-wing-wood-quiet-v1',
        local_publish_status: 'live',
        remote_matches: true,
        commit: 'abc123',
      },
      liveProof: {
        expectedEditionId: '2026-07-27-mint-wing-wood-quiet-v1',
        pageEditionId: '2026-07-27-mint-wing-wood-quiet-v1',
        loadedPlateImageCount: 1,
        loadedImageCount: 7,
        imageCount: 7,
        plate: {
          src: 'https://daily.nockgarden.com/editions/2026-07-27-mint-wing-wood-quiet-v1/assets/plate.png',
          naturalWidth: 1024,
          naturalHeight: 1536,
        },
      },
      screenshotPath: '/tmp/daily-frontpage.png',
      qa: { qaPublishPassed: true, adversarialVisualQa: 'pass' },
      source: { sourceImageMode: 'dominant-source-image', sourceFidelityVerdict: 'pass' },
      promptPath: '/tmp/scene-prompt.txt',
    })

    expect(proof.status).toBe('green')
    expect(checkPressProof(proof)).toEqual({ green: true, blockers: [] })
  })

  it('classifies stale live screenshot/preload after a good remote publish as proof_failed_after_publish', () => {
    const proof = buildPublishProof({
      summary: {
        ok: true,
        local_edition_id: '2026-07-27-mint-wing-wood-quiet-v1',
        local_publish_status: 'live',
        remote_matches: true,
      },
      liveProof: {
        expectedEditionId: '2026-07-27-mint-wing-wood-quiet-v1',
        pageEditionId: '2026-07-27-mint-wing-wood-quiet-v1',
        loadedPlateImageCount: 1,
        plate: {
          src: 'https://daily.nockgarden.com/editions/2026-07-26-blue-air-room-section-v1/assets/plate.png',
          naturalWidth: 1024,
          naturalHeight: 1536,
        },
      },
      screenshotPath: '/tmp/stale.png',
      qa: { qaPublishPassed: true, adversarialVisualQa: 'pass' },
      promptPath: '/tmp/scene-prompt.txt',
    })

    expect(proof.status).toBe('proof_failed_after_publish')
    expect(checkPressProof(proof).blockers).toContain('live plate does not match expected edition')
  })

  it('keeps generation failures distinct from proof failures', () => {
    const summary = {
      ok: false,
      local_edition_id: null,
      remote_matches: false,
      error: 'npm run daily:process -- --input-mode obsidian-allowlist --publish failed with exit code 1',
      latest_run_dir: '/tmp/daily-process-run',
    }

    expect(classifyPressState({ summary })).toBe('generation_failed')
  })

  it('extracts the final daily:publish:cron JSON summary from a mixed cron log', () => {
    const text = [
      'noise before',
      '{\n  "ok": false,\n  "local_edition_id": null\n}',
      'more log',
      '{\n  "ok": true,\n  "local_edition_id": "edition-v1",\n  "remote_matches": true\n}',
      'Live preload proof: {"loadedPlateImageCount":1}',
    ].join('\n')

    expect(extractLastPublishSummary(text)).toMatchObject({
      ok: true,
      local_edition_id: 'edition-v1',
      remote_matches: true,
    })
  })

  it('builds proof directly from cron log text', async () => {
    const { buildPublishProofFromCronLog } = await import('../../scripts/lib/press-proof.mjs')
    const text = [
      '{\n  "ok": true,\n  "local_edition_id": "edition-v1",\n  "local_publish_status": "live",\n  "remote_matches": true\n}',
      'Captured success screenshot: /tmp/proof.png',
      'Actual plate prompt: /tmp/scene-prompt.txt',
      'Live preload proof: {"expectedEditionId":"edition-v1","pageEditionId":"edition-v1","loadedPlateImageCount":1,"plate":{"src":"https://daily.nockgarden.com/editions/edition-v1/assets/plate.png","naturalWidth":1024,"naturalHeight":1536}}',
      'qa:publish',
      '  10 passed (37.9s)',
    ].join('\n')

    const proof = buildPublishProofFromCronLog(text, { adversarialVisualQa: 'pass' })

    expect(proof.status).toBe('green')
    expect(proof.screenshot_path).toBe('/tmp/proof.png')
    expect(proof.prompt_path).toBe('/tmp/scene-prompt.txt')
  })

  it('blocks proof when the live page edition marker is missing even if the plate URL matches', () => {
    const proof = buildPublishProof({
      summary: {
        ok: true,
        local_edition_id: 'edition-v1',
        local_publish_status: 'live',
        remote_matches: true,
      },
      liveProof: {
        expectedEditionId: 'edition-v1',
        pageEditionId: null,
        loadedPlateImageCount: 1,
        plate: {
          src: 'https://daily.nockgarden.com/editions/edition-v1/assets/plate.png',
          naturalWidth: 1024,
          naturalHeight: 1536,
        },
      },
      screenshotPath: '/tmp/proof.png',
      qa: { qaPublishPassed: true, adversarialVisualQa: 'pass' },
      promptPath: '/tmp/scene-prompt.txt',
    })

    expect(proof.status).toBe('proof_failed_after_publish')
    expect(checkPressProof(proof).blockers).toContain('live page edition id does not match expected edition')
  })
})
