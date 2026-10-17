import { describe, it, expect } from 'vitest'
import { nativeVideoPlaybackProgress } from '../ux/helpers/native-video-playback'

const before = { currentTime: 0, duration: 0.12, frames: 4, width: 1024, height: 1024, error: null }
describe('native video playback audit', () => {
  it('accepts a completed short clip only with post-gesture decoded frame growth', () => {
    expect(nativeVideoPlaybackProgress({ ...before, currentTime: 0.12, frames: 6 }, before)).toEqual({ advanced: true, decoded: true, dimensions: true, error: null })
  })
  it('rejects a predecoded still or a seek without new decoded frames', () => {
    expect(nativeVideoPlaybackProgress(before, before).advanced).toBe(false)
    expect(nativeVideoPlaybackProgress({ ...before, currentTime: 0.12 }, before).advanced).toBe(false)
  })
  it('retains the ordinary 0.2-second minimum for longer clips', () => {
    const start = { ...before, duration: 10 }
    expect(nativeVideoPlaybackProgress({ ...start, currentTime: 0.1, frames: 7 }, start).advanced).toBe(false)
    expect(nativeVideoPlaybackProgress({ ...start, currentTime: 0.3, frames: 13 }, start).advanced).toBe(true)
  })
  it('does not pass unavailable dimensions or media errors', () => {
    expect(nativeVideoPlaybackProgress({ ...before, currentTime: 0.12, frames: 6, width: 0, error: 'decode failed' }, before)).toMatchObject({ dimensions: false, error: 'decode failed' })
  })
})
