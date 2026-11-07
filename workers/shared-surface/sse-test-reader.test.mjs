import { it, expect, vi } from 'vitest'
import { RelaySseReader } from './sse-test-reader.mjs'
const join = ': joined; ephemeral only\n\n'
const data = 'data: {"x":0.123,"y":0.988}\n\n'
const encoder = new TextEncoder()
function fixture(parts, end = false) {
  let cancelled = 0
  const stream = new ReadableStream({ start(c) { for (const p of parts) c.enqueue(typeof p === 'string' ? encoder.encode(p) : p); if (end) c.close() }, cancel() { cancelled++ } })
  return { stream, reader: new RelaySseReader(stream), cancelled: () => cancelled }
}
it.each([
  ['zero byte', [new Uint8Array(0), join]],
  ['fragmented', [': jo', 'ined; ephemeral only\n', '\n']],
  ['coalesced', [join + data]],
])('reads exact frames across %s transport and preserves tail', async (_, chunks) => {
  const f = fixture([...chunks, ...(_ === 'coalesced' ? [] : [data])])
  try { await f.reader.frame(join); await f.reader.frame(data) } finally { await f.reader.close() }
  expect(f.stream.locked).toBe(false); expect(f.cancelled()).toBe(1)
})
it('decodes split UTF-8 without replacement', async () => {
  const bytes = encoder.encode('data: café\n\n'); const f = fixture([...bytes].map(b => new Uint8Array([b])))
  try { await f.reader.frame('data: café\n\n') } finally { await f.reader.close() }
})
it.each([['missing joined', ['data: {}\n\n'], false, /unexpected frame/], ['wrong joined comment', [': not joined\n\n'], false, /unexpected frame/], ['partial EOF', [': joined'], true, /EOF/], ['empty EOF', [], true, /EOF/], ['malformed UTF-8', [new Uint8Array([255])], false, /encoded|encoding/], ['overbudget bytes', ['x'.repeat(4097)], false, /budget/], ['overbudget reads', Array.from({length:129}, () => new Uint8Array(0)), false, /budget/]])('rejects %s and releases lock', async (_, parts, end, error) => {
  const f = fixture(parts, end)
  await expect(f.reader.frame(join)).rejects.toThrow(error)
  expect(f.stream.locked).toBe(false)
  if (!end) expect(f.cancelled()).toBe(1)
})
it.each([join + data, join + 'd', join + ':'])('quiet cannot discard coalesced replay or partial tail %s', async (bytes) => {
  const f = fixture([bytes]); await f.reader.frame(join)
  await expect(f.reader.quiet(120)).rejects.toThrow(/unexpected bytes/)
  expect(f.stream.locked).toBe(false)
})
it('quiet rejects a coalesced incomplete UTF-8 tail', async () => {
  const joinedBytes = encoder.encode(join)
  const bytes = new Uint8Array(joinedBytes.length + 1); bytes.set(joinedBytes); bytes[bytes.length - 1] = 0xc3
  const f = fixture([bytes]); await f.reader.frame(join)
  await expect(f.reader.quiet(120)).rejects.toThrow(/encoded|encoding|unexpected bytes/)
  expect(f.stream.locked).toBe(false); expect(f.cancelled()).toBe(1)
})
it('quiet rejects delayed fragmented cross-room bytes', async () => {
  let controller; const stream = new ReadableStream({ start(c) { controller = c } }); const r = new RelaySseReader(stream)
  const pending = r.quiet(120); controller.enqueue(encoder.encode('d'))
  await expect(pending).rejects.toThrow(/unexpected bytes/); expect(stream.locked).toBe(false)
})
it('quiet does not mistake EOF for isolation', async () => {
  const f = fixture([], true); await expect(f.reader.quiet(120)).rejects.toThrow(/EOF/); expect(f.stream.locked).toBe(false)
})
it('propagates transport errors and releases lock', async () => {
  const error = Error('transport failure'); const stream = new ReadableStream({ start(c) { c.error(error) } }); const r = new RelaySseReader(stream)
  await expect(r.frame(join)).rejects.toBe(error); expect(stream.locked).toBe(false)
})
it.each(['frame', 'quiet'])('%s deadline settles pending read, cancels once and clears timer', async (method) => {
  vi.useFakeTimers()
  const f = fixture([])
  try {
    const promise = method === 'frame' ? f.reader.frame(join, 120) : f.reader.quiet(120)
    const assertion = method === 'frame' ? expect(promise).rejects.toThrow(/deadline/) : expect(promise).resolves.toBeUndefined()
    await vi.advanceTimersByTimeAsync(120); await assertion
    expect(f.cancelled()).toBe(1); expect(f.stream.locked).toBe(false); expect(vi.getTimerCount()).toBe(0)
    await f.reader.close(); expect(f.cancelled()).toBe(1)
  } finally { await f.reader.close(); vi.useRealTimers() }
})
it('explicit cleanup settles a pending read without false success', async () => {
  const f = fixture([]); const promise = f.reader.frame(join)
  const assertion = expect(promise).rejects.toThrow(/EOF|closed/)
  await f.reader.close(); await assertion; expect(f.stream.locked).toBe(false); expect(f.cancelled()).toBe(1)
})
