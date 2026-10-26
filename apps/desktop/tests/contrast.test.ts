// Contrast: every text and background pair in the tokens file meets WCAG AA (4.5 to 1 for text), in light and dark.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
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

test('the home scale is the agreed one: about 90 percent of the first, in tokens, with 14 px as the floor for every word', () => {
  // Type: page title 18, section heading 16, card name 15, body and hints 14. Nothing is under 14 px (0.875rem).
  for (const [name, value] of [['hm-text-title', '1.125rem'], ['hm-text-section', '1rem'], ['hm-text-name', '0.9375rem'], ['hm-text-base', '0.875rem'], ['hm-text-small', '0.875rem'], ['hm-text-heading', '1rem'], ['hm-text-display', '1.5rem']] as [string, string][]) assert.match(homeLightBlock, new RegExp(`--${name}:\\s*${value.replace('.', '\\.')};`), name);
  for (const name of ['hm-text-title', 'hm-text-section', 'hm-text-name', 'hm-text-base', 'hm-text-small', 'hm-text-heading', 'hm-text-display']) assert.ok(homeNumber(homeLightBlock, name) >= 0.875, `${name} is at least 14 px`);
  // Space steps 4, 6, 10, 14, 20, 28, 44 px; radii 10 and 6 px.
  for (const [name, value] of [['hm-space-1', '0.25rem'], ['hm-space-2', '0.375rem'], ['hm-space-3', '0.625rem'], ['hm-space-4', '0.875rem'], ['hm-space-5', '1.25rem'], ['hm-space-6', '1.75rem'], ['hm-space-7', '2.75rem'], ['hm-radius', '0.625rem'], ['hm-radius-small', '0.375rem']] as [string, string][]) assert.match(homeLightBlock, new RegExp(`--${name}:\\s*${value.replace('.', '\\.')};`), name);
  // Controls: a button is 32 px, a sort segment 28 px, a target never under 24 px; icons 20 and 16 px; a dot is 8 px.
  for (const [name, value] of [['hm-control-h', '2rem'], ['hm-control-h-small', '1.75rem'], ['hm-control-pad', '0.75rem'], ['hm-target-min', '1.5rem'], ['hm-icon', '1.25rem'], ['hm-icon-small', '1rem'], ['hm-dot', '0.5rem']] as [string, string][]) assert.match(homeLightBlock, new RegExp(`--${name}:\\s*${value.replace('.', '\\.')};`), name);
  // One tile for every agent (250 by 124 px), one row for every skill, tool and note (44 px, a 28 px tile), bars 52 and 48 px, panel about 320 px, drawer 380 px.
  for (const [name, value] of [['hm-tile-w', '15.625rem'], ['hm-tile-h', '7.75rem'], ['hm-tile-glyph', '1.5rem'], ['hm-row-h', '2.75rem'], ['hm-row-tile', '1.75rem'], ['hm-bar-h', '3.25rem'], ['hm-savebar-h', '3rem']] as [string, string][]) assert.match(homeLightBlock, new RegExp(`--${name}:\\s*${value.replace('.', '\\.')};`), name);
  assert.match(homeLightBlock, /--hm-drawer-w:\s*min\(380px, 92vw\);/);
  assert.match(homeLightBlock, /--hm-panel-w:\s*clamp\(17rem, 25vw, 20rem\);/);
  assert.match(homeLightBlock, /--hm-nav-w:\s*14\.5rem;/); assert.match(homeLightBlock, /--hm-nav-rail-w:\s*3rem;/);   // the navigation: 232 px open, 48 px as a rail
  // No size of the first scale is left: the old card sizes are gone, so nothing can still read them.
  for (const gone of ['hm-card-agent-w', 'hm-card-agent-h', 'hm-card-small-w', 'hm-card-small-h', 'hm-card-shelf-w']) assert.doesNotMatch(homeCss, new RegExp(`--${gone}`), gone);
});

test('the width where the panel gives way to a drawer is worked out from the tokens: 290 + 320 + 380 = 990 px of the middle and right columns, so the rule stops at 989 px', () => {
  const px = (name: string): number => homeNumber(homeLightBlock, name) * 16;
  const stage = 2 * px('hm-space-5') + px('hm-tile-w');   // one tile and the stage padding: a drag can still land on an agent
  assert.equal(stage, 290);
  const panel = 320, drawer = 380;
  const first = Array.from({ length: 2000 }, (_, w) => w).find(w => w - panel - drawer >= stage)!;
  assert.equal(first, 990, `three columns fit from ${first} px of columns`);
  const css = readFileSync(join(DESKTOP, 'renderer', 'home', 'home.css'), 'utf8');
  // The width asked is the width of the middle and right columns (a container), because the navigation takes 232 or 48 px of the window.
  assert.match(css, /@container hmcol \(min-width: 761px\) and \(max-width: 989px\)/);
  assert.match(css, /container: hmcol \/ inline-size/);
  assert.equal(first + 232, 1222, 'with the navigation open the three columns and the drawer need a 1222 px window');
});

test('the columns of the map are worked out from the tokens: four columns need 1082 px of stage, so four show from 1634 px with the navigation and the panel open, and from 1082 px of columns with the panel put away', () => {
  const px = (name: string): number => homeNumber(homeLightBlock, name) * 16;
  const stageFor = (columns: number): number => 2 * px('hm-space-5') + columns * px('hm-tile-w') + (columns - 1) * px('hm-space-4');
  assert.deepEqual([1, 2, 3, 4].map(stageFor), [290, 554, 818, 1082]);
  const nav = { open: 14.5 * 16, rail: 3 * 16 };
  const panelAt = (w: number): number => Math.min(320, Math.max(272, w * 0.25));
  const columnsOf = (stage: number): number => Math.max(1, Math.floor((stage - 2 * px('hm-space-5') + px('hm-space-4')) / (px('hm-tile-w') + px('hm-space-4'))));
  const widths = Array.from({ length: 2400 }, (_, w) => w);
  const open = (n: number, navWidth: number): number => widths.find(w => columnsOf(w - navWidth - panelAt(w)) >= n)!;
  const away = (n: number, navWidth: number): number => widths.find(w => columnsOf(w - navWidth) >= n)!;
  assert.equal(open(4, nav.open), 1634, 'with the navigation and the panel open the fourth column comes at 1634 px');
  assert.equal(open(4, nav.rail), 1450, 'with the navigation put away to its rail it comes at 1450 px');
  assert.equal(away(4, nav.open), 1314, 'with the panel put away it comes at 1314 px');
  assert.equal(columnsOf(1280 - nav.open - panelAt(1280)), 2, 'at 1280 with both open the stage holds two');
  assert.equal(columnsOf(1280 - nav.open), 3, 'at 1280 with the panel put away it holds three');
  assert.equal(columnsOf(900 - nav.rail - panelAt(900)), 2, 'at the smallest window (900) the rail and the panel leave room for two');
  const css = readFileSync(join(DESKTOP, 'renderer', 'home', 'home.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.match(css, /grid-template-columns: repeat\(auto-fill, var\(--hm-tile-w\)\)/, 'the browser adds a column whenever the stage holds one more tile');
  assert.match(css, /\.hm-body\[data-details="closed"\] \{ grid-template-columns: minmax\(0, 1fr\); \}/);
  assert.match(css, /\.hm-body\[data-details="closed"\] \.hm-panel \{ display: none; \}/);
});

for (const [name, vars, block] of [['light', homeLight, homeLightBlock], ['dark', homeDark, homeDarkBlock]] as const) {
  test(`${name} theme, home app: the edge of a card, bar, drawer or button is 3 to 1 against the page, a card, a quiet panel and a selected card`, () => {
    for (const against of ['bg', 'surface', 'surface-2']) assert.ok(ratio(vars['hm-border']!, vars[against]!) >= 3, `hm-border on ${against} is ${ratio(vars['hm-border']!, vars[against]!).toFixed(2)}`);
    // A selected or hovered card, and an open "?" button, are drawn with the accent edge instead.
    for (const against of ['bg', 'surface', 'accent-soft']) assert.ok(ratio(vars['accent-strong']!, vars[against]!) >= 3, `accent-strong on ${against} is ${ratio(vars['accent-strong']!, vars[against]!).toFixed(2)}`);
  });
  test(`${name} theme, home app: the amber dot of a fact that needs care is 3 to 1 on the page, a card and a ticked card`, () => {
    for (const against of ['bg', 'surface', 'accent-soft']) assert.ok(ratio(vars['hm-amber']!, vars[against]!) >= 3, `hm-amber on ${against} is ${ratio(vars['hm-amber']!, vars[against]!).toFixed(2)}`);
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
  test(`${name} theme, home app: each of the four identity colours of an agent tile (its top edge and its bar) is 3 to 1 on the page, a card, a quiet panel and a selected card`, () => {
    for (const accent of ['blue', 'green', 'orange', 'red']) {
      assert.match(block, new RegExp(`--hm-ac-${accent}:`), `${accent} is a token with this look's own value`);
      for (const against of ['bg', 'surface', 'surface-2', 'accent-soft']) assert.ok(ratio(vars[`hm-ac-${accent}`]!, vars[against]!) >= 3, `hm-ac-${accent} on ${against} is ${ratio(vars[`hm-ac-${accent}`]!, vars[against]!).toFixed(2)}`);
    }
    // The accent is never behind words (it is an edge and a bar), so the text of a tile keeps the contrast of its card.
    assert.doesNotMatch(homeKitCss, /\.kit-card\[data-size="tile"\]\s*\{[^}]*background(-color)?:\s*var\(--ac\)/, 'the tile itself is not filled with its accent');
    for (const [fg, bg] of [['text', 'surface'], ['text', 'accent-soft'], ['text-muted', 'surface'], ['text-muted', 'accent-soft']] as const) assert.ok(ratio(vars[fg]!, vars[bg]!) >= 4.5, `${fg} on ${bg}`);
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

// ---- A state is a small dot and short words, with no fill and no border (Wave D). The words always say it, so colour is never the only signal; the colours still pass:
// 4.5 to 1 for the words and 3 to 1 for the dot on every surface a state can sit on (the page, a card, a quiet panel, and the tint of a selected card).
const statusColour = (tone: string | null, dot: boolean): string => {
  const find = (selector: RegExp): string | undefined => { const rule = kitRules.find(r => selector.test(r.selector)); return rule === undefined ? undefined : /var\(--([a-z0-9-]+)\)/.exec(declared(rule.body, dot ? 'background' : 'color') ?? '')?.[1]; };
  const own = tone === null ? undefined : find(dot ? new RegExp(`\\.kit-status\\[data-tone="${tone}"\\] \\.kit-dot\\s*$`) : new RegExp(`\\.kit-status\\[data-tone="${tone}"\\]\\s*$`));
  if (own !== undefined) return own;
  if (dot) return statusColour(tone, false);
  return /var\(--([a-z0-9-]+)\)/.exec(declared(kitRules.find(r => /\.kit-status\s*$/.test(r.selector))!.body, 'color') ?? '')![1]!;
};

for (const [name, vars] of [['light', homeLight], ['dark', homeDark]] as const) {
  test(`${name} theme, home app: the words of a state are 4.5 to 1 and its dot 3 to 1 on the page, a card, a quiet panel and a selected card`, () => {
    for (const tone of ['warn', 'new', 'info', null]) {
      const words = statusColour(tone, false), dot = statusColour(tone, true);
      for (const under of ['bg', 'surface', 'surface-2', 'accent-soft']) {
        assert.ok(ratio(vars[words]!, vars[under]!) >= 4.5, `${tone ?? 'plain'} words (${words}) on ${under} are ${ratio(vars[words]!, vars[under]!).toFixed(2)}`);
        assert.ok(ratio(vars[dot]!, vars[under]!) >= 3, `${tone ?? 'plain'} dot (${dot}) on ${under} is ${ratio(vars[dot]!, vars[under]!).toFixed(2)}`);
      }
    }
  });
}

test('no pill is left in the home style sheets: a state has no fill, no border and no round corners, and nothing is named a badge, a chip or a pill', () => {
  const dir = join(DESKTOP, 'renderer', 'home');
  const files = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? files(join(d, e.name)) : e.name.endsWith('.css') ? [join(d, e.name)] : []);
  const sheets = files(dir).map(f => ({ f: f.slice(dir.length + 1), css: readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '') }));
  assert.ok(sheets.length >= 12);
  for (const { f, css } of sheets) {
    assert.doesNotMatch(css, /\.kit-badge|\.kit-chip\b|\.kit-pill|\.dt-chip\b[^{]*\{[^}]*border-radius/, `${f} still styles a pill`);
    for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (!/border-radius:\s*var\(--hm-radius-pill\)/.test(m[2]!)) continue;
      // The round button (one icon, a circle) and the track of a meter (a bar) are the only round corners that remain.
      assert.match(m[1]!.trim(), /data-round|meter/, `${f}: ${m[1]!.trim()} has round corners`);
    }
  }
  const status = kitRules.find(r => /\.kit-status\s*$/.test(r.selector))!;
  assert.equal(declared(status.body, 'background'), 'none'); assert.equal(declared(status.body, 'border'), '0');
  assert.equal(declared(status.body, 'padding'), '0'); assert.doesNotMatch(status.body, /border-radius|box-shadow/);
  assert.match(kitCss, /\.kit-dot\s*\{[^}]*width: var\(--hm-dot\);[^}]*height: var\(--hm-dot\);[^}]*border-radius: 50%/);
});

test('every word in the home style sheets is 14 px or more: each font size is a token at 14 px or a plain size of 14 px or more', () => {
  const dir = join(DESKTOP, 'renderer', 'home');
  const files = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? files(join(d, e.name)) : e.name.endsWith('.css') ? [join(d, e.name)] : []);
  let seen = 0;
  for (const f of files(dir)) {
    const css = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const m of css.matchAll(/font-size:\s*([^;}]+)[;}]/g)) {
      const v = m[1]!.trim();
      const token = /^var\(--(hm-text-[a-z]+)\)$/.exec(v);
      const px = token !== null ? homeNumber(homeLightBlock, token[1]!) * 16 : /^clamp\(([\d.]+)rem/.test(v) ? parseFloat(/^clamp\(([\d.]+)rem/.exec(v)![1]!) * 16 : /^[\d.]+rem$/.test(v) ? parseFloat(v) * 16 : /^[\d.]+px$/.test(v) ? parseFloat(v) : v === 'inherit' ? 14 : NaN;
      assert.ok(px >= 14, `${f.slice(dir.length + 1)}: font-size ${v}`);
      seen += 1;
    }
  }
  assert.ok(seen > 60, `${seen} font sizes checked`);
});

test('a row and a tile have one size each, from tokens: the row is --hm-row-h high, the tile --hm-tile-w by --hm-tile-h, and neither grows with its words', () => {
  const row = kitRules.find(r => /\.kit-card\[data-size="small"\]\s*$/.test(r.selector))!, tile = kitRules.find(r => /\.kit-card\[data-size="tile"\]\s*$/.test(r.selector))!;
  assert.equal(declared(row.body, 'height'), 'var(--hm-row-h)'); assert.equal(declared(row.body, 'width'), '100%');
  assert.equal(declared(tile.body, 'width'), 'var(--hm-tile-w)'); assert.equal(declared(tile.body, 'height'), 'var(--hm-tile-h)');
  assert.doesNotMatch(row.body + tile.body, /min-height|max-height/, 'a fixed height, not a height that can grow');
  assert.equal(declared(row.body, 'min-width'), 'var(--hm-row-min-w)', 'a row never gets narrower than 176 px, whatever holds it'); assert.doesNotMatch(tile.body, /min-width/);
  // The counts never wrap and never leave the tile, but the ring of a focused count is not cut: the line is clipped with a margin, not hidden.
  const summary = kitRules.find(r => /\.kit-summary\s*$/.test(r.selector))!;
  assert.equal(declared(summary.body, 'white-space'), 'nowrap'); assert.equal(declared(summary.body, 'overflow'), 'clip'); assert.match(declared(summary.body, 'overflow-clip-margin') ?? '', /^4px$/);
  // The name, the hint and the job are one line each, clipped with an ellipsis.
  const main = kitRules.find(r => /\.kit-card-main\s*$/.test(r.selector))!, hint = kitRules.find(r => /\.kit-card-hint\s*$/.test(r.selector))!;
  for (const rule of [main, hint]) { assert.equal(declared(rule.body, 'white-space'), 'nowrap'); assert.equal(declared(rule.body, 'text-overflow'), 'ellipsis'); }
});
