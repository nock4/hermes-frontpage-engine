import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { assertEditorialBindings, isAiToolingContentSource } from '../../scripts/lib/source-selection-policy.mjs'
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
describe('marketplace owning-source quarantine', () => {
 const announcement = 'paisajitos by @canekzapata released on @objktcom'
 it('quarantines explicit marketplace releases despite verified artwork pixels', () => {
  const released = { ...source, description: announcement }
  expect(() => check(binding, { ...field, sources: [released] })).toThrow(/Editorial eligibility/)
 })
 it('retains owning-source evidence when the attached art is renamed', () => {
  expect(isAiToolingContentSource({ title: 'Rainbow landscape', parent_source: { description: announcement } })).toBe(true)
 })
 it('preserves independent artwork by the same artist and publisher', () => {
  const independent = { ...source, title: 'paisajitos by @canekzapata', description: 'An independent landscape artwork by @0xassembly', note_path: 'Crypto & Network Economies/art.md' }
  expect(isAiToolingContentSource(independent)).toBe(false)
  expect(() => check(binding, { ...field, sources: [independent] })).not.toThrow()
 })
 it('does not classify artist attribution or a similarly named venue as a marketplace release', () => {
  expect(isAiToolingContentSource({ description: 'Artwork by @objktcom' })).toBe(false)
  expect(isAiToolingContentSource({ description: 'released on @objktcommunity' })).toBe(false)
 })
})
describe('image-typed final media without a duplicate image descriptor', () => {
 const image = 'https://collectionapi.metmuseum.org/api/collection/v1/iiif/488880/1005811/restricted'
 const stillSource = { url: 'https://www.metmuseum.org/art/collection/search/488880', image_url: image }
 const stillDecision = { ...inspectedDecision(stillSource), inspection: {
  ...inspectedDecision(stillSource).inspection,
  capture_path: capture, capture_sha256: decision.inspection.capture_sha256,
 } }
 const stillField = { sources: [stillSource], autoresearch: { source_decisions: [stillDecision] } }
 const stillBinding = { source_url: stillSource.url, source_media_url: image, source_media_type: 'image', source_image_aliases: [image] }
 const checkStill = (b = stillBinding, f = stillField) => check(b, f)
 it('accepts the exact inspected extensionless image and preserves binding aliases', () => {
  const before = structuredClone(stillBinding)
  expect(() => checkStill()).not.toThrow()
  expect(stillBinding).toEqual(before)
 })
 it('does not require aliases to attest the exact inspected image', () => {
  expect(() => checkStill({ ...stillBinding, source_image_aliases: undefined })).not.toThrow()
 })
 it('rejects substituted media even with the inspected URL retained as an alias', () => {
  expect(() => checkStill({ ...stillBinding, source_media_url: `${image}-substituted` })).toThrow(/final media or capture integrity mismatch/)
 })
 it('does not let an inspected media URL hide an explicit substituted image', () => {
  expect(() => checkStill({ ...stillBinding, source_image_url: `${image}-substituted` })).toThrow(/final media or capture integrity mismatch/)
 })
 it.each(['video', 'audio', undefined])('does not infer still evidence for media type %s', (type) => {
  expect(() => checkStill({ ...stillBinding, source_media_type: type })).toThrow(/final media or capture integrity mismatch/)
 })
 it('does not use a video URL in place of its absent inspected poster', () => {
  expect(() => check({ ...binding, source_image_url: undefined })).toThrow(/final media or capture integrity mismatch/)
 })
 it('rejects a corrupt capture digest on the media-only image path', () => {
  expect(() => checkStill(stillBinding, { ...stillField, autoresearch: { source_decisions: [{ ...stillDecision, inspection: { ...stillDecision.inspection, capture_sha256: 'b'.repeat(64) } }] } })).toThrow(/final media or capture integrity mismatch/)
 })
 it('rejects a missing capture on the media-only image path', () => {
  expect(() => checkStill(stillBinding, { ...stillField, autoresearch: { source_decisions: [{ ...stillDecision, inspection: { ...stillDecision.inspection, capture_path: `${capture}.missing` } }] } })).toThrow(/final media or capture integrity mismatch/)
 })
 it('retains owning-source quarantine', () => {
  expect(() => checkStill(stillBinding, { ...stillField, sources: [{ ...stillSource, description: 'paisajitos released on @objktcom' }] })).toThrow(/Editorial eligibility/)
 })
 it('retains research exclusions', () => {
  expect(() => checkStill(stillBinding, { ...stillField, autoresearch: { source_decisions: [{ ...stillDecision, role: 'reject' }] } })).toThrow(/Editorial eligibility/)
 })
})
describe('final media integrity',()=>{
 it('rejects an uninspected alternate image',()=>expect(()=>check({...binding,source_image_url:'https://artist.example/other.png'})).toThrow())
 it('rejects a switched video',()=>expect(()=>check({...binding,source_media_url:'https://artist.example/other.mp4'})).toThrow())
 it('preserves inspected representative-poster video semantics',()=>expect(()=>check(binding)).not.toThrow())
 it('reads back the actual capture digest',()=>expect(()=>check(binding,{...field,autoresearch:{source_decisions:[{...decision,inspection:{...decision.inspection,capture_sha256:'a'.repeat(64)}}]}})).toThrow())
})
