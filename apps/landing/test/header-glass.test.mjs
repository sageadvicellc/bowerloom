// The sticky header: the glass layer and the rules in the style sheet.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL('../' + path, import.meta.url), 'utf8');

test('the glass is a layer behind the bar that fades in with opacity: a brand surface at 75%, blur and saturate with the -webkit- prefix, a hairline, and a soft shadow', async () => {
  const css = await read('src/navigation.css');
  const layer = css.match(/\.site-header-shell > \.site-header::before \{[^}]*\}/)[0];
  assert.match(layer, /opacity: var\(--header-p\);/);
  assert.match(layer, /background: color-mix\(in srgb, var\(--ui-surface\) 75%, transparent\)/);
  assert.match(layer, /-webkit-backdrop-filter: blur\(18px\) saturate\(1\.5\); backdrop-filter: blur\(18px\) saturate\(1\.5\)/);
  assert.match(layer, /border-bottom: 1px solid color-mix\(/);
  assert.match(layer, /box-shadow: 0 8px 24px -14px rgb\(30 24 28 \/ \.35\)/);
  assert.match(css, /\.site-header-shell > \.site-header \{[^}]*border-bottom: 0;/, 'no border on the full bar');
  assert.match(css, /--header-compact-h: 48px;/, 'the thin bar is at least the 44 px touch floor');
  assert.match(css, /\.site-header-shell \{ position: sticky; top: 0; z-index: 30; height: var\(--header-h\);/, 'the shell keeps the full height in the page');
});

test('the glass has an opaque fallback without backdrop-filter and under reduced transparency', async () => {
  const css = await read('src/navigation.css');
  assert.match(css, /@supports not \(\(backdrop-filter: blur\(1px\)\) or \(-webkit-backdrop-filter: blur\(1px\)\)\) \{\s*\.site-header-shell > \.site-header::before \{ background: var\(--ui-surface\); \}/);
  assert.match(css, /@media \(prefers-reduced-transparency: reduce\) \{\s*\.site-header-shell > \.site-header::before \{ background: var\(--ui-surface\); -webkit-backdrop-filter: none; backdrop-filter: none; \}/);
});

test('jumps and keyboard focus keep room under the thin bar with one scroll-padding rule, and no section adds its own margin on top of it', async () => {
  const css = await read('src/navigation.css');
  assert.match(css, /html \{ scroll-padding-top: calc\(var\(--header-compact-h\) \+ 16px\); \}/);
  for (const name of ['navigation.css', 'page.css', 'review.css']) assert.doesNotMatch(await read('src/' + name), /scroll-margin-top/, name);
});
