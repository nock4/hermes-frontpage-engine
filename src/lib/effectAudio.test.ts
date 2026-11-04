import { it, expect } from 'vitest'
import { detectPitch, ResonanceEnvelope } from './effectAudio'
it('distinguishes quiet bass, high pitch and unvoiced noise', () => {
  for (const hz of [60, 90, 220, 880]) {
    const a = Float32Array.from({ length: 8192 }, (_, i) => 0.03 * Math.sin((i * 2 * Math.PI * hz) / 48000))
    expect(detectPitch(a, 48000).hz).toBeCloseTo(hz, 0)
  }
  let seed = 12345
  const noise = Float32Array.from({ length: 8192 }, () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return (seed / 4294967296 - 0.5) * 0.4
  })
  expect(detectPitch(noise, 48000).hz).toBe(0)
})
it('sustains held bass, rejects silence/dropout/noise, and does not morph high release into bass', () => {
  const e = new ResonanceEnvelope()
  for (let i = 0; i < 720; i++) e.update(1 / 60, { hz: 90, confidence: 0.99, rms: 0.04 })
  expect(e.energy).toBeGreaterThan(0.4)
  expect(e.weight).toBeGreaterThan(0.9)
  e.update(0.05, { hz: 880, confidence: 0.99, rms: 0.04 })
  expect(e.weight).toBe(0)
  const density = e.density
  for (let i = 0; i < 60; i++) e.update(1 / 60, { hz: 0, confidence: 0, rms: 0 })
  expect(e.energy).toBeLessThan(0.002)
  expect(e.weight).toBe(0)
  expect(e.density).toBe(density)
  for (let i = 0; i < 120; i++) e.update(1 / 60, { hz: 0, confidence: 0, rms: 0.1 })
  expect(e.energy).toBeLessThan(0.001)
})
