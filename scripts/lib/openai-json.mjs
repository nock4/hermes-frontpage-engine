import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'

function firstJsonObject(text) {
  const trimmed = String(text || '').trim()
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) return JSON.parse(trimmed)
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) {
    throw new Error(`Hermes response did not contain a JSON object: ${trimmed.slice(0, 200)}`)
  }
  return JSON.parse(trimmed.slice(start, end + 1))
}

function extractJsonText(stdout) {
  const text = String(stdout || '').trim()
  if (!text) throw new Error('Hermes returned empty output.')
  const lines = text.split(/\r?\n/).filter(Boolean)
  const filtered = lines.filter((line) => !line.startsWith('session_id:'))
  return filtered.join('\n').trim()
}

function extractTextAndImage(input) {
  if (typeof input === 'string') return { text: input, imageUrl: null }
  if (!Array.isArray(input)) return { text: JSON.stringify(input, null, 2), imageUrl: null }
  const textParts = []
  let imageUrl = null
  for (const message of input) {
    for (const content of message?.content || []) {
      if (content?.type === 'input_text' && typeof content.text === 'string') textParts.push(content.text)
      if (!imageUrl && content?.type === 'input_image' && typeof content.image_url === 'string') imageUrl = content.image_url
    }
  }
  return { text: textParts.join('\n\n').trim(), imageUrl }
}

function extensionFromMime(mimeType, fallback = '.bin') {
  const normalized = String(mimeType || '').toLowerCase()
  if (normalized.includes('png')) return '.png'
  if (normalized.includes('jpeg') || normalized.includes('jpg')) return '.jpg'
  if (normalized.includes('webp')) return '.webp'
  if (normalized.includes('gif')) return '.gif'
  return fallback
}

function extensionFromUrl(imageUrl) {
  try {
    const pathname = new URL(imageUrl).pathname || ''
    const ext = path.extname(pathname)
    return ext || '.png'
  } catch {
    return '.png'
  }
}

async function materializeImage(imageUrl) {
  if (!imageUrl) return { imagePath: null, remoteImageUrl: null }
  if (imageUrl.startsWith('data:')) {
    const match = imageUrl.match(/^data:([^;,]+)?(;base64)?,(.*)$/s)
    if (!match) throw new Error('Unsupported data URL image input.')
    const mimeType = match[1] || 'image/png'
    const isBase64 = Boolean(match[2])
    const rawData = match[3] || ''
    const buffer = isBase64 ? Buffer.from(rawData, 'base64') : Buffer.from(decodeURIComponent(rawData), 'utf8')
    const filePath = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'dfe-hermes-image-')), `input${extensionFromMime(mimeType, '.png')}`)
    await fs.writeFile(filePath, buffer)
    return { imagePath: filePath, remoteImageUrl: null }
  }
  if (imageUrl.startsWith('file://')) return { imagePath: new URL(imageUrl).pathname, remoteImageUrl: null }
  if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
    try {
      const response = await fetch(imageUrl)
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const arrayBuffer = await response.arrayBuffer()
      const filePath = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'dfe-hermes-image-')), `input${extensionFromMime(response.headers.get('content-type'), extensionFromUrl(imageUrl))}`)
      await fs.writeFile(filePath, Buffer.from(arrayBuffer))
      return { imagePath: filePath, remoteImageUrl: null }
    } catch {
      return { imagePath: null, remoteImageUrl: imageUrl }
    }
  }
  return { imagePath: imageUrl, remoteImageUrl: null }
}

export function buildHermesQuery({ instructions, inputText, maxOutputTokens, imagePath, remoteImageUrl = null }) {
  return [
    'You are returning structured JSON for a local automated frontpage pipeline.',
    'Return exactly one JSON object and nothing else. No markdown. No prose before or after the JSON.',
    imagePath ? 'An image is attached to this query. Use it as part of your analysis.' : 'No image is attached to this query.',
    remoteImageUrl ? `If you need the source image directly, use this image URL: ${remoteImageUrl}` : '',
    `Requested output budget: ${maxOutputTokens} tokens maximum.`,
    '',
    'Task instructions:',
    String(instructions || '').trim(),
    '',
    'Request payload:',
    String(inputText || '').trim(),
  ].join('\n')
}

export function buildHermesCommandArgs({ query, imagePath, needsVision = false }) {
  const args = [
    'chat',
    '-Q',
    '--source', 'tool',
    '--max-turns', '12',
  ]
  if (needsVision) args.push('-t', 'vision')
  if (imagePath) args.push('--image', imagePath)
  args.push('-q', query)
  return args
}

async function runHermesJsonQuery({ query, imagePath, needsVision = false }) {
  const args = buildHermesCommandArgs({ query, imagePath, needsVision })
  return new Promise((resolve, reject) => {
    const child = spawn('hermes', args, {
      cwd: process.cwd(),
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
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
        reject(new Error((stderr || stdout || `hermes exited ${code}`).trim()))
        return
      }
      try {
        resolve(firstJsonObject(extractJsonText(stdout)))
      } catch (error) {
        reject(new Error(`Expected JSON from Hermes: ${error.message}\n${stdout}`))
      }
    })
  })
}

export async function openAiJson({ apiKey, model, instructions, input, maxOutputTokens = 5000 }) {
  const { text, imageUrl } = extractTextAndImage(input)
  const { imagePath, remoteImageUrl } = await materializeImage(imageUrl)
  const query = buildHermesQuery({
    instructions,
    inputText: text,
    maxOutputTokens,
    imagePath,
    remoteImageUrl,
  })
  return runHermesJsonQuery({ query, imagePath, needsVision: Boolean(imagePath || remoteImageUrl), requestedModel: model, apiKeyPresent: Boolean(apiKey) })
}
