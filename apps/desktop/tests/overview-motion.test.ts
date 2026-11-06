// The one seam of the Overview's movement (beta.2): soft by default, none under reduced motion, swappable for another engine later, safe when an engine throws, and the pure rule of what
// glides after a change of the layout. No DOM: a stand-in element records what it is asked.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MOTION } from '../renderer/motion-tokens.js';
import { applyGlides, glideKeyframes, glidePlanOf, guarded, movesOf, overviewMotion, resetOverviewMotionReport, setOverviewMotion, softMotion, stopGlides, translateOf } from '../renderer/harness/screens/overview-motion.js';
import type { GlidePlan, GlideSnapshot, OverviewMotion, Rect } from '../renderer/harness/screens/overview-motion.js';

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
/** Runs with the console's error line recorded, and returns the lines. */
function recordingConsole(run: () => void): string[] {
  const lines: string[] = [], had = console.error;
  console.error = (...args: unknown[]) => { lines.push(args.join(' ')); };
  try { run(); } finally { console.error = had; }
  return lines;
}
const rect = (x: number, y: number, w = 100, h = 50): Rect => ({ x, y, w, h });
const asEl = (value: unknown): HTMLElement => value as HTMLElement;

test('a glide starts where the element was and ends where it is: the keyframes go from the old offset to none', () => {
  const frames = glideKeyframes({ dx: -40, dy: 12 });
  assert.equal(frames.length, 2);
  assert.equal(frames[0]!.transform, 'translate(-40px, 12px)');
  assert.equal(frames[1]!.transform, 'translate(0px, 0px)');
});

test('movesOf lists only the elements that moved by a pixel or more, as the offset back to where each was', () => {
  const before = new Map([['a', rect(0, 0)], ['b', rect(100, 0)], ['c', rect(0, 50)], ['gone', rect(9, 9)]]);
  const after = new Map([['a', rect(0, 0)], ['b', rect(0.4, 50)], ['c', rect(0, 200)], ['new', rect(5, 5)]]);
  const moves = movesOf(before, after);
  assert.deepEqual([...moves.keys()].sort(), ['b', 'c']);
  assert.deepEqual(moves.get('b'), { dx: 99.6, dy: -50 });
  assert.deepEqual(moves.get('c'), { dx: 0, dy: -150 });
  assert.equal(movesOf(new Map(), after).size, 0, 'nothing was there before, so nothing glides');
  assert.equal(movesOf(before, new Map()).size, 0);
});

test('a column change glides with the layout-move time and ease; an open or close glides with the accordion time and ease, which is quick', () => {
  const columns = standIn(), toggle = standIn();
  withReducedMotion(false, () => { softMotion.glide(asEl(columns.el), { dx: 10, dy: 0 }, 'columns'); softMotion.glide(asEl(toggle.el), { dx: 0, dy: 30 }, 'toggle'); });
  assert.equal(columns.calls[0]!.options.duration, MOTION.map.layoutMove.ms);
  assert.equal(columns.calls[0]!.options.easing, MOTION.map.layoutMove.ease);
  assert.equal(toggle.calls[0]!.options.duration, MOTION.home.accordion.ms);
  assert.equal(toggle.calls[0]!.options.easing, MOTION.home.accordion.ease);
  assert.ok(MOTION.home.accordion.ms <= 250, 'a user-started move is 250 ms or less');
  assert.equal(columns.calls[0]!.options.fill, 'none', 'the element rests in its real place after the glide');
});

test('under reduced motion nothing moves: no animation is made', () => {
  const s = standIn();
  withReducedMotion(true, () => { softMotion.glide(asEl(s.el), { dx: 10, dy: 20 }, 'columns'); softMotion.glide(asEl(s.el), { dx: 10, dy: 20 }, 'toggle'); });
  assert.equal(s.calls.length, 0);
});

test('an element that cannot animate, and a move of zero, are left alone', () => {
  const s = standIn();
  withReducedMotion(false, () => {
    assert.doesNotThrow(() => softMotion.glide(asEl({}), { dx: 5, dy: 5 }, 'columns'));
    softMotion.glide(asEl(s.el), { dx: 0, dy: 0 }, 'columns');
  });
  assert.equal(s.calls.length, 0);
});

test('a new glide on an element replaces the one still running, and stop ends it', () => {
  const s = standIn();
  withReducedMotion(false, () => {
    softMotion.glide(asEl(s.el), { dx: 10, dy: 0 }, 'columns');
    softMotion.glide(asEl(s.el), { dx: 0, dy: 10 }, 'columns');
    assert.equal(s.cancelled, 1);
    softMotion.stop(asEl(s.el));
    assert.equal(s.cancelled, 2);
    assert.doesNotThrow(() => softMotion.stop(asEl(s.el)), 'stopping twice is fine');
  });
});

test('the seam can be swapped for another engine, and put back', () => {
  const seen: string[] = [], stopped: string[] = [];
  const other: OverviewMotion = { glide: (_el, move, how) => { seen.push(`${move.dx},${move.dy},${how}`); }, stop: () => { stopped.push('stop'); } };
  const first = overviewMotion();
  assert.equal(first, softMotion, 'soft motion is the default');
  setOverviewMotion(other);
  try {
    overviewMotion().glide(asEl({}), { dx: 1, dy: 2 }, 'toggle');
    stopGlides([asEl({}), asEl({})]);
    assert.deepEqual(seen, ['1,2,toggle']);
    assert.deepEqual(stopped, ['stop', 'stop'], 'a swapped engine is stopped through the same seam');
  } finally { setOverviewMotion(first); }
  assert.equal(overviewMotion(), softMotion);
});

const plan = (): GlidePlan => ({ frames: new Map([['p', { dx: 0, dy: 20 }]]), framesHow: 'toggle', tiles: new Map([['p/skill', { dx: 5, dy: 0 }]]) });

test('an element whose animate throws is caught: one console line naming the class of error, nothing else, and the rest still glide', () => {
  resetOverviewMotionReport();
  const good = standIn();
  const bad = { animate: () => { throw new TypeError('/private/path/secret failed'); } };
  const find = (layer: string): HTMLElement => asEl(layer === 'place' ? bad : good.el);
  const lines = withReducedMotion(false, () => recordingConsole(() => {
    assert.doesNotThrow(() => applyGlides(plan(), find));
    assert.doesNotThrow(() => applyGlides(plan(), find), 'a second failure is silent');
  }));
  assert.equal(lines.length, 1, 'one diagnostic in all');
  assert.match(lines[0]!, /glide \(TypeError\)/);
  assert.doesNotMatch(lines[0]!, /secret|private|\//, 'no message or path from the error');
  assert.equal(good.calls.length, 2, 'the tiles still glided');
});

test('a swapped engine that throws, in glide or in stop, cannot reach the screen', () => {
  resetOverviewMotionReport();
  const first = overviewMotion();
  setOverviewMotion({ glide: () => { throw new RangeError('x'); }, stop: () => { throw new RangeError('y'); } });
  try {
    const lines = recordingConsole(() => {
      assert.doesNotThrow(() => applyGlides(plan(), () => asEl({})));
      assert.doesNotThrow(() => stopGlides([asEl({})]));
    });
    assert.equal(lines.length, 2, 'one line for each step that failed: glide and stop');
    assert.match(lines[0]!, /glide \(RangeError\)/);
    assert.match(lines[1]!, /stop \(RangeError\)/);
  } finally { setOverviewMotion(first); resetOverviewMotionReport(); }
});

test('a find that finds nothing is not an error', () => {
  const lines = recordingConsole(() => applyGlides(plan(), () => null));
  assert.deepEqual(lines, []);
});

// ---- what glides

const snap = (columns: number, open: string, frames: [string, Rect][], tiles: [string, Rect][] = []): GlideSnapshot => ({ columns, open, frames: new Map(frames), tiles: new Map(tiles) });

test('the first layout glides nothing', () => {
  const p = glidePlanOf(null, snap(4, 'a', [['a', rect(0, 0)]], [['a/skill', rect(0, 0)]]));
  assert.equal(p.frames.size, 0); assert.equal(p.tiles.size, 0);
});

test('a press that only selects a part (same columns, same open places) glides nothing, even when a box reads a little different', () => {
  const before = snap(4, 'a,b', [['a', rect(0, 0)], ['b', rect(0, 300)]], [['a/skill', rect(0, 0)]]);
  const after = snap(4, 'a,b', [['a', rect(0, 0)], ['b', rect(0, 340)]], [['a/skill', rect(50, 0)]]);
  const p = glidePlanOf(before, after);
  assert.equal(p.frames.size, 0); assert.equal(p.tiles.size, 0);
});

test('a place that opens or closes glides the places below it as units, with the quick glide, and no tile on its own', () => {
  const before = snap(4, 'a,b', [['a', rect(0, 0, 800, 300)], ['b', rect(0, 300, 800, 300)], ['c', rect(0, 600, 800, 60)]], [['b/skill', rect(0, 50)]]);
  const after = snap(4, 'a', [['a', rect(0, 0, 800, 300)], ['b', rect(0, 300, 800, 60)], ['c', rect(0, 360, 800, 60)]], []);
  const p = glidePlanOf(before, after);
  assert.equal(p.framesHow, 'toggle');
  assert.deepEqual([...p.frames.keys()], ['c'], 'only the place that moved glides');
  assert.deepEqual(p.frames.get('c'), { dx: 0, dy: 240 });
  assert.equal(p.tiles.size, 0, 'tiles move with their frame, not by themselves');
});

test('a change of columns glides the frames and the tiles that kept their size, and lets a tile that changed size snap', () => {
  const before = snap(4, 'a', [['a', rect(0, 0, 800, 300)], ['b', rect(0, 300, 800, 60)]], [['a/agent', rect(0, 40, 200, 150)], ['a/skill', rect(210, 40, 410, 150)], ['a/tool', rect(0, 200, 200, 80)]]);
  const after = snap(2, 'a', [['a', rect(0, 0, 500, 500)], ['b', rect(0, 500, 500, 60)]], [['a/agent', rect(0, 40, 245, 150)], ['a/skill', rect(0, 200, 500, 150)], ['a/tool', rect(0, 360, 200, 80)]]);
  const p = glidePlanOf(before, after);
  assert.equal(p.framesHow, 'columns');
  assert.deepEqual([...p.frames.keys()], ['b']);
  assert.deepEqual([...p.tiles.keys()], ['a/tool'], 'agent changed width and skill moved and changed width: both snap; the tool kept its size and moved');
  assert.deepEqual(p.tiles.get('a/tool'), { dx: 0, dy: -160 });
});

test('a place that opens while the columns change glides its frames quickly and its kept tiles', () => {
  const before = snap(4, 'a', [['a', rect(0, 0)], ['b', rect(0, 100)]], [['a/x', rect(0, 0, 10, 10)]]);
  const after = snap(2, 'a,b', [['a', rect(0, 0)], ['b', rect(0, 300)]], [['a/x', rect(0, 20, 10, 10)]]);
  const p = glidePlanOf(before, after);
  assert.equal(p.framesHow, 'toggle');
  assert.equal(p.tiles.size, 1);
});

test('a swapped engine is not asked to move anything under reduced motion', () => {
  const first = overviewMotion(), asked: string[] = [];
  setOverviewMotion({ glide: () => { asked.push('glide'); }, stop: () => undefined });
  try {
    withReducedMotion(true, () => applyGlides(plan(), () => asEl({})));
    assert.deepEqual(asked, []);
    withReducedMotion(false, () => applyGlides(plan(), () => asEl({})));
    assert.equal(asked.length, 2, 'with motion on, the same plan reaches the engine');
  } finally { setOverviewMotion(first); }
});

test('guarded gives its fallback and reports once for each step, naming only the class of the error', () => {
  resetOverviewMotionReport();
  const lines = recordingConsole(() => {
    assert.equal(guarded('snapshot', 'none', () => { throw new Error('/home/someone/file'); }), 'none');
    assert.equal(guarded('snapshot', 'none', () => { throw new Error('again'); }), 'none');
    assert.equal(guarded('plan', 7, () => { throw 'text'; }), 7);
    assert.equal(guarded('plan', 7, () => 3), 3, 'a step that works gives its own value');
  });
  assert.equal(lines.length, 2);
  assert.match(lines[0]!, /snapshot \(Error\)/);
  assert.match(lines[1]!, /plan \(string\)/);
  assert.ok(lines.every(l => !/someone|again|\/home/.test(l)));
  resetOverviewMotionReport();
});

test('translateOf reads the offset of a computed transform, and nothing from anything else', () => {
  assert.deepEqual(translateOf('matrix(1, 0, 0, 1, 12, -5)'), { x: 12, y: -5 });
  assert.deepEqual(translateOf('matrix3d(1,0,0,0, 0,1,0,0, 0,0,1,0, 7,9,0,1)'), { x: 7, y: 9 });
  assert.deepEqual(translateOf('none'), { x: 0, y: 0 });
  assert.deepEqual(translateOf(undefined), { x: 0, y: 0 });
  assert.deepEqual(translateOf('matrix(1, 0, 0, 1, x, y)'), { x: 0, y: 0 });
});

test('a glide taken over while another still runs starts where the first has the element, so it does not jump', () => {
  const s = standIn();
  let reads = 0;
  const had = Object.getOwnPropertyDescriptor(globalThis, 'getComputedStyle');
  Object.defineProperty(globalThis, 'getComputedStyle', { configurable: true, value: () => { reads += 1; return { transform: 'matrix(1, 0, 0, 1, 12, -5)' }; } });
  try {
    withReducedMotion(false, () => {
      softMotion.glide(asEl(s.el), { dx: 0, dy: 40 }, 'toggle');
      assert.equal(reads, 0, 'nothing was running, so nothing is read');
      softMotion.glide(asEl(s.el), { dx: 10, dy: 20 }, 'toggle');
    });
    assert.equal(reads, 1);
    assert.equal(s.calls[0]!.keyframes[0]!.transform, 'translate(0px, 40px)');
    assert.equal(s.calls[1]!.keyframes[0]!.transform, 'translate(22px, 15px)', 'the new offset plus where the running glide had the element');
    assert.equal(s.cancelled, 1);
    softMotion.stop(asEl(s.el));
    withReducedMotion(false, () => softMotion.glide(asEl(s.el), { dx: 3, dy: 3 }, 'toggle'));
    assert.equal(s.calls[2]!.keyframes[0]!.transform, 'translate(3px, 3px)', 'after a stop nothing is running');
  } finally { if (had) Object.defineProperty(globalThis, 'getComputedStyle', had); else Reflect.deleteProperty(globalThis, 'getComputedStyle'); }
});
