// The size and the title of the window: every launch opens at 1280 by 800, so the shelves sit beside the Add drawer (they hide under 1200 px wide).
// Nothing here needs Electron: the options are plain data.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { windowOptions } from '../main/window-options.js';
import { DESKTOP } from './support.js';

test('every launch opens at 1280 by 800 and is called Bowerloom', () => {
  const o = windowOptions();
  assert.deepEqual({ width: o.width, height: o.height, title: o.title }, { width: 1280, height: 800, title: 'Bowerloom' });
});

test('1280 is past the width where the shelves hide beside a drawer, with the navigation open, and the smallest window keeps the details as a column', () => {
  const css = readFileSync(join(DESKTOP, 'renderer', 'home', 'home.css'), 'utf8');
  // The width asked is that of the middle and right columns: the window less the navigation (232 px open, 48 px as a rail).
  const hides = Number(/@container hmcol \(min-width: 761px\) and \(max-width: (\d+)px\)\s*\{\s*\[data-home\] \.hm-body\[data-drawer\] \{ grid-template-columns: minmax\(0, 1fr\) 0px/.exec(css)![1]);
  assert.ok(windowOptions().width - 232 > hides, `the default width ${windowOptions().width} less the navigation must be wider than ${hides}`);
  assert.ok(windowOptions().minWidth - 48 > 760, 'the smallest window with the rail still holds the details as a column, not under the map');
  assert.ok(1100 - 232 <= hides, 'the old size, 1100, is the one that hid the shelves');
});

test('main.ts builds the window from these options and keeps the title while the page loads', () => {
  const main = readFileSync(join(DESKTOP, 'main', 'main.ts'), 'utf8');
  assert.match(main, /\.\.\.windowOptions\(\)/);
  assert.match(main, /page-title-updated/);
});
