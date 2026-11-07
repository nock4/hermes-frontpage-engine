// Test-only consumer for this relay's exact LF-delimited wire frames, not an SSE client.
// Lock immediately: Miniflare wraps an Undici Response; its finalizer cancels an
// undisturbed, unlocked body when the original wrapper is collected.
const deadlineReached = Symbol('deadline')
export class RelaySseReader {
  constructor(stream) {
    this.reader = stream.getReader()
    this.decoder = new TextDecoder('utf-8', { fatal: true })
    this.buffer = ''
    this.closing = null
  }
  async readBefore(deadline) {
    if (this.closing) throw Error('reader closed')
    const remaining = deadline - Date.now()
    if (remaining <= 0) return deadlineReached
    let timer
    try {
      return await Promise.race([
        this.reader.read(),
        new Promise(resolve => { timer = setTimeout(() => resolve(deadlineReached), remaining) }),
      ])
    } finally { clearTimeout(timer) }
  }
  async frame(expected, ms = 5000) {
    const deadline = Date.now() + ms
    let bytes = 0, reads = 0
    try {
      for (;;) {
        const boundary = this.buffer.indexOf('\n\n')
        if (boundary !== -1) {
          const actual = this.buffer.slice(0, boundary + 2)
          this.buffer = this.buffer.slice(boundary + 2)
          if (actual !== expected) throw Error('unexpected frame: ' + JSON.stringify(actual))
          return
        }
        if (++reads > 128) throw Error('read budget exceeded')
        const chunk = await this.readBefore(deadline)
        if (chunk === deadlineReached) throw Error('frame deadline exceeded')
        if (chunk.done) throw Error('premature EOF: ' + JSON.stringify(this.buffer))
        bytes += chunk.value.byteLength
        if (bytes > 4096) throw Error('byte budget exceeded')
        this.buffer += this.decoder.decode(chunk.value, { stream: true })
      }
    } catch (error) { await this.close(); throw error }
  }
  async quiet(ms) {
    const deadline = Date.now() + ms
    let reads = 0
    try {
      // Flush pending decoder state too: an incomplete UTF-8 code point after
      // a complete frame is still received traffic, not an empty quiet tail.
      if (this.buffer || this.decoder.decode()) throw Error('unexpected bytes in buffered tail')
      for (;;) {
        if (++reads > 128) throw Error('read budget exceeded')
        const chunk = await this.readBefore(deadline)
        if (chunk === deadlineReached) return
        if (chunk.done) throw Error('premature EOF during quiet window')
        // Even a partial frame violates silence; don't wait for a delimiter.
        if (chunk.value.byteLength) throw Error('unexpected bytes during quiet window')
      }
    } finally { await this.close() }
  }
  close() {
    if (!this.closing) this.closing = (async () => {
      try { await this.reader.cancel() } finally { this.reader.releaseLock() }
    })()
    return this.closing
  }
}
