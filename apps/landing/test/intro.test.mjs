import test from 'node:test';
import assert from 'node:assert/strict';
import {createIntroController,introFrame} from '../src/intro-controller.ts';
import {introDelivery,selectIntroMedia,validProductionMedia} from '../src/intro-media.ts';
const media={kind:'production',src:'/intro/desktop.mp4',poster:'/intro/desktop.jpg',sha256:'a'.repeat(64),bytes:100,width:1920,height:1080,duration:23,logoAt:20,revealAt:22.2,audio:'embedded'};
function fixture(selectedMedia=media) {
  let now=0,id=0;const rafs=new Map(),timers=new Map();
  const clock={now:()=>now,request:fn=>{rafs.set(++id,fn);return id;},cancel:id=>rafs.delete(id),after:(fn,ms)=>{timers.set(++id,{at:now+ms,fn});return id;},clear:id=>timers.delete(id)};
  class Video extends EventTarget {currentTime=0;duration=23;videoWidth=1920;videoHeight=1080;readyState=2;paused=true;ended=false;muted=true;volume=0;plays=0;pauses=0;async play(){this.plays++;this.paused=false;}pause(){this.pauses++;this.paused=true;}}
  class Visibility extends EventTarget{hidden=false;}
  const video=new Video(),visibility=new Visibility(),frames=[],statuses=[],exits=[],entries=[];video.duration=selectedMedia.duration;
  const callbacks={frame:f=>frames.push(f),status:s=>statuses.push(s),entry:e=>entries.push(e),exit:r=>exits.push(r)};
  const controller=createIntroController(video,visibility,selectedMedia,clock,callbacks);
  return {video,visibility,frames,statuses,exits,entries,controller,clock,callbacks,advance(ms,time=video.currentTime){now+=ms;video.currentTime=time;const next=[...rafs.values()];rafs.clear();next.forEach(fn=>fn());for(const [id,timer] of [...timers])if(timer.at<=now){timers.delete(id);timer.fn();}},pending:()=>rafs.size+timers.size};
}
test('revised production stays gated and requires matching 10–15-second native timelines',()=>{
  assert.equal(selectIntroMedia(false,false),null);assert.equal(selectIntroMedia(false,true),null);
  const desktop={...media,duration:12,logoAt:9,revealAt:11.2};
  const portrait={...desktop,width:1080,height:1920};
  const delivery={status:'ready',desktop,portrait};
  assert.equal(selectIntroMedia(false,false,delivery),desktop);assert.equal(selectIntroMedia(false,true,delivery),portrait);
  for(const invalid of [{...delivery,status:'awaiting-media'},{...delivery,desktop:null},{...delivery,portrait:null},
    {...delivery,portrait:{...portrait,duration:13}},{...delivery,portrait:{...portrait,logoAt:8}},
    {...delivery,portrait:{...portrait,revealAt:11}},{...delivery,desktop:{...desktop,sha256:'corrupt'}}]){
    assert.equal(selectIntroMedia(false,false,invalid),null);assert.equal(selectIntroMedia(false,true,invalid),null);
  }
  assert.equal(validProductionMedia(desktop,false),true);assert.equal(validProductionMedia(desktop,true),false);
  assert.equal(validProductionMedia(media,false),false);
  for(const patch of [{duration:9.9},{duration:15.1},{duration:NaN},{logoAt:Infinity},{logoAt:-1},{logoAt:11},{revealAt:12},{revealAt:NaN},{audio:'silent'},{bytes:17*1024*1024},{sha256:'none'},{src:'/historical.mp4'}])assert.equal(validProductionMedia({...desktop,...patch},false),false);
});

test('historical media clock holds the final logo without a reveal or auto entry',()=>{
  assert.deepEqual(introFrame(19.9,media),{time:19.9,phase:'film',logo:0});
  assert.ok(Math.abs(introFrame(20.4,media).logo-.5)<.00001);
  assert.deepEqual(introFrame(23,media),{time:23,phase:'hold',logo:1});
  assert.equal(introFrame(200,media).time,23);
});
test('10–15-second revised timelines complete into a held logo, never the site',async()=>{
  for(const duration of [10,12,15]){
    const short={...media,duration,logoAt:duration-2,revealAt:duration-1};
    assert.equal(validProductionMedia(short,false),true);
    const f=fixture(short);await f.controller.play();f.controller.setSound(true);
    f.advance(100,short.logoAt+.4);assert.ok(Math.abs(f.frames.at(-1).logo-.5)<.00001);
    f.advance(100,short.revealAt);assert.equal(f.frames.at(-1).phase,'hold');assert.equal(f.video.volume,1);
    f.video.currentTime=duration;f.video.ended=true;f.video.dispatchEvent(new Event('ended'));
    f.advance(30000);assert.deepEqual(f.exits,[]);assert.deepEqual(f.entries,[]);
    assert.equal(f.statuses.at(-1),'complete');assert.equal(f.frames.at(-1).logo,1);assert.equal(f.pending(),0);assert.equal(f.video.muted,true);
    f.controller.dispose();
  }
});
test('explicit entry covers white then reveals site, fading sound before stopping once',async()=>{
  const f=fixture();await f.controller.play();f.controller.setSound(true);f.advance(10,4);
  f.controller.enter();f.controller.enter('skip');assert.deepEqual(f.exits,[]);
  assert.deepEqual(f.entries.at(-1),{phase:'cover',opacity:0});
  f.advance(175);assert.deepEqual(f.entries.at(-1),{phase:'cover',opacity:.5});assert.equal(f.video.volume,.5);assert.equal(f.video.paused,false);
  f.advance(175);assert.deepEqual(f.entries.at(-1),{phase:'uncover',opacity:1});assert.equal(f.video.paused,true);assert.equal(f.video.muted,true);
  f.advance(225);assert.deepEqual(f.entries.at(-1),{phase:'uncover',opacity:.5});assert.deepEqual(f.exits,[]);
  f.advance(225);assert.deepEqual(f.exits,['enter']);assert.equal(f.pending(),0);
  f.controller.enter();f.video.dispatchEvent(new Event('ended'));await f.controller.play();assert.deepEqual(f.exits,['enter']);assert.equal(f.video.plays,1);
});
test('hiding a tab during the white cover silences sound before another animation frame',async()=>{
  const f=fixture();await f.controller.play();f.controller.setSound(true);f.advance(10,4);
  f.controller.enter();f.advance(100);assert.equal(f.video.paused,false);assert.ok(f.video.volume>0);
  f.visibility.hidden=true;f.visibility.dispatchEvent(new Event('visibilitychange'));
  // No advance here: a hidden browser can suspend requestAnimationFrame indefinitely.
  assert.equal(f.video.paused,true);assert.equal(f.video.muted,true);assert.equal(f.video.volume,0);
  assert.deepEqual(f.exits,[]);assert.equal(f.entries.at(-1).phase,'cover');
  const plays=f.video.plays;
  f.visibility.hidden=false;f.visibility.dispatchEvent(new Event('visibilitychange'));
  assert.equal(f.video.plays,plays);assert.equal(f.video.muted,true);
  f.advance(250);assert.equal(f.entries.at(-1).phase,'uncover');f.advance(450);
  assert.deepEqual(f.exits,['enter']);assert.equal(f.pending(),0);
  const pauses=f.video.pauses;
  f.visibility.hidden=true;f.visibility.dispatchEvent(new Event('visibilitychange'));
  assert.equal(f.video.pauses,pauses); // Completion removed the transition visibility listener.
});
test('Enter and early Skip share the transition during film, logo, hold and after completion',async()=>{
  for(const time of [2,20.5,22.5,23])for(const reason of ['enter','skip']){
    const f=fixture();await f.controller.play();f.advance(10,time);
    if(time===23){f.video.ended=true;f.video.dispatchEvent(new Event('ended'));}
    f.controller.enter(reason);f.advance(350);assert.equal(f.entries.at(-1).opacity,1);assert.deepEqual(f.exits,[]);
    f.advance(450);assert.deepEqual(f.exits,[reason]);assert.equal(f.pending(),0);
  }
});
test('error, early-ended, metadata failure, timeout, and reduced motion wait for explicit entry',async()=>{
  for(const mode of ['error','early-ended','metadata','timeout','reduced-motion']){
    const f=fixture();await f.controller.play();
    if(mode==='error')f.video.dispatchEvent(new Event('error'));
    if(mode==='early-ended'){f.video.currentTime=4;f.video.dispatchEvent(new Event('ended'));}
    if(mode==='metadata'){f.video.videoHeight=720;f.video.dispatchEvent(new Event('loadedmetadata'));}
    if(mode==='timeout')f.advance(8000);
    if(mode==='reduced-motion')f.controller.hold('reduced-motion');
    const status=mode==='timeout'?'timeout':mode==='reduced-motion'?mode:'failure';
    assert.equal(f.statuses.at(-1),status);assert.equal(f.frames.at(-1).logo,1);assert.equal(f.pending(),0);
    f.advance(60000);await f.controller.play();assert.deepEqual(f.exits,[]);assert.equal(f.video.plays,1);
    f.controller.enter('enter',mode==='reduced-motion');
    if(mode!=='reduced-motion'){f.advance(350);f.advance(450);}
    assert.deepEqual(f.exits,['enter']);assert.equal(f.pending(),0);
  }
});
test('reduced motion before playback shows a held still until explicit immediate entry',async()=>{
  const f=fixture();f.controller.hold('reduced-motion');await f.controller.play();f.advance(60000);
  assert.equal(f.video.plays,0);assert.deepEqual(f.exits,[]);assert.equal(f.pending(),0);
  f.controller.enter('enter',true);assert.deepEqual(f.entries,[{phase:'uncover',opacity:0}]);assert.deepEqual(f.exits,['enter']);
});
test('dispose cancels either fade phase without entry, silences and rejects late events',async()=>{
  for(const advance of [175,350,575]){
    const f=fixture();await f.controller.play();f.controller.setSound(true);f.controller.enter();
    if(advance>=350){f.advance(350);f.advance(advance-350);}else f.advance(advance);
    f.controller.dispose();f.advance(10000);f.video.dispatchEvent(new Event('error'));
    assert.deepEqual(f.exits,[]);assert.equal(f.pending(),0);assert.equal(f.video.muted,true);assert.equal(f.video.paused,true);
  }
});
test('hidden tabs pause playback without consuming the failure timeout or automatically entering',async()=>{
  const f=fixture();await f.controller.play();f.controller.setSound(true);f.advance(100,20.9);
  f.visibility.hidden=true;f.visibility.dispatchEvent(new Event('visibilitychange'));const frame=f.frames.at(-1);f.advance(30000,20.9);
  assert.equal(f.frames.at(-1),frame);assert.deepEqual(f.exits,[]);assert.equal(f.video.paused,true);
  f.visibility.hidden=false;f.visibility.dispatchEvent(new Event('visibilitychange'));await Promise.resolve();f.advance(100,21);
  assert.equal(f.video.plays,2);assert.equal(f.video.muted,false);f.controller.dispose();
});
test('blocked autoplay retains explicit retry and entry with no timeout running',async()=>{
  const f=fixture();f.video.play=async()=>{throw Error('NotAllowedError');};await f.controller.play();assert.equal(f.statuses.at(-1),'blocked');assert.equal(f.pending(),0);
  f.advance(10000);assert.deepEqual(f.exits,[]);
  f.video.play=async()=>{f.video.paused=false;};await f.controller.play();assert.equal(f.statuses.at(-1),'playing');f.controller.dispose();
});
test('loading and stalled playback settle to a still after eight seconds of visible time',async()=>{
  const f=fixture();f.video.play=()=>new Promise(()=>{});void f.controller.play();f.advance(8000,0);assert.equal(f.statuses.at(-1),'timeout');assert.deepEqual(f.exits,[]);assert.equal(f.pending(),0);
  const g=fixture();await g.controller.play();g.advance(1000,5);g.advance(7999,5);assert.notEqual(g.statuses.at(-1),'timeout');g.advance(1,5);assert.equal(g.statuses.at(-1),'timeout');assert.deepEqual(g.exits,[]);
  f.controller.dispose();g.controller.dispose();
});
test('manual pause suspends timeout and does not resume from visibility alone',async()=>{
  const f=fixture();await f.controller.play();f.controller.pause();f.advance(30000);assert.deepEqual(f.exits,[]);
  f.visibility.hidden=true;f.visibility.dispatchEvent(new Event('visibilitychange'));f.visibility.hidden=false;f.visibility.dispatchEvent(new Event('visibilitychange'));assert.equal(f.video.plays,1);f.controller.dispose();
});
test('stale play fulfillment cannot restart media after hold or explicit entry',async()=>{
  for(const stop of ['hold','enter']){
    const f=fixture();let resolve;f.video.play=()=>new Promise(done=>resolve=()=>{f.video.paused=false;done();});const pending=f.controller.play();
    if(stop==='hold')f.controller.hold('failure');else f.controller.enter();
    resolve();await pending;assert.equal(f.video.paused,true);assert.deepEqual(f.exits,[]);f.controller.dispose();
  }
});
test('a stale play promise or disposal cannot silence a newer owner',async()=>{
  const f=fixture();let resolve;f.video.play=()=>new Promise(done=>resolve=done);const pending=f.controller.play();f.controller.dispose();
  f.video.play=async()=>{f.video.paused=false;};const replacement=createIntroController(f.video,f.visibility,media,f.clock,f.callbacks);await replacement.play();const pauses=f.video.pauses;
  resolve();await pending;f.controller.dispose();assert.equal(f.video.pauses,pauses);replacement.dispose();
});
test('near-end fallback holds final logo when decoder omits ended',async()=>{
  const f=fixture();await f.controller.play();f.advance(100,22.96);assert.notEqual(f.statuses.at(-1),'complete');f.advance(250,22.96);
  assert.equal(f.statuses.at(-1),'complete');assert.deepEqual(f.exits,[]);assert.equal(f.frames.at(-1).logo,1);f.controller.dispose();
});
test('browser sound pause offers Play; explicit pause and stale pause events stay distinct',async()=>{
  const f=fixture();await f.controller.play();f.controller.setSound(true);f.video.paused=true;f.video.dispatchEvent(new Event('pause'));
  assert.equal(f.statuses.at(-1),'blocked');assert.equal(f.pending(),0);await f.controller.play();assert.equal(f.video.volume,1);
  f.controller.pause();f.video.dispatchEvent(new Event('pause'));assert.equal(f.statuses.at(-1),'paused');await f.controller.play();
  f.video.dispatchEvent(new Event('pause'));assert.equal(f.statuses.at(-1),'playing');f.controller.dispose();
});
test('React entry wiring retains a native modal, persistent Enter, still fallback and no upward slide',async()=>{
  const {readFile}=await import('node:fs/promises');
  const component=await readFile(new URL('../src/CinematicIntro.tsx',import.meta.url),'utf8');
  const app=await readFile(new URL('../src/App.tsx',import.meta.url),'utf8');
  const css=await readFile(new URL('../src/intro.css',import.meta.url),'utf8');
  assert.match(component,/element.showModal\(\)/);assert.match(component,/onCancel=.*enter\('skip'\)/);
  assert.match(component,/autoFocus disabled=\{entering\} onClick=\{\(\) => enter\(\)\}>Enter/);
  assert.match(component,/if \(reducedRef.current\) active.hold\('reduced-motion'\)/);
  assert.match(component,/fallback && <img className="intro-still"/);assert.match(component,/active.dispose\(\)/);
  assert.doesNotMatch(component,/translateY|finish\(|enter.current\('reduced-motion'\)/);
  assert.doesNotMatch(app,/if \(!introMedia \|\| window.matchMedia/);
  assert.match(css,/intro-entry-white[^}]+background: #fff/);assert.match(css,/data-entry="uncover"/);
});
test('diagnostic variants are exact23-second technical fixtures, not historical or production film',async()=>{
  const {introFixtures}=await import('../src/intro-media.ts');
  const {readFile}=await import('node:fs/promises'),{createHash}=await import('node:crypto');
  for(const fixture of Object.values(introFixtures)){
    assert.equal(fixture.kind,'fixture');assert.equal(fixture.duration,23);assert.equal(fixture.audio,'embedded');
    assert.ok(fixture.src.startsWith('/_diagnostics/intro/'));
    const bytes=await readFile(new URL('../public'+fixture.src,import.meta.url));
    assert.equal(bytes.length,fixture.bytes);assert.equal(createHash('sha256').update(bytes).digest('hex'),fixture.sha256);
  }
  assert.equal(selectIntroMedia(true,false),introFixtures.desktop);assert.equal(selectIntroMedia(true,true),introFixtures.portrait);
});
test('engineering sessions cannot suppress the eventual production intro',async()=>{
  const {rememberSplash,shouldShowSplash,SPLASH_FIXTURE_SESSION_KEY}=await import('../src/splash-playback.ts');
  const map=new Map(),storage={getItem:key=>map.get(key),setItem:(key,value)=>map.set(key,value)};
  rememberSplash(storage,SPLASH_FIXTURE_SESSION_KEY);
  assert.equal(shouldShowSplash('',storage,SPLASH_FIXTURE_SESSION_KEY),false);
  assert.equal(shouldShowSplash('',storage),true);
});
test('preserved historical assets match all seven exact Brand delivery files',async()=>{
  const {readFile,readdir}=await import('node:fs/promises'),{createHash}=await import('node:crypto');
  const directory=new URL('../public/intro/',import.meta.url);
  const manifestBytes=await readFile(new URL('manifest.json',directory));
  assert.equal(manifestBytes.length,2157);assert.equal(createHash('sha256').update(manifestBytes).digest('hex'),'35ea045a4d19a66037c671bb2c43d27f0dee954f06451aa9c6efed80f068df3a');
  const manifest=JSON.parse(manifestBytes);assert.equal(manifest.status,'founder review candidate');assert.equal(manifest.audio_listening_review,'pending');
  assert.equal(manifest.duration_seconds,23);assert.equal(manifest.frames,552);assert.equal(manifest.audio_embedded,true);assert.equal(manifest.logo_baked,false);
  assert.deepEqual((await readdir(directory)).sort(),[...manifest.files.map(x=>x.path),'manifest.json'].sort());
  for(const asset of manifest.files){const bytes=await readFile(new URL(asset.path,directory));assert.equal(bytes.length,asset.bytes);assert.equal(createHash('sha256').update(bytes).digest('hex'),asset.sha256);}
  for(const asset of [introDelivery.desktop,introDelivery.portrait]){
    const declared=manifest.files.find(row=>'/intro/'+row.path===asset.src);assert.equal(asset.kind,'production');assert.equal(asset.sha256,declared.sha256);assert.equal(asset.bytes,declared.bytes);
    const stream=declared.streams.find(row=>row.type==='video');assert.equal(stream.width,asset.width);assert.equal(stream.height,asset.height);
    assert.ok(manifest.files.some(row=>'/intro/'+row.path===asset.poster));
  }
});
