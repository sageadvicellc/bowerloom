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

for (const [name, vars] of [['light', light], ['dark', dark]] as const) {
  test(`${name} theme: the eight graph colours are each seen against the graph's background (3 to 1, for shapes)`, () => {
    for (let i = 1; i <= 8; i++) assert.ok(ratio(vars[`graph-${i}`]!, vars.surface!) >= 3, `graph-${i} is ${ratio(vars[`graph-${i}`]!, vars.surface!).toFixed(2)}`);
  });
}

// ---- The prototype's own tokens (renderer/proto/proto-tokens.css). They change nothing for the 0.7 screens: every rule starts at `.shell[data-proto]`.
const protoCss = readFileSync(join(DESKTOP, 'renderer', 'proto', 'proto-tokens.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
function protoTheme(selector: RegExp): Record<string, string> {
  const block = selector.exec(protoCss)![1]!, vars: Record<string, string> = {};
  for (const m of block.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})/g)) vars[m[1]!] = m[2]!;
  return vars;
}
const protoLight = { ...light, ...protoTheme(/^\.shell\[data-proto\] \{([\s\S]*?)\n\}/m) }, protoDark = { ...dark, ...protoTheme(/^\[data-theme="dark"\] \.shell\[data-proto\] \{([\s\S]*?)\n\}/m) };

test('the prototype overrides only reach the prototype: every selector starts at the shell root that only the prototype has', () => {
  const selectors = [...protoCss.matchAll(/(^|\})\s*([^{}]+)\{/g)].map(m => m[2]!.trim());
  assert.ok(selectors.length >= 5);
  for (const selector of selectors) for (const part of selector.split(',')) assert.match(part.trim(), /^(\[data-theme="dark"\] )?\.shell\[data-proto\]/, part);
  assert.doesNotMatch(protoCss, /:root/);
});

for (const [name, vars] of [['light', protoLight], ['dark', protoDark]] as const) {
  test(`${name} theme, prototype: the edge of a card, bar, field or button is 3 to 1 against the page, a card and a quiet panel`, () => {
    for (const against of ['bg', 'surface', 'surface-2']) assert.ok(ratio(vars['border-strong']!, vars[against]!) >= 3, `border-strong on ${against} is ${ratio(vars['border-strong']!, vars[against]!).toFixed(2)}`);
  });
  test(`${name} theme, prototype: the text of a disabled button is 3 to 1 on every surface it can sit on`, () => {
    for (const on of ['bg', 'surface', 'surface-2']) assert.ok(ratio(vars['disabled-fg']!, vars[on]!) >= 3, `disabled-fg on ${on} is ${ratio(vars['disabled-fg']!, vars[on]!).toFixed(2)}`);
  });
  test(`${name} theme, prototype: every text pair still meets 4.5 to 1, the focus ring 3 to 1, and the graph colours 3 to 1`, () => {
    for (const [fg, bg] of PAIRS) assert.ok(ratio(vars[fg]!, vars[bg]!) >= 4.5, `${fg} on ${bg} is ${ratio(vars[fg]!, vars[bg]!).toFixed(2)}`);
    for (const bg of ['bg', 'surface']) assert.ok(ratio(vars.focus!, vars[bg]!) >= 3, `focus on ${bg}`);
    for (let i = 1; i <= 8; i++) assert.ok(ratio(vars[`graph-${i}`]!, vars.surface!) >= 3, `graph-${i}`);
  });
  test(`${name} theme, prototype: the strong border is far stronger than the old one`, () => {
    assert.ok(ratio(vars['border-strong']!, vars.bg!) > ratio(vars.border!, vars.bg!) * 2, 'the old border was 1.4 to 1');
  });
}

test('a disabled button in the prototype is an outline with dashes, at full opacity, with its own text colour', () => {
  assert.match(protoCss, /\.shell\[data-proto\] \.btn:disabled[^{]*\{[^}]*opacity: 1;/);
  assert.match(protoCss, /\.shell\[data-proto\] \.btn:disabled[^{]*\{[^}]*color: var\(--disabled-fg\)/);
  assert.match(protoCss, /\.shell\[data-proto\] \.btn:disabled[^{]*\{[^}]*outline: 1px dashed var\(--border-strong\)/);
});
