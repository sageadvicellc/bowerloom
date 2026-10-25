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

// ---- The 0.8 home app's own tokens (renderer/home/home-tokens.css). They are scoped to [data-home], so the 0.7 screens and the old prototype do not change.
const homeCss = readFileSync(join(DESKTOP, 'renderer', 'home', 'home-tokens.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
function homeBlock(selector: RegExp): string { return selector.exec(homeCss)![1]!; }
const homeVars = (block: string): Record<string, string> => { const v: Record<string, string> = {}; for (const m of block.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})/g)) v[m[1]!] = m[2]!; return v; };
const homeNumber = (block: string, name: string): number => Number(new RegExp(`--${name}:\\s*([0-9.]+)`).exec(block)![1]);
const homeLightBlock = homeBlock(/^\[data-home\] \{([\s\S]*?)\n\}/m), homeDarkBlock = homeBlock(/^\[data-theme="dark"\] \[data-home\], \[data-home\]\[data-theme="dark"\] \{([\s\S]*?)\n\}/m);
const homeLight = { ...light, ...homeVars(homeLightBlock) }, homeDark = { ...dark, ...homeVars(homeDarkBlock) };
const homeKitCss = readFileSync(join(DESKTOP, 'renderer', 'home', 'kit', 'kit.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const homeMapCss = readFileSync(join(DESKTOP, 'renderer', 'home', 'map', 'map.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const mixHex = (top: string, under: string, amount: number): string => '#' + [1, 3, 5].map(i => Math.round(parseInt(top.slice(i, i + 2), 16) * amount + parseInt(under.slice(i, i + 2), 16) * (1 - amount)).toString(16).padStart(2, '0')).join('');

test('the home tokens only reach the home app: every selector starts at [data-home], with a dark variant for each look', () => {
  const selectors = [...homeCss.matchAll(/(^|\})\s*([^{}]+)\{/g)].map(m => m[2]!.trim());
  assert.ok(selectors.length >= 2);
  for (const selector of selectors) for (const part of selector.split(',')) assert.match(part.trim(), /^(\[data-theme="dark"\] )?\[data-home\](\[data-theme="dark"\])?$/, part);
  assert.doesNotMatch(homeCss, /:root/);
  for (const name of ['hm-border', 'hm-ring', 'hm-scrim-alpha', 'hm-shadow']) assert.match(homeDarkBlock, new RegExp(`--${name}:`), `${name} has a dark variant`);
});

test('the home type scale, card sizes, radii and drawer width are the agreed ones', () => {
  for (const [name, value] of [['hm-text-base', '1rem'], ['hm-text-small', '0.875rem'], ['hm-text-heading', '1.25rem'], ['hm-text-display', '1.75rem'], ['hm-radius', '0.75rem'], ['hm-card-agent-w', '13.75rem'], ['hm-card-agent-h', '8.25rem'], ['hm-card-small-w', '11rem'], ['hm-card-small-h', '4.5rem']] as [string, string][]) assert.match(homeLightBlock, new RegExp(`--${name}:\\s*${value.replace('.', '\\.')};`), name);
  assert.match(homeLightBlock, /--hm-drawer-w:\s*min\(420px, 92vw\);/);
});

for (const [name, vars, block] of [['light', homeLight, homeLightBlock], ['dark', homeDark, homeDarkBlock]] as const) {
  test(`${name} theme, home app: the edge of a card, bar, drawer or button is 3 to 1 against the page, a card, a quiet panel and a selected card`, () => {
    for (const against of ['bg', 'surface', 'surface-2']) assert.ok(ratio(vars['hm-border']!, vars[against]!) >= 3, `hm-border on ${against} is ${ratio(vars['hm-border']!, vars[against]!).toFixed(2)}`);
    // A selected or hovered card, and an open "?" button, are drawn with the accent edge instead.
    for (const against of ['bg', 'surface', 'accent-soft']) assert.ok(ratio(vars['accent-strong']!, vars[against]!) >= 3, `accent-strong on ${against} is ${ratio(vars['accent-strong']!, vars[against]!).toFixed(2)}`);
  });
  test(`${name} theme, home app: every text pair still meets 4.5 to 1 and the focus ring 3 to 1`, () => {
    for (const [fg, bg] of PAIRS) assert.ok(ratio(vars[fg]!, vars[bg]!) >= 4.5, `${fg} on ${bg} is ${ratio(vars[fg]!, vars[bg]!).toFixed(2)}`);
    for (const bg of ['bg', 'surface', 'accent-soft']) assert.ok(ratio(vars.focus!, vars[bg]!) >= 3, `focus on ${bg}`);
  });
  test(`${name} theme, home app: the 2 px edge of a selected card, row or segment is 3 to 1 against everything it sits next to`, () => {
    // A selected card is a highlight with no check mark, so the edge and the tint are all that tell it apart. The edge touches the page (bg), a neighbouring card
    // (surface), the tile and the chips inside the card (surface-2) and its own tint (accent-soft); a selected row sits on the tint of its owner card as well.
    for (const against of ['bg', 'surface', 'surface-2', 'accent-soft']) assert.ok(ratio(vars['accent-strong']!, vars[against]!) >= 3, `selected edge on ${against} is ${ratio(vars['accent-strong']!, vars[against]!).toFixed(2)}`);
    assert.match(homeKitCss, /\.kit-card\[data-selected\][^{]*\{[^}]*border-width: 2px;/, 'the selected edge is 2 px');
    assert.match(homeMapCss, /\.hm-seg-button\[aria-pressed="true"\][^{]*\{[^}]*inset 0 0 0 2px var\(--accent-strong\)/, 'the selected segment has a 2 px edge');
  });
  test(`${name} theme, home app: the glyph on its tile is 4.5 to 1, and the edge of a chip or a tile is 3 to 1 on the card and (in the accent edge it takes there) on a selected card`, () => {
    assert.ok(ratio(vars['accent-strong']!, vars['surface-2']!) >= 4.5, `glyph on tile is ${ratio(vars['accent-strong']!, vars['surface-2']!).toFixed(2)}`);
    // On a plain card a chip has the grey edge. On the tint of a selected card the grey edge is under 3 to 1 in the dark look, so a chip there takes the accent edge instead.
    for (const against of ['surface', 'surface-2']) assert.ok(ratio(vars['hm-border']!, vars[against]!) >= 3, `hm-border on ${against} is ${ratio(vars['hm-border']!, vars[against]!).toFixed(2)}`);
    assert.ok(ratio(vars['accent-strong']!, vars['accent-soft']!) >= 3, 'the accent edge on the tint of a selected card');
    for (const on of ['surface', 'accent-soft']) assert.ok(ratio(vars.text!, vars[on]!) >= 4.5 && ratio(vars['text-muted']!, vars[on]!) >= 4.5, `chip and row text on ${on}`);
  });
  test(`${name} theme, home app: the ring around the lit target is 3 to 1 against the dimmed page`, () => {
    const alpha = homeNumber(block, 'hm-scrim-alpha');
    assert.ok(alpha >= 0.4 && alpha <= 0.8, `dim ${alpha}`);
    for (const page of ['bg', 'surface', 'surface-2']) assert.ok(ratio(vars['hm-ring']!, mixHex('#000000', vars[page]!, alpha)) >= 3, `ring on dimmed ${page}`);
  });
}

// ---- A disabled button stays readable while the pointer rests on it (fix list item 5). The primary hover fill used to beat the disabled style, which left the
// muted text on the dark green fill: 1.10 to 1 in the light look and 1.22 to 1 in the dark look.
const kitCss = readFileSync(join(DESKTOP, 'renderer', 'home', 'kit', 'kit.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const kitRules = [...kitCss.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(m => ({ selector: m[1]!.trim(), body: m[2]!, at: m.index! }));
const declared = (body: string, property: string): string | undefined => new RegExp(`(?:^|;|\\s)${property}:\\s*([^;]+)`).exec(body)?.[1]?.trim();

test('no hover rule that paints a fill can reach a disabled button: the primary hover is scoped to buttons that can be pressed', () => {
  const hovers = kitRules.filter(r => /\.kit-button/.test(r.selector) && /:hover/.test(r.selector) && /background/.test(r.body));
  assert.ok(hovers.length >= 2, 'the quiet and the primary hover rules are there');
  const disabled = kitRules.find(r => /\.kit-button:disabled\s*$/.test(r.selector))!;
  assert.ok(disabled !== undefined);
  for (const rule of hovers) for (const part of rule.selector.split(',').map(p => p.trim())) {
    if (/:not\(:disabled\)/.test(part)) continue;
    // A rule without the scope may stay only where the disabled rule has the same weight and comes after it. The primary rule has a heavier selector, so it must be scoped.
    assert.doesNotMatch(part, /\[data-variant="primary"\]/, `${part} would paint over a disabled button`);
    assert.ok(disabled.at > rule.at, `${part} comes after the disabled rule, so it would win`);
  }
});

for (const [name, vars] of [['light', homeLight], ['dark', homeDark]] as const) {
  test(`${name} theme, home app: the text of a disabled button is 3 to 1 on its own fill, on every place a button sits, hovered or not`, () => {
    const rule = kitRules.find(r => /\.kit-button:disabled\s*$/.test(r.selector))!;
    const colour = /var\(--([a-z0-9-]+)\)/.exec(declared(rule.body, 'color') ?? '')![1]!, fill = declared(rule.body, 'background');
    assert.equal(fill, 'transparent', 'a disabled button has no fill of its own: it is an outline with dashes');
    for (const under of ['bg', 'surface', 'surface-2', 'accent-soft']) {
      const r = ratio(vars[colour]!, vars[under]!);
      console.log(`MEASURED ${name}: disabled text (${colour}) on ${under} is ${r.toFixed(2)} to 1`);
      assert.ok(r >= 3, `disabled text on ${under} is ${r.toFixed(2)}`);
    }
    // The failure this test guards against: the muted text on the primary hover fill.
    const broken = ratio(vars[colour]!, vars['accent-strong']!);
    assert.ok(broken < 3, `the old result, ${broken.toFixed(2)} to 1, is what a hover fill would give`);
  });
}
