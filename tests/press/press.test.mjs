import { execFileSync } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import sharp from 'sharp'
import { describe, expect, it } from 'vitest'

import { INDEX_KEY, PARKED_KEY, mergeParked } from '../../shared/edition-index.js'
import { currentBranch, publish } from '../../press/lib/git.mjs'
import { hermesChat, hermesImage, hermesSettings } from '../../press/lib/hermes.mjs'
import { createModels } from '../../press/lib/models.mjs'
import { CANDIDATES_KEY, LEDGER_KEY, loadSource, markSkipped, normalizeLedger, orderCandidates, sourceKey } from '../../press/lib/pick.mjs'
import { imagePrompt } from '../../press/lib/prompts.mjs'
import { build, builtMessage, chooseDate, failedMessage, flip, shouldTellFailure } from '../../press/lib/run.mjs'
import { acceptBrief, acceptMap, acceptPlate } from '../../press/lib/steps.mjs'
import { LocalStore, RepoStore } from '../../press/lib/store.mjs'
import { tell } from '../../press/lib/telegram.mjs'
import { addDays, goLiveAt, localDate } from '../../press/lib/time.mjs'

const fixtureDir = fileURLToPath(new URL('../../press/fixtures/2026-11-10-alliharvard/', import.meta.url))
const readFixture = async (name) => JSON.parse(await fs.readFile(path.join(fixtureDir, name), 'utf8'))

const picture = (width, height, color) => sharp({ create: { width, height, channels: 3, background: color } })

async function workspace() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'press-test-'))
  const replay = path.join(root, 'replay')
  await fs.mkdir(replay)
  await fs.copyFile(path.join(fixtureDir, 'brief.json'), path.join(replay, 'brief.json'))
  await fs.copyFile(path.join(fixtureDir, 'map.json'), path.join(replay, 'map.json'))
  await fs.writeFile(path.join(replay, 'plate.png'), await picture(1536, 1024, '#e8623a').png().toBuffer())
  const store = new LocalStore(path.join(root, 'bucket'))
  await store.putJson(CANDIDATES_KEY, await readFixture('candidates.json'))
  return { root, replay, store, models: () => createModels({ env: { PRESS_REPLAY_DIR: replay } }) }
}

// The real source image lives on a third-party host; tests use a stand-in.
const fakeSource = async (candidate) => loadSource(candidate, {
  fetchImage: async () => picture(380, 310, '#f26b3a').jpeg().toBuffer(),
})

const seedIndex = {
  current_edition_id: '2026-11-09-light-loses-count-v1',
  editions: [{
    edition_id: '2026-11-09-light-loses-count-v1', date: '2026-11-09', slug: 'light-loses-count-v1', title: 'Light Loses Count',
    path: '/editions/2026-11-09-light-loses-count-v1', scene_family: 'raster-bloom-scale-break', motif_tags: ['counted-light'],
    preview_asset_path: '/editions/2026-11-09-light-loses-count-v1/assets/preview.png', is_live: true,
  }],
}

describe('press time', () => {
  it('resolves 4:00 Detroit time across the daylight-saving change', () => {
    expect(goLiveAt('2026-11-11')).toBe('2026-11-11T09:00:00.000Z')
    expect(goLiveAt('2026-07-04')).toBe('2026-07-04T08:00:00.000Z')
    expect(localDate(new Date('2026-11-11T03:30:00Z'))).toBe('2026-11-10')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
  })
})

describe('parked editions', () => {
  const entry = (id, date) => ({ edition_id: id, date, go_live_at: goLiveAt(date), manifest_item: { edition_id: id, date, is_live: false } })

  it('stay invisible until their go-live time, then become current', () => {
    const parked = { version: 1, entries: [entry('2026-11-11-b-v1', '2026-11-11'), entry('2026-11-10-a-v1', '2026-11-10')] }
    expect(mergeParked(seedIndex, parked, Date.parse('2026-11-10T08:59:00Z')).index).toBe(seedIndex)
    const first = mergeParked(seedIndex, parked, Date.parse('2026-11-10T09:00:00Z')).index
    expect(first.current_edition_id).toBe('2026-11-10-a-v1')
    expect(first.editions.filter((item) => item.is_live).map((item) => item.edition_id)).toEqual(['2026-11-10-a-v1'])
    const both = mergeParked(seedIndex, parked, Date.parse('2026-11-12T00:00:00Z')).index
    expect(both.editions.map((item) => item.edition_id)).toEqual(['2026-11-11-b-v1', '2026-11-10-a-v1', '2026-11-09-light-loses-count-v1'])
    expect(seedIndex.editions[0].is_live).toBe(true)
  })

  it('picks the earliest date without an edition', () => {
    const parked = { version: 1, entries: [entry('2026-11-10-a-v1', '2026-11-10')] }
    expect(chooseDate({ index: seedIndex, parked, today: '2026-11-10', lookaheadDays: 1 })).toBe('2026-11-11')
    expect(chooseDate({ index: seedIndex, parked: null, today: '2026-11-10', lookaheadDays: 1 })).toBe('2026-11-10')
    expect(chooseDate({ index: seedIndex, parked, today: '2026-11-09', lookaheadDays: 1 })).toBeNull()
  })
})

describe('source pick', () => {
  it('skips used and ruled-out sources and prefers saved images, newest first', () => {
    const candidates = [
      { url: 'https://x.com/a/status/1', media_urls: [], note_date: '2026-11-09' },
      { url: 'https://x.com/b/status/2', media_urls: ['https://pbs.twimg.com/media/b.jpg'], note_date: '2026-10-01' },
      { url: 'https://twitter.com/c/status/3?s=20', media_urls: ['https://pbs.twimg.com/media/c.jpg'], note_date: '2026-11-01' },
      { url: 'https://x.com/d/status/4', media_urls: ['https://pbs.twimg.com/media/d.jpg'], note_date: '2026-11-08' },
      { url: 'https://x.com/e/status/5', media_urls: ['https://pbs.twimg.com/media/e.jpg'], note_date: '2026-11-07' },
      { url: 'https://example.com/not-a-post' },
    ]
    const ledger = normalizeLedger({ used: { [sourceKey('https://x.com/d/status/4')]: { edition_id: 'x', date: '2026-11-08' } } })
    markSkipped(ledger, 'tweet:5', 'not an image', { permanent: true })
    expect(orderCandidates(candidates, ledger).map((candidate) => candidate.key)).toEqual(['tweet:3', 'tweet:2', 'tweet:1'])
  })

  it('rejects images that cannot seed a plate', async () => {
    const candidate = orderCandidates((await readFixture('candidates.json')).candidates, normalizeLedger())[0]
    await expect(loadSource(candidate, { fetchImage: async () => Buffer.from('not an image') })).rejects.toThrow('could not be decoded')
    await expect(loadSource(candidate, { fetchImage: async () => picture(90, 90, '#fff').png().toBuffer() })).rejects.toThrow('too small')
    await expect(loadSource({ ...candidate, media_urls: [] }, { lookupPhotos: async () => [] })).rejects.toThrow('no image')
    const source = await fakeSource(candidate)
    expect(source).toMatchObject({ key: 'tweet:2112561050310824352', title: '@alliharvard: try music you might like it' })
    expect(source.image.url).toBe('https://pbs.twimg.com/media/HVFSjIWaQAAH2Uw.jpg?name=orig')
  })
})

describe('model answers', () => {
  it('accepts the recorded brief and builds a text-only image prompt from it', async () => {
    const brief = acceptBrief(await readFixture('brief.json'))
    expect(brief.slug_base).toBe('one-stitch-out-of-line')
    const prompt = imagePrompt({ brief, source: { title: '@alliharvard: try music you might like it', image: { width: 380, height: 310 } } })
    expect(prompt).toContain('OUTPUT: landscape canvas')
    expect(prompt).toContain('Compose exactly 1 distinct source-native physical feature')
    expect(prompt).toContain('measured source is landscape (380x310)')
  })

  it('rejects unusable sources, thin briefs, bad maps and portrait plates', async () => {
    expect(() => acceptBrief({ usable: false, unusable_reason: 'screenshot of text' })).toThrow('screenshot of text')
    expect(() => acceptBrief({ usable: true, edition_title: 'x' })).toThrow('Brief is missing')
    expect(() => acceptMap({ detected_object: { bounds: { x: 0.1, y: 0.1, w: 0.01, h: 0.5 } } })).toThrow('too small')
    const boxed = acceptMap({ detected_object: { label: 'Mark', bounds: { x: 0.1, y: 0.1, w: 0.4, h: 0.4 }, polygon: [[0.9, 0.9], [0.95, 0.9], [0.95, 0.95]] }, plate_quality: { status: 'weak', note: 'legible text' } })
    expect(boxed.object.polygon).toHaveLength(4)
    expect(boxed.notes).toHaveLength(2)
    await expect(acceptPlate(await picture(1024, 1536, '#000').png().toBuffer())).rejects.toThrow('Landscape plate required')
    await expect(acceptPlate(Buffer.from('nope'))).rejects.toThrow('could not be decoded')
  })

  it('tries each Hermes call twice and then gives up, with no other provider', async () => {
    let chats = 0
    const hermes = {
      chat: async (request, settings) => { chats += 1; if (chats === 1) throw new Error('hermes exited 1'); return `{"profile": "${settings.profile}"}` },
      image: async () => { throw new Error('quota') },
    }
    const models = createModels({ env: {}, hermes })
    await expect(models.chatJson({ step: 'brief', system: 's', user: 'u' })).resolves.toEqual({ profile: 'frontpage' })
    expect(models.calls.map((call) => call.ok)).toEqual([false, true])
    await expect(models.generateImage({ prompt: 'p' })).rejects.toThrow('plate failed twice through Hermes')
    expect(models.calls).toHaveLength(4)
  })

  it('asks Hermes one bounded question and returns its plate', async () => {
    const runs = []
    const settings = hermesSettings({ PRESS_HERMES_PROFILE: 'frontpage', PRESS_HERMES_BIN: '/bin/hermes', PRESS_HERMES_PYTHON: '/bin/python' })
    const run = async (command, args, options) => {
      runs.push({ command, args, input: options.input, env: options.env })
      if (command === '/bin/python') {
        await fs.writeFile(args[args.indexOf('--output') + 1], 'png-bytes')
        return '{"provider": "openai-codex", "model": "gpt-image-2-medium"}\n'
      }
      return '{"ok": true}\nsession_id: abc\n'
    }
    const png = `data:image/png;base64,${Buffer.from('x').toString('base64')}`
    expect(await hermesChat({ system: 'sys', user: 'ask', imageDataUrl: png }, settings, run)).toBe('{"ok": true}')
    expect(await hermesChat({ system: 'sys', user: 'ask' }, settings, run)).toBe('{"ok": true}')
    expect(runs[0].args.join(' ')).toBe('-p frontpage chat -Q --oneshot --ignore-rules --source tool -t vision --max-turns 3 --query-file -')
    expect(runs[0].input).toMatch(/vision_analyze once on the image at .*input\.png/)
    expect(runs[1].args.join(' ')).toContain('-t todo --max-turns 1')
    const plate = await hermesImage({ prompt: 'a plate' }, settings, run)
    expect(plate).toEqual({ bytes: Buffer.from('png-bytes'), model: 'openai-codex/gpt-image-2-medium' })
    expect(runs[2].env.HERMES_HOME).toMatch(/profiles\/frontpage$/)
  })
})

describe('press run', () => {
  it('builds a loadable edition from a real past source, parks it, and flips it live', async () => {
    const { store, models } = await workspace()
    const now = new Date('2026-11-10T22:00:00Z')
    const result = await build({ store, models: models(), now, seedIndex, date: '2026-11-11', deps: { loadSource: fakeSource }, log: () => {} })

    expect(result).toMatchObject({ status: 'built', editionId: '2026-11-11-one-stitch-out-of-line-v1', liveNow: false, goLiveAt: '2026-11-11T09:00:00.000Z', notes: [] })
    expect(result.smoke).toEqual({ artifacts: 1, bindings: 1, assets: 4 })
    expect(builtMessage(result)).toContain('parked for Wed, Nov 11: "One Stitch Out of Line"')

    const base = 'editions/2026-11-11-one-stitch-out-of-line-v1'
    const edition = await store.getJson(`${base}/edition.json`)
    expect(edition.publish_state).toEqual({ is_live: true, published_at: '2026-11-11T09:00:00.000Z', archive_path: '/archive/one-stitch-out-of-line-v1' })
    const bindings = await store.getJson(`${base}/source-bindings.json`)
    expect(bindings.bindings[0]).toMatchObject({ source_type: 'tweet', source_url: 'https://x.com/alliharvard/status/2112561050310824352' })
    const map = await store.getJson(`${base}/artifact-map.json`)
    expect(map.artifacts[0].polygon.length).toBeGreaterThan(8)
    expect(await store.get(`${base}/interpretation.json`)).not.toBeNull()
    expect((await sharp(await store.get(`${base}/assets/preview.png`)).metadata()).width).toBe(768)

    // Parked, not live: the manifest is untouched until the go-live time.
    expect(await store.get(INDEX_KEY)).toBeNull()
    expect((await store.getJson(PARKED_KEY)).entries).toHaveLength(1)
    expect((await store.getJson(LEDGER_KEY)).used['tweet:2112561050310824352'].edition_id).toBe(result.editionId)

    const early = await flip({ store, now: new Date('2026-11-11T08:00:00Z'), seedIndex })
    expect(early.applied).toEqual([])
    const live = await flip({ store, now: new Date('2026-11-11T09:00:01Z'), seedIndex })
    expect(live).toMatchObject({ applied: [result.editionId], current: result.editionId })
    expect((await store.getJson(PARKED_KEY)).entries).toEqual([])
    const index = await store.getJson(INDEX_KEY)
    expect(index.editions.map((item) => [item.edition_id, item.is_live])).toEqual([[result.editionId, true], ['2026-11-09-light-loses-count-v1', false]])

    // The only source is spent, so the next run fails at pick and says why.
    const failure = await build({ store, models: models(), now: new Date('2026-11-11T22:00:00Z'), deps: { loadSource: fakeSource }, log: () => {} }).catch((error) => error)
    expect(failure).toMatchObject({ step: 'pick', date: '2026-11-12' })
    expect(failedMessage(failure)).toContain('failed at "pick" for 2026-11-12')
    expect(await shouldTellFailure(store, { date: '2026-11-12', step: 'pick' })).toBe(true)
    expect(await shouldTellFailure(store, { date: '2026-11-12', step: 'pick' })).toBe(false)
  })

  it('does nothing when today and tomorrow already have editions', async () => {
    const { store, models } = await workspace()
    const index = { ...seedIndex, editions: [{ ...seedIndex.editions[0], date: '2026-11-10' }, { ...seedIndex.editions[0], edition_id: 'next', date: '2026-11-11' }] }
    await expect(build({ store, models: models(), now: new Date('2026-11-10T22:00:00Z'), seedIndex: index, log: () => {} })).resolves.toEqual({ status: 'nothing-to-do' })
  })

  it('moves to the next candidate when a source is unusable, and maps the whole plate when mapping fails', async () => {
    const { store, replay, models } = await workspace()
    const fixture = await readFixture('candidates.json')
    await store.putJson(CANDIDATES_KEY, { candidates: [{ ...fixture.candidates[0], url: 'https://x.com/other/status/99', note_date: '2026-11-09' }, fixture.candidates[0]] })
    await fs.writeFile(path.join(replay, 'map.json'), JSON.stringify({ detected_object: null }))
    const briefs = [{ usable: false, unusable_reason: 'screenshot of plain text' }, await readFixture('brief.json')]
    const recorded = models()
    const chatJson = recorded.chatJson.bind(recorded)
    recorded.chatJson = async (request) => (request.step === 'brief' ? request.accept(briefs.shift()) : chatJson(request))

    const result = await build({ store, models: recorded, now: new Date('2026-11-10T22:00:00Z'), seedIndex, date: '2026-11-11', deps: { loadSource: fakeSource }, log: () => {} })
    expect(result.sourceUrl).toBe('https://x.com/alliharvard/status/2112561050310824352')
    expect(result.notes[0]).toContain('the whole plate is one target')
    const ledger = await store.getJson(LEDGER_KEY)
    expect(ledger.skipped['tweet:99']).toEqual({ reason: 'screenshot of plain text', count: 2 })
    const review = await store.getJson(`editions/${result.editionId}/review.json`)
    expect(review.notes.join(' ')).toContain('whole plate')
  })

  it('never parks an edition the viewer could not load', async () => {
    const { store, models } = await workspace()
    const put = store.put.bind(store)
    store.put = async (key, body) => (key.endsWith('/artifact-map.json') ? put(key, Buffer.from('{"artifacts": []}')) : put(key, body))
    const failure = await build({ store, models: models(), now: new Date('2026-11-10T22:00:00Z'), seedIndex, date: '2026-11-11', deps: { loadSource: fakeSource }, log: () => {} }).catch((error) => error)
    expect(failure.step).toBe('smoke')
    expect(await store.get(PARKED_KEY)).toBeNull()
    expect(await store.get(LEDGER_KEY)).toBeNull()
  })
})

describe('storage and notices', () => {
  it('keeps site files under public/ and press state under press/data/', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'press-repo-'))
    const store = new RepoStore(root)
    await store.putJson(INDEX_KEY, { editions: [] })
    await store.putJson(PARKED_KEY, { version: 1, entries: [] })
    await store.putJson(LEDGER_KEY, { used: {} })
    await store.putJson(CANDIDATES_KEY, { candidates: [] })
    const files = (await fs.readdir(root, { recursive: true })).filter((name) => name.endsWith('.json')).sort()
    expect(files).toEqual(['press/data/candidates.json', 'press/data/ledger.json', 'public/editions/index.json', 'public/press/parked.json'])
    await expect(store.get('../escape')).rejects.toThrow('Invalid store key')
    await expect(store.put('elsewhere/file.json', '{}')).rejects.toThrow('No place in the repository')
  })

  it('publishes by commit and push, and does nothing when nothing changed', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'press-git-'))
    const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, '-c', 'user.name=Press Test', '-c', 'user.email=press@example.invalid', ...args], { encoding: 'utf8' }).trim()
    const remote = path.join(root, 'remote.git')
    const repo = path.join(root, 'repo')
    execFileSync('git', ['init', '-q', '--bare', '-b', 'main', remote])
    execFileSync('git', ['init', '-q', '-b', 'main', repo])
    git(repo, 'config', 'user.name', 'Press Test')
    git(repo, 'config', 'user.email', 'press@example.invalid')
    git(repo, 'remote', 'add', 'origin', remote)
    await fs.writeFile(path.join(repo, 'README.md'), 'site\n')
    git(repo, 'add', '.')
    git(repo, 'commit', '-q', '-m', 'start')
    git(repo, 'push', '-q', '-u', 'origin', 'main')

    const store = new RepoStore(repo)
    await store.put('editions/2026-11-12-test-v1/edition.json', '{}')
    await store.putJson(PARKED_KEY, { version: 1, entries: [] })
    await store.putJson(CANDIDATES_KEY, { candidates: [] })
    await fs.writeFile(path.join(repo, 'stray.txt'), 'not the press')
    expect(await currentBranch(repo)).toBe('main')
    expect(await publish(repo, 'feat: publish daily edition test')).toEqual({ committed: true, pushed: true, branch: 'main' })
    expect(git(remote, 'show', '--name-only', '--format=%s', 'main').split('\n').filter(Boolean)).toEqual([
      'feat: publish daily edition test', 'public/editions/2026-11-12-test-v1/edition.json', 'public/press/parked.json',
    ])
    expect(await publish(repo, 'again')).toEqual({ committed: false, pushed: false, branch: 'main' })
  })

  it('sends one Telegram message and never throws', async () => {
    const sent = []
    const env = { TELEGRAM_BOT_TOKEN: 'token', TELEGRAM_CHAT_ID: '42' }
    const ok = await tell('hello', { env, shadow: true, log: () => {}, fetchImpl: async (url, init) => { sent.push(JSON.parse(init.body)); return new Response('{}') } })
    expect(ok).toEqual({ sent: true })
    expect(sent).toEqual([{ chat_id: '42', text: '[shadow] hello', disable_web_page_preview: false }])
    expect(await tell('hello', { env: {}, log: () => {} })).toEqual({ sent: false, reason: 'telegram not configured' })
    const failed = await tell('hello', { env, log: () => {}, fetchImpl: async () => { throw new TypeError('https://api.telegram.org/bottoken/sendMessage unreachable') } })
    expect(failed).toEqual({ sent: false, reason: 'telegram TypeError' })
  })
})
