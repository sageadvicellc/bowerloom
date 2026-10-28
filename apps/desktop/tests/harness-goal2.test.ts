// Goal 2 of the 0.8 build, as pure logic and as static checks of the styles: the graph fits above its legend, every control the sheets add has a hover and a
// focus style, the leaf stands in the rail, and the Preview mark no longer says the 900 by 600 layouts are missing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FIT_FOOT, fitView } from '../shared/harness/layout.js';
import { WORDS } from '../renderer/harness/words.js';
import { DESKTOP } from './support.js';

const css = (file: string): string => readFileSync(join(DESKTOP, file), 'utf8');

test('a fitted graph leaves the foot of the stage to the legend, so no part sits under it', () => {
  const bounds = { left: 0, top: 0, right: 600, bottom: 900 };
  const v = fitView(bounds, 560, 548, 16, FIT_FOOT);
  const bottom = v.y + bounds.bottom * v.k;
  assert.ok(bottom <= 548 - FIT_FOOT - 16 + 0.5, `the graph ends at ${bottom}, above the legend`);
  assert.ok(v.y >= 16 - 0.5);
  assert.ok(FIT_FOOT >= 40, 'the foot holds one line of the legend and its margin');
  // With no foot, the old fit stays as it was.
  assert.deepEqual(fitView(bounds, 560, 548), fitView(bounds, 560, 548, 16, 0));
});

// The hover and focus of every control of the sheets are measured in the window, not read from the style sheets: e2e/harness-small.spec.ts opens each
// sheet at 900 by 600, walks it with Tab and checks an outline on each control, and hovers each button and tick box (U14).
test('the sheet styles move nothing: colour only, and none with reduced motion', () => {
  const engine = css('renderer/harness/sheets/engine.css');
  assert.doesNotMatch(engine, /transition:[^;]*transform|animation:/, 'colour only; nothing travels');
  assert.match(engine, /@media \(prefers-reduced-motion: reduce\) \{\s*\[data-home\] \.hxe-tick \{ transition: none !important; \}/);
});

test('the sage leaf stands in the rail as well as in the open navigation; its name stays for a screen reader', () => {
  const harness = css('renderer/harness/harness.css');
  assert.match(harness, /\[data-home\]\[data-shell="harness"\] \.hm-nav\[data-mode="rail"\] \.hm-brand \{ display: flex;/);
  assert.match(harness, /\[data-home\]\[data-shell="harness"\] \.hm-nav\[data-mode="rail"\] \.hm-brand > span \{ position: absolute; width: 1px; height: 1px;/);
  // The rules that touch the shared kit or the shared navigation are held to the harness-first shell, so the home app looks as it did.
  assert.equal(harness.split('\n').filter(l => /^\[data-home\] \.(?:kit-button|hm-nav|hm-brand)/.test(l)).length, 0, 'no rule of the preview restyles the shared kit or navigation for the home app');
  assert.match(css('renderer/harness/Shell.tsx'), /data-home="" data-shell="harness"/);
  assert.match(css('renderer/harness/Navigation.tsx'), /<div className="hm-brand"><HIcon name="leaf"/);
});

test('the Preview mark no longer lists the 900 by 600 layouts as missing', () => {
  assert.ok(!WORDS.notInPreview.some(line => /900 by 600/.test(line)));
});
