import type { EffectSession } from './effectSession'
export const signalBuild = 'resonance-current-20261104-1'
/** Dev-only read-only observer. No capture, audio graph, network or storage APIs. */
export function mountSignalCheck(session: EffectSession, rendererReady: () => boolean) {
  const host = document.createElement('aside')
  host.dataset.signalCheck = signalBuild
  host.style.cssText = 'position:fixed;z-index:10000;top:8px;left:8px;width:min(430px,calc(100vw - 16px));max-height:calc(100dvh - 16px);overflow:auto;background:#fff;color:#111;padding:12px;box-sizing:border-box;font:13px/1.4 monospace;pointer-events:auto;border:1px solid #333'
  host.innerHTML = `<button type="button">Signal check</button><section hidden><h2>Resonance signal check · diagnostic review</h2><p>${signalBuild}</p><p>Enable microphone separately with the ∿ artwork control. Hold low / normal / high, Measure five seconds, then Copy diagnostics. No audio recording, upload or saved samples. Off / Stop cancels measurement.</p><button type="button" data-measure>Measure five seconds</button> <button type="button" data-copy>Copy diagnostics</button> <button type="button" data-close>Close signal check</button><pre style="white-space:pre-wrap;overflow-wrap:anywhere" data-live></pre><textarea aria-label="Selectable diagnostics" readonly style="box-sizing:border-box;width:100%;height:180px"></textarea></section>`
  document.body.append(host)
  host.querySelectorAll('button').forEach(button => { button.style.cssText = 'min-height:44px;margin:3px;max-width:100%;white-space:normal' })
  host.querySelector('pre')!.style.maxHeight = '170px'
  host.querySelector('pre')!.style.overflow = 'auto'
  const section = host.querySelector('section')!, text = host.querySelector('textarea')!, live = host.querySelector('pre')!, measure = host.querySelector<HTMLButtonElement>('[data-measure]')!
  let timer = 0, start = 0, previousTime: number | null = null, samples: object[] = [], running = false, wasActive = false
  function read() {
    const s = session.signalSnapshot(), advance = previousTime === null ? null : s.currentTime - previousTime
    previousTime = s.currentTime
    const captureHealthy = s.active && s.context === 'running' && advance !== null && advance > 0 && s.tracks.length > 0 && s.tracks.every(t => t.readyState === 'live' && t.enabled && !t.muted)
    return { ...s, captureHealthy, clockAdvance: advance, rendererReady: rendererReady(), reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches }
  }
  function finish(cancelled: boolean) {
    running = false; measure.disabled = false
    text.value = JSON.stringify({ buildID: signalBuild, executingModule: import.meta.url, browser: navigator.userAgent, secureContext: isSecureContext, visibility: document.visibilityState, status: cancelled ? 'CANCELLED / partial' : 'complete', elapsedSeconds: (performance.now()-start)/1000, samples }, null, 2)
    samples = []
  }
  function close() {
    if (running) finish(true)
    clearInterval(timer); timer = 0; previousTime = null; section.hidden = true
  }
  host.querySelector('button')!.onclick = () => {
    if (!section.hidden) return
    section.hidden = false; previousTime = null
    live.textContent = JSON.stringify(read(), null, 2)
    timer = window.setInterval(() => {
      const s = read(); live.textContent = JSON.stringify(s, null, 2)
      if (!running) return
      if (wasActive && !s.active) { finish(true); return }
      samples.push(s)
      if (performance.now()-start >= 5000) finish(false)
    }, 250)
  }
  measure.onclick = () => { samples = []; start = performance.now(); wasActive = session.active; running = true; measure.disabled = true; text.value = 'Measuring scalar values only…' }
  host.querySelector<HTMLButtonElement>('[data-close]')!.onclick = close
  host.querySelector<HTMLButtonElement>('[data-copy]')!.onclick = async () => {
    try { await navigator.clipboard.writeText(text.value) } catch { text.focus(); text.select() }
  }
  return () => { close(); host.remove() }
}
