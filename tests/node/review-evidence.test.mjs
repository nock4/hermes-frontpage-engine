import { it, expect } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { syntheticProofContext } from '../fixtures/independent-review.mjs'
import sharp from 'sharp'
import { collectReviewEvidence } from '../../scripts/lib/review-evidence.mjs'

it('pins actual plate plus every viewport/source screenshot and detects changed candidate capture', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'review-evidence-SYNTHETIC-'))
  const editionId = '2099-01-01-synthetic-v1'; const context = await syntheticProofContext(editionId, root)
  const options = { worktreeDir: root, runDir: context.latest_run_dir, editionId }
  const plate = await fs.readFile(path.join(root, 'public/editions', editionId, 'assets/plate.png'))
  const capture = async ({ directory }) => {
    const rows = []
    for (const viewport of ['desktop', 'mobile', 'mobile-landscape']) {
      const file = `${viewport}-b.png`; await fs.writeFile(path.join(directory, file), plate)
      rows.push({ file, viewport, binding_id: 'b', role: 'SYNTHETIC opened-source screenshot' })
    }
    return rows
  }
  const evidence = await collectReviewEvidence(options, { capture })
  expect(evidence.evidence).toHaveLength(5)
  expect(evidence.evidence.every(r => /^[a-f0-9]{64}$/.test(r.sha256))).toBe(true)
  expect(evidence.source_snapshot.path).toBe(null)
  expect(evidence.binding.edition_id).toBe(editionId)
  await fs.rm(path.join(options.runDir, 'automatic-review'), { recursive: true })
  await expect(collectReviewEvidence(options, { capture: async args => {
    const rows = await capture(args)
    await fs.appendFile(path.join(root, 'public/editions', editionId, 'assets/plate.png'), 'changed')
    return rows
  } })).rejects.toThrow(/changed/)
})

it('actual default Playwright capture retains every SYNTHETIC viewport and rejects stale served build bytes before review', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'review-browser-SYNTHETIC-'))
  const editionId='2099-01-01-synthetic-v1';const retained=await syntheticProofContext(editionId,root,path.join(root,'tmp/daily-process-runs/fixture'))
  const options={worktreeDir:root,runDir:retained.latest_run_dir,editionId}
  const image=await sharp({create:{width:1200,height:800,channels:3,background:'#b02040'}}).png().toBuffer()
  for(const name of ['plate.png','preview.png'])await fs.writeFile(path.join(root,'public/editions',editionId,'assets',name),image)
  await fs.mkdir(path.join(root,'dist'),{recursive:true});await fs.cp(path.join(root,'public/editions'),path.join(root,'dist/editions'),{recursive:true})
  await fs.symlink(path.resolve('node_modules'),path.join(root,'node_modules'))
  await fs.writeFile(path.join(root,'dist/index.html'),`<!doctype html><html><body><img class="plate" style="width:80vw" src="/editions/${editionId}/assets/plate.png"><button class="artifact" onkeydown="document.querySelector('.source-window').style.display='block'">SYNTHETIC mark</button><div class="source-window" data-binding-id="b" style="display:none">SYNTHETIC opened source <img width="120" src="/editions/${editionId}/assets/plate.png"></div></body></html>`)
  const result=await collectReviewEvidence(options)
  expect(result.screenshots).toHaveLength(6)
  expect(result.evidence).toHaveLength(8)
  await fs.rm(path.join(options.runDir,'automatic-review'),{recursive:true})
  await fs.writeFile(path.join(root,'dist/editions',editionId,'assets/plate.png'),await sharp({create:{width:1200,height:800,channels:3,background:'#00aaff'}}).png().toBuffer())
  await expect(collectReviewEvidence(options)).rejects.toThrow(/served.*bytes|stale.*build/i)
},30000)
