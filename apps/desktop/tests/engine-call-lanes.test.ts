// W9: the two lanes of a sheet's calls, without React. A plan never drops a write's answer; a late plan answer never replaces a newer one; a plan does not
// start while a write runs; a refusal or a thrown error arrives as words.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CallLanes } from '../renderer/harness/sheets/call-lanes.js';
import type { Answer } from '../shared/engine/types.js';

function deferred<T>(): { promise: Promise<T>; resolve(v: T): void; reject(e: unknown): void } {
  let resolve!: (v: T) => void, reject!: (e: unknown) => void;
  const promise = new Promise<T>((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
}
function lanes(): { lanes: CallLanes; seen: string[] } {
  const seen: string[] = [];
  return { seen, lanes: new CallLanes({ busy: w => seen.push(`busy ${w ?? '-'}`), writing: on => seen.push(`writing ${on}`), refusal: r => seen.push(`refusal ${r?.code ?? '-'}`) }) };
}

test('a plan started during a write does not start, and the write\'s answer is taken', async () => {
  const { lanes: l } = lanes();
  const w = deferred<Answer<string>>(), got: string[] = [];
  const write = l.write('Writing', () => w.promise, v => got.push(`write ${v}`));
  let planCalled = false;
  const plan = await l.plan('Planning', async () => { planCalled = true; return { ok: true, value: 'p' }; }, v => got.push(`plan ${v}`));
  assert.equal(plan, false, 'the plan is refused while the write runs');
  assert.equal(planCalled, false, 'the plan call never reached Bowerloom');
  w.resolve({ ok: true, value: 'done' });
  assert.equal(await write, true);
  assert.deepEqual(got, ['write done']);
});

test('a plan still in flight when a write starts is dropped, and the write\'s answer is taken', async () => {
  const { lanes: l } = lanes();
  const p = deferred<Answer<string>>(), w = deferred<Answer<string>>(), got: string[] = [];
  const plan = l.plan('Planning', () => p.promise, v => got.push(`plan ${v}`));
  const write = l.write('Writing', () => w.promise, v => got.push(`write ${v}`));
  p.resolve({ ok: true, value: 'old plan' });
  w.resolve({ ok: true, value: 'done' });
  assert.equal(await plan, false);
  assert.equal(await write, true);
  assert.deepEqual(got, ['write done']);
});

test('the newest plan wins; an older answer that arrives late is dropped', async () => {
  const { lanes: l } = lanes();
  const a = deferred<Answer<string>>(), b = deferred<Answer<string>>(), got: string[] = [];
  const first = l.plan('Planning', () => a.promise, v => got.push(v));
  const second = l.plan('Planning', () => b.promise, v => got.push(v));
  b.resolve({ ok: true, value: 'new' });
  a.resolve({ ok: true, value: 'old' });
  assert.equal(await second, true); assert.equal(await first, false);
  assert.deepEqual(got, ['new']);
});

test('a second write while one runs is refused; a thrown error arrives as a refusal with words', async () => {
  const { lanes: l, seen } = lanes();
  const w = deferred<Answer<string>>();
  const first = l.write('Writing', () => w.promise, () => undefined);
  assert.equal(await l.write('Writing', async () => ({ ok: true, value: 'x' }), () => undefined), false);
  w.reject(new Error("Error invoking remote method: Error: UNKNOWN_FOLDER"));
  assert.equal(await first, false);
  assert.ok(seen.includes('refusal UNKNOWN_FOLDER'));
  assert.ok(seen.includes('writing true') && seen.at(-2) === 'busy -' || seen.includes('writing false'));
});
