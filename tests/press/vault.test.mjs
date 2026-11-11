import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { parseNote, scanVault } from '../../press/lib/vault.mjs'

const savedNote = `---
source: "x/twitter"
author: "allison harvard burke"
handle: "@alliharvard"
date: "2026-10-20"
url: "https://x.com/alliharvard/status/2112561050310824352"
tags: ["tweet/bookmark", "memes-humor"]
---

# Try music turtle image

> try music you might like it https://x.com/alliharvard/status/2112561050310824352/photo/1

## Attached media

![photo](https://pbs.twimg.com/media/HVFSjIWaQAAH2Uw.jpg)

[View on X](https://x.com/alliharvard/status/2112561050310824352)
`

describe('vault candidates', () => {
  it('turns a saved bookmark note into a candidate', () => {
    expect(parseNote('Themes/Memes & Humor/x-2112561050310824352.md', savedNote, new Date('2026-10-21T09:03:45Z'))).toEqual({
      key: 'tweet:2112561050310824352',
      url: 'https://x.com/alliharvard/status/2112561050310824352',
      handle: '@alliharvard',
      author: 'allison harvard burke',
      title: 'Try music turtle image',
      text: 'try music you might like it https://x.com/alliharvard/status/2112561050310824352/photo/1',
      media_urls: ['https://pbs.twimg.com/media/HVFSjIWaQAAH2Uw.jpg'],
      note_date: '2026-10-21',
      tweet_date: '2026-10-20',
    })
  })

  it('ignores notes that only mention a post, and notes outside the saved lanes', async () => {
    expect(parseNote('Themes/Music/essay.md', '# Essay\nSee https://x.com/someone/status/123 for context.\n', new Date())).toBeNull()
    expect(parseNote('Inbox/tweets/plain.md', '# No links here\n', new Date())).toBeNull()
    expect(parseNote('Inbox/tweets/1.md', '# Saved\nhttps://twitter.com/artist/status/1005?s=20\n', new Date('2026-11-01T00:00:00Z'))).toMatchObject({ key: 'tweet:1005', url: 'https://x.com/artist/status/1005', handle: '@artist', media_urls: [] })

    const vault = await fs.mkdtemp(path.join(os.tmpdir(), 'press-vault-'))
    const write = async (relative, body) => { await fs.mkdir(path.dirname(path.join(vault, relative)), { recursive: true }); await fs.writeFile(path.join(vault, relative), body) }
    await write('Themes/Memes & Humor/x-2112561050310824352.md', savedNote)
    await write('Inbox/tweets/dup.md', '# Dup\nhttps://x.com/alliharvard/status/2112561050310824352\n')
    await write('Journal/private.md', '# Private\nhttps://x.com/secret/status/777\n')
    const { notes, candidates } = scanVault(vault)
    expect(notes).toBe(2)
    expect(candidates).toHaveLength(1)
    expect(candidates[0].media_urls).toHaveLength(1)
  })
})
