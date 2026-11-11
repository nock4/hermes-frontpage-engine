// Model access for the press: plain HTTPS calls, no agent, no SDK.
//   chatJson       one JSON answer from a chat model, optionally with one image
//   generateImage  one landscape PNG
// Rule for both: try the first provider, retry it once, then use the second
// provider. PRESS_REPLAY_DIR swaps every call for a recorded answer (tests,
// offline runs); PRESS_RECORD_DIR saves live answers in the same layout.

import fs from 'node:fs/promises'
import path from 'node:path'

const CHAT_TIMEOUT_MS = 180_000
const IMAGE_TIMEOUT_MS = 300_000

function providersFromEnv(env = process.env) {
  const chat = []
  const image = []
  if (env.OPENAI_API_KEY) {
    chat.push({ name: 'openai', baseUrl: 'https://api.openai.com/v1', apiKey: env.OPENAI_API_KEY, model: env.PRESS_TEXT_MODEL || 'gpt-5.5' })
    image.push({ name: 'openai', kind: 'openai-images', baseUrl: 'https://api.openai.com/v1', apiKey: env.OPENAI_API_KEY, model: env.PRESS_IMAGE_MODEL || 'gpt-image-2', quality: env.PRESS_IMAGE_QUALITY || 'medium' })
  }
  if (env.OPENROUTER_API_KEY) {
    chat.push({ name: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1', apiKey: env.OPENROUTER_API_KEY, model: env.PRESS_FALLBACK_TEXT_MODEL || 'openai/gpt-5.5' })
    image.push({ name: 'openrouter', kind: 'chat-image', baseUrl: 'https://openrouter.ai/api/v1', apiKey: env.OPENROUTER_API_KEY, model: env.PRESS_FALLBACK_IMAGE_MODEL || 'google/gemini-2.5-flash-image' })
  }
  return { chat, image }
}

function parseJsonObject(text) {
  const trimmed = String(text || '').trim()
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start === -1 || end <= start) throw new Error(`Model answer held no JSON object: ${trimmed.slice(0, 160)}`)
  const value = JSON.parse(trimmed.slice(start, end + 1))
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Model answer was not a JSON object')
  return value
}

async function postJson(url, apiKey, body, timeoutMs, fetchImpl) {
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  })
  const text = await response.text()
  // Never echo request headers; a provider error body is safe and useful.
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 300)}`)
  return JSON.parse(text)
}

async function chatOnce(provider, { system, user, imageDataUrl }, fetchImpl) {
  const content = imageDataUrl
    ? [{ type: 'text', text: user }, { type: 'image_url', image_url: { url: imageDataUrl } }]
    : user
  const result = await postJson(`${provider.baseUrl}/chat/completions`, provider.apiKey, {
    model: provider.model,
    messages: [{ role: 'system', content: system }, { role: 'user', content }],
    response_format: { type: 'json_object' },
  }, CHAT_TIMEOUT_MS, fetchImpl)
  return parseJsonObject(result.choices?.[0]?.message?.content)
}

async function imageOnce(provider, { prompt, size }, fetchImpl) {
  if (provider.kind === 'openai-images') {
    const result = await postJson(`${provider.baseUrl}/images/generations`, provider.apiKey, {
      model: provider.model, prompt, size, quality: provider.quality, n: 1,
    }, IMAGE_TIMEOUT_MS, fetchImpl)
    const b64 = result.data?.[0]?.b64_json
    if (!b64) throw new Error('Image answer held no b64_json')
    return Buffer.from(b64, 'base64')
  }
  const result = await postJson(`${provider.baseUrl}/chat/completions`, provider.apiKey, {
    model: provider.model,
    messages: [{ role: 'user', content: prompt }],
    modalities: ['image', 'text'],
    image_config: { aspect_ratio: '3:2' },
  }, IMAGE_TIMEOUT_MS, fetchImpl)
  const url = result.choices?.[0]?.message?.images?.[0]?.image_url?.url
  const match = /^data:image\/[a-z+.-]+;base64,(.+)$/s.exec(url || '')
  if (!match) throw new Error('Image answer held no base64 image')
  return Buffer.from(match[1], 'base64')
}

// One retry on the first provider, then each later provider once.
async function withFallback(providers, step, calls, run) {
  if (!providers.length) throw new Error(`No model provider configured for ${step}: set OPENAI_API_KEY and/or OPENROUTER_API_KEY`)
  const attempts = [providers[0], providers[0], ...providers.slice(1)]
  const errors = []
  for (const provider of attempts) {
    const started = Date.now()
    try {
      const value = await run(provider)
      calls.push({ step, provider: provider.name, model: provider.model, ms: Date.now() - started, ok: true })
      return value
    } catch (error) {
      calls.push({ step, provider: provider.name, model: provider.model, ms: Date.now() - started, ok: false, error: error.message.slice(0, 200) })
      errors.push(`${provider.name}/${provider.model}: ${error.message.slice(0, 200)}`)
    }
  }
  throw new Error(`${step} failed on every provider. ${errors.join(' | ')}`)
}

export function createModels({ env = process.env, fetchImpl = fetch } = {}) {
  const calls = []
  const replayDir = env.PRESS_REPLAY_DIR || ''
  const recordDir = env.PRESS_RECORD_DIR || ''
  const providers = replayDir ? { chat: [], image: [] } : providersFromEnv(env)
  const record = async (name, body) => {
    if (!recordDir) return
    await fs.mkdir(recordDir, { recursive: true })
    await fs.writeFile(path.join(recordDir, name), body)
  }

  return {
    calls,
    replay: Boolean(replayDir),
    // `accept` turns a raw answer into the value the step needs and throws on an
    // unusable one, so a malformed answer is retried like any other failure.
    async chatJson({ step, system, user, imageDataUrl = null, accept = (value) => value }) {
      if (replayDir) {
        calls.push({ step, provider: 'replay', model: 'recorded', ms: 0, ok: true })
        return accept(JSON.parse(await fs.readFile(path.join(replayDir, `${step}.json`), 'utf8')))
      }
      let raw
      const value = await withFallback(providers.chat, step, calls, async (provider) => {
        raw = await chatOnce(provider, { system, user, imageDataUrl }, fetchImpl)
        return accept(raw)
      })
      await record(`${step}.json`, `${JSON.stringify(raw, null, 2)}\n`)
      return value
    },
    async generateImage({ step = 'plate', prompt, size = '1536x1024', accept = (value) => value }) {
      if (replayDir) {
        calls.push({ step, provider: 'replay', model: 'recorded', ms: 0, ok: true })
        return accept(await fs.readFile(path.join(replayDir, `${step}.png`)))
      }
      await record(`${step}-prompt.txt`, prompt)
      let raw
      const value = await withFallback(providers.image, step, calls, async (provider) => {
        raw = await imageOnce(provider, { prompt, size }, fetchImpl)
        return accept(raw)
      })
      await record(`${step}.png`, raw)
      return value
    },
  }
}
