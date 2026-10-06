import test from 'node:test';
import assert from 'node:assert/strict';
import { createSplashPlayback, shouldShowSplash, rememberSplash, SPLASH_SESSION_KEY } from '../src/splash-playback.ts';
function setup() {
  const states=[];
  class Video extends EventTarget {
    paused=true; ended=false; plays=0; pauses=0; blocked=false;
    async play(){this.plays++;if(this.blocked)throw Error('Autoplay denied');this.paused=false;}
    pause(){this.pauses++;this.paused=true;}
  }
  class Visibility extends EventTarget { hidden=false; }
  const video=new Video(),visibility=new Visibility();
  return {video,visibility,states,controller:createSplashPlayback(video,visibility,value=>states.push(value))};
}
test('fresh visits show splash, deep links and seen sessions bypass it, denied storage never blocks entry',()=>{
  assert.equal(shouldShowSplash('',null),true);
  assert.equal(shouldShowSplash('#build',null),false);
  assert.equal(shouldShowSplash('#beta-guide',null),false);
  const stored=new Map();const storage={getItem:k=>stored.get(k),setItem:(k,v)=>stored.set(k,v)};
  rememberSplash(storage);assert.equal(stored.get(SPLASH_SESSION_KEY),'seen');assert.equal(shouldShowSplash('',storage),false);
  assert.doesNotThrow(()=>rememberSplash({setItem(){throw Error('Denied');}}));
  assert.equal(shouldShowSplash('',{getItem(){throw Error('Denied');}}),true);
});
test('ordinary mobile uses the same playback controller and blocked autoplay supports explicit retry',async()=>{
  const f=setup();f.video.blocked=true;await f.controller.play();assert.equal(f.states.at(-1),'blocked');
  f.video.blocked=false;await f.controller.play();assert.equal(f.states.at(-1),'playing');
  f.controller.pause();assert.equal(f.video.paused,true);assert.equal(f.states.at(-1),'paused');f.controller.dispose();
});
test('hidden tabs pause and resume only video that was playing',async()=>{
  const f=setup();await f.controller.play();
  f.visibility.hidden=true;f.visibility.dispatchEvent(new Event('visibilitychange'));assert.equal(f.video.paused,true);
  f.visibility.hidden=false;f.visibility.dispatchEvent(new Event('visibilitychange'));await Promise.resolve();assert.equal(f.video.plays,2);
  f.controller.pause();f.visibility.hidden=true;f.visibility.dispatchEvent(new Event('visibilitychange'));
  f.visibility.hidden=false;f.visibility.dispatchEvent(new Event('visibilitychange'));assert.equal(f.video.plays,2);f.controller.dispose();
});
test('completion does not loop and errors stop playback',async()=>{
  const f=setup();await f.controller.play();f.video.ended=true;f.video.dispatchEvent(new Event('ended'));
  assert.equal(f.states.at(-1),'ended');assert.equal(f.video.plays,1);
  f.video.dispatchEvent(new Event('error'));assert.equal(f.states.at(-1),'error');assert.equal(f.video.paused,true);f.controller.dispose();
});
test('exit disposes listeners and cancels late playback completion',async()=>{
  const f=setup();let resolve;f.video.play=()=>new Promise(done=>{resolve=done;});
  const pending=f.controller.play();f.controller.dispose();resolve();await pending;
  assert.equal(f.video.paused,true);assert.deepEqual(f.states,[]);
  f.video.dispatchEvent(new Event('error'));f.visibility.dispatchEvent(new Event('visibilitychange'));assert.deepEqual(f.states,[]);
});
test('hidden startup never attempts playback',async()=>{const f=setup();f.visibility.hidden=true;await f.controller.play();assert.equal(f.video.plays,0);f.controller.dispose();});
test('reduced motion and errors keep video absent until an explicit request',async()=>{
  const {splashVideoAllowed}=await import('../src/splash-playback.ts');
  assert.equal(splashVideoAllowed(true,false,false),false);
  assert.equal(splashVideoAllowed(true,true,false),true);
  assert.equal(splashVideoAllowed(false,false,false),true);
  assert.equal(splashVideoAllowed(false,true,true),false);
});
test('panel units contain exactly the two current Brand derivatives with retained provenance',async()=>{
  const {readFile}=await import('node:fs/promises'),{createHash}=await import('node:crypto');
  const manifest=JSON.parse(await readFile(new URL('../public/panel-units/manifest.json',import.meta.url)));
  assert.equal(manifest.assets.length,2);assert.equal(manifest.higgsfieldCredits,0);
  assert.equal(manifest.sourcePng.length,2);
  assert.deepEqual(manifest.assets.map(a=>a.path).sort(),['/panel-units/h4n-ochre-wave.webp','/panel-units/s4-rose-peek.webp']);
  for(const asset of manifest.assets){
    const data=await readFile(new URL('../public'+asset.path,import.meta.url));
    assert.equal(data.length,asset.bytes);assert.equal(createHash('sha256').update(data).digest('hex'),asset.sha256);
  }
});
test('older play fulfillment never pauses a newer successful play request',async()=>{
  const f=setup();const resolutions=[];
  f.video.play=()=>new Promise(resolve=>resolutions.push(()=>{f.video.paused=false;resolve();}));
  const older=f.controller.play(),newer=f.controller.play();
  resolutions[1]();await newer;assert.equal(f.states.at(-1),'playing');
  const pauses=f.video.pauses;
  resolutions[0]();await older;
  assert.equal(f.video.pauses,pauses);assert.equal(f.video.paused,false);assert.equal(f.states.at(-1),'playing');
  f.controller.dispose();
});
test('manual pause still stops a pending play fulfillment',async()=>{
  const f=setup();let resolve;
  f.video.play=()=>new Promise(done=>{resolve=()=>{f.video.paused=false;done();};});
  const pending=f.controller.play();f.controller.pause();resolve();await pending;
  assert.equal(f.video.paused,true);assert.equal(f.states.at(-1),'paused');f.controller.dispose();
});
test('hidden state still stops a pending play fulfillment',async()=>{
  const f=setup();let resolve;
  f.video.play=()=>new Promise(done=>{resolve=()=>{f.video.paused=false;done();};});
  const pending=f.controller.play();f.visibility.hidden=true;f.visibility.dispatchEvent(new Event('visibilitychange'));
  resolve();await pending;assert.equal(f.video.paused,true);assert.notEqual(f.states.at(-1),'playing');f.controller.dispose();
});
test('the resting image is the exact approved four-second all-cast frame',async()=>{
  const {splashRestingFrame}=await import('../src/cinematic-config.ts');
  const {readFile}=await import('node:fs/promises'),{createHash}=await import('node:crypto');
  assert.equal(splashRestingFrame.seconds,4);
  assert.equal(splashRestingFrame.poster,'/fullpage-coverage/labs.jpg');
  const bytes=await readFile(new URL('../public'+splashRestingFrame.poster,import.meta.url));
  assert.equal(createHash('sha256').update(bytes).digest('hex'),splashRestingFrame.sha256);
});
