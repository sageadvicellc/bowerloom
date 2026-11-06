// One corner style for every button, tag, and chip, and icon buttons without boxes. The rules are read from the style sheets of the page.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';

const names = (await readdir(new URL('../src/', import.meta.url))).filter(name => name.endsWith('.css') && name !== 'projection-tokens.css');
const rules = [];
for (const name of names) {
  const css = (await readFile(new URL('../src/' + name, import.meta.url), 'utf8')).replace(/\/\*[\s\S]*?\*\//g, '');
  for (const match of css.matchAll(/([^{}@;][^{}]*)\{([^{}]*)\}/g)) rules.push({ file: name, selector: match[1].trim().replace(/\s+/g, ' '), body: match[2].trim() });
}
const declared = (body, property) => [...body.matchAll(new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`, 'g'))].map(match => match[1].trim());
const TOKEN = 'var(--control-radius)';

/** Round shapes that are truly round and not buttons or chips: the step number badges, the three window dots of the terminal, and the dots before the result chips. */
const ROUND_ICONS = new Set(['.step-number', '.terminal-bar span', '.hero-results li::before']);
/** Boxes that are cards, panels, and pictures, not buttons, tags, or chips. They keep their own radius. */
const PANELS = /^(\.install-card|\.terminal|\.journey|\.boundary-note|\.command-block|\.screenshot-image|\.screenshot-full|\.screenshot-dialog|\.screenshot-open|\.hero-showcase|\.companion-surface|\.homepage-banner|\.mobile-drawer)/;

test('the token is the sharpest radius a button already used, 2 px', async () => {
  const brand = await readFile(new URL('../src/brand.css', import.meta.url), 'utf8');
  assert.match(brand, /--control-radius: 2px;/);
});

test('every button, tag, and chip uses the one radius token, and a round shape is only one of the listed round icons', () => {
  const radius = rules.flatMap(rule => declared(rule.body, 'border-radius').map(value => ({ ...rule, value })));
  const controls = /button|\.button|\.nav-cta|\.nav-github|\.screenshot-enlarge|\.screenshot-close|\.theme-toggle|\.theme-control|\.mobile-menu-toggle|\.release-tag|\.hero-engines li|\.hero-results li|\.engine-list li|\.engine-status|\.skip-link/;
  for (const rule of radius) {
    const where = `${rule.file}: ${rule.selector}`;
    const parts = rule.selector.split(',').map(part => part.trim());
    if (parts.every(part => ROUND_ICONS.has(part))) continue;
    if (parts.every(part => PANELS.test(part)) && !parts.some(part => controls.test(part))) continue;
    if (parts.some(part => controls.test(part))) assert.equal(rule.value, TOKEN, `${where}: ${rule.value}`);
    assert.doesNotMatch(rule.value, /999px|9999px|50%|radius-full/, `${where}: a pill or a circle that is not a listed round icon`);
  }
  // The listed round icons really are round, and are the only 50% shapes.
  const circles = radius.filter(rule => /50%/.test(rule.value)).map(rule => rule.selector);
  assert.deepEqual([...new Set(circles)].sort(), [...ROUND_ICONS].sort());
});

test('the viewer X is a raised push button on the frame, on the one corner token, with a 44 px target and a focus ring', () => {
  const base = rules.find(rule => rule.selector === '.screenshot-close');
  assert.ok(base);
  assert.deepEqual(declared(base.body, 'border-radius'), [TOKEN]);
  assert.match(base.body, /background: [^;]*var\(--knob\)/, 'a clay cap');
  assert.match(base.body, /box-shadow: [^;]*0 3px 0 var\(--knob-edge\)/, 'it stands up from the frame');
  assert.match(base.body, /min-width: 44px;[^}]*min-height: 44px/);
  assert.ok(rules.some(rule => rule.selector === '.screenshot-close:active' && /transform: translateY\(2px\)/.test(rule.body)), 'it presses down');
  assert.ok(rules.some(rule => rule.selector === '.screenshot-close:focus-visible' && /outline: 2px solid var\(--ui-primary\)/.test(rule.body)), 'a focus ring');
});

test('icon buttons have a transparent background and no border or shadow at rest, a hover color shift, and a focus ring', () => {
  const icon = [
    ['.theme-control.theme-toggle', '.theme-toggle:hover', '.theme-toggle:focus-visible'],
    ['.mobile-drawer-heading button, .mobile-menu-toggle', '.mobile-drawer-heading button:hover, .mobile-menu-toggle:hover', '.mobile-drawer :is(a, button):focus-visible, .mobile-menu-toggle:focus-visible'],
    ['.site-header .nav-github', '.site-header .nav-github:hover', '.site-header .nav-link:focus-visible, .site-header .nav-github:focus-visible, .site-header .nav-cta:focus-visible'],
  ];
  for (const [rest, hover, focus] of icon) {
    const base = rules.find(rule => rule.selector === rest);
    assert.ok(base, rest);
    assert.deepEqual(declared(base.body, 'background'), ['transparent'], `${rest}: transparent at rest`);
    assert.deepEqual(declared(base.body, 'border'), ['0'], `${rest}: no border`);
    assert.equal(declared(base.body, 'box-shadow').length, 0, `${rest}: no shadow`);
    assert.deepEqual(declared(base.body, 'border-radius'), [TOKEN]);
    const hovered = rules.find(rule => rule.selector === hover);
    assert.match(hovered.body, /color: var\(--ui-primary\)/, `${rest}: the icon shifts to the accent on hover`);
    assert.doesNotMatch(hovered.body, /border|box-shadow/, `${rest}: no hard box on hover`);
    assert.ok(rules.some(rule => rule.selector === focus && /outline: 2px solid var\(--ui-primary\)/.test(rule.body)), `${rest}: a focus ring`);
  }
});

test('every text button has the same minimum height, padding, and type', () => {
  const find = selector => rules.find(rule => rule.selector === selector).body;
  for (const selector of ['.button', '.copy-button', '.screenshot-enlarge']) {
    const body = find(selector);
    assert.match(body, /min-height: 44px/, selector);
    assert.match(body, /padding: 0 20px/, selector);
    assert.match(body, /font: 600 14px\/1\.2 var\(--ui-font\)/, selector);
  }
});

test('the copy button transition lives under the no-preference gate, and no other rule in the file carries it', async () => {
  const css = (await readFile(new URL('../src/review.css', import.meta.url), 'utf8')).replace(/\/\*[\s\S]*?\*\//g, '');
  const gate = css.indexOf('@media (prefers-reduced-motion: no-preference) {');
  const block = css.slice(gate, css.indexOf('\n}\n', gate));
  assert.match(block, /^\s*\.copy-button \{ transition: transform 120ms cubic-bezier\(\.23, 1, \.32, 1\), background-color 160ms cubic-bezier\(\.23, 1, \.32, 1\); \}$/m);
  assert.doesNotMatch(block, /display: inline-flex|min-width: 116px/, 'the gate holds no pasted copy of the base rule');
  assert.equal((css.match(/\.copy-button \{ display: inline-flex/g) ?? []).length, 1, 'the base rule appears once');
  assert.doesNotMatch(css.replace(block, ''), /\.copy-button \{[^}]*transition/, 'no transition outside the gate');
});
