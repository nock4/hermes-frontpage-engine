import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync(new URL('../../scripts/lib/source-research.mjs', import.meta.url), 'utf8')

describe('source autoresearch prompt', () => {
  it('frames research as aesthetic-field curation rather than tech evidence clustering', () => {
    expect(source).toContain('aesthetic-field autoresearch')
    expect(source).toContain('Over-index on music, visuals, art, memes')
    expect(source).toContain('Downrank AI-agent infrastructure')
    expect(source).toContain('curator of visual culture, music, memes, art, and surfaces')
  })
})
