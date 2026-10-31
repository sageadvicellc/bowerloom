// Click to enlarge a screenshot: each shot is a button that opens a native modal dialog with the full-size file of the current theme.
// The page is rendered to HTML on the server, as the other tests do, so these tests check the markup and the style sheet. The browser behavior
// (focus kept inside, Escape, focus returned) belongs to the native dialog and is checked in a real browser, not here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadPage } from './render-helpers.mjs';
import { screenshotSlots, shotSource, shotThemes } from '../src/screenshots.ts';

const read = path => readFile(new URL('../' + path, import.meta.url), 'utf8');
const escape = text => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#x27;');
const tags = (html, name) => [...html.matchAll(new RegExp(`<${name}\\b[^>]*>`, 'g'))].map(match => match[0]);

test('every shot is a button that opens a dialog named by its alt text', async () => {
  const page = await loadPage();
  try {
    for (const item of screenshotSlots) {
      const html = renderToStaticMarkup(createElement(page.slot.default, { slot: item.id }));
      const [button] = tags(html, 'button');
      assert.ok(button.includes('type="button"') && button.includes('class="screenshot-open"') && button.includes('aria-haspopup="dialog"'), item.id);
      assert.ok(button.includes(`aria-label="${escape(`Enlarge the screenshot: ${item.caption}`)}"`), `${item.id}: the button says what it opens`);
      const [dialog] = tags(html, 'dialog');
      assert.ok(dialog.includes(`aria-label="${escape(item.alt)}"`), `${item.id}: the dialog is named by the alt text`);
      const inside = html.slice(html.indexOf('<button'), html.indexOf('</button>'));
      assert.equal(tags(inside, 'img').length, 2, `${item.id}: both page images sit inside the button`);
    }
  } finally { await page.close(); }
});

test('the shot in the page is unchanged: one image per theme, sized, lazy, with alt text, and the caption stays', async () => {
  const page = await loadPage();
  try {
    const [item] = screenshotSlots;
    const html = renderToStaticMarkup(createElement(page.slot.default, { slot: item.id }));
    const figure = html.slice(html.indexOf('<figure'), html.indexOf('</figure>'));
    const images = tags(figure, 'img');
    assert.equal(images.length, 2);
    for (const theme of shotThemes) {
      const image = images.find(tag => tag.includes(`data-shot-theme="${theme}"`));
      assert.ok(image.includes(`src="${shotSource(item.id, theme)}"`) && image.includes(`width="${item.width}"`) && image.includes(`height="${item.height}"`), theme);
      assert.ok(image.includes('loading="lazy"') && image.includes(`alt="${escape(item.alt)}"`), theme);
    }
    assert.ok(figure.includes(`<figcaption>${escape(item.caption)}</figcaption>`));
    assert.match(figure, /<span class="screenshot-hint" aria-hidden="true">Enlarge<\/span>/);
  } finally { await page.close(); }
});

test('the dialog has a visible Close button, a scroll area a keyboard can reach, and no image before the first open', async () => {
  const page = await loadPage();
  try {
    const [item] = screenshotSlots;
    const html = renderToStaticMarkup(createElement(page.slot.default, { slot: item.id }));
    const dialog = html.slice(html.indexOf('<dialog'), html.indexOf('</dialog>'));
    assert.match(dialog, /<form method="dialog"><button type="submit" class="screenshot-close">Close<\/button><\/form>/);
    assert.match(dialog, /class="screenshot-scroll" tabindex="0" role="group"/);
    assert.equal(tags(dialog, 'img').length, 0, 'a visit that never enlarges a shot loads nothing extra');
    assert.ok(!/<dialog[^>]*\sopen/.test(dialog), 'the dialog starts closed');
    assert.ok(dialog.includes(`<p class="screenshot-dialog-caption">${escape(item.caption)}</p>`));
  } finally { await page.close(); }
});

test('after the first open the dialog holds the full file of each theme at its own size, lazy, so only the shown theme loads', async () => {
  const page = await loadPage();
  try {
    for (const item of screenshotSlots) {
      const html = renderToStaticMarkup(createElement(page.slot.ShotDialog, { id: item.id, loaded: true }));
      const images = tags(html, 'img');
      assert.equal(images.length, 2, item.id);
      for (const theme of shotThemes) {
        const image = images.find(tag => tag.includes(`data-shot-theme="${theme}"`));
        assert.ok(image.includes(`src="${shotSource(item.id, theme)}"`), `${item.id} ${theme}: the same file as the page`);
        assert.ok(image.includes(`width="${item.width}"`) && image.includes(`height="${item.height}"`), `${item.id} ${theme}: the size is known, so nothing shifts`);
        assert.ok(image.includes('loading="lazy"') && image.includes('alt=""'), `${item.id} ${theme}: the dialog name carries the words`);
        assert.ok(image.includes('class="screenshot-full"'), theme);
      }
    }
  } finally { await page.close(); }
});

test('the component opens with showModal, keeps no custom focus trap, and gives the focus back', async () => {
  const source = await read('src/ScreenshotSlot.tsx');
  assert.match(source, /showModal\(\)/);
  assert.doesNotMatch(source, /onKeyDown|keydown|focusin|onCancel/i, 'Escape and the focus trap are the dialog\'s own');
  assert.match(source, /opener\.current\?\.focus\(\)/);
  assert.match(source, /onClose=\{/);
  assert.match(source, /event\.target === event\.currentTarget/);
});

test('the style sheet scrolls inside the dialog, reserves the picture\'s size, and animates only opacity and transform, and not at all under reduced motion', async () => {
  const css = await read('src/page.css');
  assert.match(css, /\.screenshot-dialog \{[^}]*max-height: calc\(100dvh - 32px\)/);
  assert.match(css, /\.screenshot-scroll \{[^}]*overflow: auto/);
  assert.match(css, /\.screenshot-scroll \{[^}]*min-height: 0/);
  assert.match(css, /\.screenshot-full \{[^}]*height: auto/);
  assert.match(css, /html:has\(\.screenshot-dialog\[open\]\) \{[^}]*scrollbar-gutter: stable/);
  assert.match(css, /\.screenshot-close \{[^}]*min-height: 44px/);
  assert.match(css, /\.screenshot-close:focus-visible/);
  const motion = css.slice(css.indexOf('@media (prefers-reduced-motion: no-preference)', css.indexOf('screenshot-dialog')));
  assert.ok(motion.startsWith('@media (prefers-reduced-motion: no-preference)'), 'the dialog motion is inside the no-preference query');
  const block = motion.slice(0, motion.indexOf('@media (prefers-reduced-motion: reduce)'));
  const properties = new Set([...block.matchAll(/transition: ([^;]*);/g)].flatMap(match => match[1].replace(/cubic-bezier\([^)]*\)/g, 'curve').split(',').map(part => part.trim().split(/\s+/)[0])));
  assert.deepEqual([...properties].sort(), ['display', 'opacity', 'overlay', 'transform']);
  assert.doesNotMatch(block, /\b(width|height|top|left|margin|padding)\b[^;{]*\d+ms/);
  assert.doesNotMatch(block, /transition:[^;]*\b(ease|ease-in-out|linear)\b/, 'no built-in easing');
  assert.match(block, /@starting-style/);
  // Without a preference query the dialog is never made transparent, so reduced motion shows it at once.
  assert.doesNotMatch(css.replace(block, ''), /\.screenshot-dialog[^{]*\{[^}]*opacity: 0/);
  assert.match(css, /prefers-reduced-motion: reduce\) \{\s*\.screenshot-open \.screenshot-image \{ transition: none; \}/);
});

test('the picture is wide enough to read on a phone and scrolls sideways inside the dialog', async () => {
  const css = await read('src/page.css');
  assert.match(css, /\.screenshot-full \{[^}]*width: max\(100%, 960px\)/);
  assert.match(css, /\.screenshot-dialog \{[^}]*width: min\(1600px, calc\(100vw - 32px\)\)/);
});
