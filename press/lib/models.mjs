// Model access for the press: Hermes on this Mac, on Nick's subscriptions.
// No API keys and no second provider (see hermes.mjs for how each call is made).
//   chatJson       one JSON answer, optionally about one image
//   generateImage  one landscape plate
// Each call is tried twice. If it still fails the build stops and the next
// scheduled run tries again; an edition is built a day ahead, so it has a day
// of retries before it is late.
// PRESS_REPLAY_DIR swaps every call for a recorded answer (tests, offline
// runs); PRESS_RECORD_DIR saves live answers in the same layout.

import fs from 'node:fs/promises'
import path from 'node:path'

import { hermesChat, hermesImage, hermesSettings } from './hermes.mjs'

function parseJsonObject(text) {
  const trimmed = String(text || '').trim()
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start === -1 || end <= start) throw new Error(`Model answer held no JSON object: ${trimmed.slice(0, 160)}`)
  const value = JSON.parse(trimmed.slice(start, end + 1))
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Model answer was not a JSON object')
  return value
}

export function createModels({ env = process.env, hermes = { chat: hermesChat, image: hermesImage } } = {}) {
  const calls = []
  const replayDir = env.PRESS_REPLAY_DIR || ''
  const recordDir = env.PRESS_RECORD_DIR || ''
  const settings = hermesSettings(env)
  const record = async (name, body) => {
    if (!recordDir) return
    await fs.mkdir(recordDir, { recursive: true })
    await fs.writeFile(path.join(recordDir, name), body)
  }
  const replayed = (step) => calls.push({ step, provider: 'replay', model: 'recorded', ms: 0, ok: true })

  // `run` returns { value, model }. A thrown error, including an answer the
  // step cannot use, costs one of the two tries.
  async function twice(step, run) {
    const errors = []
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const started = Date.now()
      try {
        const { value, model } = await run()
        calls.push({ step, provider: 'hermes', model, ms: Date.now() - started, ok: true })
        return value
      } catch (error) {
        const reason = String(error.message).slice(0, 200)
        calls.push({ step, provider: 'hermes', model: `profile:${settings.profile}`, ms: Date.now() - started, ok: false, error: reason })
        errors.push(reason)
      }
    }
    throw new Error(`${step} failed twice through Hermes. ${errors.join(' | ')}`)
  }

  return {
    calls,
    replay: Boolean(replayDir),
    // `accept` turns a raw answer into the value the step needs and throws on an unusable one.
    async chatJson({ step, system, user, imageDataUrl = null, accept = (value) => value }) {
      if (replayDir) {
        replayed(step)
        return accept(JSON.parse(await fs.readFile(path.join(replayDir, `${step}.json`), 'utf8')))
      }
      let raw
      const value = await twice(step, async () => {
        raw = parseJsonObject(await hermes.chat({ system, user, imageDataUrl }, settings))
        return { value: await accept(raw), model: `profile:${settings.profile}` }
      })
      await record(`${step}.json`, `${JSON.stringify(raw, null, 2)}\n`)
      return value
    },
    async generateImage({ step = 'plate', prompt, accept = (value) => value }) {
      if (replayDir) {
        replayed(step)
        return accept(await fs.readFile(path.join(replayDir, `${step}.png`)))
      }
      await record(`${step}-prompt.txt`, prompt)
      let raw
      const value = await twice(step, async () => {
        const image = await hermes.image({ prompt }, settings)
        raw = image.bytes
        return { value: await accept(raw), model: image.model || `profile:${settings.profile}` }
      })
      await record(`${step}.png`, raw)
      return value
    },
  }
}
