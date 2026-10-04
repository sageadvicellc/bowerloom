import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { applyTheme, resolveTheme, savedThemePreference, themePreference } from '../src/theme.ts';
const publicFile = path => readFileSync(new URL('../public/' + path, import.meta.url));

test('theme resolution follows the system until an explicit preference overrides it', () => {
  assert.equal(themePreference(null), 'system');
  assert.equal(themePreference('sepia'), 'system');
  for (const dark of [false, true]) {
    assert.equal(resolveTheme('system', dark), dark ? 'dark' : 'light');
    assert.equal(resolveTheme('light', dark), 'light');
    assert.equal(resolveTheme('dark', dark), 'dark');
  }
});
test('storage failure safely falls back to system preference', () => {
  const previous = globalThis.window;
  try {
    globalThis.window = { get localStorage() { throw new Error('Storage disabled'); } };
    assert.equal(savedThemePreference(), 'system');
    globalThis.window = { localStorage: { getItem: () => 'dark' } };
    assert.equal(savedThemePreference(), 'dark');
    globalThis.window = { localStorage: { getItem: () => 'invalid' } };
    assert.equal(savedThemePreference(), 'system');
  } finally { if (previous === undefined) delete globalThis.window; else globalThis.window = previous; }
});
test('resolved theme changes native browser surfaces and the matching approved icon', () => {
  const previous = globalThis.document;
  const values = {};
  try {
    globalThis.document = { documentElement: { dataset: {}, style: {} }, querySelector: key => ({ setAttribute: (name, value) => { values[key + ':' + name] = value; } }) };
    applyTheme('dark');
    assert.equal(document.documentElement.dataset.theme, 'dark');
    assert.equal(document.documentElement.style.colorScheme, 'dark');
    assert.equal(values['meta[name="theme-color"]:content'], '#27262B');
    assert.match(values['link[rel="icon"]:href'], /s4-g3-icon-dark\.svg$/);
    applyTheme('light');
    assert.equal(values['meta[name="theme-color"]:content'], '#F6EEE8');
    assert.match(values['link[rel="icon"]:href'], /\/s4-g3-icon\.svg$/);
  } finally { if (previous === undefined) delete globalThis.document; else globalThis.document = previous; }
});
test('wordmarks and mascot exports match exact approved bytes', () => {
  const expected = {
    'bowerloom-wordmark-ink.svg': '2bdefa242708640725f1c6c9e492f14aa945dbf85fa401c635d6e9d6bffc653e',
    'bowerloom-wordmark-cream.svg': '80a1f2df070d72ab4fbc0a3f9eb8a2510d03be92c49de69e6507876a3a273f6b',
    's4-g3-icon.svg': '0285c6f2b60f97bb6c2dccb00ad95a570a8e261a32e5c2d3c7cd39f26c5e6d9f',
    's4-g3-icon-dark.svg': 'e3ade54d45cc0a0f72839299411c01af15092ba5e5c94b32b26758a874ebee6f',
  };
  for (const [name, hash] of Object.entries(expected)) {
    const file = publicFile('brand/rose-conservatory/' + name);
    assert.equal(createHash('sha256').update(file).digest('hex'), hash);
    assert.ok(!file.toString().includes('/Users/'));
  }
  assert.match(publicFile('brand/rose-conservatory/s4-g3-icon-dark.svg').toString(), /<g fill="#C5D4AC"><rect x="24"/);
});
test('local font licenses ship beside all three font faces', () => {
  for (const file of ['newsreader/roman.ttf', 'newsreader/italic.ttf', 'manrope/font.ttf']) assert.ok(publicFile('fonts/' + file).length > 10000);
  for (const family of ['newsreader', 'manrope']) assert.match(publicFile(`fonts/${family}/OFL.txt`).toString(), /SIL OPEN FONT LICENSE/i);
});
test('both palettes retain the exact approved color values', () => {
  const css = readFileSync(new URL('../src/brand.css', import.meta.url), 'utf8');
  const palettes = [
    { ground:'#F6EEE8',surface:'#FFF9F4',ink:'#373A32',muted:'#655D61',rose:'#DFA4AB',foliage:'#B9C6A0',clay:'#B36D4B',water:'#668B95',line:'#D5C9C8',action:'#80515B' },
    { ground:'#27262B',surface:'#343238',ink:'#F6EEE8',muted:'#D0BEC6',rose:'#E8B3BF',foliage:'#C5D4AC',clay:'#E0A17D',water:'#A0C5CD',line:'#665B63',action:'#E8B3BF' },
  ];
  for (const palette of palettes) for (const [key,value] of Object.entries(palette)) assert.ok(css.includes(`--brand-${key}: ${value};`));
});
