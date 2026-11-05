// The app and the website are one product, so they share one identity. The palette and the mascot are copies of the website's (apps/landing), and these tests
// fail when a copy drifts: a change to the brand is made in both places, or in neither.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DESKTOP } from './support.js';

const LANDING = join(DESKTOP, '..', 'landing');
const read = (...parts: string[]): string => readFileSync(join(...parts), 'utf8');
const brandVars = (block: string): Record<string, string> => {
  const vars: Record<string, string> = {};
  for (const m of block.matchAll(/--(brand-[a-z-]+):\s*(#[0-9a-fA-F]{6})/g)) vars[m[1]!] = m[2]!.toLowerCase();
  return vars;
};
const block = (css: string, selector: RegExp, label: string): string => {
  const m = selector.exec(css);
  assert.ok(m !== null, `${label}: the block is there`);
  return m[1]!;
};

const site = read(LANDING, 'src', 'brand.css'), app = read(DESKTOP, 'renderer', 'brand.css');
const siteLight = brandVars(block(site, /:root, :root\.cinematic-theme \{([\s\S]*?)\n\}/, 'site light'));
const siteDark = brandVars(block(site, /:root\[data-theme='dark'\], :root\.cinematic-theme\[data-theme='dark'\] \{([\s\S]*?)\n\}/, 'site dark'));
const appLight = brandVars(block(app, /:root, \[data-theme="light"\] \{([\s\S]*?)\n\}/, 'app light'));
const appDark = brandVars(block(app, /\[data-theme="dark"\] \{([\s\S]*?)\n\}/, 'app dark'));

test('the app palette is the website palette: Rose Conservatory in light, After Hours in dark, colour for colour', () => {
  assert.ok(Object.keys(siteLight).length >= 11, 'the site names its eleven brand colours');
  assert.deepEqual(appLight, siteLight);
  assert.deepEqual(appDark, siteDark);
});

test('the page, surface, text, muted text and action of the app are the brand colours themselves', () => {
  const tokens = read(DESKTOP, 'renderer', 'tokens.css');
  const hex = (css: string): Record<string, string> => { const v: Record<string, string> = {}; for (const m of css.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})/g)) v[m[1]!] = m[2]!.toLowerCase(); return v; };
  const light = hex(block(tokens, /:root, \[data-theme="light"\] \{([\s\S]*?)\n\}/, 'tokens light')), dark = hex(block(tokens, /\[data-theme="dark"\] \{([\s\S]*?)\n\}/, 'tokens dark'));
  const SAME: [string, string][] = [['bg', 'brand-ground'], ['surface', 'brand-surface'], ['text', 'brand-ink'], ['text-muted', 'brand-muted'], ['accent', 'brand-action'], ['accent-contrast', 'brand-action-ink']];
  for (const [token, brand] of SAME) {
    assert.equal(light[token], siteLight[brand], `light ${token} is ${brand}`);
    assert.equal(dark[token], siteDark[brand], `dark ${token} is ${brand}`);
  }
});

test('the mascot in the app is the website icon, shape for shape and colour for colour', () => {
  const icon = read(LANDING, 'public', 'brand', 'rose-conservatory', 's4-g3-icon.svg'), dark = read(LANDING, 'public', 'brand', 'rose-conservatory', 's4-g3-icon-dark.svg');
  const mark = read(DESKTOP, 'renderer', 'home', 'kit', 'BrandMark.tsx');
  const shapes = (svg: string): string[] => [...svg.matchAll(/<(?:path|rect)\b[^>]*?\/>/g)].map(m => m[0].replace(/\s*\/>$/, '').replace(/^<(path|rect)\s+/, '$1 ').replace(/fill="[^"]*"\s*/g, '').trim());
  assert.deepEqual(shapes(mark), shapes(icon), 'the same paths and rects, in the same order');
  for (const fill of ['#B9C6A0', '#F6EEE8', '#373A32', '#C5D4AC']) assert.ok(icon.includes(`fill="${fill}"`) && mark.includes(fill), `${fill} is in both`);
  // The side disks are the one part that changes with the look: ink in light, foliage in dark, as the two site files are.
  assert.match(icon, /<g fill="#373A32"><rect x="24"/);
  assert.match(dark, /<g fill="#C5D4AC"><rect x="24"/);
  const layer = read(DESKTOP, 'renderer', 'harness', 'brand-layer.css');
  assert.match(layer, /\.kit-brand-mark-disks \{ fill: #373a32; \}/);
  assert.match(layer, /\[data-theme="dark"\] \[data-home\] \.kit-brand-mark-disks, \[data-home\]\[data-theme="dark"\] \.kit-brand-mark-disks \{ fill: #c5d4ac; \}/);
});

test('the fonts are the website font files, served by the app itself, and the brand sheet loads before the tokens', () => {
  for (const file of ['newsreader/roman.ttf', 'newsreader/italic.ttf', 'newsreader/OFL.txt', 'manrope/font.ttf', 'manrope/OFL.txt']) assert.ok(existsSync(join(LANDING, 'public', 'fonts', file)), `${file} is in the site`);
  for (const url of app.matchAll(/url\('([^']+)'\)/g)) assert.match(url[1]!, /^fonts\/(newsreader\/(roman|italic)|manrope\/font)\.ttf$/);
  assert.match(read(DESKTOP, 'tools', 'bundle.mjs'), /\['newsreader', \['roman\.ttf', 'italic\.ttf', 'OFL\.txt'\]\], \['manrope', \['font\.ttf', 'OFL\.txt'\]\]/);
  assert.match(read(DESKTOP, 'main', 'main.ts'), /'\.ttf': 'font\/ttf'/);
  const html = read(DESKTOP, 'renderer', 'index.html');
  assert.ok(html.indexOf('href="brand.css"') > 0 && html.indexOf('href="brand.css"') < html.indexOf('href="tokens.css"'), 'brand.css loads first');
  assert.match(html, /font-src 'self'/, 'the policy still allows only the app\'s own fonts');
});

test('every button, tag and chip has the website\'s one sharp control corner, and no button is a pill', () => {
  const siteStyles = read(LANDING, 'src', 'styles.css');
  const siteSharp = /:root \{[\s\S]*?--ui-radius-sm:\s*([0-9.]+px);/.exec(siteStyles)?.[1];
  const appSharp = /--hm-radius-sharp:\s*([0-9.]+px);/.exec(read(DESKTOP, 'renderer', 'home', 'home-tokens.css'))?.[1];
  assert.ok(siteSharp !== undefined && appSharp !== undefined, 'both name the sharp corner');
  assert.equal(appSharp, siteSharp);
  const layer = read(DESKTOP, 'renderer', 'harness', 'brand-layer.css');
  assert.match(layer, /\[data-home\] \.kit-button \{ border-radius: var\(--hm-radius-sharp\); \}/);
  // A pill is only the round backdrop of an icon tile; no button, tag or chip uses it.
  const pills = layer.split('\n').filter(line => line.includes('--hm-radius-pill'));
  assert.deepEqual(pills.map(line => line.trim()), ['[data-home] .hx-tile { border-radius: var(--hm-radius-pill); }']);
});

test('an icon button has no box: no fill, edge or shadow at rest, a 44 px hit area, and the action colour under the pointer', () => {
  const layer = read(DESKTOP, 'renderer', 'harness', 'brand-layer.css'), tokens = read(DESKTOP, 'renderer', 'home', 'home-tokens.css');
  assert.match(tokens, /--hm-hit: 2\.75rem;/);
  assert.match(layer, /\.kit-button\[data-icon-only\]::before \{ content: ''; position: absolute; inset: calc\(\(var\(--hm-control-h\) - var\(--hm-hit\)\) \/ 2\); \}/);
  assert.match(layer, /\{ background: transparent; border-color: transparent; box-shadow: none; \}/);
  assert.match(layer, /\.kit-button\[data-icon-only\]:not\(\[data-variant="primary"\]\):not\(\[aria-disabled="true"\]\):hover \{ color: var\(--accent\);/);
  assert.match(layer, /\.kit-button\[data-icon-only\]:focus-visible \{ outline: 3px solid var\(--focus\);[^}]*border-radius: var\(--hm-radius-sharp\); \}/);
});

test('the brand layer is the last sheet the page loads, so it wins a tie with the sheet that first drew a part', () => {
  const mount = read(DESKTOP, 'renderer', 'harness', 'mount.tsx');
  const imports = [...mount.matchAll(/^import .*$/gm)].map(m => m[0]);
  assert.equal(imports.at(-1), "import './brand-layer.css';");
});
