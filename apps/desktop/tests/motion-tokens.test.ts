// The prototype's motion tokens: the weighting is confirmed, the proto group exists, and "reduce motion" zeroes every duration.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MOTION, applyMotionTokens, ms } from '../renderer/motion-tokens.js';
import { DESKTOP } from './support.js';

type Matcher = (query: string) => { matches: boolean };
const g = globalThis as unknown as { matchMedia?: Matcher };

/** Runs `body` with the reduce-motion setting on or off, and puts the global back afterwards. */
function withReduce<T>(reduce: boolean, body: () => T): T {
  const before = g.matchMedia;
  g.matchMedia = query => ({ matches: reduce && /prefers-reduced-motion/.test(query) });
  try { return body(); } finally { if (before === undefined) delete g.matchMedia; else g.matchMedia = before; }
}
const published = (): Record<string, string> => {
  const out: Record<string, string> = {};
  applyMotionTokens({ style: { setProperty: (name: string, value: string) => { out[name] = value; } } } as unknown as HTMLElement);
  return out;
};

test('the header says the maintainer confirmed the weighting on 2026-10-24, and no longer says unconfirmed', () => {
  const source = readFileSync(join(DESKTOP, 'renderer', 'motion-tokens.ts'), 'utf8'), header = source.slice(0, source.indexOf('export interface Transition'));
  assert.doesNotMatch(header, /UNCONFIRMED|OWNER TO CHOOSE/i);
  assert.match(header, /2026-10-24/); assert.match(header, /spec section 7/i);
  for (const lens of ['Jakub', 'Emil', 'Jhey']) assert.match(header, new RegExp(lens));
  for (const surface of [/whole product/i, /setup and scan/i, /versions and export/i, /knowledge graph/i]) assert.match(header, surface);
});

test('the proto group holds the four tokens with the agreed durations and the existing settle ease', () => {
  const p = MOTION.proto;
  assert.deepEqual({ ms: p.setupReveal.ms, stagger: p.setupReveal.stagger }, { ms: 280, stagger: 40 });
  assert.equal(p.versions.ms, 240); assert.equal(p.lasso.ms, 90); assert.equal(p.dropSettle.ms, 220);
  assert.equal(p.dropSettle.ease, MOTION.ease.settle);
  for (const t of [p.setupReveal, p.versions, p.lasso, p.dropSettle]) { assert.match(t.ease, /^cubic-bezier\(/); assert.ok(Number.isFinite(t.ms) && t.ms > 0); }
  assert.equal(Object.isFrozen(p), true);
  assert.ok(p.lasso.ms < p.dropSettle.ms && p.dropSettle.ms < p.versions.ms && p.versions.ms < p.setupReveal.ms, 'a busy action is quickest, a reveal is slowest');
});

test('ms gives the duration, or 0 when the person asked for less motion', () => {
  assert.equal(withReduce(false, () => ms(MOTION.proto.versions.ms)), 240);
  assert.equal(withReduce(true, () => ms(MOTION.proto.versions.ms)), 0);
  assert.equal(ms(MOTION.proto.lasso.ms), MOTION.proto.lasso.ms, 'with no matchMedia at all (a plain Node run) the duration is kept');
});

test('the proto tokens are published as page properties', () => {
  const props = withReduce(false, published);
  assert.equal(props['--motion-setup-reveal-ms'], '280ms'); assert.equal(props['--motion-setup-reveal-stagger'], '40ms');
  assert.equal(props['--motion-versions-ms'], '240ms'); assert.equal(props['--motion-lasso-ms'], '90ms'); assert.equal(props['--motion-drop-settle-ms'], '220ms');
  assert.equal(props['--motion-drop-settle-ease'], MOTION.ease.settle); assert.equal(props['--motion-setup-reveal-ease'], MOTION.proto.setupReveal.ease);
  assert.equal(props['--motion-reduced'], '0');
});

test('with reduce motion on, every published duration and every stagger is 0, the old ones and the proto ones', () => {
  const props = withReduce(true, published), durations = Object.entries(props).filter(([name]) => /-(ms|stagger)$/.test(name));
  assert.ok(durations.length >= 17, `${durations.length} durations`);
  for (const [name, value] of durations) assert.equal(value, '0ms', name);
  for (const name of ['--motion-setup-reveal-ms', '--motion-setup-reveal-stagger', '--motion-versions-ms', '--motion-lasso-ms', '--motion-drop-settle-ms']) assert.equal(props[name], '0ms', name);
  assert.equal(props['--motion-reduced'], '1');
});

test('the same call twice publishes the same values, and a call changes nothing it reads', () => {
  const before = JSON.stringify(MOTION);
  assert.deepEqual(withReduce(false, published), withReduce(false, published));
  assert.equal(JSON.stringify(MOTION), before);
});

test('the shared button of the page styles takes its timing from the hover token and the strong ease-out, not from a time of their own', () => {
  const css = readFileSync(join(DESKTOP, 'renderer', 'styles.css'), 'utf8'), tokens = readFileSync(join(DESKTOP, 'renderer', 'tokens.css'), 'utf8');
  assert.doesNotMatch(css, /var\(--motion\)/, 'no 140 ms with the default ease');
  assert.doesNotMatch(tokens, /--motion:/, 'the old single duration is gone');
  for (const rule of [/\.btn \{[^}]*transition: background var\(--motion-hover-ms, 0ms\) var\(--motion-ease-out, ease\)/]) assert.match(css, rule);
});

test('the hover duration is 90 ms, the ease-out is the strong one, and the travel of a reveal is a token', () => {
  const props = withReduce(false, published);
  assert.equal(props['--motion-hover-ms'], '90ms'); assert.equal(props['--motion-ease-out'], 'cubic-bezier(0.23, 1, 0.32, 1)');
  assert.equal(props['--motion-ease-out'], MOTION.ease.out);
  assert.equal(props['--motion-setup-reveal-travel'], '6px'); assert.equal(props['--motion-versions-travel'], '4px');
  assert.equal(MOTION.proto.setupReveal.distance, 6); assert.equal(MOTION.proto.versions.distance, 4);
});

test('with reduce motion on, the hover duration and every travel are 0, and the ease stays published', () => {
  const props = withReduce(true, published);
  assert.equal(props['--motion-hover-ms'], '0ms');
  assert.equal(props['--motion-setup-reveal-travel'], '0px'); assert.equal(props['--motion-versions-travel'], '0px');
  assert.equal(props['--motion-ease-out'], MOTION.ease.out);
});
