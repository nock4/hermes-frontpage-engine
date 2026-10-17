export interface NativeVideoSnapshot {
  currentTime: number
  duration: number
  frames: number
  width: number
  height: number
  error: string | null
}

export function nativeVideoPlaybackProgress(now: NativeVideoSnapshot, start: NativeVideoSnapshot) {
  // Short provider GIF/video wrappers can finish before a fixed 0.2s
  // threshold. Still require both elapsed media time and new decoded frames.
  const minimumProgress = Number.isFinite(now.duration) && now.duration > 0
    ? Math.min(0.2, now.duration / 2) : 0.2
  return {
    advanced: now.currentTime > start.currentTime + minimumProgress && now.frames > start.frames,
    decoded: now.frames > 0,
    dimensions: now.width > 0 && now.height > 0,
    error: now.error,
  }
}
