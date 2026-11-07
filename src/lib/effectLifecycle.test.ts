import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { EffectSession } from './effectSession'
import { createEffectRenderer } from './effectRenderer'
import type { EditionEffect } from './editionEffects.mjs'
import type { ArtifactRecord } from '../types/runtime'

// SYNTHETIC browser-platform scheduling, exercising the real session/renderer.
const deferred = <T>() => { let resolve!: (v: T) => void; let reject!: (e: Error) => void; const promise = new Promise<T>((a,b) => {resolve=a; reject=b}); return {promise,resolve,reject} }
const flush = async () => { for(let i=0;i<8;i++) await Promise.resolve() }
let sources: any[], images: any[], videos: any[], contexts: any[], gl: any, hidden: boolean
const effect = (kind: string) => ({ kind, evidence: {video:{url:'/source.webm'}} }) as EditionEffect
const session = (kind: string) => new EffectSession(effect(kind), 'room', vi.fn())
beforeEach(() => {
  vi.useFakeTimers(); sources=[]; images=[]; videos=[]; contexts=[]; hidden=false
  vi.stubGlobal('location', {hostname:'localhost',search:''})
  vi.stubGlobal('window', {addEventListener:vi.fn(),removeEventListener:vi.fn()})
  vi.stubGlobal('document', {get hidden(){return hidden}, createElement: (tag: string) => {
    if(tag !== 'video') return {}
    const play=deferred<void>(); const v={play:vi.fn(()=>play.promise),pause:vi.fn(),load:vi.fn(),removeAttribute:vi.fn(),pending:play}; videos.push(v); return v
  }})
  vi.stubGlobal('EventSource', class { onopen: any; onerror: any; onmessage: any; close=vi.fn(); constructor(){sources.push(this)} })
  vi.stubGlobal('fetch', vi.fn(async()=>({ok:true,headers:new Headers({'content-type':'application/json'}),json:async()=>({shared_endpoint:'http://localhost:45678'})})))
  vi.stubGlobal('AudioContext', class { pending=deferred<void>(); close=vi.fn(async()=>{}); resume=()=>this.pending.promise; constructor(){contexts.push(this)} })
  vi.stubGlobal('Image', class {onload:any; onerror:any; src=''; constructor(){images.push(this)} })
  gl=new Proxy({getShaderParameter:()=>true,getProgramParameter:()=>true,isContextLost:()=>false,getError:()=>0,NO_ERROR:0}, {get(t:any,p){return p in t?t[p]:(t[p]=vi.fn(()=>({})))}})
})
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals()})
async function join(s: EffectSession){ const p=s.start(); await flush(); sources[sources.length-1].onopen(); await p }
for(const failure of ['non-ok','reject']) test(`old shared POST ${failure} cannot stop replacement`,async()=>{
 const s=session('shared'); await join(s); const post=deferred<any>(); vi.mocked(fetch).mockImplementationOnce(()=>post.promise); vi.spyOn(performance,'now').mockReturnValue(1000); s.touch(.2,.4); await join(s); const before=s.snapshot(); if(failure==='reject')post.reject(Error('old'));else post.resolve({ok:false}); await flush(); expect(s.snapshot()).toEqual(before); s.stop(); vi.restoreAllMocks()
})
test('queued old SSE callbacks cannot mutate replacement',async()=>{const s=session('shared');await join(s);const old=sources[0];const error=old.onerror,message=old.onmessage;await join(s);const before=s.snapshot();message({data:'{"x":0.1,"y":0.2}'});error();await flush();expect(s.snapshot()).toEqual(before);s.stop()})
test('Stop settles pending SSE immediately and clears deadline',async()=>{const s=session('shared');let settled=false;const p=s.start().then(()=>{settled=true});await flush();s.stop();await flush();expect(settled).toBe(true);expect(vi.getTimerCount()).toBe(0);await p})
test('queued old sensor ended cannot stop replacement',async()=>{const track=()=>({stop:vi.fn(),onended:null as any});const a=track(),b=track();vi.stubGlobal('navigator',{mediaDevices:{getUserMedia:vi.fn().mockResolvedValueOnce({getTracks:()=>[a]}).mockResolvedValueOnce({getTracks:()=>[b]})}});const s=session('camera');const p=s.start();await flush();videos[0].pending.resolve();await p;const ended=a.onended;const q=s.start();await flush();videos[1].pending.resolve();await q;ended();expect(s.active).toBe(true);expect(b.stop).not.toHaveBeenCalled();s.stop()})
test('late permission stops every acquired track (existing guard)',async()=>{const d=deferred<any>();const tracks=[{stop:vi.fn()},{stop:vi.fn()}];vi.stubGlobal('navigator',{mediaDevices:{getUserMedia:()=>d.promise}});const s=session('camera');const p=s.start();s.stop();d.resolve({getTracks:()=>tracks});await p;tracks.forEach(t=>expect(t.stop).toHaveBeenCalledOnce());expect(s.active).toBe(false)})
test('hidden during play releases owned video rather than retaining it',async()=>{const s=session('projection');const p=s.start();hidden=true;videos[0].pending.resolve();await p;expect(s.video).toBeNull();expect(videos[0].pause).toHaveBeenCalled();expect(s.active).toBe(false)})
test('hidden during resume releases owned context',async()=>{const s=session('sound');const p=s.start();hidden=true;contexts[0].pending.resolve();await p;expect(contexts[0].close).toHaveBeenCalled();expect(s.active).toBe(false)})
for (const kind of ['projection','sound']) for (const result of ['resolve','reject']) test(`old ${kind} ${result} cannot change replacement or reclaim its resources`,async()=>{
 const s=session(kind); const a=s.start(); await flush(); const old=kind==='sound'?contexts[0]:videos[0]; const b=s.start(); await flush(); const current=kind==='sound'?contexts[1]:videos[1];current.pending.resolve();await b;const before=s.snapshot(); if(result==='resolve')old.pending.resolve();else old.pending.reject(Error('old'));await a;expect(s.snapshot()).toEqual(before);expect(kind==='sound'?current.close:current.pause).not.toHaveBeenCalled();s.stop()
})
test('Stop during video play cannot resurrect activation',async()=>{const s=session('projection');const p=s.start();s.stop();videos[0].pending.resolve();await p;expect(s.active).toBe(false);expect(s.video).toBeNull()})
const artifact={bounds:{x:0,y:0,w:1,h:1}} as ArtifactRecord
function renderer(){return createEffectRenderer({getContext:()=>gl} as any,'/plate.png',artifact,session('refraction'))}
for(const failure of ['image','upload','gl-error','deadline']) test(`renderer reports ${failure} as unavailable and releases resources`,async()=>{
 const r=renderer() as any; expect(r).not.toBeNull(); let result:any='pending'; r.ready?.then((v:any)=>{result=v});
 if(failure==='image')images[0].onerror?.();if(failure==='upload'){gl.texImage2D=()=>{throw Error('upload')};images[0].onload()}if(failure==='gl-error'){gl.getError=()=>1282;images[0].onload()}if(failure==='deadline')await vi.advanceTimersByTimeAsync(8000);await flush();expect(result).toBe(false);expect(gl.deleteTexture).toHaveBeenCalledOnce();r.dispose();expect(gl.deleteTexture).toHaveBeenCalledOnce()
})
test('renderer ready success and old load cannot resurrect disposed renderer',async()=>{const r=renderer() as any;const load=images[0].onload;r.dispose();load();expect(gl.texImage2D).not.toHaveBeenCalled();const next=renderer() as any;images[1].onload();expect(await next.ready).toBe(true);expect(vi.getTimerCount()).toBe(0);next.dispose()})
