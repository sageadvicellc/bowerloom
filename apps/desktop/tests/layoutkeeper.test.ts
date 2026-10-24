// The places on the map are never lost: moves close together are gathered, and a write can be forced.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createKeeper } from '../shared/layoutkeeper.js';
import type { Place } from '../shared/maplayout.js';

function fixture(saved: Record<string, Place> = {}) {
  const writes: (Record<string, Place> | null)[] = []; const timers: { run: () => void; ms: number; live: boolean }[] = [];
  const keeper = createKeeper({ delay: 400, saved: () => saved, commit: l => { writes.push(l); if (l !== null) saved = l; },
    setTimer: (run, ms) => { const t = { run, ms, live: true }; timers.push(t); return t; }, clearTimer: h => { (h as { live: boolean }).live = false; } });
  return { keeper, writes, fire: () => { for (const t of timers) if (t.live) { t.live = false; t.run(); } } };
}

test('two drags inside the wait are both written, once, on top of what was saved', () => {
  const f = fixture({ old: { x: 1, y: 1 } });
  f.keeper.keep({ a: { x: 16, y: 16 } }); f.keeper.keep({ b: { x: 32, y: 32 } });
  assert.equal(f.writes.length, 0); f.fire();
  assert.deepEqual(f.writes, [{ old: { x: 1, y: 1 }, a: { x: 16, y: 16 }, b: { x: 32, y: 32 } }]);
});

test('the later place of the same node wins, and a later drag after a write keeps the earlier ones', () => {
  const f = fixture(); f.keeper.keep({ a: { x: 1, y: 1 } }); f.keeper.keep({ a: { x: 2, y: 2 } }); f.fire(); f.keeper.keep({ c: { x: 3, y: 3 } }); f.fire();
  assert.deepEqual(f.writes, [{ a: { x: 2, y: 2 } }, { a: { x: 2, y: 2 }, c: { x: 3, y: 3 } }]);
});

test('a second write that lands before the saved places come back still includes the first', () => {
  const writes: Record<string, Place>[] = []; const stale: Record<string, Place> = { old: { x: 0, y: 0 } };
  const k = createKeeper({ delay: 1, saved: () => stale, commit: l => { if (l !== null) writes.push(l); }, setTimer: run => { run(); return null; }, clearTimer: () => undefined });
  k.keep({ a: { x: 1, y: 1 } }); k.keep({ b: { x: 2, y: 2 } });
  assert.deepEqual(writes[1], { old: { x: 0, y: 0 }, a: { x: 1, y: 1 }, b: { x: 2, y: 2 } });
});

test('flush writes at once (leaving the screen, losing focus, quitting) and does nothing when nothing waits', () => {
  const f = fixture(); f.keeper.flush(); assert.equal(f.writes.length, 0);
  f.keeper.keep({ a: { x: 5, y: 5 } }); assert.equal(f.keeper.pending(), true); f.keeper.flush(); assert.deepEqual(f.writes, [{ a: { x: 5, y: 5 } }]); assert.equal(f.keeper.pending(), false); f.fire(); assert.equal(f.writes.length, 1, 'the timer does not write again');
});

test('forget drops what waits and clears the saved places', () => {
  const f = fixture(); f.keeper.keep({ a: { x: 5, y: 5 } }); f.keeper.forget(); f.fire(); assert.deepEqual(f.writes, [null]);
});

test('with real timers, two quick drags are both kept', async () => {
  const writes: Record<string, Place>[] = []; let saved: Record<string, Place> = {};
  const k = createKeeper({ delay: 20, saved: () => saved, commit: l => { if (l !== null) { saved = l; writes.push(l); } } });
  k.keep({ a: { x: 1, y: 1 } }); await new Promise(r => setTimeout(r, 5)); k.keep({ b: { x: 2, y: 2 } }); await new Promise(r => setTimeout(r, 60));
  assert.deepEqual(writes, [{ a: { x: 1, y: 1 }, b: { x: 2, y: 2 } }]);
});
