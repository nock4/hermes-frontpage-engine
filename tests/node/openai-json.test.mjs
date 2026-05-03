import { describe, expect, it } from 'vitest'

import { buildHermesCommandArgs, buildHermesQuery, openAiJson } from '../../scripts/lib/openai-json.mjs'

describe('openAiJson', () => {
  it('builds a Hermes CLI query/command for structured JSON work', () => {
    const query = buildHermesQuery({
      instructions: 'Return strict JSON only.',
      inputText: '{"task":"ping"}',
      maxOutputTokens: 120,
      imagePath: null,
    })
    const args = buildHermesCommandArgs({ query, needsVision: false })

    expect(query).toContain('Return exactly one JSON object and nothing else.')
    expect(query).toContain('Return strict JSON only.')
    expect(query).toContain('{"task":"ping"}')
    expect(args).toEqual([
      'chat',
      '-Q',
      '--source', 'tool',
      '--max-turns', '12',
      '-q', query,
    ])
  })

  it('builds a Hermes vision command when an image is present', () => {
    const query = buildHermesQuery({
      instructions: 'Inspect the attached image and return JSON only.',
      inputText: '{"task":"inspect-image"}',
      maxOutputTokens: 120,
      imagePath: '/tmp/example.png',
    })
    const args = buildHermesCommandArgs({ query, needsVision: true })

    expect(query).toContain('Use the vision_analyze tool on that image before answering.')
    expect(query).toContain('Image reference: /tmp/example.png')
    expect(args).toEqual([
      'chat',
      '-Q',
      '--source', 'tool',
      '--max-turns', '12',
      '-t', 'vision',
      '-q', query,
    ])
  })

  it('routes text-only structured JSON work through Hermes successfully', async () => {
    const result = await openAiJson({
      apiKey: 'ignored',
      model: 'gpt-5.5',
      instructions: 'Return strict JSON only.',
      input: '{"ok":true,"route":"hermes"}',
      maxOutputTokens: 120,
    })

    expect(result).toEqual({ ok: true, route: 'hermes' })
  }, 90000)
})
