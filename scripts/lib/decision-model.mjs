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

function jevApiKey(env = process.env) {
  return String(env.JEV_API_KEY || env.TYPESAFE_AI_API_KEY || '').trim()
}

export async function callJevDecision(payload, { env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const endpoint = jevEndpoint(env)
  if (!endpoint) return null
  if (!fetchImpl) throw new Error('Jev decision model requires fetch.')

  const apiKey = jevApiKey(env)
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
