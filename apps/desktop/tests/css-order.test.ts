// The order of the style sheets is part of the look: a harness rule such as `.hxf-steps .kit-step` ties in specificity with a kit rule and wins only by coming later.
// The harness mount imports the kit sheets first and in a fixed order, so that order never depends on which screen imports a kit part first.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DESKTOP } from './support.js';

const KIT_SHEETS = ['home/home-tokens.css', 'home/kit/kit.css', 'home/home.css', 'home/kit/menu.css', 'home/shell/shell.css', 'home/kit/stepper.css'];

test('the harness mount imports the kit sheets first, in the order that the cascade needs', () => {
  const source = readFileSync(join(DESKTOP, 'renderer', 'harness', 'mount.tsx'), 'utf8');
  const sheets = [...source.matchAll(/^import '\.\.\/([\w./-]+\.css)';$/gm)].map(m => m[1]);
  assert.deepEqual(sheets, KIT_SHEETS);
  const firstScript = source.search(/^import .* from '\.\.?\/(?!home\/[\w/-]+\.css)/m);
  assert.ok(source.indexOf(`import '../${KIT_SHEETS[0]}'`) < firstScript || firstScript === -1, 'the sheets come before the first import of a screen');
});

test('the first-run steps restyle the kit step with a rule of equal weight, so they must come after the kit sheet', () => {
  const kit = readFileSync(join(DESKTOP, 'renderer', 'home', 'kit', 'stepper.css'), 'utf8');
  const firstRun = readFileSync(join(DESKTOP, 'renderer', 'harness', 'screens', 'first-run.css'), 'utf8');
  assert.match(kit, /\[data-home\] \.kit-step\[data-state="next"\] \{ opacity: 0\.55; \}/);
  assert.match(firstRun, /\[data-home\] \.hxf-steps \.kit-step \{ opacity: 1; \}/);
});
