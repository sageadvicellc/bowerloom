import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { createSplashRun, rememberThemeSplash, shouldShowThemeSplash, splashDelivery, splashFadeFor, splashMediaFor, splashTiming, SPLASH_SEEN_KEY } from '../src/theme-splash.ts';

const ready = { ...splashDelivery, status: 'ready' };
const read = path => readFile(new URL('../' + path, import.meta.url), 'utf8');
function memory() { const map = new Map(); return { map, getItem: key => map.get(key) ?? null, setItem: (key, value) => map.set(key, value) }; }
function fixture({ rejectPlay = false } = {}) {
  let now = 0, id = 0; const timers = new Map(), exits = [], starts = [];
  class Video extends EventTarget { plays = 0; async play() { this.plays++; if (rejectPlay) throw Error('Autoplay denied'); } }
  const video = new Video();
  const clock = { after: (fn, ms) => { timers.set(++id, { at: now + ms, fn }); return id; }, clear: key => timers.delete(key) };
  const run = createSplashRun(video, clock, { started: () => starts.push(now), finish: reason => exits.push(reason) });
  return { video, run, exits, starts, timers, advance(ms) { now += ms; for (const [key, timer] of [...timers]) if (timer.at <= now) { timers.delete(key); timer.fn(); } } };
}
const flush = () => new Promise(resolve => setImmediate(resolve));

test('no splash renders while the clips are missing, and each theme gets its own clip', () => {
  assert.equal(splashDelivery.status, 'awaiting-media');
  assert.equal(splashMediaFor('light'), null); assert.equal(splashMediaFor('dark'), null);
  assert.equal(shouldShowThemeSplash({ hash: '', reducedMotion: false, storage: null }), false);
  assert.deepEqual(splashMediaFor('light', ready), { video: '/splash/splash-light.mp4', poster: '/splash/splash-light-poster.jpg' });
  assert.deepEqual(splashMediaFor('dark', ready), { video: '/splash/splash-dark.mp4', poster: '/splash/splash-dark-poster.jpg' });
});

test('the declared delivery state matches the files on disk', async () => {
  const files = ['light', 'dark'].flatMap(theme => [splashDelivery[theme].video, splashDelivery[theme].poster]);
  const present = await Promise.all(files.map(file => access(new URL('../public' + file, import.meta.url)).then(() => true, () => false)));
  assert.equal(splashDelivery.status === 'ready', present.every(Boolean), 'Set status to ready only when all four splash files exist, and only then.');
});

test('once per browser, skipped for deep links and reduced motion, and shown when storage fails', () => {
  const storage = memory();
  assert.equal(shouldShowThemeSplash({ hash: '', reducedMotion: false, storage, delivery: ready }), true);
  assert.equal(shouldShowThemeSplash({ hash: '', reducedMotion: true, storage, delivery: ready }), false);
  assert.equal(shouldShowThemeSplash({ hash: '#build', reducedMotion: false, storage, delivery: ready }), false);
  rememberThemeSplash(storage); assert.equal(storage.map.get(SPLASH_SEEN_KEY), 'seen');
  assert.equal(shouldShowThemeSplash({ hash: '', reducedMotion: false, storage, delivery: ready }), false);
  assert.equal(shouldShowThemeSplash({ hash: '', reducedMotion: false, storage: { getItem() { throw Error('Denied'); } }, delivery: ready }), true);
  assert.equal(shouldShowThemeSplash({ hash: '', reducedMotion: false, storage: null, delivery: ready }), true);
  assert.doesNotThrow(() => rememberThemeSplash({ setItem() { throw Error('Denied'); } }));
});

test('the clip ending fades the splash once, with the full dissolve', async () => {
  const f = fixture(); await flush();
  assert.equal(f.video.plays, 1);
  f.video.dispatchEvent(new Event('playing')); f.video.dispatchEvent(new Event('playing'));
  assert.equal(f.starts.length, 1);
  f.advance(4000); f.video.dispatchEvent(new Event('ended')); f.video.dispatchEvent(new Event('ended'));
  assert.deepEqual(f.exits, ['ended']); assert.equal(f.timers.size, 0);
  assert.equal(splashFadeFor('ended'), splashTiming.fadeMs);
});

test('a stalled clip stops at the hard cap', async () => {
  const f = fixture(); await flush();
  f.video.dispatchEvent(new Event('playing'));
  f.advance(splashTiming.capMs - 1); assert.deepEqual(f.exits, []);
  f.advance(1); assert.deepEqual(f.exits, ['cap']); assert.equal(f.timers.size, 0);
  assert.ok(splashTiming.capMs <= 8000, 'The cap stays a few seconds.');
});

test('a clip that cannot load or play fades at once', async () => {
  const missing = fixture(); await flush();
  missing.video.dispatchEvent(new Event('error'));
  assert.deepEqual(missing.exits, ['error']); assert.equal(missing.starts.length, 0);
  const slow = fixture(); await flush();
  slow.advance(splashTiming.startMs); assert.deepEqual(slow.exits, ['stalled']);
  const blocked = fixture({ rejectPlay: true }); await flush();
  assert.deepEqual(blocked.exits, ['blocked']);
  for (const reason of ['error', 'stalled', 'blocked', 'input']) assert.equal(splashFadeFor(reason), splashTiming.quickFadeMs);
  assert.ok(splashTiming.quickFadeMs <= 250);
});

test('input ends the splash early and disposal silences late events', async () => {
  const f = fixture(); await flush();
  f.run.skip(); f.run.skip(true); assert.deepEqual(f.exits, ['input']);
  const k = fixture(); await flush();
  k.run.skip(true); assert.deepEqual(k.exits, ['key']); assert.equal(splashFadeFor('key'), 0);
  const g = fixture(); g.run.dispose(); await flush();
  assert.equal(g.video.plays, 0);
  g.video.dispatchEvent(new Event('ended')); g.advance(60000); assert.deepEqual(g.exits, []);
});

test('the splash is decorative, has no controls, and sits on the exact theme ground', async () => {
  const component = await read('src/ThemeSplash.tsx'), css = await read('src/theme-splash.css'), app = await read('src/App.tsx');
  assert.match(component, /className="theme-splash" aria-hidden="true"/);
  assert.doesNotMatch(component, /<button|showModal|<video[^>]*\scontrols[\s={>]|autoFocus|tabIndex=\{0\}|\.focus\(/);
  assert.match(component, /tabIndex=\{-1\}/);
  assert.match(css, /\.theme-splash \{[^}]*background: var\(--ui-bg\)/);
  assert.match(css, /\.theme-splash > video \{[^}]*background: var\(--ui-bg\)/);
  assert.match(css, /data-leaving="true"\] \{ opacity: 0; pointer-events: none; \}/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.doesNotMatch(css, /transition: all|ease-in-out|ease;/);
  assert.doesNotMatch(app, /CinematicIntro|banner-replay|replaySplash|intro-media/);
  assert.match(app, /splash && !reduced && <ThemeSplash/);
  assert.match(app, /prefers-reduced-motion: reduce\)"\)\.matches;\n  if \(!shouldShowThemeSplash/);
  assert.match(app, /document\.documentElement\.dataset\.theme === "dark"/);
  assert.match(app, /if \(!active \|\| active === document\.body\) document\.getElementById\('main'\)\?\.focus\(\{ preventScroll: true \}\)/);
});
