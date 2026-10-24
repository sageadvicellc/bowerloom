// How the harness canvas looks, read from its style sheet and its source: no stripe on one side of a node, text that stays at 12 pixels or more,
// the entrance that plays once, and "connections" where the screen used to say "wires".
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DESKTOP } from './support.js';

const css = readFileSync(join(DESKTOP, 'renderer/proto/canvas.css'), 'utf8');
const code = readFileSync(join(DESKTOP, 'renderer/proto/HarnessCanvas.tsx'), 'utf8');
const rules = css.replace(/\/\*[\s\S]*?\*\//g, '');

test('a node has one full border and a tinted icon circle, never a stripe on one side', () => {
  assert.doesNotMatch(rules, /border-(left|right|top|bottom)\s*:\s*[0-9.]+px/, 'no single-side border');
  assert.doesNotMatch(rules, /border-(left|right|top|bottom)-width/);
  assert.match(rules, /\.hc-node \{[^}]*border: 1px solid/);
  assert.match(rules, /\.hc-icon \{[^}]*border-radius: 50%[^}]*background: color-mix/);
  assert.match(code, /HarnessIcon name=\{iconNameOf\(n\)\} size=\{16\}/);
});

test('every size of text on a node is at least 12 pixels, and it grows as the picture shrinks', () => {
  for (const m of rules.matchAll(/\.(hc-kind|hc-chip|hc-toggle|hc-detail|hc-label)[^{]*\{[^}]*font-size:\s*([^;]+);/g)) {
    const sizes = [...m[2]!.matchAll(/(\d+(?:\.\d+)?)px/g)].map(x => Number(x[1]));
    assert.ok(sizes.length > 0 && Math.min(...sizes) >= 12, `${m[1]} has text of ${m[2]}`);
  }
  assert.match(rules, /\.hc-kind[^{]*\{[^}]*max\(12px, var\(--hc-far-small/);
  assert.match(rules, /\.hc-label[^{]*\{[^}]*max\(13\.5px, var\(--hc-far-font/);
  assert.match(code, /'--hc-far-font'/); assert.match(code, /NAME_SCREEN = 12\.5/);
  assert.match(rules, /\.react-flow__edge-text \{[^}]*max\(12px, var\(--hc-far-small/);
});

test('a faded node keeps readable text, and the entrance keeps the faded opacity', () => {
  assert.match(rules, /\.hc-node\.is-inherited \{[^}]*opacity: 0\.72/);
  assert.match(rules, /\.hc-node\.is-inherited \.hc-kind[^{]*\{[^}]*color: var\(--text\)/);
  assert.doesNotMatch(rules, /@keyframes hc-enter \{[^}]*\bto\b/, 'no end frame, so the node ends at its own opacity');
  assert.match(rules, /\.hc-root\.is-entering \.hc-node \{[^}]*animation: hc-enter[^}]*backwards/);
});

test('the entrance plays once, a scope switch is a crossfade, a crowd draws no connections in, and reduced motion stops all of it', () => {
  assert.match(rules, /\.hc-root\.is-fade \.react-flow \{[^}]*animation: hc-fade var\(--hc-switch-ms/);
  assert.match(rules, /\.hc-root\.is-drawing \.react-flow__edge\.hc-edge \.react-flow__edge-path \{[^}]*hc-edge-draw/);
  assert.doesNotMatch(rules, /^\.react-flow__edge\.hc-edge \.react-flow__edge-path \{[^}]*animation/m, 'the draw-in is not on every connection all the time');
  assert.match(code, /let entranceSpent = false/); assert.match(code, /DRAW_IN_MAX = 40/); assert.match(code, /SWITCH_MS = 120/);
  assert.match(rules, /\.hc-root\.is-reduced \*[^{]*\{[^}]*animation: none !important/);
});

test('the legend and the labels say connections, not wires', () => {
  assert.match(code, /What the connections mean/); assert.doesNotMatch(code, /What the wires mean/);
  assert.match(code, /'connection' : 'connections'/);
  for (const m of code.matchAll(/(?:ariaLabel|aria-label|title)[:=]\s*[{`"']([^`"'}]*)/g)) assert.doesNotMatch(m[1]!, /\bwires?\b/i, `a label says wire: ${m[1]}`);
});

test('the toolbar of the canvas sits in its own strip: fit leaves that strip free', () => {
  assert.match(code, /FIT_TOP = 60/); assert.match(code, /top: `\$\{FIT_TOP\}px`/);
  assert.match(code, /className="hc-toolbar"/); assert.match(code, /Fit to view/); assert.match(code, /aria-label="Zoom in"/);
});
