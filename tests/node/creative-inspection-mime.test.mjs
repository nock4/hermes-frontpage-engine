import { afterEach, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
vi.mock('../../scripts/lib/openai-json.mjs', () => ({ openAiJson: vi.fn() }))
vi.mock('../../scripts/lib/source-image-network-policy.mjs', () => ({ fetchVettedRemoteUrl: vi.fn() }))
import { openAiJson } from '../../scripts/lib/openai-json.mjs'
import { fetchVettedRemoteUrl } from '../../scripts/lib/source-image-network-policy.mjs'
import { inspectCreativeArtifacts } from '../../scripts/lib/creative-artifact-inspection.mjs'
import { hasCreativeArtifactEvidence } from '../../scripts/lib/source-selection-policy.mjs'

// A complete 2x2 JPEG, generated with Pillow; not a signature-only stand-in.
const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAACAAIDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDk6KKKs+qP/9k=', 'base64')
const source = { url: 'https://artist.example/work', image_url: 'https://artist.example/work.jpg' }
const dirs = []
afterEach(async () => {
  vi.resetAllMocks()
  await Promise.all(dirs.splice(0).map(dir => fs.rm(dir, { recursive: true, force: true })))
})
async function inspect(mime, bytes = jpeg) {
  const runDir = await fs.mkdtemp(path.join(os.tmpdir(), 'inspection-mime-'))
  dirs.push(runDir)
  fetchVettedRemoteUrl.mockResolvedValue(new Response(bytes, { headers: mime ? { 'content-type': mime } : {} }))
  return inspectCreativeArtifacts([source], {}, { runDir, maxInspections: 1 })
}

it.each(['image/jpg', 'image/jpg; charset=binary', 'image/jpeg'])('sends %s JPEG as canonical MIME without changing captured bytes or digest', async mime => {
  openAiJson.mockResolvedValue({ status: 'ambiguous', artifact_kind: 'photography', confidence: 'medium' })
  const result = await inspect(mime)
  const inspection = result.source_decisions[0].inspection
  expect(inspection.error).toBeUndefined()
  expect(openAiJson).toHaveBeenCalledTimes(1)
  expect(openAiJson.mock.calls[0][0].input[0].content[1].image_url).toBe(`data:image/jpeg;base64,${jpeg.toString('base64')}`)
  expect(inspection.capture_sha256).toBe(createHash('sha256').update(jpeg).digest('hex'))
  expect(inspection.capture_path).toMatch(/\.jpeg$/)
  expect(await fs.readFile(inspection.capture_path)).toEqual(jpeg)
  expect(inspection.media_url).toBe(source.image_url)
  expect(inspection.resolved_media_url).toBe(source.image_url)
  expect(inspection.status).toBe('ambiguous')
  expect(hasCreativeArtifactEvidence(source, result)).toBe(false)
})

it.each([
  ['text/html', Buffer.from('<!doctype html><title>Not an image</title>')],
  ['text/html', jpeg],
  ['image/svg+xml', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')],
  ['image/avif', jpeg],
  [null, jpeg],
])('rejects unsupported MIME %s with an explicit diagnostic and no vision call', async (mime, bytes) => {
  const result = await inspect(mime, bytes)
  const inspection = result.source_decisions[0].inspection
  expect(inspection.error).toBe(`Unsupported inspection media MIME: ${mime || '(missing)'}`)
  expect(inspection.status).toBe('unknown')
  expect(inspection.capture_path).toBeUndefined()
  expect(openAiJson).not.toHaveBeenCalled()
  expect(hasCreativeArtifactEvidence(source, result)).toBe(false)
})

it('does not turn a normal vision/decode failure for mislabeled image/jpg bytes into evidence', async () => {
  // Vision is an external boundary; its decoder failure must remain fail-closed.
  openAiJson.mockRejectedValue(new Error('Cannot decode image input'))
  const result = await inspect('image/jpg', Buffer.from('<html>not JPEG pixels</html>'))
  expect(openAiJson).toHaveBeenCalledTimes(1)
  expect(result.source_decisions[0].inspection.error).toBe('Cannot decode image input')
  expect(result.source_decisions[0].inspection.status).toBe('unknown')
  expect(hasCreativeArtifactEvidence(source, result)).toBe(false)
})
