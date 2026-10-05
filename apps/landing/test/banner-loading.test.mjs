import test from 'node:test';
import assert from 'node:assert/strict';
import { watchBannerImage } from '../src/banner-loading.ts';
class Picture extends EventTarget { complete=false;naturalWidth=0;async decode(){} }
const flush=async()=>{await Promise.resolve();await Promise.resolve();await Promise.resolve();};
function watch(image){const events=[];const dispose=watchBannerImage(image,()=>events.push('ready'),()=>events.push('failed'));return{events,dispose};}
test('cached complete broken banner is a failure, not successful loading',async()=>{const image=new Picture();image.complete=true;const w=watch(image);await flush();assert.deepEqual(w.events,['failed']);w.dispose();});
test('cached valid image waits for decode then becomes visible',async()=>{const image=new Picture();image.complete=true;image.naturalWidth=1920;let done;image.decode=()=>new Promise(resolve=>done=resolve);const w=watch(image);await flush();assert.deepEqual(w.events,[]);done();await flush();assert.deepEqual(w.events,['ready']);w.dispose();});
test('network failure and decode failure trigger exactly one fallback',async()=>{for(const mode of ['network','decode']){const image=new Picture();image.naturalWidth=100;image.decode=async()=>{throw Error('corrupt');};const w=watch(image);image.dispatchEvent(new Event(mode==='network'?'error':'load'));await flush();image.dispatchEvent(new Event('error'));assert.deepEqual(w.events,['failed']);w.dispose();}});
test('replaced or unmounted banner ignores pending decode and cached callbacks',async()=>{const image=new Picture();image.complete=true;image.naturalWidth=1920;let done;image.decode=()=>new Promise(resolve=>done=resolve);const w=watch(image);await flush();w.dispose();done();await flush();assert.deepEqual(w.events,[]);const cached=watch(image);cached.dispose();await flush();assert.deepEqual(cached.events,[]);});
test('new load becomes ready without animation dependency and disposal removes listeners',async()=>{const image=new Picture(),w=watch(image);image.naturalWidth=1920;image.dispatchEvent(new Event('load'));await flush();assert.deepEqual(w.events,['ready']);w.dispose();image.dispatchEvent(new Event('error'));assert.deepEqual(w.events,['ready']);});

test('canonical banner alternatives are available and match the exact approved stills',async()=>{
  const {readFile}=await import('node:fs/promises'),{createHash}=await import('node:crypto');
  for(const [name,bytes,hash] of [['labs.jpg',142015,'dd0d210520c64fefa41c93f5ed6d01abe96daa017fd2bad8b7f3139b7ef1effb'],['hero.jpg',103248,'64a32adeaddd4bdac71fe4c235058394c8b0458c98d0b2fc170fc674e18bc84c']]){
    const data=await readFile(new URL('../public/banner/'+name,import.meta.url));assert.equal(data.length,bytes);assert.equal(createHash('sha256').update(data).digest('hex'),hash);
  }
  const app=await readFile(new URL('../src/App.tsx',import.meta.url),'utf8');
  assert.doesNotMatch(app,/cinematicJourney.openingPoster|animation-review/);
  assert.equal((app.match(/<SectionCompanion /g)||[]).length,3);
  const banner=await readFile(new URL('../src/HomepageBanner.tsx',import.meta.url),'utf8');
  assert.match(banner,/width="1440" height="810"/);assert.match(banner,/\/banner\/labs.jpg/);assert.match(banner,/\/banner\/hero.jpg/);
});
