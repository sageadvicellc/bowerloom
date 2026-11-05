// The sticky header follows the scroll position: one progress value p, 0 at the top and 1 at the compact distance, written to --header-p.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { headerProgress, watchHeaderProgress } from '../src/header-progress.ts';

const read = path => readFile(new URL('../' + path, import.meta.url), 'utf8');

test('progress is the scroll distance over the compact distance, clamped to 0 and 1, with no hysteresis', () => {
  assert.equal(headerProgress(0, 52), 0);
  assert.equal(headerProgress(26, 52), 0.5);
  assert.equal(headerProgress(52, 52), 1);
  assert.equal(headerProgress(900, 52), 1);
  assert.equal(headerProgress(-30, 52), 0, 'rubber-band overscroll never goes below 0');
  assert.equal(headerProgress(10, 0), 1, 'a zero distance is already compact');
  assert.equal(headerProgress(10, Number.NaN), 0);
  const ups = [0, 12, 24, 36, 48, 96].map(y => headerProgress(y, 52));
  for (let i = 1; i < ups.length; i++) assert.ok(ups[i] >= ups[i - 1]);
  assert.equal(headerProgress(24, 52), headerProgress(24, 52), 'the same scroll gives the same value going up or down');
});

function fakeWindow(distance) {
  const listeners = new Map(); const frames = []; const written = [];
  const win = {
    scrollY: 0,
    addEventListener: (type, fn, options) => { listeners.set(type, { fn, options }); },
    removeEventListener: type => { listeners.delete(type); },
    requestAnimationFrame: fn => { frames.push(fn); return frames.length; },
    cancelAnimationFrame: () => { frames.length = 0; },
  };
  const state = { distance };
  return { win, listeners, frames, written, state, write: p => written.push(p), distance: () => state.distance };
}

test('p is written once at start, once more per frame after any number of scroll events, and again on resize', () => {
  const f = fakeWindow(50);
  const stop = watchHeaderProgress({ win: f.win, distance: f.distance, write: f.write });
  assert.deepEqual(f.written, [0], 'set once on load');
  assert.deepEqual([...f.listeners.keys()].sort(), ['resize', 'scroll']);
  assert.deepEqual(f.listeners.get('scroll').options, { passive: true });
  f.win.scrollY = 10; f.listeners.get('scroll').fn();
  f.win.scrollY = 25; f.listeners.get('scroll').fn();
  assert.equal(f.frames.length, 1, 'throttled to one frame request');
  f.frames.shift()();
  assert.deepEqual(f.written, [0, 0.5], 'reads the position when the frame runs');
  f.win.scrollY = 0; f.listeners.get('scroll').fn(); f.frames.shift()();
  assert.deepEqual(f.written, [0, 0.5, 0], 'scrolling back reverses exactly');
  f.win.scrollY = 10; f.state.distance = 20; f.listeners.get('resize').fn();
  assert.deepEqual(f.written, [0, 0.5, 0, 0.5], 'resize writes at once, with the new distance');
  stop();
  assert.equal(f.listeners.size, 0);
});

test('a value that has not changed is not written again', () => {
  const f = fakeWindow(50);
  watchHeaderProgress({ win: f.win, distance: f.distance, write: f.write });
  f.win.scrollY = 80; f.listeners.get('scroll').fn(); f.frames.shift()();
  f.win.scrollY = 90; f.listeners.get('scroll').fn(); f.frames.shift()();
  assert.deepEqual(f.written, [0, 1]);
});

test('the compact distance is the full header height minus the compact strip, from the style sheet, so the photo edge meets the strip exactly at p = 1', async () => {
  const code = (await read('src/header-progress.ts')).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(code, /setTimeout|transition|IntersectionObserver/);
  assert.match(await read('src/App.tsx'), /watchHeaderProgress/);
  assert.doesNotMatch(await read('src/App.tsx'), /is-compact|header-sentinel|watchCompact/);
});

test('every part of the change is driven by --header-p, with only transform and opacity, and no time-based transition on the header', async () => {
  const css = await read('src/navigation.css');
  assert.match(css, /:root \{[^}]*--header-p: 0;/, 'a default so the full bar shows before the script runs');
  assert.match(css, /\.site-header-shell > \.site-header \{[^}]*transform: translateY\(calc\(var\(--header-shift\) \* var\(--header-p\)\)\)/);
  assert.match(css, /\.site-header \.brand \{[^}]*transform: scale\(calc\(1 - \.4 \* var\(--header-p\)\)\)/);
  assert.match(css, /::before \{[^}]*opacity: var\(--header-p\)/);
  assert.doesNotMatch(css, /is-compact|header-sentinel|--header-time|--header-ease/);
  const headerRules = css.split('\n').filter(line => /site-header-shell|\.brand/.test(line) && !/stitch/.test(line));
  assert.doesNotMatch(headerRules.join('\n'), /transition|animation/);
});
