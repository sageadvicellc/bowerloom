import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { anchorTimeline, motionAllowed, regionAt, sectionTimeline, timelineAt } from '../src/fullpage-scroll.ts';
import { loadClip } from '../src/fullpage-media.ts';
import { fullpageRegions } from '../src/cinematic-config.ts';
const starts = fullpageRegions.map(region => region.start);
const tops = [80, 1000, 1700, 3400, 5800, 6700];
const points = sectionTimeline(tops, 900, 7200, starts);

test('all six actual page regions map to contiguous approved ranges with reachable footer/end', () => {
  assert.deepEqual(starts, [0, .9, 2.6, 4.5, 6.4, 7.5]);
  fullpageRegions.slice(1).forEach((region, i) => assert.equal(fullpageRegions[i].end, region.start));
  points.forEach(point => assert.equal(timelineAt(points, point.scroll), point.time));
  assert.equal(timelineAt(points, 6300), 8);
  assert.equal(timelineAt(points, -100), 0);
  assert.equal(timelineAt(points, 90000), 8);
  assert.ok(points.at(-2).scroll < 6300);
});

test('forward and reverse scrolling use the same frame including deep links and nested guide positions', () => {
  const positions = [0, 1200, 3500, 4400, 5800, 6300];
  const forward = positions.map(position => timelineAt(points, position));
  assert.deepEqual(positions.toReversed().map(position => timelineAt(points, position)), forward.toReversed());
  assert.equal(regionAt(timelineAt(points, 4400), starts), 3);
  assert.equal(regionAt(timelineAt(points, 6300), starts), 5);
});

test('disclosure expansion preserves current frame and monotonic forward/reverse mapping', () => {
  const scroll = 3800, before = timelineAt(points, scroll);
  const expanded = sectionTimeline([80,1000,1700,3400,6900,7800],900,8300,starts);
  const anchored = anchorTimeline(expanded, scroll, before);
  assert.equal(timelineAt(anchored, scroll), before);
  assert.equal(timelineAt(anchored, 7400), 8);
  let last = 0;
  for (let position=0; position<=7400; position+=10) {
    const time=timelineAt(anchored,position); assert.ok(time>=last); last=time;
  }
  assert.ok(timelineAt(anchored, scroll-100)<before);
  assert.ok(timelineAt(anchored, scroll+100)>before);
});

test('viewport resize and browser scroll anchoring retain current frame but keep both endpoints', () => {
  const before = timelineAt(points, 3800);
  const resized = sectionTimeline([80,1100,1800,4000,7400,8300],600,8700,starts);
  const anchored = anchorTimeline(resized, 4400, before);
  assert.equal(timelineAt(anchored,4400),before);
  assert.equal(timelineAt(anchored,0),0);
  assert.equal(timelineAt(anchored,8100),8);
});

test('still, reduced motion, narrow/coarse, and failed paths prohibit video admission', () => {
  assert.equal(motionAllowed(true,false,false,false,false),true);
  assert.equal(motionAllowed(false,false,false,false,false),false);
  for(let index=1;index<5;index++) { const args=[true,false,false,false,false];args[index]=true;assert.equal(motionAllowed(...args),false); }
});

test('all six copied stills match Brand hashes and manifest paths', async () => {
  const manifest=JSON.parse(await readFile(new URL('../public/fullpage-coverage/manifest.json',import.meta.url)));
  assert.equal(manifest.stills.length,6);
  for(const [i,item] of manifest.stills.entries()) {
    assert.equal(item.path, fullpageRegions[i].poster);
    const bytes=await readFile(new URL('../public'+item.path,import.meta.url));
    assert.equal(createHash('sha256').update(bytes).digest('hex'),item.sha256);
  }
});

test('bounded media loader rejects wrong media, failures, declared and streamed oversize', async () => {
  const original=globalThis.fetch;
  try {
    for (const response of [new Response('',{status:503}),new Response('bad',{headers:{'content-type':'text/html'}}),new Response('large',{headers:{'content-type':'video/mp4','content-length':'100'}}),new Response('large',{headers:{'content-type':'video/mp4'}})]) {
      globalThis.fetch=async()=>response;
      await assert.rejects(loadClip('/approved.mp4',new AbortController().signal,4));
    }
    globalThis.fetch=async()=>new Response('ok',{headers:{'content-type':'video/mp4'}});
    const blob=await loadClip('/approved.mp4',new AbortController().signal,4);
    assert.equal(blob.size,2);
  } finally {globalThis.fetch=original;}
});

test('media loader forwards disposal signal and does not substitute another source on error', async () => {
  const original=globalThis.fetch,controller=new AbortController();let calls=0;
  globalThis.fetch=async(path,{signal})=>{calls++;assert.equal(path,'/approved.mp4');assert.equal(signal,controller.signal);throw new Error('Unavailable');};
  try {await assert.rejects(loadClip('/approved.mp4',controller.signal,4));assert.equal(calls,1);}finally{globalThis.fetch=original;}
});

test('expanded content does not offset later section boundaries after reverse scrolling', () => {
  const expanded = sectionTimeline([80,1000,1700,3400,6900,7800],900,8300,starts);
  const anchored = anchorTimeline(expanded,3800,timelineAt(points,3800));
  for(const point of expanded.filter(point=>point.scroll>3800)) assert.equal(timelineAt(anchored,point.scroll),point.time);
  assert.equal(timelineAt(anchored,expanded[2].scroll),starts[2]);
});

test('fresh URL fragments scroll to mounted builder and nested guide exactly once', async () => {
  const { scheduleInitialAnchor } = await import('../src/fullpage-anchor.ts');
  for (const id of ['build', 'beta-guide', 'local-backend']) {
    let callback, calls=0;
    const dispose=scheduleInitialAnchor('#'+id, target=> {
      assert.equal(target,id);
      return {scrollIntoView(options) { calls++;assert.deepEqual(options,{block:'start',behavior:'instant'}); }};
    }, {request(fn) {callback=fn;return 1;},cancel(){callback=undefined;}});
    assert.equal(calls,0);
    callback();
    dispose();
    assert.equal(calls,1);
  }
});

test('initial anchor cleanup cancels deferred scroll and missing or malformed targets do not move the page', async () => {
  const { scheduleInitialAnchor } = await import('../src/fullpage-anchor.ts');
  let callback,lookups=0;
  const frames={request(fn){callback=fn;return 1;},cancel(){callback=undefined;}};
  const lookup=()=>{lookups++;return null;};
  const dispose=scheduleInitialAnchor('#build',lookup,frames);dispose();assert.equal(callback,undefined);
  for(const hash of ['', '#', '#%broken']) scheduleInitialAnchor(hash,lookup,frames);
  assert.equal(callback,undefined);assert.equal(lookups,0);
  scheduleInitialAnchor('#unknown',lookup,frames);callback();assert.equal(lookups,1);
});

test('initial anchor reports navigation after positioning so a stale resize anchor cannot retain the hero frame', async () => {
  const { scheduleInitialAnchor } = await import('../src/fullpage-anchor.ts');
  let callback,scroll=0,timeline=anchorTimeline(points,3500,0),frame=0;
  scheduleInitialAnchor('#build',()=>({scrollIntoView(){scroll=3500;}}),{request(fn){callback=fn;return 1;},cancel(){}},()=>{
    timeline=sectionTimeline(tops,900,7200,starts);
    frame=timelineAt(timeline,scroll);
  });
  callback();
  assert.equal(regionAt(frame,starts),3);
  assert.ok(frame>=4.5);
});
