// The size and the title of the window: the home app prototype opens at 1280 by 800, so the shelves sit beside the Add drawer (they hide under 1200 px wide).
// The other launches keep the size they always had. Nothing here needs Electron: the options are plain data.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { windowOptions } from '../main/window-options.js';
import { DESKTOP } from './support.js';

test('the home app prototype opens at 1280 by 800 and is called Bowerloom', () => {
  const o = windowOptions(true);
  assert.deepEqual({ width: o.width, height: o.height, title: o.title }, { width: 1280, height: 800, title: 'Bowerloom' });
});

test('every other launch keeps 1100 by 760 and the name Bowerloom Viewer', () => {
  const o = windowOptions(false);
  assert.deepEqual({ width: o.width, height: o.height, title: o.title }, { width: 1100, height: 760, title: 'Bowerloom Viewer' });
});

test('the smallest window is the same for both, and 1280 is past the width where the shelves hide beside a drawer, with the navigation open', () => {
  assert.equal(windowOptions(true).minWidth, windowOptions(false).minWidth);
  assert.equal(windowOptions(true).minHeight, windowOptions(false).minHeight);
  const css = readFileSync(join(DESKTOP, 'renderer', 'home', 'home.css'), 'utf8');
  // The width asked is that of the middle and right columns: the window less the navigation (232 px open, 48 px as a rail).
  const hides = Number(/@container hmcol \(min-width: 761px\) and \(max-width: (\d+)px\)\s*\{\s*\[data-home\] \.hm-body\[data-drawer\] \{ grid-template-columns: minmax\(0, 1fr\) 0px/.exec(css)![1]);
  assert.ok(windowOptions(true).width - 232 > hides, `the default width ${windowOptions(true).width} less the navigation must be wider than ${hides}`);
  assert.ok(windowOptions(true).minWidth - 48 > 760, 'the smallest window with the rail still holds the details as a column, not under the map');
  assert.ok(windowOptions(false).width - 232 <= hides, 'the old size is the one that hid the shelves');
});

test('main.ts builds the window from these options and keeps the title the prototype set while the page loads', () => {
  const main = readFileSync(join(DESKTOP, 'main', 'main.ts'), 'utf8');
  assert.match(main, /windowOptions\(prototypeV2 \|\| prototypeReal\)/);
  assert.match(main, /page-title-updated/);
});
