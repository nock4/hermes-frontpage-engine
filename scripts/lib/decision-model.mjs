import { spawn } from 'node:child_process'

const JEV_DECISION_SCHEMA_VERSION = 1

export function shouldUseJevDecisionModel(env = process.env) {
  return String(env.DFE_DECISION_MODEL || '').trim().toLowerCase() === 'jev'
}

export function buildJevDecisionPayload({ question, choices, state }) {
  return {
    model: 'jev-latest',
    state,
    questions: {
      press_decision: {
        type: 'choice',
        instructions: question,
        criteria: Object.fromEntries(choices.map((choice) => [choice, null])),
      },
    },
  }
}

export function normalizeJevDecision(raw) {
  const answer = raw?.answers?.press_decision || raw
  const decision = answer?.choice || answer?.decision || answer?.answer || 'needs_review'
  const confidence = Number.isFinite(Number(answer?.confidence))
    ? Number(answer.confidence)
    : Number.isFinite(Number(answer?.probability))
      ? Number(answer.probability)
      : null
  const probabilities = answer?.probabilities || null
  return {
    schema_version: JEV_DECISION_SCHEMA_VERSION,
    model: 'jev',
    decision,
    reason_code: answer?.reason_code || answer?.reasonCode || `jev_choice_${decision}`,
    confidence,
    evidence: Array.isArray(answer?.evidence)
      ? answer.evidence
      : probabilities
        ? [`Jev choice probability: ${JSON.stringify(probabilities)}`]
        : [],
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
