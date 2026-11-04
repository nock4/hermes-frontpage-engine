// Bounded YIN, decimated to retain several bass periods at 96 kHz.
export function detectPitch(data: Float32Array, sampleRate: number) {
  const step = 2,
    rate = sampleRate / step,
    n = Math.floor(data.length / step),
    max = Math.min(Math.floor(rate / 50), n >> 1),
    min = Math.floor(rate / 1400)
  const d = new Float32Array(max + 2)
  let sum = 0
  for (let lag = 1; lag <= max; lag++) {
    let v = 0
    for (let i = 0; i < n - max; i++) {
      const a = data[i * step] - data[(i + lag) * step]
      v += a * a
    }
    sum += v
    d[lag] = sum > 1e-12 ? (v * lag) / sum : 1
  }
  for (let lag = Math.max(2, min); lag < max - 1; lag++)
    if (d[lag] < 0.12) {
      while (lag + 1 < max && d[lag + 1] < d[lag]) lag++
      const den = d[lag - 1] - 2 * d[lag] + d[lag + 1],
        offset = Math.abs(den) > 1e-9 ? (0.5 * (d[lag - 1] - d[lag + 1])) / den : 0
      return { hz: rate / (lag + Math.max(-0.5, Math.min(0.5, offset))), confidence: 1 - d[lag] }
    }
  return { hz: 0, confidence: 0 }
}
export class ResonanceEnvelope {
  energy = 0
  weight = 0.8
  density = 5
  rate = 0.9
  phase = 0
  hz = 0
  quiet = 1
  update(dt: number, p: { hz: number; confidence: number; rms: number }) {
    const confident = p.confidence > 0.88 && p.rms > 0.006 && p.hz >= 50
    this.quiet = confident ? 0 : this.quiet + dt
    if (confident)
      this.hz = this.hz ? Math.exp(Math.log(this.hz) + (Math.log(p.hz) - Math.log(this.hz)) * 0.35) : p.hz
    const voiced = confident || (this.quiet <= 0.28 && this.hz > 0 && p.rms > 0.006)
    const ease = 1 - Math.exp(-dt * 9)
    if (voiced) {
      const cutoff = Math.max(0, Math.min(1, (Math.max(this.hz, confident ? p.hz : 0) - 220) / 220)),
        weight = 1 - cutoff * cutoff * (3 - 2 * cutoff)
      this.weight = Math.min(this.weight + (weight - this.weight) * ease, weight)
      const density =
        this.hz <= 220
          ? 2.2 + (Math.max(0, this.hz - 60) / 160) * 2.8
          : 5 + Math.pow(Math.min(1, (this.hz - 220) / 1180), 0.7) * 65
      this.density += (density - this.density) * ease
      this.rate +=
        (0.5 + Math.max(0, Math.min(1, Math.log2(this.hz / 60) / Math.log2(1400 / 60))) * 3.3 - this.rate) *
        ease
    }
    this.energy +=
      ((voiced ? 1 - Math.exp(-Math.max(0, p.rms - 0.006) * 22) : 0) - this.energy) *
      (1 - Math.exp(-dt * (voiced ? 12 : 7)))
    this.phase = (this.phase + dt * this.rate * Math.PI * 2) % (Math.PI * 2)
  }
}
