import fs from 'node:fs/promises'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

function parseArgs(argv) {
  const parsed = {}
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (!token.startsWith('--')) continue
    const key = token.slice(2)
    const next = argv[index + 1]
    if (!next || next.startsWith('--')) {
      parsed[key] = true
      continue
    }
    parsed[key] = next
    index += 1
  }
  return parsed
}

const args = parseArgs(process.argv.slice(2))
const outDir = path.resolve(String(args['out-dir'] || 'artifacts/demo-video'))
const rawDir = path.join(outDir, 'raw')
const cardsDir = path.join(outDir, 'cards')
const segmentsDir = path.join(outDir, 'segments')
const finalDir = path.join(outDir, 'final')
const textDir = path.join(outDir, 'text')
const finalPath = path.join(finalDir, String(args.output || 'hermes-frontpage-demo.mp4'))
const manifestPath = path.join(outDir, 'capture-manifest.json')
const fontPath = '/System/Library/Fonts/Supplemental/Arial.ttf'
const resolution = { width: 1920, height: 1080 }
const fps = 30

function run(command, commandArgs) {
  console.log(`$ ${command} ${commandArgs.join(' ')}`)
  execFileSync(command, commandArgs, { stdio: 'inherit' })
}

async function ensureDirectory(dirPath) {
  await fs.mkdir(dirPath, { recursive: true })
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

function readJson(filePath) {
  return JSON.parse(execFileSync('python3', ['-c', `import json,sys; print(json.dumps(json.load(open(${JSON.stringify(filePath)}, 'r')), separators=(',', ':')))`], { encoding: 'utf8' }))
}

function safeGit(commandArgs, fallback = 'unknown') {
  try {
    return execFileSync('git', commandArgs, { encoding: 'utf8' }).trim() || fallback
  } catch {
    return fallback
  }
}

async function makeCard({ name, title, subtitle = '', footer = '', duration = 3.5 }) {
  const imagePath = path.join(cardsDir, `${name}.png`)
  const outputPath = path.join(cardsDir, `${name}.mp4`)

  run('python3', ['-c', `
from PIL import Image, ImageDraw, ImageFont
canvas = Image.new('RGB', (${resolution.width}, ${resolution.height}), '#090909')
draw = ImageDraw.Draw(canvas)
font_title = ImageFont.truetype(${JSON.stringify(fontPath)}, 64)
font_sub = ImageFont.truetype(${JSON.stringify(fontPath)}, 34)
font_footer = ImageFont.truetype(${JSON.stringify(fontPath)}, 24)
blocks = [
    (${JSON.stringify(title)}, font_title, (255,255,255), int(${resolution.height} * 0.30)),
    (${JSON.stringify(subtitle)}, font_sub, (215,215,215), int(${resolution.height} * 0.52)),
    (${JSON.stringify(footer)}, font_footer, (154,160,166), int(${resolution.height} * 0.79)),
]
for text, font, color, center_y in blocks:
    if not text:
        continue
    bbox = draw.multiline_textbbox((0,0), text, font=font, align='center', spacing=12)
    width = bbox[2] - bbox[0]
    height = bbox[3] - bbox[1]
    x = (${resolution.width} - width) / 2
    y = center_y - height / 2
    draw.multiline_text((x, y), text, font=font, fill=color, align='center', spacing=12)
canvas.save(${JSON.stringify(imagePath)})
`])

  run('ffmpeg', [
    '-y',
    '-loop', '1',
    '-i', imagePath,
    '-t', String(duration),
    '-r', String(fps),
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    outputPath,
  ])

  return outputPath
}

async function transcodeClip(inputPath, outputPath) {
  run('ffmpeg', [
    '-y',
    '-i', inputPath,
    '-vf', `scale=${resolution.width}:${resolution.height}:force_original_aspect_ratio=decrease,pad=${resolution.width}:${resolution.height}:(ow-iw)/2:(oh-ih)/2:black`,
    '-r', String(fps),
    '-an',
    '-c:v', 'libx264',
    '-preset', 'medium',
    '-crf', '18',
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    outputPath,
  ])
}

async function main() {
  const hasManifest = await fileExists(manifestPath)
  if (!hasManifest) throw new Error(`Missing capture manifest: ${manifestPath}`)

  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'))
  const editionManifest = readJson(path.resolve('public/editions/index.json'))
  const currentEditionId = editionManifest.current_edition_id || 'unknown'
  const commit = safeGit(['rev-parse', '--short', 'HEAD'])

  await Promise.all([ensureDirectory(cardsDir), ensureDirectory(segmentsDir), ensureDirectory(finalDir), ensureDirectory(textDir)])

  const titleCard = await makeCard({
    name: '00-title',
    title: 'Hermes Frontpage Engine',
    subtitle: 'A daily interactive front page generated from saved links and research trails.',
    footer: 'The image is the interface.',
    duration: 3.2,
  })

  const proofCard = await makeCard({
    name: '06-proof',
    title: 'Hermes handles intake, research, packaging, and QA.',
    subtitle: `Current edition: ${currentEditionId}`,
    footer: `Live demo: ${manifest.url}`,
    duration: 3.2,
  })

  const qaCard = await makeCard({
    name: '07-qa',
    title: 'Submission proof',
    subtitle: 'qa:publish passed locally and the live demo is online.',
    footer: `Repo commit: ${commit}`,
    duration: 3.0,
  })

  const endCard = await makeCard({
    name: '09-end',
    title: 'daily.nockgarden.com',
    subtitle: 'github.com/nock4/hermes-frontpage-engine',
    footer: 'Hermes creative hackathon demo draft',
    duration: 3.5,
  })

  const shotSegments = []
  for (const shot of manifest.shots) {
    const inputPath = shot.clip_path
    const outputPath = path.join(segmentsDir, `${shot.id}.mp4`)
    await transcodeClip(inputPath, outputPath)
    shotSegments.push({ ...shot, segment_path: outputPath })
  }

  const sequence = [
    titleCard,
    shotSegments.find((shot) => shot.id === '01-live-hero')?.segment_path,
    shotSegments.find((shot) => shot.id === '02-source-window-a')?.segment_path,
    shotSegments.find((shot) => shot.id === '03-source-window-b')?.segment_path,
    shotSegments.find((shot) => shot.id === '04-about-panel')?.segment_path,
    shotSegments.find((shot) => shot.id === '05-archive-panel')?.segment_path,
    proofCard,
    qaCard,
    shotSegments.find((shot) => shot.id === '01-live-hero')?.segment_path,
    endCard,
  ].filter(Boolean)

  const concatPath = path.join(outDir, 'concat.txt')
  await fs.writeFile(concatPath, `${sequence.map((filePath) => `file '${filePath.replace(/'/g, `'\\''`)}'`).join('\n')}\n`, 'utf8')

  run('ffmpeg', [
    '-y',
    '-f', 'concat',
    '-safe', '0',
    '-i', concatPath,
    '-c', 'copy',
    finalPath,
  ])

  console.log(`final demo video -> ${finalPath}`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
