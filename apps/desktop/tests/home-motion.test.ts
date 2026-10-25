// The motion tokens of the home app: the drawer slide is 220 ms, the card hover 90 ms, the tour spotlight 160 ms, and every one is 0 under reduce motion.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MOTION, applyMotionTokens } from '../renderer/motion-tokens.js';
import { DESKTOP } from './support.js';

type Matcher = (query: string) => { matches: boolean };
const g = globalThis as unknown as { matchMedia?: Matcher };
function published(reduce: boolean): Record<string, string> {
  const before = g.matchMedia;
  g.matchMedia = query => ({ matches: reduce && /prefers-reduced-motion/.test(query) });
  const out: Record<string, string> = {};
  try { applyMotionTokens({ style: { setProperty: (name: string, value: string) => { out[name] = value; } } } as unknown as HTMLElement); } finally { if (before === undefined) delete g.matchMedia; else g.matchMedia = before; }
  return out;
}
const read = (file: string): string => readFileSync(join(DESKTOP, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

test('the home group holds the drawer (220 ms), the tour spotlight (160 ms) and the dim (160 ms), all with the strong ease-out', () => {
  const h = MOTION.home;
  assert.deepEqual({ drawer: h.drawer.ms, spot: h.tourSpot.ms, dim: h.tourDim.ms, travel: h.drawer.distance }, { drawer: 220, spot: 160, dim: 160, travel: 24 });
  for (const t of [h.drawer, h.tourSpot, h.tourDim]) assert.equal(t.ease, MOTION.ease.out);
  assert.equal(MOTION.map.hover.ms, 90, 'a card hover is 90 ms'); assert.equal(MOTION.panel.slide.ms, h.drawer.ms, 'the drawer matches the panel slide'); assert.equal(Object.isFrozen(h), true);
});

test('the home tokens are published as page properties, and are 0 with reduce motion on', () => {
  const on = published(false);
  assert.equal(on['--motion-home-drawer-ms'], '220ms'); assert.equal(on['--motion-home-tour-spot-ms'], '160ms'); assert.equal(on['--motion-home-tour-dim-ms'], '160ms');
  assert.equal(on['--motion-home-drawer-travel'], '24px'); assert.equal(on['--motion-home-drawer-ease'], MOTION.ease.out); assert.equal(on['--motion-hover-ms'], '90ms');
  const off = published(true);
  for (const name of ['--motion-home-drawer-ms', '--motion-home-tour-spot-ms', '--motion-home-tour-dim-ms', '--motion-hover-ms', '--motion-panel-close-ms']) assert.equal(off[name], '0ms', name);
  assert.equal(off['--motion-home-drawer-travel'], '0px');
});

test('the home style sheets take their timing from the tokens and never write a duration of their own', () => {
  for (const file of ['renderer/home/kit/kit.css', 'renderer/home/home.css', 'renderer/home/tour/tour.css']) {
    const css = read(file);
    assert.doesNotMatch(css, /(?<![-\w])\d+(\.\d+)?m?s\b(?![^;{}]*var\()/, `${file} has a fixed time`);
    for (const m of css.matchAll(/(transition|animation)\s*:\s*([^;]+);/g)) assert.match(m[2]!, /var\(--motion-|none/, `${file}: ${m[0]}`);
  }
  assert.match(read('renderer/home/kit/kit.css'), /prefers-reduced-motion: reduce[\s\S]*animation: none !important; transition: none !important/);
  assert.match(read('renderer/home/tour/tour.css'), /prefers-reduced-motion: reduce[\s\S]*transition: none !important/);
});

// ---- The drawer and the page move together (fix list items 1 and 2).
test('the page makes room for a drawer on the drawer\'s own clock, and the shelves fade out in 110 ms', () => {
  const h = MOTION.home;
  assert.deepEqual({ ms: h.shelves.ms, ease: h.shelves.ease }, { ms: 110, ease: MOTION.ease.out });
  const css = read('renderer/home/home.css');
  // Opening: the padding grows in the drawer's 220 ms. Closing: it shrinks in the close time of the drawer, so the two never part.
  assert.match(css, /\.hm-body\[data-moving\]\s*\{[^}]*transition:[^;]*padding-right var\(--motion-panel-close-ms[^;]*var\(--motion-panel-close-ease/);
  assert.match(css, /\.hm-body\[data-drawer\]\s*\{ padding-right: var\(--hm-drawer-w\); \}/);
  assert.match(css, /\.hm-body\[data-moving\]\[data-drawer\]\s*\{[^}]*transition:[^;]*padding-right var\(--motion-home-drawer-ms[^;]*var\(--motion-home-drawer-ease/);
  // The transition belongs to the drawer alone: the plain body has none, so a resize of the window never runs it.
  assert.doesNotMatch(css, /\.hm-body\s*\{[^}]*transition:/);
  // The shelves give way with a fade; they are not taken out of the page in one frame.
  assert.match(css, /\.hm-panel\s*\{[^}]*transition:[^;]*opacity var\(--motion-home-shelves-ms/);
  const narrow = /@media \(min-width: 761px\) and \(max-width: 1199px\) \{([\s\S]*?)\n\}/.exec(css);
  assert.ok(narrow !== null, 'the narrow rules are there');
  assert.doesNotMatch(narrow[1]!, /display: none/);
  assert.match(narrow[1]!, /\.hm-panel \{[^}]*opacity: 0;[^}]*visibility: hidden/);
});

test('the shelves token and the overlay tokens are published, and are 0 with reduce motion on', () => {
  const on = published(false);
  assert.equal(on['--motion-home-shelves-ms'], '110ms');
  assert.equal(on['--motion-home-overlay-in-ms'], '140ms'); assert.equal(on['--motion-home-overlay-travel'], '4px'); assert.equal(on['--motion-home-overlay-out-ms'], '100ms');
  assert.equal(on['--motion-home-overlay-in-ease'], MOTION.ease.out); assert.equal(on['--motion-home-overlay-out-ease'], MOTION.ease.in);
  const off = published(true);
  for (const name of ['--motion-home-shelves-ms', '--motion-home-overlay-in-ms', '--motion-home-overlay-out-ms']) assert.equal(off[name], '0ms', name);
  assert.equal(off['--motion-home-overlay-travel'], '0px');
});
