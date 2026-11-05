// The thin sticky header: the observer wiring, and the rules in the style sheet.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { watchCompact, COMPACT_AFTER, EXPAND_BELOW } from '../src/compact-header.ts';

const read = path => readFile(new URL('../' + path, import.meta.url), 'utf8');

test('the header turns compact when the first sentinel leaves the screen, and expands only when the second is back, with a gap between', () => {
  assert.equal(COMPACT_AFTER, 48);
  assert.equal(EXPAND_BELOW, 16);
  assert.ok(EXPAND_BELOW < COMPACT_AFTER, 'a hysteresis gap');
  const seen = []; const callbacks = []; let disconnected = 0; const observed = [];
  const enter = {}, leave = {};
  const stop = watchCompact(enter, leave, compact => seen.push(compact), cb => { callbacks.push(cb); return { observe: el => observed.push(el), disconnect: () => { disconnected += 1; } }; });
  assert.deepEqual(observed, [enter, leave]);
  const [onEnter, onLeave] = callbacks;
  onEnter([{ isIntersecting: true }]);          // at the top: nothing changes
  onLeave([{ isIntersecting: false }]);         // 30 px down: the bar keeps its state
  assert.deepEqual(seen, [], 'between 16 and 48 px nothing changes');
  onEnter([{ isIntersecting: false }]);         // past 48 px
  assert.deepEqual(seen, [true]);
  onEnter([{ isIntersecting: true }]);          // back to 30 px: still compact
  assert.deepEqual(seen, [true], 'no flicker on the way back');
  onLeave([{ isIntersecting: true }]);          // below 16 px
  assert.deepEqual(seen, [true, false]);
  stop();
  assert.equal(disconnected, 2);
});

test('the sentinels are 48 px and 16 px tall', async () => {
  const css = await read('src/navigation.css');
  assert.match(css, /\.header-sentinel-enter \{ height: 48px; \}/);
  assert.match(css, /\.header-sentinel-leave \{ height: 16px; \}/);
});

test('no scroll or per-frame handler runs for the header', async () => {
  const code = ((await read('src/compact-header.ts')) + (await read('src/App.tsx'))).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(code, /addEventListener\(\s*['"]scroll['"]|onScroll|requestAnimationFrame\(\s*(?:function|\(\)\s*=>)[^)]*scroll/);
});

test('the glass is a layer behind the bar that fades in with opacity: a brand surface at 75%, blur and saturate with the -webkit- prefix, a hairline, and a soft shadow', async () => {
  const css = await read('src/navigation.css');
  const layer = css.match(/\.site-header-shell > \.site-header::before \{[^}]*\}/)[0];
  assert.match(layer, /opacity: 0;/);
  assert.match(layer, /background: color-mix\(in srgb, var\(--ui-surface\) 75%, transparent\)/);
  assert.match(layer, /-webkit-backdrop-filter: blur\(18px\) saturate\(1\.5\); backdrop-filter: blur\(18px\) saturate\(1\.5\)/);
  assert.match(layer, /border-bottom: 1px solid color-mix\(/);
  assert.match(layer, /box-shadow: 0 8px 24px -14px rgb\(30 24 28 \/ \.35\)/);
  assert.match(css, /\.site-header-shell > \.site-header\.is-compact::before \{ opacity: 1; \}/);
  assert.match(css, /\.site-header-shell > \.site-header \{[^}]*border-bottom: 0;/, 'no border on the full bar');
  assert.match(css, /--header-compact-h: 48px;/, 'the thin bar is at least the 44 px touch floor');
  assert.match(css, /\.site-header-shell \{ position: sticky; top: 0; z-index: 30; height: var\(--header-h\);/, 'the shell keeps the full height in the page');
});

test('the glass has an opaque fallback without backdrop-filter and under reduced transparency', async () => {
  const css = await read('src/navigation.css');
  assert.match(css, /@supports not \(\(backdrop-filter: blur\(1px\)\) or \(-webkit-backdrop-filter: blur\(1px\)\)\) \{\s*\.site-header-shell > \.site-header::before \{ background: var\(--ui-surface\); \}/);
  assert.match(css, /@media \(prefers-reduced-transparency: reduce\) \{\s*\.site-header-shell > \.site-header::before \{ background: var\(--ui-surface\); -webkit-backdrop-filter: none; backdrop-filter: none; \}/);
});

test('the change animates only transform and opacity, in 250 ms with a gentle ease-out, and only without a reduced-motion preference', async () => {
  const css = await read('src/navigation.css');
  const gate = css.indexOf('@media (prefers-reduced-motion: no-preference) {\n  :root { --header-ease');
  const block = css.slice(gate, css.indexOf('\n}\n', gate));
  const props = [...block.matchAll(/transition: ([^;]*);/g)].flatMap(m => m[1].replace(/cubic-bezier\([^)]*\)/g, 'curve').split(',').map(part => part.trim().split(/\s+/)[0]));
  assert.deepEqual([...new Set(props)].sort(), ['opacity', 'transform'], 'only compositor properties: the bar moves and the glass fades, and no layout changes');
  assert.ok(block.includes('--header-time: 250ms') && block.includes('--header-ease: cubic-bezier(.3, .5, .2, 1)'));
  assert.equal((block.match(/transition: (?:transform|opacity) var\(--header-time\) var\(--header-ease\)/g) ?? []).length, 3, 'the bar, the glass, and the wordmark share one curve');
  assert.equal((css.replace(block, '').match(/transition:/g) ?? []).length, 1, 'only the stitch draw-in sits in another gate');
});

test('jumps and keyboard focus keep room under the thin bar with one scroll-padding rule, and no section adds its own margin on top of it', async () => {
  const css = await read('src/navigation.css');
  assert.match(css, /html \{ scroll-padding-top: calc\(var\(--header-compact-h\) \+ 16px\); \}/);
  for (const name of ['navigation.css', 'page.css', 'review.css']) assert.doesNotMatch(await read('src/' + name), /scroll-margin-top/, name);
});

/** The progress of a cubic Bezier easing at time `x` (0 to 1), solved by bisection. */
const bezier = (x1, y1, x2, y2) => x => {
  const point = (t, a, b) => 3 * (1 - t) ** 2 * t * a + 3 * (1 - t) * t * t * b + t ** 3;
  let lo = 0, hi = 1;
  for (let i = 0; i < 50; i++) { const mid = (lo + hi) / 2; if (point(mid, x1, x2) < x) lo = mid; else hi = mid; }
  return point((lo + hi) / 2, y1, y2);
};

test('the easing never moves the bar more than 8 px in one 60 Hz frame, even on the tallest bar: the old curve moved 8.1 px in its first frame and read as a snap', async () => {
  const css = await read('src/navigation.css');
  const [x1, y1, x2, y2] = css.match(/--header-ease: cubic-bezier\(([^)]*)\)/)[1].split(',').map(Number);
  const time = Number(css.match(/--header-time: (\d+)ms/)[1]);
  const travel = (100 - 48) / 2;
  const worst = (curve, duration = time) => { let prev = 0, most = 0; for (let t = 1000 / 60; t < duration + 17; t += 1000 / 60) { const v = curve(Math.min(t / duration, 1)); most = Math.max(most, (v - prev) * travel); prev = v; } return most; };
  assert.ok(worst(bezier(x1, y1, x2, y2)) < 6, `worst frame ${worst(bezier(x1, y1, x2, y2)).toFixed(2)} px`);
  assert.ok(worst(bezier(.23, 1, .32, 1), 220) > 8, 'the old curve over 220 ms, for comparison, did jump');
  assert.ok(time >= 200 && time <= 300);
});
