import type { ArtifactRecord } from '../types/runtime'
import { EffectSession } from './effectSession'

// Transparent full-coordinate overlay: original plate and DOM hit territories
// never transform. The polygon is the actual visible mask, not the hover mesh.
export function createEffectRenderer(
  canvas: HTMLCanvasElement,
  plateUrl: string,
  artifact: ArtifactRecord,
  session: EffectSession,
) {
  const gl = canvas.getContext('webgl', {
    alpha: true,
    antialias: false,
    preserveDrawingBuffer: new URLSearchParams(location.search).has('qaEffects'),
  })
  if (!gl) return null
  const shader = (type: number, text: string) => {
    const s = gl.createShader(type)!
    gl.shaderSource(s, text)
    gl.compileShader(s)
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      gl.deleteShader(s)
      throw Error('effect shader unavailable')
    }
    return s
  }
  let program: WebGLProgram | null = null,
    texture: WebGLTexture | null = null,
    buffer: WebGLBuffer | null = null,
    ready = false,
    disposed = false
  const shaders: WebGLShader[] = []
  let settle!: (ready: boolean) => void
  const readiness = new Promise<boolean>((resolve) => { settle = resolve })
  let image: HTMLImageElement | null = null
  const dispose = () => {
    if (disposed) return
    disposed = true
    clearTimeout(deadline)
    settle(false)
    if (image) { image.onload = null; image.onerror = null }
    gl.deleteTexture(texture)
    gl.deleteBuffer(buffer)
    gl.deleteProgram(program)
    shaders.forEach((s) => gl.deleteShader(s))
  }
  const deadline = setTimeout(dispose, 5000)
  try {
    shaders.push(
      shader(
        gl.VERTEX_SHADER,
        'attribute vec2 p;varying vec2 uv;void main(){uv=vec2((p.x+1.)*.5,(1.-p.y)*.5);gl_Position=vec4(p,0.,1.);}',
      ),
    )
    shaders.push(
      shader(
        gl.FRAGMENT_SHADER,
        `precision highp float;varying vec2 uv;uniform sampler2D plate;uniform vec2 center,pointer,tilt;uniform float energy,phase,density,weight,mode,collapse;uniform vec3 light;
  void main(){vec2 r=uv-center;float dist=length(r),edge=smoothstep(0.,.04,uv.x)*smoothstep(0.,.04,1.-uv.x)*smoothstep(0.,.04,uv.y)*smoothstep(0.,.04,1.-uv.y);vec2 q=uv;float shine=0.;
  if(mode<.5){vec2 local=uv-pointer;float reach=exp(-length(local)*12.);q+=vec2(sin(local.y*90.+phase),cos(local.x*70.-phase))*.018*energy*reach*edge;shine=reach*energy*.06;}
  if(mode>2.5&&mode<3.5){float wave=sin(dist*density*6.283185-phase);q+=r/max(.09,dist)*wave*mix(.0024,.075,weight)*energy*edge;}
  if(mode>3.5&&mode<4.5){q+=tilt*.012*edge;shine=dot(r,tilt)*.14;}
  if(mode>5.5&&mode<6.5||mode>7.5){float ring=sin(length(uv-pointer)*45.-phase)*exp(-length(uv-pointer)*5.);q+=normalize(r+.001)*ring*.009*energy*edge;shine=ring*energy*.09;}
  if(mode>6.5&&mode<7.5){q+=vec2(sign(r.x)*.035,.04)*collapse*edge;}
  vec3 color=texture2D(plate,clamp(q,.001,.999)).rgb+shine;
  if(mode>4.5&&mode<5.5)color+=light*exp(-dist*5.)*.6;
  gl_FragColor=vec4(color,1.);}`,
      ),
    )
    program = gl.createProgram()!
    for (const s of shaders) gl.attachShader(program, s)
    gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw Error('effect program unavailable')
    gl.useProgram(program)
    buffer = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW,
    )
    const attr = gl.getAttribLocation(program, 'p')
    gl.enableVertexAttribArray(attr)
    gl.vertexAttribPointer(attr, 2, gl.FLOAT, false, 0, 0)
    texture = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    image = new Image()
    image.onload = () => {
      if (disposed) return
      try {
        gl.bindTexture(gl.TEXTURE_2D, texture)
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image!)
        if (gl.isContextLost() || gl.getError() !== gl.NO_ERROR) throw Error('effect texture unavailable')
        ready = true
        clearTimeout(deadline)
        settle(true)
      } catch {
        dispose()
      }
    }
    image.onerror = dispose
    image.src = plateUrl
    const names = [
      'center',
      'pointer',
      'tilt',
      'energy',
      'phase',
      'density',
      'weight',
      'mode',
      'collapse',
      'light',
    ]
    const locations = Object.fromEntries(names.map((n) => [n, gl.getUniformLocation(program!, n)]))
    const modes = [
      'refraction',
      'projection',
      'camera',
      'resonance',
      'depth',
      'castlight',
      'shared',
      'rupture',
      'sound',
    ]
    return {
      ready: readiness,
      draw(ms: number) {
        if (disposed || !ready || gl.isContextLost()) return false
        const rect = canvas.getBoundingClientRect(),
          scale = Math.min(devicePixelRatio, 1.5, 1600 / Math.max(rect.width, rect.height)),
          w = Math.max(1, Math.round(rect.width * scale)),
          h = Math.max(1, Math.round(rect.height * scale))
        if (canvas.width !== w || canvas.height !== h) {
          canvas.width = w
          canvas.height = h
          gl.viewport(0, 0, w, h)
        }
        gl.useProgram(program)
        gl.bindTexture(gl.TEXTURE_2D, texture)
        const e = session.envelope,
          age = ms / 1000 - session.ruptureAt,
          collapse =
            session.ruptureAt >= 0 && age < 3.8
              ? age < 0.75
                ? (age / 0.75) ** 2
                : Math.exp(-(age - 0.75) * 2.1) * Math.cos((age - 0.75) * 7)
              : 0
        gl.uniform2f(
          locations.center,
          artifact.bounds.x + artifact.bounds.w / 2,
          artifact.bounds.y + artifact.bounds.h / 2,
        )
        gl.uniform2fv(locations.pointer, session.pointer)
        gl.uniform2fv(locations.tilt, session.tilt)
        gl.uniform1f(locations.energy, e.energy)
        gl.uniform1f(locations.phase, e.phase)
        gl.uniform1f(locations.density, e.density)
        gl.uniform1f(locations.weight, e.weight)
        gl.uniform1f(locations.mode, modes.indexOf(session.effect.kind))
        gl.uniform1f(locations.collapse, collapse)
        gl.uniform3fv(locations.light, session.light)
        gl.drawArrays(gl.TRIANGLES, 0, 6)
        return true
      },
      dispose,
    }
  } catch {
    dispose()
    return null
  }
}
