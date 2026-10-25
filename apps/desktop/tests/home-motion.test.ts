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
  for (const file of ['renderer/home/kit/kit.css', 'renderer/home/home.css', 'renderer/home/tour/tour.css', 'renderer/home/add/add.css', 'renderer/home/save/save.css', 'renderer/home/notes/notes.css', 'renderer/home/share/share.css', 'renderer/home/first-run/find.css']) {
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

// ---- The arrival of a new card, the enter and exit of the layers, the press (fix list items 9, 10 and 11).
test('a new card rises and settles in 220 ms, its ring is drawn in 180 ms, held, and fades over 400 ms so it is gone by 5 s', () => {
  const h = MOTION.home;
  assert.deepEqual({ ms: h.arrive.ms, ease: h.arrive.ease, distance: h.arrive.distance }, { ms: 220, ease: MOTION.ease.out, distance: 6 });
  assert.deepEqual({ draw: h.ring.drawMs, fade: h.ring.fadeMs, hold: h.ring.holdMs }, { draw: 180, fade: 400, hold: 5000 });
  assert.ok(h.ring.holdMs - h.ring.fadeMs > h.ring.drawMs, 'the ring is held between being drawn and fading');
  const on = published(false);
  assert.equal(on['--motion-home-arrive-ms'], '220ms'); assert.equal(on['--motion-home-arrive-travel'], '6px'); assert.equal(on['--motion-home-arrive-ease'], MOTION.ease.out);
  assert.equal(on['--motion-home-ring-draw-ms'], '180ms'); assert.equal(on['--motion-home-ring-fade-ms'], '400ms'); assert.equal(on['--motion-home-ring-fade-delay'], '4600ms');
  const off = published(true);
  for (const name of ['--motion-home-arrive-ms', '--motion-home-ring-draw-ms', '--motion-home-ring-fade-ms', '--motion-home-ring-fade-delay']) assert.equal(off[name], '0ms', name);
  assert.equal(off['--motion-home-arrive-travel'], '0px');
  const kit = read('renderer/home/kit/kit.css');
  assert.match(kit, /\.kit-card\[data-fresh\][^{]*\{[^}]*animation:[^;]*kit-ring-draw var\(--motion-home-ring-draw-ms[^;]*kit-ring-fade var\(--motion-home-ring-fade-ms[^;]*var\(--motion-home-ring-fade-delay/);
  assert.match(kit, /\.kit-card\[data-size="small"\]\[data-fresh\][^{]*\{[^}]*animation:[^;]*kit-arrive var\(--motion-home-arrive-ms/);
});

test('a button and a card give a small press: scale 0.98 within 100 ms, and nothing under reduce motion', () => {
  assert.deepEqual({ ms: MOTION.home.press.ms, scale: MOTION.home.press.scale, ease: MOTION.home.press.ease }, { ms: 100, scale: 0.98, ease: MOTION.ease.out });
  const on = published(false), off = published(true);
  assert.equal(on['--motion-home-press-ms'], '100ms'); assert.equal(on['--motion-home-press-scale'], '0.98');
  assert.equal(off['--motion-home-press-ms'], '0ms'); assert.equal(off['--motion-home-press-scale'], '1');
  const kit = read('renderer/home/kit/kit.css');
  assert.match(kit, /\.kit-button:not\(:disabled\):active\s*\{[^}]*transform: scale\(var\(--motion-home-press-scale/);
  assert.match(kit, /\.kit-card:has\(> \.kit-card-main:active\)\s*\{[^}]*transform: scale\(var\(--motion-home-press-scale/);
  assert.match(kit, /\.kit-button\s*\{[^}]*transition:[^;]*transform var\(--motion-home-press-ms/);
  assert.match(kit, /\.kit-card\s*\{[^}]*transition:[^;]*transform var\(--motion-home-press-ms/);
});

test('the Choose notes sheet fades in with an 8 px rise instead of sliding 24 px', () => {
  assert.deepEqual({ ms: MOTION.home.sheet.ms, distance: MOTION.home.sheet.distance, ease: MOTION.home.sheet.ease }, { ms: 180, distance: 8, ease: MOTION.ease.out });
  assert.equal(published(false)['--motion-home-sheet-travel'], '8px'); assert.equal(published(true)['--motion-home-sheet-travel'], '0px');
  const css = read('renderer/home/notes/notes.css');
  assert.match(css, /\.nt-layer \.kit-drawer\[data-phase="open"\]\s*\{[^}]*animation: kit-sheet-in var\(--motion-home-sheet-ms/);
  assert.match(read('renderer/home/kit/kit.css'), /@keyframes kit-sheet-in \{ from \{ opacity: 0; transform: translateY\(var\(--motion-home-sheet-travel/);
  assert.doesNotMatch(css, /translateX/);
});

test('the layers (popover, dialog, share sheet, note, toast) fade in with the overlay tokens and leave faster', () => {
  const kit = read('renderer/home/kit/kit.css'), add = read('renderer/home/add/add.css'), home = read('renderer/home/home.css');
  assert.match(kit, /\.kit-popover\s*\{[^}]*animation: kit-overlay-in var\(--motion-home-overlay-in-ms[^;]*var\(--motion-home-overlay-in-ease/);
  assert.match(kit, /\.kit-popover\[data-leaving\]\s*\{[^}]*animation: kit-overlay-out var\(--motion-home-overlay-out-ms/);
  assert.match(add, /\.add-dialog, \[data-home\] \.sh-dialog\s*\{[^}]*animation: kit-overlay-in var\(--motion-home-overlay-in-ms/);
  assert.match(add, /\.add-scrim\[data-leaving\][^{]*\{[^}]*animation: kit-overlay-out var\(--motion-home-overlay-out-ms/);
  assert.match(home, /\.hm-toast\[data-open\]\s*\{[^}]*animation: hm-toast-in var\(--motion-home-overlay-in-ms/);
  assert.match(home, /\.hm-toast\[data-leaving\]\s*\{[^}]*animation: hm-toast-out var\(--motion-home-overlay-out-ms/);
});

test('the Find tile lights once: no delay between its parts, no rise, and the bar grows by scaleX from its left edge', () => {
  const find = read('renderer/home/first-run/find.css');
  assert.doesNotMatch(find, /fr-rise|animation-delay|home-tile-stagger|home-tile-travel/);
  assert.match(find, /\.fr-progress-fill\s*\{[^}]*transform-origin: left[^}]*transition: transform var\(--motion-home-tile-ms/);
  assert.doesNotMatch(find, /progress-value[^}]*transition/);
  assert.equal('stagger' in MOTION.home.tileLight, false); assert.equal('distance' in MOTION.home.tileLight, false);
});

// ---- The mini accordions of the agent card and the tooltip of the Version history button (Wave A).
test('a mini accordion opens and closes in 160 ms with the strong ease-out, by the height of its row, and is at once under reduce motion', () => {
  assert.deepEqual({ ms: MOTION.home.accordion.ms, ease: MOTION.home.accordion.ease }, { ms: 160, ease: MOTION.ease.out });
  const on = published(false), off = published(true);
  assert.equal(on['--motion-home-accordion-ms'], '160ms'); assert.equal(on['--motion-home-accordion-ease'], MOTION.ease.out); assert.equal(off['--motion-home-accordion-ms'], '0ms');
  const kit = read('renderer/home/kit/kit.css');
  assert.match(kit, /\.kit-acc\s*\{[^}]*grid-template-rows: 0fr;[^}]*transition: grid-template-rows var\(--motion-home-accordion-ms[^;]*var\(--motion-home-accordion-ease/);
  assert.match(kit, /\.kit-acc\[data-open\]\s*\{[^}]*grid-template-rows: 1fr/);
  assert.match(kit, /\.kit-chip \.kit-icon\s*\{[^}]*transition: transform var\(--motion-home-accordion-ms/);
  assert.match(kit, /@media \(prefers-reduced-motion: reduce\) \{\s*\[data-home\] \*[^}]*transition: none !important/, 'the one rule that turns every transition off');
});

test('a tooltip waits 400 ms on hover, and its fade uses the overlay tokens', () => {
  assert.equal(MOTION.home.tooltip.delayMs, 400);
  const kit = read('renderer/home/kit/kit.css');
  assert.match(kit, /\.kit-tip-text\[data-open\]\s*\{[^}]*transition:[^;]*opacity var\(--motion-home-overlay-in-ms/);
  assert.match(kit, /\.kit-tip-text\s*\{[^}]*font-size: var\(--hm-text-small\)/);
  const tip = readFileSync(join(DESKTOP, 'renderer/home/kit/Tooltip.tsx'), 'utf8');
  assert.match(tip, /MOTION\.home\.tooltip\.delayMs/); assert.doesNotMatch(tip, /setTimeout\([^)]*,\s*\d+\)/, 'the wait is a token, not a number in the component');
});
