import fsSync from 'node:fs'
import os from 'node:os'
import path from 'node:path'

function envFilePaths(root) {
  return [
    path.join(root, '.env'),
    path.join(os.homedir(), '.env'),
    path.join(os.homedir(), '.hermes', '.env'),
  ]
}

export function defaultGenerationName() {
  return `daily-process-${new Date().toISOString().replace(/[:.]/g, '-')}`
}

export function loadDotEnv({ root, env = process.env } = {}) {
  const loaded = {}
  for (const filePath of envFilePaths(root || process.cwd())) {
    if (!fsSync.existsSync(filePath)) continue
    const text = fsSync.readFileSync(filePath, 'utf8')
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim()
      if (!line || line.startsWith('#') || !line.includes('=')) continue
      const [key, ...rest] = line.split('=')
      if (!key) continue
      const value = rest.join('=').trim().replace(/^['"]|['"]$/g, '')
      if (!env[key]) {
        env[key] = value
        loaded[key] = true
      }
    }
  }
  return loaded
}

export function requireOpenAiKey({ root, env = process.env, required = true } = {}) {
  const loaded = loadDotEnv({ root, env })
  const key = env.OPENAI_API_KEY || null
  if (!key && required) {
    throw new Error([
      'OPENAI_API_KEY is only required when the image backend is set to direct OpenAI image generation.',
      'The command checked process.env plus .env, ~/.env, and ~/.hermes/.env.',
    ].join(' '))
  }
  return { key, loaded }
}
