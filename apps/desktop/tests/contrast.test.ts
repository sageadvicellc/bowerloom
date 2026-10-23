// Contrast: every text and background pair in the tokens file meets WCAG AA (4.5 to 1 for text), in light and dark.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DESKTOP } from './support.js';

const css = readFileSync(join(DESKTOP, 'renderer', 'tokens.css'), 'utf8');
function theme(selector: RegExp): Record<string, string> {
  const block = selector.exec(css)![1]!, vars: Record<string, string> = {};
  for (const m of block.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})/g)) vars[m[1]!] = m[2]!;
  return vars;
}
const light = { ...theme(/:root, \[data-theme="light"\] \{([\s\S]*?)\n\}/) }, dark = { ...light, ...theme(/\[data-theme="dark"\] \{([\s\S]*?)\n\}/) };
const lum = (hex: string): number => { const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4); return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!; };
const ratio = (a: string, b: string): number => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x! + 0.05) / (y! + 0.05); };
const PAIRS: [string, string][] = [['text', 'bg'], ['text', 'surface'], ['text', 'surface-2'], ['text', 'accent-soft'], ['text-muted', 'bg'], ['text-muted', 'surface'], ['text-muted', 'surface-2'], ['accent-contrast', 'accent'], ['accent-contrast', 'accent-strong'], ['accent-strong', 'surface'], ['accent-strong', 'bg'], ['good-fg', 'good-bg'], ['warn-fg', 'warn-bg'], ['bad-fg', 'bad-bg'], ['quiet-fg', 'quiet-bg'], ['text-muted', 'accent-soft']];

for (const [name, vars] of [['light', light], ['dark', dark]] as const) {
  test(`${name} theme: every text pair meets contrast 4.5 to 1`, () => {
    for (const [fg, bg] of PAIRS) { const r = ratio(vars[fg]!, vars[bg]!); assert.ok(r >= 4.5, `${fg} on ${bg} is ${r.toFixed(2)}`); }
  });
  test(`${name} theme: the focus ring is visible against the page (3 to 1)`, () => {
    for (const bg of ['bg', 'surface']) assert.ok(ratio(vars.focus!, vars[bg]!) >= 3, `focus on ${bg}`);
  });
}
