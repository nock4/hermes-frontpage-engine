// Model access through Hermes on the Mac, on Nick's subscriptions: no API keys.
//   hermesChat   one question to the Hermes CLI in its most bounded mode: no
//                rules, memory or skills, and either no useful tool (text) or
//                the vision tool alone (a question about one image)
//   hermesImage  one plate from the Hermes image provider, through the same
//                helper the old press uses (scripts/lib/hermes_image_generate.py)
// Both use whatever models the Hermes profile is configured with, so routing
// stays in Hermes' config and not in this repository.

import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const IMAGE_HELPER = fileURLToPath(new URL('../../scripts/lib/hermes_image_generate.py', import.meta.url))
const CHAT_TIMEOUT_MS = 300_000
const IMAGE_TIMEOUT_MS = 420_000

export function hermesSettings(env = process.env) {
  const home = env.PRESS_HERMES_HOME || path.join(os.homedir(), '.hermes')
  const agentDir = env.HERMES_AGENT_DIR || path.join(os.homedir(), 'Projects/hermes/hermes-agent')
  const profile = env.PRESS_HERMES_PROFILE || 'frontpage'
  return {
    bin: env.PRESS_HERMES_BIN || path.join(os.homedir(), '.local/bin/hermes'),
    profile,
    profileHome: path.join(home, 'profiles', profile),
    agentDir,
    python: env.PRESS_HERMES_PYTHON || path.join(agentDir, 'venv/bin/python'),
  }
}

function run(command, args, { input = '', env = process.env, cwd, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs)
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.on('error', (error) => { clearTimeout(timer); reject(new Error(`${path.basename(command)} could not start: ${error.message}`)) })
    child.on('close', (code, signal) => {
      clearTimeout(timer)
      if (code === 0) return resolve(stdout)
      const tail = (stderr || stdout).trim().split('\n').slice(-3).join(' ').slice(0, 300)
      reject(new Error(`${path.basename(command)} ${signal ? `killed (${signal}, ${timeoutMs / 1000}s limit)` : `exited ${code}`}: ${tail}`))
    })
    child.stdin.on('error', () => {})
    child.stdin.end(input)
  })
}

async function inTempDir(work) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'press-hermes-'))
  try { return await work(dir) } finally { await fs.rm(dir, { recursive: true, force: true }) }
}

function chatQuery({ system, user, imagePath }) {
  const task = ['INSTRUCTIONS:', system, '', 'REQUEST:', user].join('\n')
  if (!imagePath) return `Reply with exactly one JSON object and nothing else. No markdown, no tool calls.\n\n${task}`
  return [
    'You are one step of an automated press. Do exactly this and nothing else:',
    `1. Call vision_analyze once on the image at ${imagePath}. Pass it the full INSTRUCTIONS and REQUEST below as the question, so the model that sees the image answers them.`,
    '2. Reply with the single JSON object that answers the REQUEST. No markdown, no prose.',
    '',
    task,
  ].join('\n')
}

// Returns the model's raw text answer.
export async function hermesChat({ system, user, imageDataUrl = null }, settings, runImpl = run) {
  return inTempDir(async (dir) => {
    let imagePath = null
    if (imageDataUrl) {
      const match = /^data:image\/(png|jpeg);base64,(.+)$/s.exec(imageDataUrl)
      if (!match) throw new Error('hermesChat takes a base64 PNG or JPEG data URL')
      imagePath = path.join(dir, `input.${match[1] === 'png' ? 'png' : 'jpg'}`)
      await fs.writeFile(imagePath, Buffer.from(match[2], 'base64'))
    }
    const args = [
      '-p', settings.profile, 'chat', '-Q', '--oneshot', '--ignore-rules', '--source', 'tool',
      // Hermes needs a toolset name; "todo" is the inert one for a text-only question.
      '-t', imagePath ? 'vision' : 'todo', '--max-turns', imagePath ? '3' : '1', '--query-file', '-',
    ]
    // Run from the empty temp dir so no project rules or files are in reach.
    const stdout = await runImpl(settings.bin, args, { input: chatQuery({ system, user, imagePath }), cwd: dir, timeoutMs: CHAT_TIMEOUT_MS })
    return stdout.split('\n').filter((line) => !line.startsWith('session_id:')).join('\n').trim()
  })
}

// Returns the image bytes and what the provider reported about itself.
export async function hermesImage({ prompt }, settings, runImpl = run) {
  return inTempDir(async (dir) => {
    const promptFile = path.join(dir, 'prompt.txt')
    const output = path.join(dir, 'plate.png')
    await fs.writeFile(promptFile, prompt)
    const stdout = await runImpl(settings.python, [IMAGE_HELPER, '--prompt-file', promptFile, '--output', output, '--aspect-ratio', 'landscape'], {
      cwd: dir,
      env: { ...process.env, HERMES_HOME: settings.profileHome, HERMES_AGENT_DIR: settings.agentDir },
      timeoutMs: IMAGE_TIMEOUT_MS,
    })
    let reported = {}
    try { reported = JSON.parse(stdout.trim().split('\n').pop()) } catch { /* the image is what matters */ }
    return { bytes: await fs.readFile(output), model: [reported.provider, reported.model].filter(Boolean).join('/') || null }
  })
}
