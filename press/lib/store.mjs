// Files for the press. Keys look like "editions/index.json".
//   LocalStore  one directory holding every key as-is (tests, demos)
//   RepoStore   this repository: what the site serves goes under public/, the
//               press's own state under press/data/
// Editions are published by committing and pushing those files (see git.mjs).

import fs from 'node:fs/promises'
import path from 'node:path'

function assertKey(key) {
  if (typeof key !== 'string' || !key || key.startsWith('/') || key.split('/').some((part) => part === '..' || part === '')) {
    throw new Error(`Invalid store key: ${JSON.stringify(key)}`)
  }
}

export class LocalStore {
  constructor(root) {
    this.root = path.resolve(root)
  }

  describe() {
    return `local:${this.root}`
  }

  file(key) {
    assertKey(key)
    return path.join(this.root, key)
  }

  async get(key) {
    try { return await fs.readFile(this.file(key)) } catch (error) { if (error.code === 'ENOENT') return null; throw error }
  }

  async getJson(key) {
    const body = await this.get(key)
    return body ? JSON.parse(body.toString('utf8')) : null
  }

  async put(key, body) {
    const file = this.file(key)
    await fs.mkdir(path.dirname(file), { recursive: true })
    const temporary = `${file}.${process.pid}.tmp`
    await fs.writeFile(temporary, body)
    await fs.rename(temporary, file)
  }

  async putJson(key, value) {
    await this.put(key, Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8'))
  }

  async delete(key) {
    await fs.rm(this.file(key), { force: true })
  }
}

export class RepoStore extends LocalStore {
  // The repository this store writes into; its presence is what turns on git publishing.
  get repo() {
    return this.root
  }

  describe() {
    return `repo:${this.root}`
  }

  file(key) {
    assertKey(key)
    // Served by the site: editions, and the parked list the go-live gate reads.
    if (key.startsWith('editions/') || key === 'press/parked.json') return path.join(this.root, 'public', key)
    // Everything else under press/ is the press's own state.
    if (key.startsWith('press/')) return path.join(this.root, 'press/data', key.slice('press/'.length))
    throw new Error(`No place in the repository for store key: ${key}`)
  }
}

// PRESS_STORE=local:<dir> for a plain directory; otherwise the repository at
// PRESS_REPO (default: the current directory).
export function storeFromEnv(env = process.env) {
  const target = env.PRESS_STORE || ''
  if (target.startsWith('local:')) return new LocalStore(target.slice('local:'.length))
  if (target) throw new Error('PRESS_STORE must be local:<dir>, or unset to use the repository')
  return new RepoStore(env.PRESS_REPO || process.cwd())
}
