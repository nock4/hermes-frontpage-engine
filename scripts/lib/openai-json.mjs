function firstJsonObject(text) {
  const trimmed = text.trim()
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) return JSON.parse(trimmed)
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) {
    throw new Error(`OpenAI response did not contain a JSON object: ${trimmed.slice(0, 200)}`)
  }
  return JSON.parse(trimmed.slice(start, end + 1))
}

function extractOutputText(response) {
  if (typeof response.output_text === 'string') return response.output_text
  const chunks = []
  for (const item of response.output || []) {
    for (const content of item.content || []) {
      if (content.type === 'output_text' && typeof content.text === 'string') chunks.push(content.text)
      if (content.type === 'text' && typeof content.text === 'string') chunks.push(content.text)
    }
  }
  return chunks.join('\n')
}

function ensureJsonModeInput(input) {
  if (typeof input === 'string') return `Return JSON.\n${input}`
  if (!Array.isArray(input)) return input
  return input.map((message, index) => {
    if (index !== 0 || !Array.isArray(message?.content)) return message
    return {
      ...message,
      content: [
        { type: 'input_text', text: 'Return JSON.' },
        ...message.content,
      ],
    }
  })
}

export async function openAiJson({ apiKey, model, instructions, input, maxOutputTokens = 5000 }) {
  const jsonInput = ensureJsonModeInput(input)
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      instructions,
      input: jsonInput,
      text: { format: { type: 'json_object' } },
      max_output_tokens: maxOutputTokens,
    }),
  })

  const body = await response.json().catch(async () => ({ raw: await response.text() }))
  if (!response.ok) {
    throw new Error(`OpenAI Responses API failed (${response.status}): ${JSON.stringify(body).slice(0, 1000)}`)
  }
  return firstJsonObject(extractOutputText(body))
}
