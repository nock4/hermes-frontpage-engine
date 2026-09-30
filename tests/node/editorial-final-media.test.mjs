import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { assertEditorialBindings } from '../../scripts/lib/source-selection-policy.mjs'
import { inspectedDecision } from '../fixtures/creative-inspection.mjs'
const source = {url:'https://artist.example/work',image_url:'https://artist.example/work.png',media_url:'https://artist.example/movie.mp4',media_type:'video'}
const capture = path.join(fs.mkdtempSync(path.join(os.tmpdir(),'editorial-final-')), 'capture.png')
fs.writeFileSync(capture, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64'))
const decision = inspectedDecision(source)
decision.inspection.capture_path = capture
decision.inspection.capture_sha256 = createHash('sha256').update(fs.readFileSync(capture)).digest('hex')
decision.inspection.representative_media_url = source.media_url
const field = {sources:[source],autoresearch:{source_decisions:[decision]}}
const binding = {source_url:source.url,source_image_url:source.image_url,source_media_url:source.media_url,source_media_type:'video'}
const check = (b, f=field) => assertEditorialBindings([b],f,null,{minimum:1,finalMedia:true})
describe('final media integrity',()=>{
 it('rejects an uninspected alternate image',()=>expect(()=>check({...binding,source_image_url:'https://artist.example/other.png'})).toThrow())
 it('rejects a switched video',()=>expect(()=>check({...binding,source_media_url:'https://artist.example/other.mp4'})).toThrow())
 it('preserves inspected representative-poster video semantics',()=>expect(()=>check(binding)).not.toThrow())
 it('reads back the actual capture digest',()=>expect(()=>check(binding,{...field,autoresearch:{source_decisions:[{...decision,inspection:{...decision.inspection,capture_sha256:'a'.repeat(64)}}]}})).toThrow())
})
