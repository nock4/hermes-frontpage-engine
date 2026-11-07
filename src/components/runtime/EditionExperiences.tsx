import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import type { LoadedEdition, ArtifactRecord } from '../../types/runtime'
import type { EditionEffect } from '../../lib/editionEffects.mjs'
import { EffectSession } from '../../lib/effectSession'
import { createEffectRenderer } from '../../lib/effectRenderer'
import '../../styles/edition-effects.css'

const labels: Record<string, string> = {
  refraction: 'Touch the reflective surface',
  projection: 'Play the original moving source',
  camera: 'Enable camera reflection — local, no recording',
  resonance: 'Enable microphone resonance — local, no recording; or hold Space for sensor-free resonance',
  depth: 'Enable tilt depth — local movement',
  castlight: 'Play native source light',
  shared: 'Join ephemeral shared surface — sends anonymous coordinates',
  rupture: 'Release this seam once',
  sound: 'Enable synthesized material sound',
}
const glyphs: Record<string, string> = {
  refraction: '≈',
  projection: '▷',
  camera: '◉',
  resonance: '∿',
  depth: '◇',
  castlight: '☼',
  shared: '⌁',
  rupture: '⋰',
  sound: '⋇',
}
type QAWindow = Window & { __effectsQA?: Record<string, () => ReturnType<EffectSession['snapshot']>> }
function Experience({
  effect,
  artifact,
  loaded,
  position,
  suspended,
  selected,
  onSelect,
}: {
  effect: EditionEffect
  artifact: ArtifactRecord
  loaded: LoadedEdition
  position?: { x: number; y: number }
  suspended: boolean
  selected: string | null
  onSelect: (kind: string) => void
}) {
  const [status, setStatus] = useState(''),
    [started, setStarted] = useState(false),
    [active, setActive] = useState(false),
    [activation, setActivation] = useState(0),
    [rendered, setRendered] = useState(false)
  const canvas = useRef<HTMLCanvasElement>(null),
    videoHost = useRef<HTMLDivElement>(null)
  const session = useRef<EffectSession | null>(null)
  const reduced = useRef(matchMedia('(prefers-reduced-motion: reduce)'))
  useEffect(() => {
    const s = new EffectSession(effect, loaded.edition.edition_id, (text) => {
      setStatus(text)
      setActive(s.active)
      setActivation(s.activation)
    })
    session.current = s
    const off = () => s.stop(),
      visibility = () => {
        if (document.hidden) off()
      },
      escape = (e: KeyboardEvent) => {
        if (e.key === 'Escape') off()
      }
    document.addEventListener('visibilitychange', visibility)
    window.addEventListener('pagehide', off)
    window.addEventListener('offline', off)
    window.addEventListener('keydown', escape)
    reduced.current.addEventListener('change', off)
    const qaWindow = window as QAWindow,
      qa = new URLSearchParams(location.search).get('qaEffects') === '1'
    if (qa) {
      qaWindow.__effectsQA ??= {}
      qaWindow.__effectsQA[effect.kind] = () => s.snapshot()
    }
    return () => {
      s.stop()
      session.current = null
      document.removeEventListener('visibilitychange', visibility)
      window.removeEventListener('pagehide', off)
      window.removeEventListener('offline', off)
      window.removeEventListener('keydown', escape)
      reduced.current.removeEventListener('change', off)
      if (qaWindow.__effectsQA) {
        delete qaWindow.__effectsQA[effect.kind]
        if (!Object.keys(qaWindow.__effectsQA).length) delete qaWindow.__effectsQA
      }
    }
  }, [effect, loaded.edition.edition_id])
  useEffect(() => {
    if (selected !== null && selected !== effect.kind) {
      session.current?.stop()
      setStarted(false)
    }
  }, [selected, effect.kind])
  useEffect(() => {
    if (suspended) session.current?.stop()
  }, [suspended])
  useEffect(() => {
    const s = session.current
    if (!s || !active || !canvas.current || reduced.current.matches) return
    const token = s.activation
    let disposed = false
    const native = effect.kind === 'projection' || effect.kind === 'camera'
    const renderer = native
      ? null
      : createEffectRenderer(canvas.current, loaded.edition.plate_asset_path, artifact, s)
    if (!native && !renderer) {
      s.stop('Off · renderer unavailable; original source remains available')
      return
    }
    if (s.video && native) {
      videoHost.current?.append(s.video)
      s.video.className = `edition-effect-video edition-effect-video--${effect.kind}`
    }
    const element = canvas.current
    const lost = () => s.stop('Off · renderer lost; original source remains available')
    element.addEventListener('webglcontextlost', lost)
    let raf = 0,
      last = performance.now(),
      drawn = false
    const draw = (ms: number) => {
      if (disposed || !s.active || token !== s.activation) return
      const dt = Math.min(0.05, (ms - last) / 1000)
      last = ms
      s.tick(dt, ms)
      if (renderer?.draw(ms) && !drawn) {
        drawn = true
        setRendered(true)
      }
      raf = requestAnimationFrame(draw)
    }
    if (native) raf = requestAnimationFrame(draw)
    else void renderer!.ready.then((ready) => {
      if (disposed || token !== s.activation || !s.active) return
      if (!ready) {
        s.stop('Off · renderer unavailable; original source remains available')
        return
      }
      raf = requestAnimationFrame(draw)
    })
    const field = canvas.current.parentElement?.parentElement
    const touch = (e: PointerEvent) => {
      if ((e.target as Element).closest('.edition-effect-mark,.edition-effect-status')) return
      const r = field?.getBoundingClientRect()
      if (r) s.touch((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height)
    }
    field?.addEventListener('pointerdown', touch as EventListener)
    field?.addEventListener('pointermove', touch as EventListener)
    return () => {
      disposed = true
      element.removeEventListener('webglcontextlost', lost)
      cancelAnimationFrame(raf)
      renderer?.dispose()
      setRendered(false)
      videoHost.current?.replaceChildren()
      field?.removeEventListener('pointerdown', touch as EventListener)
      field?.removeEventListener('pointermove', touch as EventListener)
    }
  }, [active, activation, effect, artifact, loaded.edition.plate_asset_path])
  const polygon = `polygon(${artifact.polygon.map(([x, y]) => `${x * 100}% ${y * 100}%`).join(',')})`
  const style = {
    left: position?.x,
    top: position?.y,
    visibility: position ? undefined : 'hidden',
  } as CSSProperties
  return (
    <>
      <div className="edition-effect-paint" style={{ clipPath: polygon }} aria-hidden="true">
        <canvas ref={canvas} className={active && rendered ? 'is-painted' : ''} />
        <div ref={videoHost} className="edition-effect-video-host" />
      </div>
      <button
        className="edition-effect-mark"
        style={style}
        type="button"
        aria-label={`Experience ${effect.kind} — ${labels[effect.kind]}`}
        title={labels[effect.kind]}
        disabled={suspended}
        onKeyDown={(event) => {
          if (effect.kind === 'resonance' && event.code === 'Space') {
            event.preventDefault()
            if (!event.repeat && !reduced.current.matches) {
              onSelect(effect.kind)
              setStarted(true)
              session.current?.startLocal()
            }
          }
        }}
        onKeyUp={(event) => {
          if (effect.kind === 'resonance' && event.code === 'Space') {
            event.preventDefault()
            session.current?.releaseLocal()
          }
        }}
        onBlur={() => session.current?.releaseLocal()}
        onClick={() => {
          onSelect(effect.kind)
          setStarted(true)
          if (reduced.current.matches) {
            setStatus('Off · reduced motion; original source remains available')
            return
          }
          void session.current?.start()
        }}
      >
        {glyphs[effect.kind]}
      </button>
      {started && !suspended && selected === effect.kind
        ? createPortal(
            <div className="edition-effect-status" role="status">
              <span>{active && !rendered && effect.kind !== 'camera' && effect.kind !== 'projection'
                ? 'Renderer activation pending · Stop cancels' : status}</span>
              <button type="button" aria-label="Stop experience" onClick={() => session.current?.stop()}>
                Off / Stop
              </button>
            </div>,
            document.body,
          )
        : null}
    </>
  )
}
export function EditionExperiences({ loaded, suspended }: { loaded: LoadedEdition; suspended: boolean }) {
  const [selected, onSelect] = useState<string | null>(null)
  const measure = useRef<HTMLSpanElement>(null)
  const [size, setSize] = useState({ width: 0, height: 0, left: 0, top: 0, right: 0, bottom: 0,
    nav: [] as { x: number; y: number; width: number; height: number }[] })
  useLayoutEffect(() => {
    const field = measure.current?.parentElement
    if (!field) return
    const nav = [...(field.closest('.stage')?.querySelectorAll('.site-enter-button, .about-unfurl__controls .about-unfurl__button') || [])]
    const update = () => {
      const rect = field.getBoundingClientRect()
      const next = { width: field.clientWidth, height: field.clientHeight,
        left: Math.max(0, -rect.left), top: Math.max(0, -rect.top),
        right: Math.min(field.clientWidth, window.innerWidth - rect.left),
        bottom: Math.min(field.clientHeight, window.innerHeight - rect.top),
        nav: nav.map(node => {
          const r = node.getBoundingClientRect()
          return { x: r.left - rect.left, y: r.top - rect.top, width: r.width, height: r.height }
        }).filter(r => r.width > 0 && r.height > 0) }
      setSize(previous => JSON.stringify(previous) === JSON.stringify(next) ? previous : next)
    }
    const observer = new ResizeObserver(update)
    observer.observe(field)
    nav.forEach(node => observer.observe(node))
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    update()
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [])
  // Resolve collisions AFTER edge clamping in actual plate-field pixels. Keep
  // glyphs near their artifact, with independent 44px hit areas and 4px spacing.
  const positions: { x: number; y: number }[] = []
  for (const effect of loaded.effects?.effects || []) {
    const a = loaded.artifactMap.artifacts.find((a) => a.id === effect.artifact_id)
    if (!a || !size.width || !size.height) continue
    const clampX = (x: number) => Math.max(size.left, Math.min(size.right - 44, x))
    const clampY = (y: number) => Math.max(size.top, Math.min(size.bottom - 44, y))
    const x = clampX((a.bounds.x + a.bounds.w) * size.width - 22)
    const y = clampY((a.bounds.y + a.bounds.h) * size.height - 20)
    // A nearest free rectangle lies at the preferred coordinate, a safe bound,
    // or an obstacle edge. Search those edges without a capped offset radius.
    const obstacles = [...size.nav, ...positions.map(p => ({ ...p, width: 44, height: 44 }))]
    const xs = [x, size.left, size.right - 44]
    const ys = [y, size.top, size.bottom - 44]
    for (const r of obstacles) {
      xs.push(r.x - 48, r.x + r.width + 4)
      ys.push(r.y - 48, r.y + r.height + 4)
    }
    const candidates = [...new Set(xs.map(clampX))].flatMap(x =>
      [...new Set(ys.map(clampY))].map(y => ({ x, y })))
    candidates.sort((a, b) => (a.x-x)**2 + (a.y-y)**2 - (b.x-x)**2 - (b.y-y)**2)
    const chosen = candidates.find(p => obstacles.every(r =>
      p.x + 48 <= r.x || r.x + r.width + 4 <= p.x || p.y + 48 <= r.y || r.y + r.height + 4 <= p.y))
    if (chosen) positions.push(chosen)
  }
  return (
    <>
      <span ref={measure} aria-hidden="true" style={{ display: 'none' }} />
      {loaded.effects?.effects.map((effect, index) => {
        const artifact = loaded.artifactMap.artifacts.find((a) => a.id === effect.artifact_id)
        return artifact ? (
          <Experience
            key={`${loaded.edition.edition_id}:${effect.kind}`}
            position={positions[index]}
            {...{ effect, artifact, loaded, suspended, selected, onSelect }}
          />
        ) : null
      })}
    </>
  )
}
