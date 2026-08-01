import fsSync from 'node:fs'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'

import { isYouTubeVideoUrl, youtubeId } from './source-url-policy.mjs'
import { getResearchContentSources } from './source-research.mjs'
import { getSourceDisplayTitle } from './source-display.mjs'

const defaultSliceDuration = Number(process.env.DFE_AUDIO_MATERIAL_DURATION || 60)
const maxAudioSources = Number(process.env.DFE_AUDIO_MATERIAL_MAX_SOURCES || 2)

function commandExists(command) {
  if (!command) return false
  if (command.includes(path.sep)) return fsSync.existsSync(command)
  const paths = String(process.env.PATH || '').split(path.delimiter)
  return paths.some((dir) => fsSync.existsSync(path.join(dir, command)))
}

function commandPath(name, candidates = []) {
  for (const candidate of [process.env[`DFE_${name.toUpperCase()}_BIN`], ...candidates, name].filter(Boolean)) {
    if (commandExists(candidate)) return candidate
  }
  return null
}

function runCommand(command, args, { cwd, timeoutMs = 180000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      reject(new Error(`${command} timed out after ${timeoutMs}ms`))
    }, timeoutMs)
    child.stdout.on('data', (chunk) => { stdout += chunk.toString() })
    child.stderr.on('data', (chunk) => { stderr += chunk.toString() })
    child.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) resolve({ stdout, stderr })
      else reject(new Error(`${command} exited ${code}: ${(stderr || stdout).slice(0, 1600)}`))
    })
  })
}

function audioMaterialSourceCandidates(researchField) {
  const sources = getResearchContentSources(researchField)
    .filter((source) => isYouTubeVideoUrl(source.url || source.source_url || source.final_url))
  const visualReference = researchField?.visual_reference
  const visualUrl = visualReference?.url || visualReference?.source_url || visualReference?.final_url
  const visualSource = isYouTubeVideoUrl(visualUrl)
    ? [{ ...visualReference, url: visualUrl, source_type: 'youtube', source_channel: 'youtube-like' }]
    : []
  const seen = new Set()
  return [...visualSource, ...sources].filter((source) => {
    const id = youtubeId(source.url || source.source_url || source.final_url)
    if (!id || seen.has(id)) return false
    seen.add(id)
    return true
  }).slice(0, Math.max(1, maxAudioSources))
}

function secondsToTimestamp(seconds) {
  const whole = Math.max(1, Math.round(Number(seconds) || 60))
  const hh = Math.floor(whole / 3600)
  const mm = Math.floor((whole % 3600) / 60)
  const ss = whole % 60
  return [hh, mm, ss].map((part) => String(part).padStart(2, '0')).join(':')
}

function briefFromFeatures(features) {
  const translation = features.visual_translation || {}
  return [
    `tempo ${features.tempo_bpm || 'unknown'} bpm / ${translation.tempo_posture || 'unknown tempo posture'}`,
    `${translation.bass_pressure || 'bass pressure unknown'}; ${translation.brightness || 'brightness unknown'}`,
    `${translation.pulse || 'pulse unknown'}; ${translation.repetition || 'repetition unknown'}`,
    `top pitch colors: ${(features.pitch_color?.top_chroma || []).join(', ') || 'unknown'}`,
    `source-window marks: ${(translation.source_window_marks || []).join('; ')}`,
  ].join('. ')
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

export async function prepareSourceAudioMaterial(researchField, { runDir, root = process.cwd() } = {}) {
  const outputDir = path.join(runDir, 'source-audio-material')
  await fs.mkdir(outputDir, { recursive: true })

  if (process.env.DFE_AUDIO_MATERIAL === '0') {
    const skipped = { schema_version: 1, enabled: false, reason: 'DFE_AUDIO_MATERIAL=0', sources: [] }
    await writeJson(path.join(runDir, 'source-audio-material.json'), skipped)
    return skipped
  }

  const ytDlp = commandPath('yt-dlp', [
    path.join(os.homedir(), 'Projects/hermes/hermes-agent/venv/bin/yt-dlp'),
  ])
  const ffmpeg = commandPath('ffmpeg', ['/opt/homebrew/bin/ffmpeg'])
  const python = commandPath('python3', [
    path.join(os.homedir(), 'Projects/hermes/hermes-agent/venv/bin/python3'),
    path.join(os.homedir(), 'Projects/hermes/hermes-agent/venv/bin/python'),
  ])
  const songsee = commandPath('songsee', [path.join(os.homedir(), 'go/bin/songsee')])

  const toolchain = { yt_dlp: ytDlp, ffmpeg, python3: python, songsee }
  const candidates = audioMaterialSourceCandidates(researchField)
  const result = {
    schema_version: 1,
    enabled: true,
    generated_at: new Date().toISOString(),
    toolchain,
    slice_duration_seconds: defaultSliceDuration,
    source_count: candidates.length,
    sources: [],
  }

  if (!candidates.length) {
    result.status = 'skipped'
    result.reason = 'No YouTube video sources in selected research field.'
    await writeJson(path.join(runDir, 'source-audio-material.json'), result)
    return result
  }
  if (!ytDlp || !ffmpeg || !python) {
    result.status = 'skipped'
    result.reason = 'Missing required yt-dlp, ffmpeg, or python3 audio-analysis toolchain.'
    await writeJson(path.join(runDir, 'source-audio-material.json'), result)
    return result
  }

  for (const [index, source] of candidates.entries()) {
    const sourceUrl = source.url || source.source_url || source.final_url
    const id = youtubeId(sourceUrl)
    const sourceDir = path.join(outputDir, `${index + 1}-${id}`)
    await fs.mkdir(sourceDir, { recursive: true })
    const downloaded = path.join(sourceDir, 'source.%(ext)s')
    const mp3Path = path.join(sourceDir, 'source.mp3')
    const wavPath = path.join(sourceDir, 'slice.wav')
    const featuresPath = path.join(sourceDir, 'audio-features.json')
    const contactPath = path.join(sourceDir, 'audio-contact.png')

    const record = {
      source_url: sourceUrl,
      title: getSourceDisplayTitle(source, source.title || sourceUrl),
      youtube_id: id,
      source_type: source.source_type || 'youtube',
      status: 'pending',
      paths: {
        audio_features: path.relative(root, featuresPath),
        audio_contact_sheet: songsee ? path.relative(root, contactPath) : null,
        audio_slice: path.relative(root, wavPath),
      },
    }

    try {
      await runCommand(ytDlp, [
        '--no-warnings',
        '-f', 'bestaudio',
        '--extract-audio',
        '--audio-format', 'mp3',
        '--download-sections', `*00:00:00-${secondsToTimestamp(defaultSliceDuration)}`,
        '-o', downloaded,
        sourceUrl,
      ], { timeoutMs: 240000 })
      await runCommand(ffmpeg, ['-y', '-i', mp3Path, '-ss', '0', '-t', String(defaultSliceDuration), '-ac', '1', '-ar', '22050', wavPath], { timeoutMs: 90000 })
      await runCommand(python, [path.join(root, 'scripts/analyze-youtube-audio.py'), wavPath, '--source-url', sourceUrl, '--output', featuresPath], { timeoutMs: 120000 })
      const features = JSON.parse(await fs.readFile(featuresPath, 'utf8'))
      if (songsee) {
        await runCommand(songsee, [wavPath, '--viz', 'spectrogram,mel,chroma,loudness,flux,selfsim', '--style', 'magma', '--width', '1600', '--height', '1000', '--format', 'png', '-o', contactPath], { timeoutMs: 120000 })
      }
      record.status = 'ok'
      record.features = features
      record.audio_visual_brief = briefFromFeatures(features)
    } catch (error) {
      record.status = 'failed'
      record.error = error.message
    }
    result.sources.push(record)
  }

  const okSources = result.sources.filter((source) => source.status === 'ok')
  result.status = okSources.length ? 'ok' : 'failed'
  result.audio_visual_briefs = okSources.map((source) => ({
    source_url: source.source_url,
    title: source.title,
    brief: source.audio_visual_brief,
    features_path: source.paths.audio_features,
    contact_sheet_path: source.paths.audio_contact_sheet,
  }))
  result.prompt_guidance = okSources.length
    ? [
      'Treat source_audio_material as structure, not UI: translate bass pressure, spectral bands, onset clusters, self-similarity, silence, and pitch color into physical plate marks.',
      'Pair the anchor still/thumbnail as surface stock with audio-derived seams, ridges, punctures, folds, and density.',
      'Avoid waveform/equalizer/visualizer clichés unless the source itself explicitly calls for them.',
    ]
    : []

  await writeJson(path.join(runDir, 'source-audio-material.json'), result)
  return result
}
