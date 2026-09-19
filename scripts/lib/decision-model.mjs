import { spawn } from 'node:child_process'

const JEV_DECISION_SCHEMA_VERSION = 1

export function shouldUseJevDecisionModel(env = process.env) {
  return String(env.DFE_DECISION_MODEL || '').trim().toLowerCase() === 'jev'
}

export function buildJevDecisionPayload({ question, choices, state }) {
  return {
    primitive: 'Choice',
    question,
    choices,
    state,
  }
}

export function normalizeJevDecision(raw) {
  const decision = raw?.choice || raw?.decision || raw?.answer || 'needs_review'
  const confidence = Number.isFinite(Number(raw?.probability))
    ? Number(raw.probability)
    : Number.isFinite(Number(raw?.confidence))
      ? Number(raw.confidence)
      : null
  return {
    schema_version: JEV_DECISION_SCHEMA_VERSION,
    model: 'jev',
    decision,
    reason_code: raw?.reason_code || raw?.reasonCode || 'jev_decision',
    confidence,
    evidence: Array.isArray(raw?.evidence) ? raw.evidence : [],
    raw,
  }
}

function jevEndpoint(env = process.env) {
  return String(env.JEV_API_URL || env.TYPESAFE_AI_JEV_API_URL || '').trim()
}

function readOpSecret(ref) {
  return new Promise((resolve, reject) => {
    const child = spawn('op', ['read', ref], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString()
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`Unable to read Jev API key from 1Password reference: ${(stderr || `op exited ${code}`).trim()}`))
        return
      }
      resolve(stdout.trim())
    })
  })
}

export async function resolveJevApiKey({ env = process.env, opRead = readOpSecret } = {}) {
  const direct = String(env.JEV_API_KEY || env.TYPESAFE_AI_API_KEY || '').trim()
  if (direct) return direct
  const opRef = String(env.JEV_API_KEY_OP_REF || env.TYPESAFE_AI_API_KEY_OP_REF || '').trim()
  if (!opRef) return ''
  return opRead(opRef)
}

export async function callJevDecision(payload, { env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const endpoint = jevEndpoint(env)
  if (!endpoint) return null
  if (!fetchImpl) throw new Error('Jev decision model requires fetch.')

  const apiKey = await resolveJevApiKey({ env })
  const response = await fetchImpl(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify(payload),
  })
  if (!response.ok) {
    throw new Error(`Jev decision request failed: HTTP ${response.status}`)
  }
  return normalizeJevDecision(await response.json())
}
