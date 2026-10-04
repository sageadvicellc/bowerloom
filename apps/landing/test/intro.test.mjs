import test from 'node:test';
import assert from 'node:assert/strict';
import {createIntroController,introFrame} from '../src/intro-controller.ts';
import {introDelivery,selectIntroMedia,validProductionMedia} from '../src/intro-media.ts';
const media={kind:'production',src:'/intro/desktop.mp4',poster:'/intro/desktop.jpg',sha256:'a'.repeat(64),bytes:100,width:1920,height:1080,duration:23,logoAt:20,revealAt:22.2,audio:'embedded'};
function fixture() {
  let now=0,id=0;const rafs=new Map(),timers=new Map();
  const clock={now:()=>now,request:fn=>{rafs.set(++id,fn);return id;},cancel:id=>rafs.delete(id),after:(fn,ms)=>{timers.set(++id,{at:now+ms,fn});return id;},clear:id=>timers.delete(id)};
  class Video extends EventTarget {currentTime=0;duration=23;videoWidth=1920;videoHeight=1080;readyState=2;paused=true;ended=false;muted=true;volume=0;plays=0;pauses=0;async play(){this.plays++;this.paused=false;}pause(){this.pauses++;this.paused=true;}}
  class Visibility extends EventTarget{hidden=false;}
  const video=new Video(),visibility=new Visibility(),frames=[],statuses=[],exits=[];
  const callbacks={frame:f=>frames.push(f),status:s=>statuses.push(s),exit:r=>exits.push(r)};
  const controller=createIntroController(video,visibility,media,clock,callbacks);
  return {video,visibility,frames,statuses,exits,controller,clock,callbacks,advance(ms,time=video.currentTime){now+=ms;video.currentTime=time;const next=[...rafs.values()];rafs.clear();next.forEach(fn=>fn());for(const [id,timer] of [...timers])if(timer.at<=now){timers.delete(id);timer.fn();}},pending:()=>rafs.size+timers.size};
}
test('logo and reveal follow one23-second media clock',()=>{
  assert.deepEqual(introFrame(19.9,media),{time:19.9,phase:'film',logo:0,reveal:0});
  assert.ok(Math.abs(introFrame(20.4,media).logo-.5)<.00001);assert.equal(introFrame(20.8,media).logo,1);assert.equal(introFrame(22.19,media).logo,1);assert.equal(introFrame(22.2,media).phase,'reveal');
  assert.ok(Math.abs(introFrame(22.6,media).reveal-.5)<.00001);assert.equal(introFrame(23,media).reveal,1);
});
test('production remains gated until both exact native variant contracts are supplied',()=>{
  assert.equal(selectIntroMedia(false,false),introDelivery.desktop);assert.equal(selectIntroMedia(false,true),introDelivery.portrait);
  for(const invalid of [{...introDelivery,status:'awaiting-media'},{...introDelivery,desktop:null},{...introDelivery,portrait:null},
    {...introDelivery,portrait:{...introDelivery.portrait,duration:8}},{...introDelivery,desktop:{...introDelivery.desktop,sha256:'corrupt'}}]){
    assert.equal(selectIntroMedia(false,false,invalid),null);assert.equal(selectIntroMedia(false,true,invalid),null);
  }
  assert.equal(validProductionMedia(media,false),true);assert.equal(validProductionMedia(media,true),false);
  for(const patch of [{duration:8},{audio:'silent'},{bytes:17*1024*1024},{sha256:'none'},{src:'/historical.mp4'}])assert.equal(validProductionMedia({...media,...patch},false),false);
});
test('natural completion exits once and cancels scheduling',async()=>{
  const f=fixture();await f.controller.play();f.advance(100,20.5);assert.equal(f.frames.at(-1).phase,'logo');
  f.advance(100,22.5);assert.equal(f.frames.at(-1).phase,'reveal');f.video.currentTime=23;f.video.ended=true;f.video.dispatchEvent(new Event('ended'));
  f.controller.finish('skip');f.video.dispatchEvent(new Event('ended'));assert.deepEqual(f.exits,['complete']);assert.equal(f.pending(),0);assert.equal(f.video.paused,true);
});
test('skip during film logo or reveal cannot restart through late events',async()=>{
  for(const time of [2,20.5,22.5]){const f=fixture();await f.controller.play();f.advance(100,time);f.controller.finish('skip');await f.controller.play();
    f.visibility.hidden=true;f.visibility.dispatchEvent(new Event('visibilitychange'));f.visibility.hidden=false;f.visibility.dispatchEvent(new Event('visibilitychange'));
    assert.deepEqual(f.exits,['skip']);assert.equal(f.video.plays,1);assert.equal(f.pending(),0);}
});
test('hidden tabs freeze picture/audio and the post-video logo/reveal clock',async()=>{
  const f=fixture();await f.controller.play();f.controller.setSound(true);f.advance(100,20.9);
  f.visibility.hidden=true;f.visibility.dispatchEvent(new Event('visibilitychange'));const frame=f.frames.at(-1);f.advance(30000,20.9);
  assert.equal(f.frames.at(-1),frame);assert.deepEqual(f.exits,[]);assert.equal(f.video.paused,true);
  f.visibility.hidden=false;f.visibility.dispatchEvent(new Event('visibilitychange'));await Promise.resolve();f.advance(100,21);
  assert.equal(f.video.plays,2);assert.equal(f.video.muted,false);assert.equal(f.frames.at(-1).time,21);f.controller.dispose();
});
test('embedded sound opt-in retains timeline and fades with reveal',async()=>{
  const f=fixture();await f.controller.play();f.advance(100,12);f.controller.setSound(true);assert.equal(f.video.currentTime,12);assert.equal(f.video.muted,false);
  f.advance(100,22.6);assert.ok(Math.abs(f.video.volume-.5)<.00001);f.controller.finish('skip');assert.equal(f.video.muted,true);
});
test('blocked autoplay exposes retry without leaving a watchdog running',async()=>{
  const f=fixture();f.video.play=async()=>{throw Error('NotAllowedError');};await f.controller.play();assert.equal(f.statuses.at(-1),'blocked');assert.equal(f.pending(),0);
  f.video.play=async()=>{f.video.paused=false;};await f.controller.play();assert.equal(f.statuses.at(-1),'playing');f.controller.finish('skip');
});
test('loading and stalled playback exit at eight seconds of visible time',async()=>{
  const f=fixture();f.video.play=()=>new Promise(()=>{});void f.controller.play();f.advance(8000,0);assert.deepEqual(f.exits,['timeout']);assert.equal(f.pending(),0);
  const g=fixture();await g.controller.play();g.advance(1000,5);g.advance(7999,5);assert.deepEqual(g.exits,[]);g.advance(1,5);assert.deepEqual(g.exits,['timeout']);
});
test('manual pause suspends timeout and does not resume merely on tab visibility',async()=>{
  const f=fixture();await f.controller.play();f.controller.pause();f.advance(30000,0);assert.deepEqual(f.exits,[]);
  f.visibility.hidden=true;f.visibility.dispatchEvent(new Event('visibilitychange'));f.visibility.hidden=false;f.visibility.dispatchEvent(new Event('visibilitychange'));assert.equal(f.video.plays,1);f.controller.dispose();
});
test('stale play fulfillment cannot pause newer success or restart after skip',async()=>{
  const f=fixture();const resolves=[];f.video.play=()=>new Promise(resolve=>resolves.push(()=>{f.video.paused=false;resolve();}));
  const a=f.controller.play(),b=f.controller.play();resolves[1]();await b;const pauses=f.video.pauses;resolves[0]();await a;assert.equal(f.video.pauses,pauses);
  const c=f.controller.play();f.controller.finish('skip');resolves[2]();await c;assert.equal(f.video.paused,true);assert.deepEqual(f.exits,['skip']);
});
test('old controller disposal cannot silence a replacement controller on the same element',async()=>{
  const f=fixture();let resolve;f.video.play=()=>new Promise(done=>{resolve=done;});const pending=f.controller.play();f.controller.dispose();
  f.video.play=async()=>{f.video.paused=false;};const replacement=createIntroController(f.video,f.visibility,media,f.clock,f.callbacks);await replacement.play();const pauses=f.video.pauses;
  resolve();await pending;assert.equal(f.video.pauses,pauses);replacement.dispose();
});
test('missing ended callback has a bounded near-end fallback, but early ended fails',async()=>{
  const f=fixture();await f.controller.play();f.advance(100,22.96);assert.deepEqual(f.exits,[]);f.advance(250,22.96);assert.deepEqual(f.exits,['complete']);
  const g=fixture();await g.controller.play();g.video.currentTime=10;g.video.dispatchEvent(new Event('ended'));assert.deepEqual(g.exits,['failure']);
});
test('unexpected dimensions or duration fail before the sequence can claim completion',async()=>{
  const f=fixture();f.video.videoHeight=720;f.video.dispatchEvent(new Event('loadedmetadata'));assert.deepEqual(f.exits,['failure']);assert.equal(f.pending(),0);
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
test('browser pause after sound activation offers explicit Play instead of a silent timeout',async()=>{
  const f=fixture();await f.controller.play();f.advance(100,5);f.controller.setSound(true);
  f.video.paused=true;f.video.dispatchEvent(new Event('pause'));
  assert.equal(f.statuses.at(-1),'blocked');assert.equal(f.pending(),0);
  f.advance(10000,5);assert.deepEqual(f.exits,[]);
  await f.controller.play();assert.equal(f.statuses.at(-1),'playing');assert.equal(f.video.muted,false);assert.equal(f.video.currentTime,5);f.controller.dispose();
});
test('manual and hidden pause events do not become playback-policy failures',async()=>{
  const f=fixture();await f.controller.play();f.controller.pause();f.video.dispatchEvent(new Event('pause'));assert.equal(f.statuses.at(-1),'paused');
  await f.controller.play();f.visibility.hidden=true;f.visibility.dispatchEvent(new Event('visibilitychange'));f.video.dispatchEvent(new Event('pause'));
  assert.notEqual(f.statuses.at(-1),'blocked');f.controller.dispose();
});
test('a queued old pause event cannot stop resumed playback',async()=>{
  const f=fixture();await f.controller.play();f.controller.pause();await f.controller.play();
  f.video.dispatchEvent(new Event('pause'));assert.equal(f.statuses.at(-1),'playing');assert.ok(f.pending()>0);f.controller.dispose();
});

test('protected production assets match all seven exact Brand delivery files',async()=>{
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
