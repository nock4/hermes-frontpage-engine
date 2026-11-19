'use strict';
// Six encounters with a heavy silver reliquary: pressure, depth, borrowed light,
// shared touch, a single gravitational failure, and a material instrument.
const $=s=>document.querySelector(s), canvas=$('#world'), film=$('#film');
const reduced=matchMedia('(prefers-reduced-motion: reduce)');
const S={study:0,held:false,energy:0,bass:0,treble:0,tilt:[0,0],target:[0,0],mic:false,orient:false,sound:false,joined:false,ripples:[],light:[0,0,0],samples:0,received:0,sent:0,rupture:-1,frames:0};
const titles=['Breath in silver','The weight of looking','A borrowed blue','A surface between us','One small collapse','The material remembers'];
const short=['Resonance','Depth','Cast light','Shared','Rupture','Sound'];
const hints=['Hum low to bend the whole surface in broad, heavy waves; higher notes make faster, tighter ripples. Louder notes push harder. An artistic pitch response, not a physical acoustics simulation. Microphone analysis stays on this device: no recording, upload or transcription. Or hold the surface / Space.','Move the object without touching it. Enable tilt explicitly, or drag / use arrow keys. Turn off to return it to rest.','Light sampled from actual video pixels escapes the heart. Generated motion study of this still plate — not original source video.','Touch leaves a brief impression. Local by default. Joining sends only transient anonymous coordinates to other joined viewers. No names, chat, storage or simulated visitors.','A momentary loss of gravity, then the metal finds its weight again. Trigger once; replay deliberately. Reduced motion keeps a complete still.','Touch the stone, silver and blue interior: grain, metal and ceramic. Synthesized locally, no microphone. Sound begins only when enabled.'];
let pitchData=null,pitchDiff=null,lastPitch=0,lastFrame=0,quietTime=0,lastDetectedPitch=0;
Object.assign(S,{pitchHz:0,pitchConfidence:0,rippleRate:.9,rippleDensity:5,rippleWeight:.8,ripplePhase:0,rms:0});
function resetResonance(){S.pitchHz=0;S.pitchConfidence=0;S.rippleRate=.9;S.rippleDensity=5;S.rippleWeight=.8;S.ripplePhase=0;S.rms=0;quietTime=0;lastPitch=0;lastDetectedPitch=0;pitchData=null;pitchDiff=null}
// YIN's first confident period valley avoids locking onto a louder harmonic or
// a later multiple of the fundamental. No stable period => no voiced response.
function voicedPitch(data,sampleRate){
 // 8192 samples retain several 60 Hz cycles even at 96 kHz. Decimation
 // keeps this bounded; the confidence requirement is unchanged.
 const step=4,rate=sampleRate/step,n=data.length/step,max=Math.min(Math.floor(rate/50),n>>1),min=Math.floor(rate/1400);
 let mean=0;for(let i=0;i<n;i++)mean+=data[i*step];mean/=n;
 const d=pitchDiff||(pitchDiff=new Float32Array(max+2));let sum=0;
 for(let lag=1;lag<=max;lag++){let v=0;for(let i=0;i<n-max;i++){const a=(data[i*step]-mean)-(data[(i+lag)*step]-mean);v+=a*a}sum+=v;d[lag]=sum>1e-12?v*lag/sum:1;}
 for(let lag=Math.max(2,min);lag<max-1;lag++){if(d[lag]<.12){while(lag+1<max&&d[lag+1]<d[lag])lag++;const a=d[lag-1],b=d[lag],c=d[lag+1],den=a-2*b+c,offset=Math.abs(den)>1e-9?.5*(a-c)/den:0;return {hz:rate/(lag+Math.max(-.5,Math.min(.5,offset))),confidence:1-b}}}
 return {hz:0,confidence:0};
}
function resonance(dt,ms){
 if(S.mic&&analyser){
  pitchData ||= new Float32Array(analyser.fftSize);analyser.getFloatTimeDomainData(pitchData);let power=0;for(const v of pitchData)power+=v*v;S.rms=Math.sqrt(power/pitchData.length);
  if(ms-lastPitch>=40){lastPitch=ms;const p=S.rms>.006?voicedPitch(pitchData,micCtx.sampleRate):{hz:0,confidence:0};S.pitchConfidence=p.confidence;lastDetectedPitch=p.hz;if(p.hz){S.pitchHz=S.pitchHz?Math.exp(Math.log(S.pitchHz)+(Math.log(p.hz)-Math.log(S.pitchHz))*.35):p.hz;quietTime=0}}
  const confident=S.pitchConfidence>.88&&S.rms>.006;quietTime=confident?0:quietTime+dt;
  // A held voice is a continuous driver, not a series of confident onsets.
  // Brief breath/period ambiguity spans several 40ms checks (and the 8192
  // sample window). Keep its pitch/envelope for at most 280ms, only above
  // the loudness floor. Silence releases immediately; noise cannot renew it.
  const voiced=confident||(quietTime<=.28&&S.pitchHz>0&&S.rms>.006);
  if(!voiced){S.pitchHz*=Math.exp(-dt*10);if(quietTime>.45)S.pitchHz=0}
  const note=voiced?Math.max(0,Math.min(1,Math.log2(S.pitchHz/60)/Math.log2(1400/60))):0;
  // Only bass owns broad displacement. Use the latest confident period for
  // this safety envelope, not the lagging display/cadence pitch: low -> high
  // must not carry the heavy bass tail. Smoothstep keeps the pitch cutoff soft.
  const cutoff=Math.max(0,Math.min(1,(Math.max(S.pitchHz,lastDetectedPitch)-220)/220));
  const weight=1-cutoff*cutoff*(3-2*cutoff);
  const density=S.pitchHz<=220?2.2+Math.max(0,S.pitchHz-60)/160*2.8:5+Math.pow(Math.min(1,(S.pitchHz-220)/1180),.7)*65;
  const ease=1-Math.exp(-dt*9);S.rippleRate+=((voiced?.5+note*3.3:.5)-S.rippleRate)*ease;
  // Release fades the current instrument; it must not morph tight high ripples
  // into the broad bass defaults while there is still visible energy.
  if(voiced){S.rippleDensity+=(density-S.rippleDensity)*ease;S.rippleWeight+=(weight-S.rippleWeight)*ease;S.rippleWeight=Math.min(S.rippleWeight,weight)}
  // A soft loudness curve gives quiet voiced input body without auto-motion.
  // Pitch additionally owns the displacement envelope: bass is intentionally heavy.
  S.energy+=((voiced?1-Math.exp(-Math.max(0,S.rms-.006)*22):0)-S.energy)*(1-Math.exp(-dt*(voiced?12:7)));
  // Retained spectrum diagnostics; deliberately not used for ripple cadence/amplitude.
  const f=new Uint8Array(analyser.frequencyBinCount);analyser.getByteFrequencyData(f);const bins=hz=>Math.ceil(hz*analyser.fftSize/micCtx.sampleRate),low=f.slice(0,bins(250)),high=f.slice(bins(1000),bins(2500));S.bass=low.reduce((a,v)=>a+v,0)/(low.length*255);S.treble=high.reduce((a,v)=>a+v,0)/(high.length*255);
 }else{S.energy+=(Number(S.held)*.85-S.energy)*.12;S.rippleRate=.9;S.rippleDensity=5;S.rippleWeight=.8}
 S.ripplePhase=(S.ripplePhase+dt*S.rippleRate*Math.PI*2)%(Math.PI*2);
}
let epoch=0,stream=null,micCtx=null,analyser=null,micSource=null,es=null,soundCtx=null,master=null,compressor=null,soundAnalyser=null,voices=new Set(),lastSend=0,lastTone=0,pointer=false,raf=0;
function status(t){$('#status').textContent=t}
function button(label,fn){const b=document.createElement('button');b.textContent=label;b.onclick=fn;$('#actions').append(b);return b}
function off(){if(document.body.classList.contains('immersed'))$('#immerse').textContent='Show labels / exit';epoch++;S.held=false;pointer=false;S.mic=false;resetResonance();stream?.getTracks().forEach(t=>t.stop());stream=null;micSource?.disconnect();micSource=null;analyser=null;micCtx?.close().catch(()=>{});micCtx=null;S.orient=false;window.removeEventListener('deviceorientation',orientation);S.target=[0,0];S.tilt=[0,0];leave();S.sound=false;voices.forEach(v=>{try{v.stop()}catch{}});voices.clear();soundCtx?.close().catch(()=>{});soundCtx=null;master=null;soundAnalyser=null;film.pause();S.energy=0;S.bass=0;S.treble=0;S.ripples=[];}
function select(n){off();S.study=n;S.rupture=-1;$('#eyebrow').textContent=`ENCOUNTER 0${n+1} / 06`; $('h1').textContent=titles[n];$('#hint').textContent=hints[n];$('#actions').replaceChildren();document.querySelectorAll('nav button').forEach((b,i)=>b.setAttribute('aria-current',i===n));status('Local interaction · sensors off');
if(n===0){button('Enable microphone',microphone);button('Microphone off',()=>{off();status('Microphone off · hold surface / Space')})}
if(n===1){button('Enable tilt',tilt);button('Tilt off',()=>{off();status('Tilt off · drag available')})}
if(n===2){button('Play light',async()=>{try{await film.play();status('Playing · actual frame-pixel light')}catch{status('Playback unavailable · open native media')}});button('Pause',()=>{film.pause();status('Paused · frozen frame light')});status('Video paused · no generated-time light')}
if(n===3){button('Join shared surface',join);button('Leave',()=>{leave();status('Off · local touch only')});status('Off · local touch only')}
if(n===4){button('Release / replay',rupture);status(reduced.matches?'Reduced motion · settled still':'Settled · waiting for your release')}
if(n===5){button('Enable sound',sound);button('Sound off',()=>{off();status('Sound off · touch remains silent')});status('Sound off · no autoplay')}
location.replace('#'+(n+1));}
short.forEach((name,i)=>{const b=document.createElement('button');b.textContent=`0${i+1} ${name}`;b.onclick=()=>select(i);$('nav').append(b)});
async function microphone(){if(S.mic||micCtx)return;const token=++epoch;status('Microphone permission pending · Off cancels activation');try{if(!navigator.mediaDevices?.getUserMedia)throw Error('unavailable');const acquired=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false},video:false});if(token!==epoch||S.study!==0||document.hidden){acquired.getTracks().forEach(t=>t.stop());return}stream=acquired;micCtx=new AudioContext();await micCtx.resume();if(token!==epoch)return;analyser=micCtx.createAnalyser();analyser.fftSize=8192;analyser.smoothingTimeConstant=0;micSource=micCtx.createMediaStreamSource(stream);micSource.connect(analyser);S.mic=true;status('MIC ON · local analysis only · Microphone off to stop');}catch(e){if(token===epoch){off();status('Microphone denied / unavailable · hold surface / Space')}}}
function orientation(e){if(!S.orient)return;if(!Number.isFinite(e.gamma)||!Number.isFinite(e.beta))return;S.target=[Math.max(-1,Math.min(1,e.gamma/35)),Math.max(-1,Math.min(1,(e.beta-35)/40))]}
async function tilt(){const token=++epoch;try{if(!window.DeviceOrientationEvent)throw Error();if(typeof DeviceOrientationEvent.requestPermission==='function'){status('Tilt permission pending');if(await DeviceOrientationEvent.requestPermission()!=='granted')throw Error()}if(token!==epoch||S.study!==1||document.hidden)return;S.orient=true;window.addEventListener('deviceorientation',orientation);status('Tilt on · movement stays local · Tilt off to stop')}catch{if(token===epoch){S.orient=false;status('Tilt denied / unavailable · drag or arrows')}}}
function leave(){es?.close();es=null;S.joined=false;S.ripples=[]}
function join(){if(es)return;status('Connecting · ephemeral coordinates only');const source=new WebSocket((location.protocol==='https:'?'wss:':'ws:')+'//'+location.host+'/surface');es=source;source.onopen=()=>{if(es!==source)return;S.joined=true;status('Connected · shared touch on · Leave stops network')};source.onmessage=e=>{if(!S.joined)return;try{const d=JSON.parse(e.data);if(Number.isFinite(d.x)&&Number.isFinite(d.y)){S.received++;ripple(d.x,d.y)}}catch{}};source.onclose=source.onerror=()=>{if(es!==source)return;leave();status('Disconnected · local only · Join to reconnect')}}
function ripple(x,y){S.ripples.push({x,y,t:performance.now()/1000});if(S.ripples.length>12)S.ripples.shift()}
function touch(x,y){if(S.study===3){ripple(x,y);if(S.joined&&performance.now()-lastSend>100){lastSend=performance.now();fetch('/ripple',{method:'POST',headers:{'Content-Type':'application/json','X-Surface':'touch'},body:JSON.stringify({x,y})}).then(r=>{if(r.ok)S.sent++}).catch(()=>{leave();status('Disconnected · local only')})}}if(S.study===4)rupture();if(S.study===5)tone(x,y)}
function rupture(){S.rupture=reduced.matches?-1:performance.now()/1000;status(reduced.matches?'Reduced motion · complete still':'Released · settling once')}
async function sound(){if(soundCtx)return;const token=epoch;try{const ctx=new AudioContext();soundCtx=ctx;await ctx.resume();if(token!==epoch||S.study!==5||document.hidden){ctx.close().catch(()=>{});return}master=ctx.createGain();master.gain.value=.16;compressor=ctx.createDynamicsCompressor();compressor.threshold.value=-20;compressor.knee.value=10;compressor.ratio.value=12;soundAnalyser=ctx.createAnalyser();master.connect(compressor);compressor.connect(soundAnalyser);soundAnalyser.connect(ctx.destination);S.sound=true;status('SOUND ON · stone / silver / ceramic · Sound off to stop')}catch{off();status('Sound unavailable · silent touch')}}
function tone(x,y){if(!S.sound||!soundCtx||performance.now()-lastTone<65)return;lastTone=performance.now();const region=x<.4?0:(y<.55?1:2),ctx=soundCtx,t=ctx.currentTime;const f=[180,920,430][region]*(.85+y*.3);[1,region===1?2.76:1.51,region===0?4.1:3.94].forEach((m,i)=>{const o=ctx.createOscillator(),g=ctx.createGain();o.type=region===0?'triangle':'sine';o.frequency.setValueAtTime(f*m,t);o.frequency.exponentialRampToValueAtTime(f*m*.94,t+.7);g.gain.setValueAtTime(0,t);g.gain.linearRampToValueAtTime(.35/(i+1),t+.008);g.gain.exponentialRampToValueAtTime(.0001,t+(region===1?1.3:.7));o.connect(g);g.connect(master);voices.add(o);o.onended=()=>{voices.delete(o);o.disconnect();g.disconnect()};o.start();o.stop(t+1.4)});ripple(x,y);S.energy=.6;status(['Stone · dry grain','Silver · inharmonic ring','Ceramic · hollow resonance'][region]+' · SOUND ON')}
canvas.onpointerdown=e=>{canvas.focus();pointer=true;canvas.setPointerCapture(e.pointerId);S.held=true;touch(e.clientX/innerWidth,e.clientY/innerHeight)};
canvas.onpointermove=e=>{if(!pointer)return;const x=e.clientX/innerWidth,y=e.clientY/innerHeight;if(S.study===1)S.target=[(x-.5)*2,(y-.5)*2];if(S.study===3||S.study===5)touch(x,y)};
canvas.onpointerup=canvas.onpointercancel=()=>{pointer=false;S.held=false};
canvas.onkeydown=e=>{if(e.code==='Space'){e.preventDefault();S.held=true}if(e.key==='Enter'){e.preventDefault();touch(.7,.55)}if(e.key.startsWith('Arrow')){e.preventDefault();S.target=[Math.max(-1,Math.min(1,S.target[0]+(e.key==='ArrowRight'?.2:e.key==='ArrowLeft'?-.2:0))),Math.max(-1,Math.min(1,S.target[1]+(e.key==='ArrowDown'?.2:e.key==='ArrowUp'?-.2:0)))]}};canvas.onkeyup=e=>{if(e.code==='Space')S.held=false};canvas.onblur=()=>S.held=false;
$('#immerse').onclick=()=>{const b=document.body.classList.toggle('immersed');if(!b&&(S.mic||S.sound||S.orient||S.joined)){off();status('Inputs off · re-enable explicitly')}$('#immerse').textContent=b?'Show labels / exit':'Hide labels';if(b&&S.mic)$('#immerse').textContent='MIC ON · exit / off';if(b&&S.sound)$('#immerse').textContent='SOUND ON · exit / off'};
$('#mediaOpen').onclick=()=>$('#media').showModal();$('#media').onclose=()=>{if(S.study!==2)film.pause()};document.addEventListener('keydown',e=>{if(e.key==='Escape'&&document.body.classList.contains('immersed')){document.body.classList.remove('immersed');off();$('#immerse').textContent='Hide labels';status('Inputs off · re-enable explicitly')}});
document.addEventListener('visibilitychange',()=>{if(document.hidden){off();cancelAnimationFrame(raf);status('Paused / inputs off · re-enable explicitly')}else{raf=requestAnimationFrame(draw);status('Returned · inputs off · re-enable explicitly')}});window.addEventListener('offline',()=>{if(es){leave();status('Disconnected · local only · Join to reconnect')}});window.addEventListener('pagehide',off);
const sample=document.createElement('canvas');sample.width=12;sample.height=8;const sc=sample.getContext('2d',{willReadFrequently:true});let sampledTime=-1;
function videoLight(){if(film.readyState<2||film.currentTime===sampledTime)return;sampledTime=film.currentTime;sc.drawImage(film,0,0,12,8);const d=sc.getImageData(0,0,12,8).data;let r=0,g=0,b=0;for(let y=1;y<7;y++)for(let x=5;x<11;x++){const i=(y*12+x)*4;r+=d[i];g+=d[i+1];b+=d[i+2]}S.light=[r/9180,g/9180,b/9180];S.samples++}
const gl=canvas.getContext('webgl',{alpha:false,preserveDrawingBuffer:true});let program,tex,ready=false;
const fragment=`precision highp float;uniform sampler2D plate;uniform vec2 res,tilt;uniform float mode,energy,bass,treble,clock,collapse,reduce,ripplePhase,rippleDensity,rippleWeight;uniform vec3 light;uniform vec3 ripples[12];varying vec2 uv;
vec2 crop(vec2 q){float a=res.x/res.y;float ia=1.5;vec2 scale=a>ia?vec2(1.,ia/a):vec2(a/ia,1.);return (q-.5)*scale+vec2(min(.71,1.-scale.x*.5),.5);}
void main(){vec2 p=crop(vec2(uv.x,1.-uv.y));p.x=clamp(p.x,.002,.998);vec3 original=texture2D(plate,p).rgb;float blue=smoothstep(.05,.25,original.b-original.r)*smoothstep(.02,.15,original.b-original.g);float metal=(1.-blue)*smoothstep(.32,.7,dot(original,vec3(.333)))*smoothstep(.35,.5,p.x);vec2 q=p;float shine=0.;
if(mode<.5){vec2 radial=(p-vec2(.70,.49))*vec2(1.,1.15);float dist=length(radial);float wave=sin(dist*rippleDensity*6.283185-ripplePhase);float reach=1.-smoothstep(.28,.78,dist);float edge=smoothstep(.0,.10,p.x)*smoothstep(.0,.10,1.-p.x)*smoothstep(.0,.10,p.y)*smoothstep(.0,.10,1.-p.y);float material=mix(blue+metal*.35,reach*.88,rippleWeight);q+=radial/max(.09,dist)*wave*mix(.0024,.075,rippleWeight)*energy*material*edge*(1.-reduce);shine=energy*metal*.1;}
if(mode>.5&&mode<1.5){q+=tilt*.022*(blue*1.7+metal*.35)*(1.-reduce);shine=metal*(tilt.x*(p.x-.6)+tilt.y*(p.y-.5))*.5;}
if(mode>3.5&&mode<4.5){float seam=smoothstep(.63,.65,p.x);float w=collapse*(1.-reduce);q.x+=(seam-.5)*w*.08;q.y+=w*.07*seam;shine=metal*w*.4;}
if(mode>2.5&&mode<3.5||mode>4.5){for(int i=0;i<12;i++){vec3 ri=ripples[i];float age=clock-ri.z;float dist=length((uv-ri.xy)*vec2(res.x/res.y,1.));float ring=exp(-pow((dist-age*.22)*80.,2.))*max(0.,1.-age/2.4)*step(0.,age);q+=normalize(p-vec2(.68,.5)+.001)*ring*.007*(1.-reduce);shine+=ring*.13*(metal+.35);}}
vec3 color=texture2D(plate,clamp(q,.001,.999)).rgb+shine;
if(mode>1.5&&mode<2.5){float spread=exp(-length((p-vec2(.72,.48))*vec2(1.,1.2))*7.);color+=light*spread*.65*(1.-blue*.75);color+=light*metal*.1;}
if(mode>.5&&mode<1.5){float reflection=pow(max(0.,1.-abs(p.x+p.y*.4-.93-tilt.x*.12)*12.),8.);color+=reflection*metal*.2*length(tilt);}
gl_FragColor=vec4(color,1.);}`;
if(gl){try{const shader=(type,source)=>{const s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));return s};program=gl.createProgram();gl.attachShader(program,shader(gl.VERTEX_SHADER,'attribute vec2 pos;varying vec2 uv;void main(){uv=(pos+1.)*.5;gl_Position=vec4(pos,0.,1.);}'));gl.attachShader(program,shader(gl.FRAGMENT_SHADER,fragment));gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(program));gl.useProgram(program);const buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]),gl.STATIC_DRAW);const a=gl.getAttribLocation(program,'pos');gl.enableVertexAttribArray(a);gl.vertexAttribPointer(a,2,gl.FLOAT,false,0,0);tex=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,tex);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);const image=new Image();image.onload=()=>{gl.texImage2D(gl.TEXTURE_2D,0,gl.RGB,gl.RGB,gl.UNSIGNED_BYTE,image);ready=true};image.src='assets/plate.jpg'}catch(e){status('Still-image fallback · renderer unavailable');console.warn(e.message)}}
function draw(ms){const now=ms/1000,dt=Math.min(.05,Math.max(0,(ms-lastFrame)/1000));lastFrame=ms;S.frames++;if(S.study===0)resonance(dt,ms);else S.energy*=.96;
S.tilt=S.tilt.map((v,i)=>v+(S.target[i]-v)*.09);if(S.study===2)videoLight();S.ripples=S.ripples.filter(r=>now-r.t<2.4);let collapse=0;if(S.rupture>=0){const t=now-S.rupture;if(t<3.8)collapse=t<.75?Math.pow(t/.75,2):Math.exp(-(t-.75)*2.1)*Math.cos((t-.75)*7);else{S.rupture=-1;status('Settled · replay is manual')}}
if(ready){const dpr=Math.min(devicePixelRatio,1.5);const w=Math.round(innerWidth*dpr),h=Math.round(innerHeight*dpr);if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;gl.viewport(0,0,w,h)}const u=n=>gl.getUniformLocation(program,n);gl.uniform2f(u('res'),w,h);gl.uniform2fv(u('tilt'),S.tilt);gl.uniform1f(u('mode'),S.study);gl.uniform1f(u('energy'),S.energy);gl.uniform1f(u('bass'),S.bass);gl.uniform1f(u('treble'),S.treble);gl.uniform1f(u('clock'),now);gl.uniform1f(u('ripplePhase'),S.ripplePhase);gl.uniform1f(u('rippleDensity'),S.rippleDensity);gl.uniform1f(u('rippleWeight'),S.rippleWeight);gl.uniform1f(u('collapse'),collapse);gl.uniform1f(u('reduce'),Number(reduced.matches));gl.uniform3fv(u('light'),S.light);const rr=new Float32Array(36).fill(-100);S.ripples.forEach((r,i)=>rr.set([r.x,1-r.y,r.t],i*3));gl.uniform3fv(u('ripples[0]'),rr);gl.drawArrays(gl.TRIANGLES,0,6)}raf=requestAnimationFrame(draw)}
window.encounters={state:S,select,get ready(){return ready},get audio(){return {micContext:micCtx?.state,context:soundCtx?.state,master:master?.gain.value,voices:voices.size}},wave(){if(!soundAnalyser)return [];const a=new Float32Array(128);soundAnalyser.getFloatTimeDomainData(a);return Array.from(a)},pixel(){if(!gl)return [];const a=new Uint8Array(4);gl.readPixels(Math.floor(canvas.width*.7),Math.floor(canvas.height*.5),1,1,gl.RGBA,gl.UNSIGNED_BYTE,a);return Array.from(a)}};
select(Math.max(0,Math.min(5,(Number(location.hash.slice(1))||1)-1)));raf=requestAnimationFrame(draw);

// Opt-in review diagnostics. Read-only observer of the existing production graph.
// No sensors, waveform reads, recording, persistence, or network operations here.
(()=>{
 const buildID='encounters-signal-20261103-1',executingScript=document.currentScript?.src||'unknown';
 const panel=document.createElement('dialog');panel.id='signalCheck';panel.setAttribute('aria-labelledby','signalTitle');
 panel.innerHTML='<div class="signal-head"><strong id="signalTitle">Signal check</strong><button id="signalClose" aria-label="Close signal check">Close ×</button></div><p class="signal-note">Local numerical diagnostics only. No recording, transcription, upload or saved microphone data. Enable microphone yourself first; this panel never requests or restarts it.</p><pre id="signalLive"></pre><div class="signal-controls"><button id="signalMeasure">Measure 5 seconds</button><button id="signalCopy">Copy diagnostics</button></div><p id="signalMessage" role="status" aria-live="polite">Not measuring.</p><label for="signalText">Readable report / selectable copy fallback</label><textarea id="signalText" readonly spellcheck="false"></textarea>';
 document.body.append(panel);
 const live=panel.querySelector('#signalLive'),text=panel.querySelector('#signalText'),message=panel.querySelector('#signalMessage'),measure=panel.querySelector('#signalMeasure');
 let timer=0,run=null,previous=null,peak=0,lastSnapshot=null;
 const num=(v,d=4)=>Number.isFinite(v)?Number(v.toFixed(d)):null;
 function snapshot(){
  const now=performance.now(),ctx=micCtx,tracks=stream?.getAudioTracks()||[];
  const track=tracks.map(t=>{const s=t.getSettings();return {state:t.readyState,muted:t.muted,enabled:t.enabled,settings:Object.fromEntries(['sampleRate','sampleSize','channelCount','latency','echoCancellation','noiseSuppression','autoGainControl'].filter(k=>k in s).map(k=>[k,s[k]]))}});
  const time=ctx?.currentTime??null,same=previous?.ctx===ctx,delta=same&&time!==null?time-previous.time:null,frames=previous?S.frames-previous.frames:null;
  const confident=S.pitchConfidence>.88&&S.rms>.006,hold=!confident&&quietTime<=.28&&S.pitchHz>0&&S.rms>.006;
  let capture='not enabled';
  if(S.mic){capture=!ctx||!analyser||!micSource?'graph incomplete':!track.length?'no audio track':track.some(t=>t.state!=='live')?'track ended':track.some(t=>!t.enabled)?'track disabled':track.some(t=>t.muted)?'track muted':ctx.state!=='running'?'context '+ctx.state:delta===null?'checking clock':delta<=0?'clock not advancing':'live graph / clock advancing (not proof of voice)'}
  peak=Math.max(peak,S.rms);
  const s={buildID,executingScript,browser:navigator.userAgent,secureContext:isSecureContext,visibility:document.visibilityState,micEnabledFlag:S.mic,capture,context:{state:ctx?.state||'absent',currentTime:num(time),advanceSeconds:num(delta),sampleRate:ctx?.sampleRate??null},tracks:track,rmsCurrent:num(S.rms,6),rmsPeakSinceOpen:num(peak,6),pitchDetectedHz:num(lastDetectedPitch,2),pitchSmoothedHz:num(S.pitchHz,2),confidence:num(S.pitchConfidence),gate:!S.mic||!analyser?'inactive':confident?'confident voiced':hold?'bounded hold':S.rms<=.006?'rejected: RMS floor':'rejected: no confident period',quietSeconds:num(quietTime),holdLimitSeconds:.28,effectEnergy:num(S.energy),webglReady:!!gl&&ready&&!gl.isContextLost(),reducedMotion:reduced.matches,frames:S.frames,frameAdvance:frames,frameAdvancing:frames===null?null:frames>0};
  previous={ctx,time,frames:S.frames,now};return s;
 }
 function readable(s){return `Build: ${s.buildID}\nExecuting: ${s.executingScript}\nBrowser: ${s.browser}\nSecure: ${s.secureContext} · visibility: ${s.visibility}\nCapture: ${s.capture} · mic flag: ${s.micEnabledFlag}\nAudioContext: ${s.context.state} · time ${s.context.currentTime} · advance ${s.context.advanceSeconds} s · ${s.context.sampleRate} Hz\nTracks: ${JSON.stringify(s.tracks)}\nRMS current: ${s.rmsCurrent} · peak RMS since open: ${s.rmsPeakSinceOpen}\nPitch detected: ${s.pitchDetectedHz} Hz · smoothed: ${s.pitchSmoothedHz} Hz · confidence: ${s.confidence}\nGate: ${s.gate} · quiet ${s.quietSeconds} s · hold limit ${s.holdLimitSeconds} s\nEffect energy: ${s.effectEnergy}\nWebGL ready: ${s.webglReady} · reduced motion: ${s.reducedMotion}\nFrames: ${s.frames} · advance: ${s.frameAdvance} · advancing: ${s.frameAdvancing}`}
 function finish(cancelled=false){
  if(!run)return;
  const r=run;run=null;measure.disabled=false;
  const samples=r.samples,values=k=>samples.map(s=>s[k]),range=k=>{const a=values(k);return `${num(Math.min(...a),6)} – ${num(Math.max(...a),6)}`};
  const elapsed=(performance.now()-r.start)/1000;
  text.value=`${cancelled?'CANCELLED / partial':'5-second measurement complete'}\nElapsed: ${elapsed.toFixed(3)} seconds · ${samples.length} numerical samples\nRMS range: ${range('rmsCurrent')}\nDetected pitch range (Hz): ${range('pitchDetectedHz')}\nConfidence range: ${range('confidence')}\nEffect energy range: ${range('effectEnergy')}\nCapture states: ${[...new Set(values('capture'))].join('; ')}\nGate states: ${[...new Set(values('gate'))].join('; ')}\nReduced motion observed: ${values('reducedMotion').some(Boolean)}\n\nFinal snapshot:\n${readable(samples.at(-1))}\n\nNo raw audio/waveform collected; memory-only report. Synthetic tests do not establish physical microphone acceptance.`;
  message.textContent=cancelled?'Measurement cancelled; partial report only.':'Measurement complete. Copy diagnostics or select the report below.';
 }
 function tick(){if(!panel.open)return;lastSnapshot=snapshot();live.textContent=readable(lastSnapshot);if(run){run.samples.push(lastSnapshot);message.textContent=`Measuring numerical diagnostics: ${Math.min(5,(performance.now()-run.start)/1000).toFixed(1)} / 5 seconds · ${run.samples.length} samples`;if(performance.now()-run.start>=5000)finish()}}
 function close(){finish(true);clearInterval(timer);timer=0;panel.close();document.querySelector('#signalOpen')?.focus()}
 function open(){if(S.study!==0)return;previous=null;peak=0;panel.show();tick();clearInterval(timer);timer=setInterval(tick,250);panel.querySelector('#signalClose').focus()}
 panel.querySelector('#signalClose').onclick=close;panel.addEventListener('cancel',e=>{e.preventDefault();close()});panel.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();close()}});
 measure.onclick=()=>{if(run)return;if(!S.mic||!micCtx||!analyser||!stream){message.textContent='Enable microphone manually first. No sensor request was made.';return}run={start:performance.now(),samples:[]};measure.disabled=true;text.value='';tick()};
 panel.querySelector('#signalCopy').onclick=async()=>{if(!text.value)text.value=readable(lastSnapshot||snapshot());try{await navigator.clipboard.writeText(text.value);message.textContent='Diagnostics copied.'}catch{message.textContent='Clipboard unavailable. Report selected: press Ctrl/Cmd+C or copy manually.';text.focus();text.select()}};
 function entry(){if(S.study!==0){if(panel.open)close();return}if(!document.querySelector('#signalOpen')){const b=button('Signal check',open);b.id='signalOpen'}}
 new MutationObserver(entry).observe(document.querySelector('#actions'),{childList:true});entry();
 // Query links identify the opt-in entry, but never auto-open or auto-measure.
})();
