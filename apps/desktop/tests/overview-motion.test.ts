// The one seam of the Overview's movement (beta.2): soft by default, none under reduced motion, and swappable for another engine later. No DOM: a stand-in element records what it is asked.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MOTION } from '../renderer/motion-tokens.js';
import { glideKeyframes, movesOf, overviewMotion, setOverviewMotion, softMotion } from '../renderer/harness/screens/overview-motion.js';
import type { OverviewMotion, Rect } from '../renderer/harness/screens/overview-motion.js';

interface Call { keyframes: Keyframe[]; options: KeyframeAnimationOptions }
function standIn(): { el: { animate(k: Keyframe[], o: KeyframeAnimationOptions): { cancel(): void } }; calls: Call[]; cancelled: number } {
  const state = { calls: [] as Call[], cancelled: 0 };
  const el = { animate: (keyframes: Keyframe[], options: KeyframeAnimationOptions) => { state.calls.push({ keyframes, options }); return { cancel: () => { state.cancelled += 1; } }; } };
  return { el, get calls() { return state.calls; }, get cancelled() { return state.cancelled; } };
}
function withReducedMotion<T>(reduced: boolean, run: () => T): T {
  const had = Object.getOwnPropertyDescriptor(globalThis, 'matchMedia');
  Object.defineProperty(globalThis, 'matchMedia', { configurable: true, value: () => ({ matches: reduced }) });
  try { return run(); } finally { if (had) Object.defineProperty(globalThis, 'matchMedia', had); else Reflect.deleteProperty(globalThis, 'matchMedia'); }
}
const rect = (x: number, y: number, w = 100, h = 50): Rect => ({ x, y, w, h });

test('a glide starts where the tile was and ends where it is: the keyframes go from the old offset to none', () => {
  const frames = glideKeyframes({ dx: -40, dy: 12 });
  assert.equal(frames.length, 2);
  assert.equal(frames[0]!.transform, 'translate(-40px, 12px)');
  assert.equal(frames[1]!.transform, 'translate(0px, 0px)');
});

test('movesOf lists only the tiles that moved by a pixel or more, as the offset back to where each was', () => {
  const before = new Map([['a', rect(0, 0)], ['b', rect(100, 0)], ['c', rect(0, 50)], ['gone', rect(9, 9)]]);
  const after = new Map([['a', rect(0, 0)], ['b', rect(0.4, 50)], ['c', rect(0, 200)], ['new', rect(5, 5)]]);
  const moves = movesOf(before, after);
  assert.deepEqual([...moves.keys()].sort(), ['b', 'c']);
  assert.deepEqual(moves.get('b'), { dx: 99.6, dy: -50 });
  assert.deepEqual(moves.get('c'), { dx: 0, dy: -150 });
  assert.equal(movesOf(new Map(), after).size, 0, 'nothing was there before, so nothing glides');
  assert.equal(movesOf(before, new Map()).size, 0);
});

test('soft motion animates with the app\'s own layout-move time and ease', () => {
  const s = standIn();
  withReducedMotion(false, () => softMotion.glide(s.el as unknown as HTMLElement, { dx: 10, dy: 0 }));
  assert.equal(s.calls.length, 1);
  assert.equal(s.calls[0]!.options.duration, MOTION.map.layoutMove.ms);
  assert.equal(s.calls[0]!.options.easing, MOTION.map.layoutMove.ease);
  assert.equal(s.calls[0]!.options.fill, 'none', 'the tile rests in its real place after the glide');
});

test('under reduced motion nothing moves: no animation is made', () => {
  const s = standIn();
  withReducedMotion(true, () => softMotion.glide(s.el as unknown as HTMLElement, { dx: 10, dy: 20 }));
  assert.equal(s.calls.length, 0);
});

test('an element that cannot animate, and a move of zero, are left alone', () => {
  const s = standIn();
  withReducedMotion(false, () => {
    assert.doesNotThrow(() => softMotion.glide({} as HTMLElement, { dx: 5, dy: 5 }));
    softMotion.glide(s.el as unknown as HTMLElement, { dx: 0, dy: 0 });
  });
  assert.equal(s.calls.length, 0);
});

test('the seam can be swapped for another engine, and put back', () => {
  const seen: string[] = [];
  const other: OverviewMotion = { glide: (_el, move) => { seen.push(`${move.dx},${move.dy}`); } };
  const first = overviewMotion();
  assert.equal(first, softMotion, 'soft motion is the default');
  setOverviewMotion(other);
  try {
    overviewMotion().glide({} as HTMLElement, { dx: 1, dy: 2 });
    assert.deepEqual(seen, ['1,2']);
  } finally { setOverviewMotion(first); }
  assert.equal(overviewMotion(), softMotion);
});
