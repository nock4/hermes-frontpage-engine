import type { EditionEffect } from './editionEffects.mjs'
import { detectPitch, ResonanceEnvelope } from './effectAudio'

/** One activation owns every resource. Epoch invalidation also handles late permissions. */
export class EffectSession {
  readonly envelope = new ResonanceEnvelope()
  state = 'Off'
  active = false
  held = false
  frames = 0
  received = 0
  samples = 0
  voices = 0
  tilt: [number, number] = [0, 0]
  pointer: [number, number] = [0.5, 0.5]
  light = [0, 0, 0]
  ruptureAt = -1
  video: HTMLVideoElement | null = null
  private epoch = 0
  get activation() { return this.epoch }
  private cancelJoin: (() => void) | null = null
  private stream: MediaStream | null = null
  private ctx: AudioContext | null = null
  private analyser: AnalyserNode | null = null
  private source: MediaStreamAudioSourceNode | null = null
  private data = new Float32Array(8192)
  private pitch = { hz: 0, confidence: 0, rms: 0 }
  private lastAnalysis = 0
  private signalRms = 0
  private signalPeak = 0
  /** Scalar-only readout of the existing capture graph; never acquires or resumes. */
  signalSnapshot() {
    const tracks = this.stream?.getAudioTracks().map(t => ({ readyState: t.readyState, muted: t.muted, enabled: t.enabled })) ?? []
    return { active: this.active, context: this.ctx?.state ?? 'absent',
      currentTime: this.ctx?.currentTime ?? 0, sampleRate: this.ctx?.sampleRate ?? 0,
      tracks, rms: this.signalRms, peak: this.signalPeak,
      estimatedHz: this.pitch.hz, confidence: this.pitch.confidence, rmsFloor: 0.006,
      rejection: !this.active ? 'inactive' : this.ctx?.state !== 'running' ? 'context not running' :
        !tracks.length || tracks.some(t => t.readyState !== 'live' || t.muted || !t.enabled) ? 'track unavailable' :
        this.signalRms <= 0.006 ? 'below RMS floor' : this.pitch.confidence <= 0.88 ? 'no confident period' : 'confident',
      energy: this.envelope.energy, phase: this.envelope.phase, frames: this.frames }
  }
  private abort: AbortController | null = null
  private events: EventSource | null = null
  private endpoint = ''
  private lastSend = 0
  private lastTone = 0
  private oscillators = new Set<OscillatorNode>()
  private usedRupture = false
  private sample = document.createElement('canvas')
  private sampleTime = -1
  private onOrientation = (e: DeviceOrientationEvent) => {
    if (this.active && Number.isFinite(e.gamma) && Number.isFinite(e.beta))
      this.tilt = [Math.max(-1, Math.min(1, e.gamma! / 35)), Math.max(-1, Math.min(1, (e.beta! - 35) / 40))]
  }
  constructor(
    readonly effect: EditionEffect,
    readonly room: string,
    private notify: (s: string) => void,
  ) {
    this.sample.width = 12
    this.sample.height = 8
  }
  private status(s: string) {
    this.state = s
    this.notify(s)
  }
  stop(message = 'Off · activate explicitly to return') {
    this.epoch++
    this.active = false
    this.held = false
    this.stream?.getTracks().forEach((t) => t.stop())
    this.stream = null
    this.source?.disconnect()
    this.source = null
    this.analyser = null
    this.ctx?.close().catch(() => {})
    this.ctx = null
    this.oscillators.forEach((o) => {
      try {
        o.stop()
      } catch {}
    })
    this.oscillators.clear()
    this.voices = 0
    window.removeEventListener('deviceorientation', this.onOrientation)
    this.tilt = [0, 0]
    this.abort?.abort()
    this.abort = null
    this.cancelJoin?.()
    this.cancelJoin = null
    if (this.events) {
      this.events.onopen = this.events.onerror = this.events.onmessage = null
    }
    this.events?.close()
    this.events = null
    this.endpoint = ''
    if (this.video) {
      this.video.pause()
      this.video.srcObject = null
      this.video.removeAttribute('src')
      this.video.load()
      this.video = null
    }
    this.envelope.energy = 0
    this.envelope.quiet = 1
    this.light = [0, 0, 0]
    this.status(message)
  }
  startLocal() {
    this.stop()
    this.active = true
    this.held = true
    this.envelope.weight = 0.8
    this.envelope.density = 5
    this.envelope.rate = 0.9
    this.status('Touch resonance ON · sensors off; release to settle')
  }
  releaseLocal() {
    this.held = false
  }
  async start() {
    this.stop()
    const token = this.epoch
    const kind = this.effect.kind
    this.status('Permission / activation pending · Stop cancels')
    try {
      if (kind === 'camera' || kind === 'resonance') {
        if (!navigator.mediaDevices?.getUserMedia) throw Error('sensor unavailable')
        const acquired = await navigator.mediaDevices.getUserMedia(
          kind === 'camera'
            ? { video: { facingMode: 'user', width: { ideal: 640 } }, audio: false }
            : {
                audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
                video: false,
              },
        )
        if (token !== this.epoch || document.hidden) {
          acquired.getTracks().forEach((t) => t.stop())
          return
        }
        this.stream = acquired
        for (const track of acquired.getTracks()) track.onended = () => {
          if (token === this.epoch) this.stop('Off · sensor ended')
        }
        if (kind === 'camera') {
          this.video = document.createElement('video')
          this.video.muted = true
          this.video.playsInline = true
          this.video.srcObject = acquired
          await this.video.play()
        } else {
          const ctx = new AudioContext()
          this.ctx = ctx
          await ctx.resume()
          if (token !== this.epoch) return
          if (document.hidden) { this.stop(); return }
          this.analyser = ctx.createAnalyser()
          this.analyser.fftSize = 8192
          this.source = ctx.createMediaStreamSource(acquired)
          this.source.connect(this.analyser)
        }
      } else if (kind === 'depth') {
        const Orientation = window.DeviceOrientationEvent as typeof DeviceOrientationEvent & {
          requestPermission?: () => Promise<string>
        }
        if (!Orientation) throw Error('tilt unavailable')
        if (Orientation.requestPermission && (await Orientation.requestPermission()) !== 'granted')
          throw Error('tilt denied')
        if (token !== this.epoch || document.hidden) return
        window.addEventListener('deviceorientation', this.onOrientation)
      } else if (kind === 'sound') {
        const ctx = new AudioContext()
        this.ctx = ctx
        await ctx.resume()
      } else if (kind === 'projection' || kind === 'castlight') {
        const url = this.effect.evidence.video?.url
        if (!url) throw Error('native source not admitted')
        this.video = document.createElement('video')
        this.video.crossOrigin = 'anonymous'
        this.video.muted = true
        this.video.playsInline = true
        this.video.loop = true
        this.video.src = url
        await this.video.play()
      } else if (kind === 'shared') {
        this.abort = new AbortController()
        const response = await fetch('/effects-config.json', {
          signal: this.abort.signal,
          credentials: 'same-origin',
        })
        if (!response.ok || !response.headers.get('content-type')?.includes('application/json'))
          throw Error('shared endpoint not configured')
        const config = await response.json()
        const u = new URL(config.shared_endpoint)
        const local =
          ['127.0.0.1', 'localhost'].includes(location.hostname) &&
          ['127.0.0.1', 'localhost'].includes(u.hostname) &&
          u.protocol === 'http:'
        if ((u.protocol !== 'https:' && !local) || u.username || u.password || u.search || u.hash)
          throw Error('secure shared endpoint not configured')
        if (token !== this.epoch || document.hidden) return
        this.endpoint = u.href.replace(/\/$/, '')
        const events = new EventSource(`${this.endpoint}/surface?room=${encodeURIComponent(this.room)}`)
        this.events = events
        await new Promise<void>((resolve, reject) => {
          const cancel = () => { clearTimeout(timeout); resolve() }
          this.cancelJoin = cancel
          const timeout = setTimeout(() => {
            events.close()
            reject(Error('shared connection unavailable'))
          }, 5000)
          events.onopen = () => {
            clearTimeout(timeout)
            if (token !== this.epoch) return
            this.cancelJoin = null
            resolve()
          }
          events.onerror = () => {
            if (token !== this.epoch) return
            this.cancelJoin = null
            clearTimeout(timeout)
            reject(Error('shared connection lost'))
            if (this.active) this.stop('Off · shared disconnected; join explicitly to reconnect')
          }
        })
        events.onmessage = (e) => {
          if (token !== this.epoch || !this.active) return
          try {
            const d = JSON.parse(e.data)
            if (
              Number.isFinite(d.x) &&
              d.x >= 0 &&
              d.x <= 1 &&
              Number.isFinite(d.y) &&
              d.y >= 0 &&
              d.y <= 1
            ) {
              this.pointer = [d.x, d.y]
              this.received++
              this.envelope.energy = 0.7
            }
          } catch {}
        }
      } else if (kind === 'rupture') {
        if (this.usedRupture) {
          this.status('Settled · once per edition visit')
          return
        }
        this.usedRupture = true
        this.ruptureAt = performance.now() / 1000
      }
      if (token !== this.epoch) return
      if (document.hidden) {
        this.stop()
        return
      }
      this.active = true
      this.status(
        `${kind.toUpperCase()} ON · ${kind === 'shared' ? 'ephemeral coordinates only' : 'local only; no recording or upload'}`,
      )
    } catch (error) {
      if (token === this.epoch)
        this.stop(
          `Off · ${error instanceof Error ? error.message : 'unavailable'} · source remains available`,
        )
    }
  }
  touch(x: number, y: number) {
    this.pointer = [Math.max(0, Math.min(1, x)), Math.max(0, Math.min(1, y))]
    if (!this.active) return
    const now = performance.now()
    if (this.effect.kind === 'refraction') this.envelope.energy = 0.85
    if (this.effect.kind === 'depth') this.tilt = [(x - 0.5) * 2, (y - 0.5) * 2]
    if (this.effect.kind === 'shared' && this.endpoint && now - this.lastSend > 100) {
      this.lastSend = now
      const token = this.epoch
      fetch(`${this.endpoint}/surface?room=${encodeURIComponent(this.room)}`, {
        method: 'POST',
        credentials: 'omit',
        signal: this.abort?.signal,
        headers: { 'Content-Type': 'application/json', 'X-Surface': 'touch' },
        body: JSON.stringify({ x: this.pointer[0], y: this.pointer[1] }),
      })
        .then((r) => {
          if (token === this.epoch && !r.ok) this.stop('Off · shared unavailable')
        })
        .catch(() => {
          if (token === this.epoch && this.active) this.stop('Off · shared disconnected')
        })
    }
    if (this.effect.kind === 'sound' && this.ctx && now - this.lastTone > 80) {
      this.lastTone = now
      const ctx = this.ctx,
        t = ctx.currentTime,
        metal = ['metal', 'glass', 'ceramic'].includes(this.effect.evidence.material),
        base = (metal ? 440 : 130) * (1 + y * 0.5)
      const master = ctx.createGain(),
        compressor = ctx.createDynamicsCompressor()
      master.gain.value = 0.08
      master.connect(compressor)
      compressor.connect(ctx.destination)
      let remaining = 3
      for (const [i, m] of [1, metal ? 2.76 : 1.51, 3.94].entries()) {
        const o = ctx.createOscillator(),
          g = ctx.createGain()
        o.type = metal ? 'sine' : 'triangle'
        o.frequency.value = base * m
        g.gain.setValueAtTime(0.28 / (i + 1), t)
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.8)
        o.connect(g)
        g.connect(master)
        this.oscillators.add(o)
        this.voices = this.oscillators.size
        o.onended = () => {
          this.oscillators.delete(o)
          this.voices = this.oscillators.size
          o.disconnect()
          g.disconnect()
          if (--remaining === 0) {
            master.disconnect()
            compressor.disconnect()
          }
        }
        o.start()
        o.stop(t + 0.9)
      }
      this.envelope.energy = 0.7
    }
  }
  tick(dt: number, ms: number) {
    this.frames++
    if (this.active && this.analyser && this.ctx) {
      this.analyser.getFloatTimeDomainData(this.data)
      let power = 0
      for (const v of this.data) power += v * v
      const rms = Math.sqrt(power / this.data.length)
      this.signalRms = rms
      this.signalPeak = this.data.reduce((peak, v) => Math.max(peak, Math.abs(v)), 0)
      if (ms - this.lastAnalysis >= 40) {
        this.lastAnalysis = ms
        this.pitch = {
          ...(rms > 0.006 ? detectPitch(this.data, this.ctx.sampleRate) : { hz: 0, confidence: 0 }),
          rms,
        }
      }
      this.envelope.update(dt, { ...this.pitch, rms })
    } else {
      this.envelope.phase += dt * 4
      if (this.active && this.held)
        this.envelope.energy += (0.85 - this.envelope.energy) * (1 - Math.exp(-dt * 12))
      else this.envelope.energy *= Math.exp(-dt * 7)
    }
    if (
      this.active &&
      this.effect.kind === 'castlight' &&
      this.video &&
      this.video.readyState >= 2 &&
      this.video.currentTime !== this.sampleTime
    ) {
      try {
        const c = this.sample.getContext('2d', { willReadFrequently: true })!
        c.drawImage(this.video, 0, 0, 12, 8)
        const pixels = c.getImageData(0, 0, 12, 8).data
        const rgb = [0, 0, 0]
        for (let i = 0; i < pixels.length; i += 4)
          for (let j = 0; j < 3; j++) rgb[j] += pixels[i + j] / (255 * 96)
        this.light = rgb
        this.samples++
        this.sampleTime = this.video.currentTime
      } catch {
        this.stop('Off · native source is not pixel-safe')
      }
    }
  }
  snapshot() {
    return {
      active: this.active,
      state: this.state,
      energy: this.envelope.energy,
      pitch: this.envelope.hz,
      weight: this.envelope.weight,
      density: this.envelope.density,
      phase: this.envelope.phase,
      frames: this.frames,
      samples: this.samples,
      light: [...this.light],
      received: this.received,
      voices: this.voices,
      context: this.ctx?.state ?? 'absent',
    }
  }
}
