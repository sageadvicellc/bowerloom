// The report cache: a report under 2 seconds old is reused, and callers that arrive during a probe share it. It uses a fake clock.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_TTL_MS, createReportCache } from '../../../dist/packages/local-models/src/cache.js';

const report = n => Object.freeze({ sampledAt: `r${n}`, models: Object.freeze([]), endpointsConfigured: n, notes: Object.freeze([]) });

/** A collector that counts its calls and can be held open. */
function collector(clock) {
  const state = { calls: 0, release: [], advance: 0 };
  const collect = () => {
    state.calls += 1;
    const n = state.calls;
    return new Promise(resolve => { state.release.push(() => { clock.t += state.advance; resolve(report(n)); }); });
  };
  return { state, collect, finish: () => { for (const r of state.release.splice(0)) r(); } };
}

test('the time to live is 2 seconds', () => {
  assert.equal(DEFAULT_TTL_MS, 2000);
});

test('the first call probes, and a call under 2 seconds later gets the same report without a second probe', async () => {
  const clock = { t: 1000 };
  const c = collector(clock);
  const cache = createReportCache({ collect: c.collect, now: () => clock.t });
  const first = cache.get();
  c.finish();
  const a = await first;
  clock.t += 1999;
  const b = await cache.get();
  assert.equal(b, a);
  assert.equal(c.state.calls, 1);
});

test('at exactly 2 seconds the report has expired and the next call probes again', async () => {
  const clock = { t: 0 };
  const c = collector(clock);
  const cache = createReportCache({ collect: c.collect, now: () => clock.t });
  const first = cache.get(); c.finish(); await first;
  clock.t += 2000;
  const second = cache.get(); c.finish();
  assert.equal((await second).sampledAt, 'r2');
  assert.equal(c.state.calls, 2);
});

test('callers that arrive while a probe is running share it: five calls, one probe, one report', async () => {
  const clock = { t: 0 };
  const c = collector(clock);
  const cache = createReportCache({ collect: c.collect, now: () => clock.t });
  const calls = Array.from({ length: 5 }, () => cache.get());
  assert.equal(c.state.calls, 1);
  c.finish();
  const reports = await Promise.all(calls);
  assert.equal(c.state.calls, 1);
  for (const r of reports) assert.equal(r, reports[0]);
});

test('a probe that takes longer than the time to live is cached from the moment it ends', async () => {
  const clock = { t: 0 };
  const c = collector(clock);
  c.state.advance = 5000;
  const cache = createReportCache({ collect: c.collect, now: () => clock.t });
  const first = cache.get(); c.finish(); await first;
  assert.equal(clock.t, 5000);
  clock.t += 1999;
  await cache.get();
  assert.equal(c.state.calls, 1, 'still fresh');
  clock.t += 1;
  const next = cache.get(); c.finish(); await next;
  assert.equal(c.state.calls, 2);
});

test('a call after an expired report starts one new probe, and a caller that comes during it shares it', async () => {
  const clock = { t: 0 };
  const c = collector(clock);
  const cache = createReportCache({ collect: c.collect, now: () => clock.t });
  const first = cache.get(); c.finish(); await first;
  clock.t += 10_000;
  const p1 = cache.get(), p2 = cache.get();
  assert.equal(c.state.calls, 2);
  c.finish();
  assert.equal(await p1, await p2);
});

test('a probe that rejects, or throws, gives a report with PROBE_FAILED and no models, and is not cached', async () => {
  const clock = { t: 5000 };
  let mode = 'reject', calls = 0;
  const collect = () => { calls += 1; if (mode === 'throw') throw new Error('boom'); return mode === 'reject' ? Promise.reject(new Error('boom')) : Promise.resolve(report(9)); };
  const cache = createReportCache({ collect, now: () => clock.t });
  const failed = await cache.get();
  assert.deepEqual(failed.models, []);
  assert.deepEqual(failed.notes.map(n => n.code), ['PROBE_FAILED']);
  assert.equal(failed.sampledAt, new Date(5000).toISOString());
  assert.equal(failed.endpointsConfigured, 0);
  assert.ok(!JSON.stringify(failed).includes('boom'), 'the error text is not passed on');
  mode = 'throw';
  assert.deepEqual((await cache.get()).notes.map(n => n.code), ['PROBE_FAILED']);
  mode = 'ok';
  assert.equal((await cache.get()).sampledAt, 'r9');
  assert.equal(calls, 3);
});

test('after a failed probe the failure does not block later callers: the in-flight slot is cleared', async () => {
  let n = 0;
  const cache = createReportCache({ collect: () => { n += 1; return n === 1 ? Promise.reject(new Error('x')) : Promise.resolve(report(n)); }, now: () => 0 });
  await cache.get();
  assert.equal((await cache.get()).sampledAt, 'r2');
});

test('a time to live of 0 never reuses a finished report, but still shares a probe in flight', async () => {
  const clock = { t: 0 };
  const c = collector(clock);
  const cache = createReportCache({ collect: c.collect, now: () => clock.t, ttlMs: 0 });
  const a1 = cache.get(), a2 = cache.get();
  assert.equal(c.state.calls, 1);
  c.finish(); await Promise.all([a1, a2]);
  const b = cache.get(); c.finish(); await b;
  assert.equal(c.state.calls, 2);
});

test('a time to live that is negative, not finite or not a number falls back to 2 seconds', async () => {
  for (const ttlMs of [-1, NaN, Infinity, '5', null]) {
    const clock = { t: 0 };
    const c = collector(clock);
    const cache = createReportCache({ collect: c.collect, now: () => clock.t, ttlMs });
    const first = cache.get(); c.finish(); await first;
    clock.t += 1999; await cache.get();
    assert.equal(c.state.calls, 1, String(ttlMs));
    clock.t += 1; const again = cache.get(); c.finish(); await again;
    assert.equal(c.state.calls, 2, String(ttlMs));
  }
});

test('the failure report is frozen', async () => {
  const failed = await createReportCache({ collect: () => Promise.reject(new Error('x')), now: () => 0 }).get();
  assert.ok(Object.isFrozen(failed) && Object.isFrozen(failed.models) && Object.isFrozen(failed.notes) && Object.isFrozen(failed.notes[0]));
});
