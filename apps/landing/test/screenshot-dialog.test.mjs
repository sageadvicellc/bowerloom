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

test('every shot has an Enlarge button in the caption row, with the dialog named by its alt text', async () => {
  const page = await loadPage();
  try {
    for (const item of screenshotSlots) {
      const html = renderToStaticMarkup(createElement(page.slot.default, { slot: item.id }));
      const buttons = tags(html, 'button');
      const enlarge = buttons.find(tag => tag.includes('class="screenshot-enlarge"'));
      assert.ok(enlarge.includes('type="button"') && enlarge.includes('aria-haspopup="dialog"') && enlarge.includes(`aria-label="Enlarge: ${item.title}"`), item.id);
      assert.ok(`Enlarge: ${item.title}`.startsWith('Enlarge'), `${item.id}: the name starts with the visible text`);
      const id = /aria-describedby="([^"]+)"/.exec(enlarge)?.[1];
      assert.ok(id !== undefined && html.includes(`<span id="${id}" class="screenshot-caption-text">${escape(item.caption)}</span>`), `${item.id}: the caption describes the button, so it is read once`);
      assert.ok(html.indexOf('</button>') < html.indexOf('<figcaption') && html.indexOf('<figcaption') < html.indexOf(enlarge), `${item.id}: Enlarge sits in the caption row, under the picture`);
      const picture = buttons.find(tag => tag.includes('class="screenshot-open"'));
      assert.ok(picture.includes('tabindex="-1"'), `${item.id}: the picture is a pointer target and the Enlarge button is the one tab stop`);
      assert.ok(!html.includes('screenshot-hint'), `${item.id}: no hint sits on the image`);
      const [dialog] = tags(html, 'dialog');
      assert.ok(dialog.includes(`aria-label="${escape(item.alt)}"`), `${item.id}: the dialog is named by the alt text`);
      const inside = html.slice(html.indexOf('<button'), html.indexOf('</button>'));
      assert.equal(tags(inside, 'img').length, 2, `${item.id}: both page images sit inside the picture button`);
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
    assert.match(figure, new RegExp(`<span id="[^"]+" class="screenshot-caption-text">${escape(item.caption)}</span>`));
    assert.match(figure, /<span aria-hidden="true">Enlarge<\/span>/);
  } finally { await page.close(); }
});

test('the dialog has a visible Close button, a scroll area a keyboard can reach, and no image before the first open', async () => {
  const page = await loadPage();
  try {
    const [item] = screenshotSlots;
    const html = renderToStaticMarkup(createElement(page.slot.default, { slot: item.id }));
    const dialog = html.slice(html.indexOf('<dialog'), html.indexOf('</dialog>'));
    assert.match(dialog, /<form class="screenshot-close-mount" method="dialog"><button type="submit" class="screenshot-close" aria-label="Close"><svg[^>]*aria-hidden="true"/, 'an X button, named Close');
    assert.match(dialog, /class="screenshot-scroll"/);
    assert.doesNotMatch(dialog.slice(dialog.indexOf('class="screenshot-scroll"'), dialog.indexOf('class="screenshot-scroll"') + 60), /tabindex|role=/, 'the picture area is not a keyboard stop: it does not scroll');
    assert.equal(tags(dialog, 'img').length, 0, 'a visit that never enlarges a shot loads nothing extra');
    assert.ok(!/<dialog[^>]*\sopen/.test(dialog), 'the dialog starts closed');
    assert.ok(dialog.includes(`<div class="screenshot-plate"><p class="screenshot-dialog-caption">${escape(item.caption)}</p></div>`), 'the caption is on the plate');
  } finally { await page.close(); }
});

test('after the first open the dialog holds the full file of each theme at its own size, lazy, so only the shown theme loads', async () => {
  const page = await loadPage();
  try {
    for (const item of screenshotSlots) {
      const html = renderToStaticMarkup(createElement(page.slot.ShotDialog, { id: item.id, loaded: true }));
      const images = tags(html, 'img').filter(tag => tag.includes('data-shot-theme'));
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

test('the component opens with showModal, traps Tab itself, closes on Escape and backdrop, and gives the focus back', async () => {
  // The code only: a word in a comment is not a focus trap.
  const source = (await read('src/ScreenshotSlot.tsx')).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.match(source, /showModal\(\)/);
  assert.match(source, /onKeyDown=\{trap\}/, 'Tab is kept inside the dialog');
  assert.match(source, /tabTarget\(/);
  assert.match(source, /event\.key === 'Escape'/, 'Escape closes the dialog in every browser');
  assert.match(source, /opener\.current\?\.focus\(\)/);
  assert.match(source, /onClose=\{/);
  assert.match(source, /closesOnBackdrop\(/);
  assert.match(source, /onPointerDown=\{press\}/, 'a click closes only when the press began on the backdrop too');
});

test('the backdrop is blurred, the dialog box is clear, and the caption plate and the X are parts of the frame', async () => {
  const css = await read('src/page.css');
  assert.match(css, /\.screenshot-dialog::backdrop \{[^}]*backdrop-filter: blur\(/);
  assert.match(css, /\.screenshot-dialog \{[^}]*background: transparent;[^}]*box-shadow: none;/, 'the box itself casts no shadow: the device does the work');
  assert.doesNotMatch(css, /screenshot-dialog-bar/, 'no header bar above the device');
  assert.match(css, /\.screenshot-plate \{[^}]*position: absolute;[^}]*top: calc\(\(var\(--rail-y\) \+ var\(--rail-h\) \/ 2 - 6\) \* var\(--s\) \* 1px\)/, 'the plate sits on the top rail');
  assert.match(css, /\.screenshot-plate \{[^}]*left: calc\(var\(--cut-l\)[^}]*right: calc\(var\(--cut-r\)/, 'between the corner plates');
  assert.match(css, /\.screenshot-dialog \.screenshot-dialog-caption \{[^}]*background: var\(--lcd\);[^}]*color: var\(--lcd-ink\)/, 'an LCD readout');
  assert.match(css, /\.screenshot-close-mount \{[^}]*top: calc\(var\(--close-y\)[^}]*right: calc\(var\(--close-x\)/, 'the X is on the top right corner plate');
  for (const theme of ['light', 'dark']) assert.match(css, new RegExp(`url\\(/frame/frame-${theme}\\.webp\\);[^}]*--rail-y: \\d+; --rail-h: \\d+; --close-x: \\d+; --close-y: \\d+;`), `${theme}: the frame names its rail and button spots`);
});

test('the style sheet reserves the picture\'s size, and animates only opacity and transform, and not at all under reduced motion', async () => {
  const css = await read('src/page.css');
  assert.match(css, /\.screenshot-dialog \{[^}]*max-height: calc\(100dvh - 32px\)[^}]*overflow: auto/, 'a window too short for the device scrolls the dialog');
  assert.match(css, /\.screenshot-scroll \{[^}]*min-height: 0/);
  assert.match(css, /\.screenshot-full \{[^}]*aspect-ratio: 16 \/ 10;[^}]*height: auto/);
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

test('the picture fits the frame at 16:10; on a phone a Pinch to zoom hint shows and pinch zoom stays allowed; on a wide screen the hint is hidden', async () => {
  const css = await read('src/page.css');
  assert.match(css, /\.screenshot-full \{[^}]*width: 100%; aspect-ratio: 16 \/ 10;[^}]*object-fit: cover;/, 'the picture fills the frame at 16:10');
  assert.match(css, /\.screenshot-column \{[^}]*width: min\(1100px, 100%, calc\(\(100dvh/, 'the frame is as wide as the window height allows');
  const phone = css.slice(css.indexOf('@media (max-width: 760px) {', css.indexOf('screenshot-full')));
  const block = phone.slice(0, phone.indexOf('\n}\n'));
  assert.match(block, /\.screenshot-pinch \{ display: flex;/, 'phone: the hint shows');
  assert.match(css, /\.screenshot-pinch \{ display: none; \}/, 'wide: the hint is hidden');
  assert.match(css, /\.screenshot-scroll, \.screenshot-full \{ touch-action: pan-x pan-y pinch-zoom; \}/, 'two fingers can zoom the picture');
  assert.doesNotMatch(css, /touch-action: none/);
  const html = await read('index.html');
  assert.doesNotMatch(html, /user-scalable|maximum-scale/, 'the page never blocks pinch zoom');
});

test('the dialog shows a short hint with an icon hidden from screen readers', async () => {
  const page = await loadPage();
  try {
    const html = renderToStaticMarkup(createElement(page.slot.ShotDialog, { id: 'builder-graph', loaded: false }));
    assert.match(html, /<p class="screenshot-pinch"><svg[^>]*aria-hidden="true"[^>]*>[\s\S]*?<\/svg>Pinch to zoom<\/p>/);
    assert.ok(html.indexOf('screenshot-dialog-caption') < html.indexOf('screenshot-pinch'));
  } finally { await page.close(); }
});

test('each shot has its own short title, so the Enlarge buttons have different names', () => {
  const titles = screenshotSlots.map(item => item.title);
  assert.equal(new Set(titles).size, titles.length);
  for (const title of titles) assert.ok(title.length > 3 && title.length < 30, title);
});

test('a priority slot loads both themes at once with high priority, and an ordinary slot stays lazy', async () => {
  const page = await loadPage();
  try {
    const priority = renderToStaticMarkup(createElement(page.slot.default, { slot: 'builder-graph', priority: true }));
    const ordinary = renderToStaticMarkup(createElement(page.slot.default, { slot: 'builder-graph' }));
    const figure = html => html.slice(html.indexOf('<figure'), html.indexOf('</figure>'));
    for (const tag of tags(figure(priority), 'img')) assert.ok(tag.includes('loading="eager"') && tag.includes('fetchPriority="high"'), tag);
    for (const tag of tags(figure(ordinary), 'img')) assert.ok(tag.includes('loading="lazy"') && !tag.includes('fetchPriority'), tag);
  } finally { await page.close(); }
});

/** The width and height of a WebP file, read from its header (the extended VP8X form, which a file with transparency uses). */
async function webpSize(name) {
  const bytes = await readFile(new URL(`../public/frame/${name}.webp`, import.meta.url));
  assert.equal(bytes.toString('ascii', 0, 4), 'RIFF'); assert.equal(bytes.toString('ascii', 12, 16), 'VP8X', `${name} has transparency`);
  return { width: bytes.readUIntLE(24, 3) + 1, height: bytes.readUIntLE(27, 3) + 1 };
}
/** The frame numbers of one theme rule: the image, the hole the picture fills, and the nine-slice cuts, in image pixels. */
function frameVars(rule) {
  const src = /--frame: url\(\/frame\/(frame-\w+)\.webp\);/.exec(rule)?.[1];
  const nums = name => ['t', 'r', 'b', 'l'].map(side => Number(new RegExp(`--${name}-${side}: (\\d+);`).exec(rule)?.[1]));
  return { src, hole: nums('hole'), cut: nums('cut') };
}

test('the dialog is a clear box holding a column; the device is a painted frame per theme, drawn as a nine-slice overlay that scales with --s', async () => {
  const css = await read('src/page.css');
  assert.match(css, /\.screenshot-dialog \{ --s: \.5;[^}]*background: transparent;[^}]*box-shadow: none;/);
  assert.match(css, /@media \(max-width: 1000px\) \{\s*\.screenshot-dialog \{ --s: \.4; \}/);
  assert.match(css, /@media \(max-width: 760px\) \{[^@]*\.screenshot-dialog \{ --s: \.3;/);
  // The picture fills the frame's hole: the device's padding is the hole, in image pixels times --s.
  assert.match(css, /\.screenshot-device \{[^}]*padding: calc\(var\(--hole-t\) \* var\(--s\) \* 1px\) calc\(var\(--hole-r\) \* var\(--s\) \* 1px\) calc\(var\(--hole-b\) \* var\(--s\) \* 1px\) calc\(var\(--hole-l\) \* var\(--s\) \* 1px\);/);
  // The frame lies over the picture, so corner hardware can reach past the hole without a gap, and it never takes a click.
  const after = /\.screenshot-device::after \{[^}]*\}/.exec(css)?.[0] ?? '';
  assert.match(after, /position: absolute; inset: 0;/);
  assert.match(after, /z-index: 1;/);
  assert.match(after, /pointer-events: none;/);
  assert.match(after, /border-color: transparent;/, 'a frame image that fails to load leaves no solid border over the picture');
  assert.match(after, /border-image: var\(--frame\) var\(--cut-t\) var\(--cut-r\) var\(--cut-b\) var\(--cut-l\) \/ calc\(var\(--cut-t\) \* var\(--s\) \* 1px\) calc\(var\(--cut-r\) \* var\(--s\) \* 1px\) calc\(var\(--cut-b\) \* var\(--s\) \* 1px\) calc\(var\(--cut-l\) \* var\(--s\) \* 1px\) stretch;/);
  assert.match(css, /\.screenshot-scroll \{[^}]*position: relative;/, 'the picture is a layer under the frame');
  assert.match(css, /\.deco \{[^}]*pointer-events: none;/);
  assert.doesNotMatch(css, /bezel\.webp|\.deco\.(?:tl|br|hl|hr|ctl)\b/, 'the old kit is gone');
});

test('each theme names its own frame, and its hole and cuts fit inside that image', async () => {
  const css = await read('src/page.css');
  const light = frameVars(/\.screenshot-dialog \{ --s: \.5;[^}]*\}/.exec(css)?.[0] ?? '');
  const dark = frameVars(/\[data-theme='dark'\] \.screenshot-dialog \{[^}]*\}/.exec(css)?.[0] ?? '');
  const system = /@media \(prefers-color-scheme: dark\) \{\s*:root:not\(\[data-theme\]\) \.screenshot-dialog \{[^}]*\}/.exec(css)?.[0] ?? '';
  assert.equal(light.src, 'frame-light'); assert.equal(dark.src, 'frame-dark');
  assert.deepEqual(frameVars(system), dark, 'a visitor with no saved theme and a dark system gets the dark frame');
  for (const theme of [light, dark]) {
    const { width, height } = await webpSize(theme.src);
    const [ht, hr, hb, hl] = theme.hole, [ct, cr, cb, cl] = theme.cut;
    for (const v of [...theme.hole, ...theme.cut]) assert.ok(Number.isInteger(v) && v > 0, `${theme.src}: ${v}`);
    assert.ok(ct >= ht && cr >= hr && cb >= hb && cl >= hl, `${theme.src}: each cut reaches at least the hole`);
    assert.ok(ct + cb < height && cl + cr < width, `${theme.src}: the cuts leave a middle to stretch (${width}x${height})`);
  }
});

test('the dialog markup has the device with its plate, its X, and the picture area, and the two plants only after the first open', async () => {
  const page = await loadPage();
  try {
    const closed = renderToStaticMarkup(createElement(page.slot.ShotDialog, { id: 'builder-graph', loaded: false }));
    assert.ok(closed.includes('class="screenshot-column"') && closed.includes('class="screenshot-plate"') && closed.includes('class="screenshot-device"') && closed.includes('class="screenshot-scroll"'));
    assert.equal(tags(closed, 'img').length, 0, 'nothing loads before the first open');
    const open = renderToStaticMarkup(createElement(page.slot.ShotDialog, { id: 'builder-graph', loaded: true }));
    const decorations = tags(open, 'img').filter(tag => tag.includes('class="deco '));
    assert.deepEqual(decorations.map(tag => /class="deco (\w+)"/.exec(tag)[1]), ['ivy', 'bloom']);
    for (const tag of decorations) {
      assert.ok(tag.includes('alt=""') && tag.includes('aria-hidden="true"') && tag.includes('loading="lazy"'), tag);
      assert.match(tag, /src="\/frame\/(?:ivy|bloom)\.webp"/);
    }
    const device = open.indexOf('class="screenshot-device"');
    assert.ok(device < open.indexOf('class="screenshot-plate"') && device < open.indexOf('class="screenshot-close-mount"'), 'the plate and the X are parts of the device');
    assert.ok(open.indexOf('class="screenshot-close"') < open.indexOf('class="screenshot-scroll"'), 'the X comes first, so focus starts on it');
  } finally { await page.close(); }
});

test('the frame kit files are in public/frame', async () => {
  for (const name of ['frame-light', 'frame-dark', 'ivy', 'bloom']) assert.ok((await readFile(new URL(`../public/frame/${name}.webp`, import.meta.url))).byteLength > 1000, name);
});
