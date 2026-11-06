// Real-browser checks of the lightbox and the copy button. The page runs in a headless Chromium against Vite's server, so the native dialog,
// the focus, and the timers behave as they do for a visitor. Playwright is not a dependency of this repository: the test uses the copy that ships
// with a global `@playwright/cli`, or the one named in PLAYWRIGHT_CORE_PATH, and skips with a plain reason when there is none.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { installAvailable } from '../src/release.ts';
import { pendingNote } from '../src/content.ts';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const require = createRequire(import.meta.url);
function loadChromium() {
  const candidates = [process.env.PLAYWRIGHT_CORE_PATH];
  candidates.push(join(dirname(process.execPath), '../lib/node_modules/@playwright/cli/node_modules/playwright-core'));
  try { candidates.push(join(realpathSync(execSync('which playwright-cli', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()), '../../node_modules/playwright-core')); } catch { /* no playwright-cli on the path */ }
  try { candidates.push(join(execSync('npm root -g', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(), '@playwright/cli/node_modules/playwright-core')); } catch { /* no global npm */ }
  for (const path of candidates) {
    if (!path || !existsSync(path)) continue;
    try { return require(path).chromium; } catch { /* try the next one */ }
  }
  return null;
}
const chromium = loadChromium();
let skipReason = chromium ? null : 'no Playwright was found (set PLAYWRIGHT_CORE_PATH)';
// In CI a missing browser is a failure, never a skip, so the lightbox and the copy button cannot go unchecked.
const inCi = Boolean(process.env.CI);

/** A browser test. It skips, with the reason, on a machine that has no headless Chromium, and fails when `CI` is set. */
const dom = (name, run) => test(name, async context => {
  if (skipReason) { if (inCi) assert.fail(`CI needs a browser for this test: ${skipReason}`); return context.skip(skipReason); }
  await run();
});
const SHOT = 'builder-graph';
let server, browser, base;
before(async () => {
  if (skipReason) return;
  try { browser = await chromium.launch({ headless: true }); } catch { skipReason = 'Chromium is not installed for Playwright'; return; }
  server = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), logLevel: 'silent', server: { host: '127.0.0.1', port: 0, hmr: false, watch: null } });
  await server.listen();
  base = server.resolvedUrls.local[0];
});
after(async () => { await browser?.close(); await server?.close(); });

async function open(options = {}) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, ...options });
  const page = await context.newPage();
  await page.goto(base, { waitUntil: 'networkidle' });
  return { page, context };
}
// Measuring tests wait for the scroll reveal to finish, so a box is never read while a card is still rising.
const settleReveals = async page => {
  for (const id of ['engines', 'install']) {
    await page.evaluate(section => document.getElementById(section).scrollIntoView({ behavior: 'instant', block: 'center' }), id);
    await page.waitForFunction(section => [...document.querySelectorAll(`#${section} [data-reveal]`)].every(el => el.hasAttribute('data-revealed') && getComputedStyle(el).transform === 'none'), id, { timeout: 5000 });
  }
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
};
const settleInstall = async page => { await page.locator('#install').scrollIntoViewIfNeeded(); await page.evaluate(() => document.querySelector('#install').scrollIntoView({ behavior: 'instant', block: 'center' })); await page.waitForFunction(() => [...document.querySelectorAll('#install .install-card')].every(el => getComputedStyle(el).transform === 'none')); };
const active = page => page.evaluate(() => document.activeElement?.className || document.activeElement?.tagName);
const dialogOpen = page => page.locator(`[data-screenshot-dialog="${SHOT}"]`).evaluate(dialog => dialog.open);
async function enlarge(page) {
  const trigger = page.getByRole('button', { name: 'Enlarge: Builder graph' });
  await trigger.focus();
  await page.keyboard.press('Enter');
  await page.waitForFunction(selector => document.querySelector(selector)?.open, `[data-screenshot-dialog="${SHOT}"]`);
}

dom('Escape closes the lightbox and the focus returns to the Enlarge button', async () => {
  const { page, context } = await open();
  await enlarge(page);
  assert.equal(await active(page), 'screenshot-close', 'focus starts on the X');
  await page.keyboard.press('Escape');
  assert.equal(await dialogOpen(page), false);
  assert.equal(await active(page), 'screenshot-enlarge');
  await context.close();
});

dom('the X closes the lightbox and the focus returns', async () => {
  const { page, context } = await open();
  await enlarge(page);
  await page.locator('.screenshot-dialog[open] .screenshot-close').click();
  assert.equal(await dialogOpen(page), false);
  assert.equal(await active(page), 'screenshot-enlarge');
  await context.close();
});

dom('a click on the backdrop closes the lightbox, and a click inside does not', async () => {
  const { page, context } = await open();
  await enlarge(page);
  const box = await page.locator('.screenshot-dialog[open]').boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + 120);
  assert.equal(await dialogOpen(page), true, 'inside the dialog');
  await page.mouse.click(Math.max(4, box.x / 2), box.y + box.height / 2);
  assert.equal(await dialogOpen(page), false, 'on the backdrop');
  assert.equal(await active(page), 'screenshot-enlarge');
  await context.close();
});

dom('a click on the picture opens it, and the focus returns to the picture button', async () => {
  const { page, context } = await open();
  await page.locator(`[data-screenshot-slot="${SHOT}"] .screenshot-open`).click();
  await page.waitForFunction(selector => document.querySelector(selector)?.open, `[data-screenshot-dialog="${SHOT}"]`);
  await page.keyboard.press('Escape');
  assert.equal(await active(page), 'screenshot-open');
  await context.close();
});

dom('the X is the one keyboard stop in the lightbox, so Tab and Shift+Tab keep the focus on it, and the picture area is not a stop', async () => {
  const { page, context } = await open();
  await enlarge(page);
  assert.equal(await active(page), 'screenshot-close');
  await page.keyboard.press('Tab');
  assert.equal(await active(page), 'screenshot-close', 'Tab cycles back to the X');
  await page.keyboard.press('Shift+Tab');
  assert.equal(await active(page), 'screenshot-close', 'Shift+Tab cycles back to the X');
  assert.equal(await page.locator('.screenshot-dialog[open] [tabindex="0"]').count(), 0, 'no empty tab stop');
  await context.close();
});

dom('with reduced motion the lightbox shows at once', async () => {
  const { page, context } = await open({ reducedMotion: 'reduce' });
  await enlarge(page);
  assert.equal(await page.locator('.screenshot-dialog[open]').evaluate(dialog => getComputedStyle(dialog).opacity), '1');
  await context.close();
});

dom('the Enlarge buttons have different names that start with their visible text', async () => {
  const { page, context } = await open();
  const names = await page.locator('.screenshot-enlarge').evaluateAll(buttons => buttons.map(button => ({ name: button.getAttribute('aria-label'), visible: button.innerText.trim() })));
  assert.equal(names.length, 6);
  assert.equal(new Set(names.map(entry => entry.name)).size, 6);
  for (const entry of names) assert.ok(entry.name.startsWith(entry.visible), `${entry.name} starts with ${entry.visible}`);
  await context.close();
});

// The browser tests follow the live record, so this server render covers both states whatever the record says.
test('the install card renders the npm note outside the live region only while unpublished', async () => {
  const vite = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), logLevel: 'silent', appType: 'custom', server: { middlewareMode: true, hmr: false, watch: null } });
  try {
    const { InstallSection } = await vite.ssrLoadModule('/src/Sections.tsx');
    const status = '<p class="copy-status" role="status" aria-live="polite"></p>';
    const unpublished = renderToStaticMarkup(createElement(InstallSection, { available: false }));
    assert.match(unpublished, /data-command="unpublished"/);
    assert.match(unpublished, /class="copy-slot" data-note="yes"/);
    const note = `<p class="copy-note">${pendingNote}</p>`;
    assert.ok(unpublished.includes(note + status), 'the note sits before the empty live region, outside it');
    const published = renderToStaticMarkup(createElement(InstallSection, { available: true }));
    assert.match(published, /data-command="published"/);
    assert.match(published, /class="copy-slot" data-note="no"/);
    assert.ok(!published.includes('copy-note'), 'a published command has no npm note');
    assert.ok(published.includes(status), 'the live region is empty at idle');
  } finally { await vite.close(); }
});

// While the package is unpublished the slot holds the npm note. Once it is published the slot is empty at idle.
const idleSlot = page => page.waitForFunction(text => (document.querySelector('.copy-note')?.innerText.trim() ?? '') === text && document.querySelector('.copy-status').innerText.trim() === '', idleNote, { timeout: 5000 });
const idleNote = installAvailable ? '' : pendingNote;

dom('the npm note is plain text outside the live region while unpublished, and Copied takes the same slot at the same height', async () => {
  const { page, context } = await open({ permissions: ['clipboard-read', 'clipboard-write'] });
  await settleInstall(page);
  const button = page.locator('.copy-button');
  const status = page.locator('.copy-status');
  const noteEl = page.locator('.copy-note');
  assert.equal(await status.getAttribute('role'), 'status');
  if (installAvailable) assert.equal(await noteEl.count(), 0, 'a published command has no npm note');
  else {
    assert.match((await noteEl.innerText()).trim(), /not on npm yet/);
    assert.equal(await noteEl.evaluate(el => el.closest('[role="status"], [aria-live]') === null), true, 'the note is not in a live region, so it is never read out again');
  }
  assert.equal((await status.innerText()).trim(), '', 'the live region is empty while idle');
  const slot = await page.locator('.copy-slot').boundingBox();
  const card = await page.locator('.install-card-cli').boundingBox();
  const terminal = await page.locator('.terminal').boundingBox();
  assert.ok(slot.y - (terminal.y + terminal.height) < 20, 'no dead gap between the terminal and the note');
  await button.click();
  await page.waitForFunction(() => document.querySelector('.copy-status').innerText.trim() === 'Copied');
  if (!installAvailable) assert.equal(await noteEl.count(), 0, 'Copied replaces the note in the slot');
  assert.equal((await button.innerText()).split('\n')[0].trim(), 'Copied');
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'npm install -g bowerloom@beta');
  assert.equal((await page.locator('.copy-slot').boundingBox()).height, slot.height, 'the slot keeps its height');
  assert.equal((await page.locator('.install-card-cli').boundingBox()).height, card.height, 'the card does not move');
  await idleSlot(page);
  assert.equal((await status.innerText()).trim(), '', 'back at idle the live region is empty, so nothing is announced');
  assert.equal((await button.innerText()).split('\n')[0].trim(), 'Copy');
  await context.close();
});

dom('a clipboard that refuses shows the failure words in the same slot, then the slot goes back to idle', async () => {
  const { page, context } = await open();
  await settleInstall(page);
  await page.evaluate(() => { Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: () => Promise.reject(new Error('denied')) } }); });
  const before = await page.locator('.install-card-cli').boundingBox();
  const slot = await page.locator('.copy-slot').boundingBox();
  await page.locator('.copy-button').click();
  await page.waitForFunction(() => document.querySelector('.copy-status').innerText.includes('Copy failed'));
  assert.match(await page.locator('.copy-status').innerText(), /Copy failed\. Select the command\./);
  assert.equal((await page.locator('.copy-slot').boundingBox()).height, slot.height);
  assert.equal((await page.locator('.install-card-cli').boundingBox()).height, before.height, 'the failure text takes the same slot');
  await idleSlot(page);
  await context.close();
});

dom('the pinch hint shows on a phone only, and the picture and its scroll area allow pinch zoom', async () => {
  const phone = await open({ viewport: { width: 390, height: 844 } });
  await enlarge(phone.page);
  const read = () => phone.page.evaluate(() => ({
    hint: getComputedStyle(document.querySelector('.screenshot-dialog[open] .screenshot-pinch')).display,
    scroll: getComputedStyle(document.querySelector('.screenshot-dialog[open] .screenshot-scroll')).touchAction,
    image: getComputedStyle([...document.querySelectorAll('.screenshot-dialog[open] .screenshot-full')].find(img => img.offsetParent !== null)).touchAction,
    meta: document.querySelector('meta[name="viewport"]').content,
  }));
  const small = await read();
  assert.notEqual(small.hint, 'none');
  // The browser writes `pan-x pan-y pinch-zoom` as `manipulation`. Both allow a pinch.
  assert.match(small.scroll, /pinch-zoom|manipulation/);
  assert.match(small.image, /pinch-zoom|manipulation/);
  assert.doesNotMatch(small.meta, /user-scalable|maximum-scale/);
  await phone.context.close();
  const wide = await open({ viewport: { width: 1280, height: 800 } });
  await enlarge(wide.page);
  assert.equal(await wide.page.evaluate(() => getComputedStyle(document.querySelector('.screenshot-dialog[open] .screenshot-pinch')).display), 'none', 'no hint on a wide screen');
  await wide.context.close();
});

dom('a double press still returns to idle once, after the last press', async () => {
  const { page, context } = await open({ permissions: ['clipboard-read', 'clipboard-write'] });
  await settleInstall(page);
  const button = page.locator('.copy-button');
  await button.click();
  await page.waitForTimeout(1500);
  await button.click();
  await page.waitForTimeout(1500);
  assert.ok((await button.innerText()).includes('Copied'), 'the first timer was cleared, so the second press still shows Copied after 3 s');
  await page.waitForFunction(() => !document.querySelector('.copy-button').innerText.includes('Copied'), null, { timeout: 5000 });
  await context.close();
});

dom('the banner is 70% of the view height at phone, tablet, and desktop widths, and the picture covers the whole banner at scroll 0 and at 300 px, with and without motion', async () => {
  const measure = page => page.evaluate(() => {
    const banner = document.querySelector('.homepage-banner').getBoundingClientRect();
    const img = document.querySelector('.homepage-banner > img').getBoundingClientRect();
    return { banner: { top: banner.top, bottom: banner.bottom, left: banner.left, right: banner.right, height: banner.height }, img: { top: img.top, bottom: img.bottom, left: img.left, right: img.right }, transform: getComputedStyle(document.querySelector('.homepage-banner > img')).transform };
  });
  const covers = (m, label) => {
    assert.ok(m.img.top <= m.banner.top + 0.5, `${label}: the picture reaches the top of the banner (${m.img.top} vs ${m.banner.top})`);
    assert.ok(m.img.bottom >= m.banner.bottom - 0.5, `${label}: the picture reaches the bottom of the banner (${m.img.bottom} vs ${m.banner.bottom})`);
    assert.ok(m.img.left <= m.banner.left + 0.5 && m.img.right >= m.banner.right - 0.5, `${label}: the picture spans the banner width`);
  };
  for (const [width, height] of [[390, 844], [834, 1194], [1024, 768], [1440, 900]]) {
    for (const reducedMotion of ['no-preference', 'reduce']) {
      const { page, context } = await open({ viewport: { width, height }, reducedMotion });
      await page.waitForSelector('.homepage-banner[data-artwork="ready"]');
      const start = await measure(page);
      assert.ok(Math.abs(start.banner.height - height * 0.7) < 1, `${width}x${height}: banner ${start.banner.height}`);
      covers(start, `${width}x${height} ${reducedMotion} at scroll 0`);
      await page.evaluate(() => window.scrollTo(0, 300));
      await page.waitForTimeout(400);
      const scrolled = await measure(page);
      covers(scrolled, `${width}x${height} ${reducedMotion} at 300 px`);
      if (reducedMotion === 'reduce') assert.equal(scrolled.transform, 'none', `${width}x${height}: no offset under reduced motion`);
      else assert.notEqual(scrolled.transform, 'none', `${width}x${height}: the scroll moves the picture`);
      await context.close();
    }
  }
});

// Scroll so the middle of the section sits 42% down the screen, inside the 40% to 45% reading band. Late images move the page, so the aim is made twice.

dom('the link of the section in view gets aria-current, and Docs and GitHub never do', async () => {
  const { page, context } = await open({ viewport: { width: 1280, height: 800 } });
  const current = () => page.evaluate(() => [...document.querySelectorAll('.desktop-navigation a[aria-current]')].map(a => a.textContent.trim()));
  const toSection = async id => {
    for (let pass = 0; pass < 2; pass++) {
      await page.evaluate(id => { const rect = document.getElementById(id).getBoundingClientRect(); window.scrollTo(0, rect.top + rect.height / 2 + scrollY - innerHeight * 0.42); }, id);
      await page.waitForTimeout(500);
    }
  };
  assert.deepEqual(await current(), [], 'at the top, in the hero, no link is current');
  await toSection('how-it-works');
  assert.deepEqual(await current(), ['How it works']);
  assert.equal(await page.locator('.desktop-navigation a[aria-current]').getAttribute('aria-current'), 'true');
  await toSection('app');
  assert.deepEqual(await current(), ['The app']);
  await toSection('command-line');
  assert.deepEqual(await current(), [], 'The command line is not in the bar, so the bar marks nothing');
  assert.equal(await page.locator('.mobile-drawer a[href="#command-line"]').getAttribute('aria-current'), 'true', 'but the drawer marks it');
  await toSection('install');
  assert.equal(await page.locator('.mobile-drawer a[href="#install"]').getAttribute('aria-current'), 'true');
  assert.equal(await page.locator('.mobile-drawer a[href="#command-line"]').getAttribute('aria-current'), null, 'one at a time');
  assert.equal(await page.locator('.desktop-navigation a:is([href="/docs/"], .nav-github)[aria-current]').count(), 0);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(400);
  assert.deepEqual(await current(), []);
  await context.close();
});

dom('the stitch shows at once under reduced motion, on hover and on keyboard focus', async () => {
  const { page, context } = await open({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });
  const clip = name => page.getByRole('link', { name, exact: true }).evaluate(el => getComputedStyle(el, '::after').clipPath);
  assert.match(await clip('Docs'), /inset\(0px 100% 0px 0px\)/, 'hidden at rest');
  await page.getByRole('link', { name: 'Docs', exact: true }).hover();
  assert.match(await clip('Docs'), /inset\(0px\)/, 'drawn on hover with no delay');
  await page.mouse.move(2, 2);
  await page.keyboard.press('Tab');
  await page.getByRole('link', { name: 'The app', exact: true }).focus();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  assert.match(await clip('The app'), /inset\(0px\)/, 'drawn on keyboard focus');
  assert.equal(await page.getByRole('link', { name: 'The app', exact: true }).evaluate(el => getComputedStyle(el, '::after').transitionDuration), '0s', 'no transition under reduced motion');
  await context.close();
});

dom('the stitch draws in over about 200 ms when motion is allowed', async () => {
  const { page, context } = await open({ viewport: { width: 1280, height: 800 }, reducedMotion: 'no-preference' });
  const duration = await page.getByRole('link', { name: 'Docs', exact: true }).evaluate(el => getComputedStyle(el, '::after').transitionDuration);
  assert.equal(duration, '0.2s');
  await context.close();
});

dom('the page has no horizontal overflow at 390, 834, 1024, 1180, and 1440 px, and the desktop bar fits at 1024 px and up', async () => {
  for (const width of [390, 834, 1024, 1180, 1440]) {
    const { page, context } = await open({ viewport: { width, height: 900 } });
    const facts = await page.evaluate(() => {
      const box = selector => { const el = document.querySelector(selector); return el === null || getComputedStyle(el).display === 'none' ? null : el.getBoundingClientRect(); };
      const parts = ['.brand', '.desktop-navigation', '#site-theme', '.nav-cta-bar', '.mobile-menu-toggle'].map(box).filter(Boolean);
      let overlap = false;
      for (let i = 1; i < parts.length; i++) if (parts[i].left < parts[i - 1].right - 0.5) overlap = true;
      const tops = [...document.querySelectorAll('.desktop-navigation a')].map(a => Math.round(a.getBoundingClientRect().top));
      return { docWidth: document.documentElement.scrollWidth, overlap, desktop: box('.desktop-navigation') !== null, oneRow: new Set(tops).size <= 1, rightmost: Math.max(...parts.map(part => part.right)) };
    });
    assert.ok(facts.docWidth <= width, `${width}: the page is ${facts.docWidth} px wide`);
    assert.equal(facts.overlap, false, `${width}: header parts do not overlap`);
    assert.equal(facts.desktop, width >= 1024, `${width}: the desktop bar shows from 1024 px`);
    if (facts.desktop) assert.equal(facts.oneRow, true, `${width}: the links stay in one row`);
    assert.ok(facts.rightmost <= width, `${width}: the header ends inside the window`);
    await context.close();
  }
});

dom('the nav links, the nav button, and the stitch meet contrast rules in light and dark', async () => {
  const luminance = rgb => { const [r, g, b] = rgb.map(v => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const ratio = (a, b) => { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
  const parse = text => text.match(/[\d.]+/g).slice(0, 3).map(Number);
  for (const theme of ['light', 'dark']) {
    const { page, context } = await open({ viewport: { width: 1280, height: 800 }, colorScheme: theme });
    await page.evaluate(t => { document.documentElement.dataset.theme = t; }, theme);
    const colors = await page.evaluate(() => {
      const style = selector => getComputedStyle(document.querySelector(selector));
      return { link: style('.desktop-navigation .nav-link').color, github: style('.nav-github').color, ground: style('html').backgroundColor, button: style('.nav-cta-bar').color, buttonGround: style('.nav-cta-bar').backgroundColor, accent: style('.nav-link').getPropertyValue('--ui-primary').trim() };
    });
    assert.ok(ratio(parse(colors.link), parse(colors.ground)) >= 4.5, `${theme}: link text ${ratio(parse(colors.link), parse(colors.ground)).toFixed(2)}:1`);
    assert.ok(ratio(parse(colors.button), parse(colors.buttonGround)) >= 4.5, `${theme}: button text ${ratio(parse(colors.button), parse(colors.buttonGround)).toFixed(2)}:1`);
    await context.close();
  }
});

const scrollTo = async (page, y, wait = 450) => { await page.evaluate(top => window.scrollTo(0, top), y); await page.waitForTimeout(wait); };
/** The thin strip the glass covers on screen: the glass layer's top and height, in the window. */
const strip = page => page.evaluate(() => { const header = document.querySelector('.site-header'); const glass = getComputedStyle(header, '::before'); return { top: header.getBoundingClientRect().top + parseFloat(glass.top), height: parseFloat(glass.height), headerHeight: header.getBoundingClientRect().height }; });
/** What the header looks like at the current scroll: p, the bar's shift, the brand scale, the glass opacity, and the boxes of every part. */
const headerState = page => page.evaluate(() => {
  const header = document.querySelector('.site-header');
  const box = element => { if (!element) return null; const r = element.getBoundingClientRect(); return r.width === 0 || r.height === 0 ? null : { left: r.left, right: r.right, top: r.top, bottom: r.bottom }; };
  const matrix = new DOMMatrixReadOnly(getComputedStyle(header).transform);
  const brand = new DOMMatrixReadOnly(getComputedStyle(document.querySelector('.site-header .brand')).transform);
  const parts = ['.brand-mascot', '.brand-wordmark', '.desktop-navigation .nav-link', '.nav-github', '#site-theme', '.nav-cta-bar', '.mobile-menu-toggle'].flatMap(selector => [...document.querySelectorAll('.site-header ' + selector)].map(el => ({ selector, box: box(el) }))).filter(part => part.box);
  return {
    p: Number(getComputedStyle(document.querySelector('.site-header-shell')).getPropertyValue('--header-p')),
    ty: matrix.f, scale: brand.a, glass: Number(getComputedStyle(header, '::before').opacity),
    edge: document.querySelector('.homepage-banner').getBoundingClientRect().top,
    parts,
  };
});
const POSITIONS = [0, 12, 24, 36, 48, 96];
const sweep = async (page, positions) => { const out = []; for (const y of positions) { await scrollTo(page, y, 120); out.push({ y, ...(await headerState(page)) }); } return out; };

dom('the header follows the scroll: p, the bar shift, the brand scale, and the glass are monotonic from the full bar at 0 to the compact bar by 96 px, with values in between', async () => {
  for (const [width, height] of [[1440, 900], [390, 844]]) {
    const { page, context } = await open({ viewport: { width, height } });
    await page.waitForSelector('.homepage-banner[data-artwork="ready"]');
    const states = await sweep(page, POSITIONS);
    const first = states[0], last = states.at(-1);
    assert.equal(first.p, 0); assert.equal(first.ty, 0); assert.equal(first.scale, 1); assert.equal(first.glass, 0);
    assert.equal(last.p, 1); assert.ok(last.ty < -10, `${width}: shift ${last.ty}`); assert.ok(Math.abs(last.scale - 0.6) < 0.001); assert.equal(last.glass, 1);
    for (let i = 1; i < states.length; i++) {
      assert.ok(states[i].p >= states[i - 1].p, `${width}: p rises at ${states[i].y}`);
      assert.ok(states[i].ty <= states[i - 1].ty + 1e-6, `${width}: the bar rises at ${states[i].y}`);
      assert.ok(states[i].scale <= states[i - 1].scale + 1e-6, `${width}: the brand shrinks at ${states[i].y}`);
      assert.ok(states[i].glass >= states[i - 1].glass - 1e-6, `${width}: the glass fades in at ${states[i].y}`);
    }
    const middle = states.filter(state => state.y > 0 && state.p < 1);
    assert.ok(middle.length >= 2, `${width}: at least two positions between the ends`);
    for (const mid of middle) {
      assert.ok(mid.p > 0 && mid.p < 1, `${width}: p ${mid.p} at ${mid.y}`);
      assert.ok(mid.ty < 0 && mid.ty > last.ty, `${width}: shift ${mid.ty} at ${mid.y}`);
      assert.ok(mid.scale < 1 && mid.scale > 0.6); assert.ok(mid.glass > 0 && mid.glass < 1);
      assert.ok(Math.abs(mid.glass - mid.p) < 1e-3 && Math.abs(mid.ty - last.ty * mid.p) < 0.05, 'every part is the same fraction of its end value');
    }
    await context.close();
  }
});

dom('at 0, 12, 24, 36, 48, and 96 px, at 1440 and 390 px wide, the wordmark never crosses the photo edge unless the glass is fully under it, and no header control overlaps another', async () => {
  const overlap = (a, b) => a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;
  for (const [width, height] of [[1440, 900], [1000, 700], [390, 844]]) {
    const { page, context } = await open({ viewport: { width, height } });
    await page.waitForSelector('.homepage-banner[data-artwork="ready"]');
    for (const state of await sweep(page, [...POSITIONS, 20, 30, 40, 44])) {
      const word = state.parts.find(part => part.selector === '.brand-wordmark')?.box;
      assert.ok(word, `${width}: the wordmark is shown`);
      const crosses = state.edge > 0.5 && state.edge > word.top + 0.5 && state.edge < word.bottom - 0.5;
      assert.ok(!crosses || state.glass >= 0.999, `${width} at ${state.y}: the photo edge ${state.edge.toFixed(1)} cuts the wordmark ${word.top.toFixed(1)} to ${word.bottom.toFixed(1)}`);
      for (let i = 0; i < state.parts.length; i++) for (let j = i + 1; j < state.parts.length; j++) assert.ok(!overlap(state.parts[i].box, state.parts[j].box), `${width} at ${state.y}: ${state.parts[i].selector} overlaps ${state.parts[j].selector}`);
      for (const part of state.parts) assert.ok(!(state.edge > 0.5 && state.edge > part.box.top + 0.5 && state.edge < part.box.bottom - 0.5 && state.glass < 0.999), `${width} at ${state.y}: ${part.selector} is cut by the photo edge`);
    }
    await context.close();
  }
});

dom('scrolling back up reverses exactly: the same scroll position gives the same header going up and going down', async () => {
  const { page, context } = await open({ viewport: { width: 1280, height: 800 } });
  await page.waitForSelector('.homepage-banner[data-artwork="ready"]');
  const down = await sweep(page, [0, 12, 24, 36, 48, 96]);
  const up = (await sweep(page, [96, 48, 36, 24, 12, 0])).reverse();
  for (let i = 0; i < down.length; i++) for (const key of ['p', 'ty', 'scale', 'glass']) assert.ok(Math.abs(down[i][key] - up[i][key]) < 1e-6, `${key} at ${down[i].y}: ${down[i][key]} down, ${up[i][key]} up`);
  await context.close();
});

dom('the header changes with no time-based easing: the value is the scroll position at once, with no transition on the bar, the brand, or the glass', async () => {
  for (const reducedMotion of ['no-preference', 'reduce']) {
    const { page, context } = await open({ viewport: { width: 1280, height: 800 }, reducedMotion });
    const durations = await page.evaluate(() => ['.site-header', '.site-header .brand'].map(s => getComputedStyle(document.querySelector(s)).transitionDuration).concat(getComputedStyle(document.querySelector('.site-header'), '::before').transitionDuration));
    assert.deepEqual(durations, ['0s', '0s', '0s'], reducedMotion);
    await page.evaluate(() => scrollTo(0, 26));
    await page.waitForFunction(() => Number(document.querySelector('.site-header-shell').style.getPropertyValue('--header-p')) > 0.4);
    const now = await headerState(page);
    assert.ok(Math.abs(now.p - 0.5) < 0.01 && Math.abs(now.glass - now.p) < 1e-3, `${reducedMotion}: the frame after the scroll already shows p ${now.p}`);
    await context.close();
  }
});

dom('a page loaded already scrolled never paints the full bar: --header-p is at its scrolled value on every frame once the page has scrolled', async () => {
  const { page, context } = await open({ viewport: { width: 1280, height: 800 } });
  await page.waitForSelector('.homepage-banner[data-artwork="ready"]');
  await scrollTo(page, 400, 300);
  await page.addInitScript(() => {
    window.__frames = [];
    const tick = () => {
      const shell = document.querySelector('.site-header-shell');
      window.__frames.push({ y: scrollY, p: shell ? Number(getComputedStyle(shell).getPropertyValue('--header-p')) : null });
      if (window.__frames.length < 120) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(1500);
  const frames = await page.evaluate(() => window.__frames);
  assert.ok(frames.some(f => f.y > 100), 'the browser restored the scroll position');
  const bad = frames.filter(f => f.y >= 60 && f.p !== null && f.p < 1);
  assert.deepEqual(bad, [], 'no frame shows a scrolled page with a see-through bar');
  await context.close();
});

dom('the progress is set again on resize: the compact distance follows the header height', async () => {
  const { page, context } = await open({ viewport: { width: 1280, height: 800 } });
  await scrollTo(page, 30, 120);
  const wide = (await headerState(page)).p;
  await page.setViewportSize({ width: 390, height: 800 });
  await page.waitForTimeout(200);
  await page.evaluate(() => scrollTo(0, 14));
  await page.waitForTimeout(200);
  const narrow = (await headerState(page)).p;
  assert.ok(Math.abs(wide - 30 / 52) < 0.01, `wide ${wide}`);
  assert.ok(Math.abs(narrow - 14 / 28) < 0.01, `narrow ${narrow}`);
  await context.close();
});

dom('nothing below the header moves while the bar changes: the banner keeps one document top at 0, 30, 60, and 120 px, and no layout shift is reported', async () => {
  for (const [width, height] of [[1440, 900], [390, 844]]) {
    const { page, context } = await open({ viewport: { width, height } });
    await page.waitForSelector('.homepage-banner[data-artwork="ready"]');
    await page.waitForTimeout(800);
    await page.evaluate(() => {
      window.__shift = 0;
      new PerformanceObserver(list => { for (const entry of list.getEntries()) if (!entry.hadRecentInput) window.__shift += entry.value; }).observe({ type: 'layout-shift', buffered: false });
    });
    const docTop = () => page.evaluate(() => Math.round((document.querySelector('.homepage-banner').getBoundingClientRect().top + scrollY) * 100) / 100);
    const base = await docTop();
    for (const y of [0, 30, 60, 120, 60, 30, 0]) {
      await scrollTo(page, y, 0);
      assert.equal(await docTop(), base, `${width}: banner top at ${y} px, mid-transition`);
      await page.waitForTimeout(300);
      assert.equal(await docTop(), base, `${width}: banner top at ${y} px, settled`);
    }
    assert.equal(await page.evaluate(() => window.__shift), 0, `${width}: no layout shift while the bar changes`);
    await context.close();
  }
});

dom('at scroll 0 the bar has no border, no shadow, and no glass; compact it fades the glass, hairline, and shadow in over the photo', async () => {
  const { page, context } = await open({ viewport: { width: 1280, height: 800 } });
  await page.waitForSelector('.homepage-banner[data-artwork="ready"]');
  const read = () => page.evaluate(() => { const header = document.querySelector('.site-header'); const glass = getComputedStyle(header, '::before'); return { border: getComputedStyle(header).borderBottomWidth, shadow: getComputedStyle(header).boxShadow, opacity: glass.opacity, filter: glass.backdropFilter, position: getComputedStyle(document.querySelector('.site-header-shell')).position }; });
  const top = await read();
  assert.equal(top.border, '0px'); assert.equal(top.shadow, 'none'); assert.equal(top.opacity, '0');
  assert.equal(top.position, 'sticky');
  await scrollTo(page, 200);
  const compact = await read();
  assert.equal(compact.opacity, '1');
  assert.match(compact.filter, /blur\(18px\)/);
  const thin = await strip(page);
  assert.ok(thin.height >= 44 && thin.height <= 52, `compact strip ${thin.height}`);
  assert.equal(Math.round(thin.top), 0, 'the strip stays at the top');
  await context.close();
});

dom('the compact bar is at least 44 px tall at 390 and 1440 px, and the drawer still opens from it', async () => {
  for (const [width, height] of [[390, 844], [1440, 900]]) {
    const { page, context } = await open({ viewport: { width, height } });
    await scrollTo(page, 300);
    const thin = await strip(page);
    assert.ok(thin.height >= 44, `${width}: compact bar ${thin.height} px`);
    assert.equal(Math.round(thin.top), 0);
    const controls = await page.evaluate(() => ['#site-theme', '.mobile-menu-toggle', '.nav-cta-bar'].map(sel => { const el = document.querySelector(sel); const r = el.getBoundingClientRect(); return r.width === 0 ? null : { top: r.top, bottom: r.bottom }; }).filter(Boolean));
    for (const control of controls) assert.ok(control.top >= -0.5 && control.bottom <= thin.height + 0.5, `${width}: a control sits inside the thin bar (${control.top} to ${control.bottom})`);
    if (width < 1024) {
      await page.getByRole('button', { name: 'Open navigation' }).click();
      await page.waitForFunction(() => document.querySelector('#mobile-navigation')?.open);
      await page.keyboard.press('Escape');
    }
    await context.close();
  }
});

dom('anchor jumps land below the thin bar', async () => {
  const { page, context } = await open({ viewport: { width: 1280, height: 800 } });
  await page.waitForSelector('.homepage-banner[data-artwork="ready"]');
  for (const [name, id] of [['How it works', 'how-it-works'], ['The app', 'app']]) {
    await page.locator(`.desktop-navigation a[href="#${id}"]`).click();
    await page.waitForTimeout(700);
    await page.waitForTimeout(300);
    const thin = await strip(page);
    const facts = await page.evaluate(id => ({ top: document.getElementById(id).getBoundingClientRect().top }), id);
    facts.bar = thin.top + thin.height;
    assert.ok(facts.top >= facts.bar - 0.5, `${name}: the section starts at ${facts.top}, below the bar's bottom ${facts.bar}`);
  }
  await context.close();
});

dom('text on the glass meets 4.5:1 over the brightest and the darkest picture, in light and dark', async () => {
  const channels = text => { const nums = text.match(/[\d.]+(?:e-?\d+)?/g).map(Number); return text.startsWith('color(') ? { rgb: nums.slice(0, 3).map(v => v * 255), a: nums[3] ?? 1 } : { rgb: nums.slice(0, 3), a: nums[3] ?? 1 }; };
  const lum = rgb => { const [r, g, b] = rgb.map(v => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const ratio = (a, b) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
  for (const theme of ['light', 'dark']) {
    const { page, context } = await open({ viewport: { width: 1280, height: 800 }, colorScheme: theme });
    await page.evaluate(t => { document.documentElement.dataset.theme = t; }, theme);
    await scrollTo(page, 300);
    const colors = await page.evaluate(() => ({ glass: getComputedStyle(document.querySelector('.site-header'), '::before').backgroundColor, link: getComputedStyle(document.querySelector('.nav-link')).color }));
    const glass = channels(colors.glass), link = channels(colors.link).rgb;
    for (const [label, behind] of [['white photo', [255, 255, 255]], ['black photo', [0, 0, 0]]]) {
      const composite = glass.rgb.map((v, i) => v * glass.a + behind[i] * (1 - glass.a));
      assert.ok(ratio(link, composite) >= 4.5, `${theme} over a ${label}: ${ratio(link, composite).toFixed(2)}:1`);
    }
    await context.close();
  }
});

dom('icon buttons have no box at rest and a 44 px target, and every button, tag, and chip has the one sharp corner', async () => {
  const phone = await open({ viewport: { width: 390, height: 844 } });
  const iconFacts = selector => phone.page.evaluate(sel => { const el = document.querySelector(sel); const style = getComputedStyle(el); const box = el.getBoundingClientRect(); return { bg: style.backgroundColor, border: style.borderTopWidth, shadow: style.boxShadow, w: box.width, h: box.height }; }, selector);
  for (const selector of ['#site-theme', '.mobile-menu-toggle']) {
    const facts = await iconFacts(selector);
    assert.equal(facts.bg, 'rgba(0, 0, 0, 0)', `${selector}: transparent`);
    assert.equal(facts.border, '0px', `${selector}: no border`);
    assert.equal(facts.shadow, 'none', `${selector}: no shadow`);
    assert.ok(facts.w >= 44 && facts.h >= 44, `${selector}: ${facts.w}x${facts.h}`);
  }
  await phone.page.locator('[data-screenshot-slot="builder-graph"] .screenshot-enlarge').click();
  await phone.page.waitForFunction(() => document.querySelector('.screenshot-dialog[open]'));
  await phone.page.waitForFunction(() => getComputedStyle(document.querySelector('.screenshot-dialog[open]')).opacity === '1');
  const closeFacts = await iconFacts('.screenshot-dialog[open] .screenshot-close');
  assert.notEqual(closeFacts.bg, 'rgba(0, 0, 0, 0)', 'the viewer X is a solid push button on the frame'); assert.ok(closeFacts.w >= 44 && closeFacts.h >= 44);
  await phone.context.close();
  const wide = await open({ viewport: { width: 1280, height: 800 } });
  await settleReveals(wide.page);
  const github = await wide.page.evaluate(() => { const el = document.querySelector('.nav-github'); const style = getComputedStyle(el); const box = el.getBoundingClientRect(); return { bg: style.backgroundColor, border: style.borderTopWidth, w: box.width, h: box.height }; });
  assert.deepEqual([github.bg, github.border], ['rgba(0, 0, 0, 0)', '0px']); assert.ok(github.w >= 44 && github.h >= 44);
  const radii = await wide.page.evaluate(() => Object.fromEntries(['.hero-copy .button.primary', '.nav-cta-bar', '.copy-button', '.screenshot-enlarge', '.release-tag', '.hero-engines li', '.hero-results li', '.engine-list li', '.engine-status'].map(sel => [sel, getComputedStyle(document.querySelector(sel)).borderTopLeftRadius])));
  for (const [selector, radius] of Object.entries(radii)) assert.equal(radius, '2px', selector);
  const heights = await wide.page.evaluate(() => ['.hero-copy .button.primary', '.nav-cta-bar', '.copy-button', '.screenshot-enlarge'].map(sel => Math.round(document.querySelector(sel).getBoundingClientRect().height)));
  assert.ok(heights.every(h => h === 44), `text buttons are all 44 px tall: ${heights}`);
  await wide.context.close();
});

dom('with the modal open there is no overflow at 390, 834, and 1440 px in either theme, the picture fills the frame at 16:10, the frame is drawn, and the decorations ignore the pointer', async () => {
  for (const theme of ['light', 'dark']) for (const [width, height] of [[390, 844], [834, 1194], [1440, 900]]) {
    const { page, context } = await open({ viewport: { width, height }, colorScheme: theme });
    await page.locator('[data-screenshot-slot="builder-graph"] .screenshot-enlarge').click();
    await page.waitForFunction(() => document.querySelector('.screenshot-dialog[open]'));
    await page.waitForFunction(() => [...document.querySelectorAll('.screenshot-dialog[open] img')].filter(img => img.offsetParent !== null).every(img => img.complete && img.naturalWidth > 0), null, { timeout: 8000 });
    await page.waitForTimeout(400);
    const facts = await page.evaluate(() => {
      const dialog = document.querySelector('.screenshot-dialog[open]');
      const shown = [...dialog.querySelectorAll('.screenshot-full')].find(img => img.offsetParent !== null).getBoundingClientRect();
      const decorations = [...dialog.querySelectorAll('.deco')].filter(el => el.offsetParent !== null);
      const box = dialog.getBoundingClientRect();
      return {
        docWidth: document.documentElement.scrollWidth, dialogLeft: box.left, dialogRight: box.right, dialogHeight: box.height, innerHeight, innerWidth,
        ratio: shown.width / shown.height,
        decorations: decorations.map(el => ({ name: el.className, events: getComputedStyle(el).pointerEvents, alt: el.getAttribute('alt'), hidden: el.getAttribute('aria-hidden'), left: el.getBoundingClientRect().left, right: el.getBoundingClientRect().right })),
        scrollWidth: dialog.scrollWidth, clientWidth: dialog.clientWidth,
        borderImage: getComputedStyle(dialog.querySelector('.screenshot-device'), '::after').borderImageSource,
        overlay: (() => { const cs = getComputedStyle(dialog.querySelector('.screenshot-device'), '::after'); return { top: parseFloat(cs.borderTopWidth), slice: cs.borderImageSlice }; })(),
        scrollHeight: dialog.scrollHeight, clientHeight: dialog.clientHeight,
        // The picture fills the device's content box exactly, so the frame's hole is never empty.
        fill: (() => { const device = dialog.querySelector('.screenshot-device'), cs = getComputedStyle(device), d = device.getBoundingClientRect();
          return { left: shown.left - (d.left + parseFloat(cs.paddingLeft)), right: (d.right - parseFloat(cs.paddingRight)) - shown.right, top: shown.top - (d.top + parseFloat(cs.paddingTop)), bottom: (d.bottom - parseFloat(cs.paddingBottom)) - shown.bottom }; })(),
      };
    });
    assert.ok(facts.docWidth <= width, `${width}: page ${facts.docWidth} px wide`);
    assert.ok(facts.dialogLeft >= 0 && facts.dialogRight <= width, `${width}: the dialog is inside the window`);
    assert.ok(facts.scrollWidth <= facts.clientWidth + 1, `${width}: the dialog has no sideways scroll`);
    assert.ok(Math.abs(facts.ratio - 1.6) < 0.01, `${width}: the picture ratio is ${facts.ratio}`);
    assert.match(facts.borderImage, new RegExp(`/frame/frame-${theme}\\.webp`));
    assert.ok(facts.overlay.top > 0 && /^\d+ \d+ \d+ \d+$/.test(facts.overlay.slice), `${theme} ${width}: the frame overlay is drawn (${JSON.stringify(facts.overlay)})`);
    assert.ok(facts.scrollHeight <= facts.clientHeight + 1, `${theme} ${width}: no vertical scroll from the plants (${facts.scrollHeight} > ${facts.clientHeight})`);
    for (const [side, gap] of Object.entries(facts.fill)) assert.ok(Math.abs(gap) < 1, `${theme} ${width}: the picture fills the hole (${side} ${gap})`);
    assert.deepEqual(facts.decorations.map(d => d.name), ['deco ivy', 'deco bloom'], `${width}: both plants are shown`);
    for (const d of facts.decorations) {
      assert.equal(d.events, 'none', d.name); assert.equal(d.alt, ''); assert.equal(d.hidden, 'true');
      assert.ok(d.left >= -0.5 && d.right <= width + 0.5, `${width}: ${d.name} stays inside the window (${d.left} to ${d.right})`);
    }
    await context.close();
  }
});

dom('the dark theme shows the dark painted frame, and the light one is never fetched', async () => {
  const { page, context } = await open({ viewport: { width: 1280, height: 800 }, colorScheme: 'dark' });
  const requests = [];
  page.on('request', request => { if (request.url().includes('/frame/')) requests.push(request.url()); });
  const frame = page.waitForResponse(response => response.url().includes('/frame/frame-dark.webp'));
  await page.locator('[data-screenshot-slot="builder-graph"] .screenshot-enlarge').click();
  await page.waitForFunction(() => document.querySelector('.screenshot-dialog[open]'));
  assert.equal((await frame).status(), 200, 'the dark frame file loads');
  await page.waitForTimeout(800);
  const source = await page.evaluate(() => getComputedStyle(document.querySelector('.screenshot-dialog[open] .screenshot-device'), '::after').borderImageSource);
  assert.match(source, /\/frame\/frame-dark\.webp/);
  assert.ok(requests.some(url => url.includes('frame-dark.webp')) && !requests.some(url => url.includes('frame-light.webp')), requests.join(', '));
  await context.close();
});

dom('a saved light theme on a dark system shows the light frame, and the dark one is never fetched', async () => {
  const { page, context } = await open({ viewport: { width: 1280, height: 800 }, colorScheme: 'dark' });
  await page.evaluate(() => localStorage.setItem('bowerloom.theme', 'light'));
  const requests = [];
  page.on('request', request => { if (request.url().includes('/frame/')) requests.push(request.url()); });
  await page.reload({ waitUntil: 'networkidle' });
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'light');
  const frame = page.waitForResponse(response => response.url().includes('/frame/frame-light.webp'));
  await page.locator('[data-screenshot-slot="builder-graph"] .screenshot-enlarge').click();
  assert.equal((await frame).status(), 200);
  assert.match(await page.evaluate(() => getComputedStyle(document.querySelector('.screenshot-dialog[open] .screenshot-device'), '::after').borderImageSource), /\/frame\/frame-light\.webp/);
  assert.ok(!requests.some(url => url.includes('frame-dark.webp')), requests.join(', '));
  await context.close();
});

dom('nothing from the device frame loads until the modal first opens', async () => {
  const { page, context } = await open({ viewport: { width: 1280, height: 800 } });
  const requests = [];
  page.on('request', request => { if (request.url().includes('/frame/')) requests.push(request.url()); });
  await page.reload({ waitUntil: 'networkidle' });
  assert.deepEqual(requests, [], 'no frame file on page load');
  await page.locator('[data-screenshot-slot="builder-graph"] .screenshot-enlarge').click();
  await page.waitForFunction(() => document.querySelector('.screenshot-dialog[open]'));
  await page.waitForTimeout(800);
  assert.ok(requests.some(url => url.includes('frame-light.webp')) && requests.some(url => url.includes('ivy.webp')), 'the frame loads on first open');
  await context.close();
});

dom('link text on the real glass, sampled at scroll 14, 26, 38, 60, and 300, meets 4.5:1 in light and dark', async () => {
  const lum = rgb => { const [r, g, b] = rgb.map(v => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  for (const theme of ['light', 'dark']) {
    const { page, context } = await open({ viewport: { width: 1280, height: 800 }, colorScheme: theme });
    await page.evaluate(t => { document.documentElement.dataset.theme = t; }, theme);
    await page.waitForSelector('.homepage-banner[data-artwork="ready"]');
    const link = await page.evaluate(() => getComputedStyle(document.querySelector('.nav-link')).color.match(/[\d.]+/g).slice(0, 3).map(Number));
    await page.addStyleTag({ content: '.site-header > * { visibility: hidden !important; }' });
    for (const y of [14, 26, 38, 60, 300]) {
      await scrollTo(page, y, 600);
      const png = (await page.screenshot({ clip: { x: 0, y: 0, width: 1280, height: 48 } })).toString('base64');
      // The strip as pixels: the glass over whatever is under it, with the bar's text hidden. The worst pixel decides.
      const pixels = await page.evaluate(async data => {
        const bitmap = await createImageBitmap(await (await fetch('data:image/png;base64,' + data)).blob());
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height); const ctx = canvas.getContext('2d'); ctx.drawImage(bitmap, 0, 0);
        const { data: px } = ctx.getImageData(0, 0, bitmap.width, bitmap.height); const out = [];
        for (let i = 0; i < px.length; i += 4 * 8) out.push([px[i], px[i + 1], px[i + 2]]);
        return out;
      }, png);
      const worst = Math.min(...pixels.map(p => { const [hi, lo] = [lum(link), lum(p)].sort((a, b) => b - a); return (hi + 0.05) / (lo + 0.05); }));
      assert.ok(worst >= 4.5, `${theme} at ${y} px: the worst pixel under the links gives ${worst.toFixed(2)}:1`);
    }
    await context.close();
  }
});

// Reveal on scroll (src/reveal.ts, src/reveal.css).
const CARD = '#install .install-card-app';
const state = (page, selector) => page.locator(selector).first().evaluate(el => { const s = getComputedStyle(el); return { opacity: Number(s.opacity), transform: s.transform, revealed: el.hasAttribute('data-revealed') }; });
const jump = (page, y) => page.evaluate(top => window.scrollTo({ top, behavior: 'instant' }), y);
const top = (page, selector) => page.locator(selector).first().evaluate(el => el.getBoundingClientRect().top + window.scrollY);

dom('reveal: elements below the fold start hidden and reveal after scrolling', async () => {
  const { page, context } = await open({ reducedMotion: 'no-preference' });
  assert.equal(await page.evaluate(() => document.documentElement.classList.contains('js-reveal')), true);
  const before = await state(page, CARD);
  assert.equal(before.opacity, 0);
  assert.notEqual(before.transform, 'none');
  assert.equal(before.revealed, false);
  await jump(page, (await top(page, CARD)) - 300);
  await page.waitForFunction(selector => document.querySelector(selector).hasAttribute('data-revealed'), CARD);
  await page.waitForFunction(selector => getComputedStyle(document.querySelector(selector)).opacity === '1' && getComputedStyle(document.querySelector(selector)).transform === 'none', CARD, { timeout: 3000 });
  await context.close();
});

dom('reveal: content above the fold is visible at load, with no hidden state and no transition', async () => {
  const { page, context } = await open({ reducedMotion: 'no-preference' });
  const facts = await page.evaluate(() => {
    const near = [...document.querySelectorAll('[data-reveal]')].filter(el => el.getBoundingClientRect().top < window.innerHeight && el.getBoundingClientRect().bottom > 0);
    return near.map(el => { const s = getComputedStyle(el); return { opacity: s.opacity, transform: s.transform, revealed: el.hasAttribute('data-revealed'), duration: s.transitionDuration }; });
  });
  for (const fact of facts) assert.deepEqual(fact, { opacity: '1', transform: 'none', revealed: true, duration: '0s' });
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.normal-hero')).opacity), '1', 'the hero is not touched');
  await context.close();
});

dom('reveal: each element is revealed once and does not hide again when scrolling back up', async () => {
  const { page, context } = await open({ reducedMotion: 'no-preference' });
  await jump(page, (await top(page, CARD)) - 300);
  await page.waitForFunction(selector => { const el = document.querySelector(selector); return el.hasAttribute('data-revealed') && getComputedStyle(el).opacity === '1' && getComputedStyle(el).transform === 'none'; }, CARD);
  await jump(page, 0);
  await page.waitForTimeout(150);
  assert.deepEqual(await state(page, CARD), { opacity: 1, transform: 'none', revealed: true });
  await jump(page, (await top(page, CARD)) - 300);
  await page.waitForTimeout(150);
  assert.deepEqual(await state(page, CARD), { opacity: 1, transform: 'none', revealed: true });
  await context.close();
});

dom('reveal: cards in one group stagger by 60 ms and the delay stops at 300 ms', async () => {
  const { page, context } = await open({ viewport: { width: 1280, height: 800 }, reducedMotion: 'no-preference' });
  await jump(page, (await top(page, '#engines .engine-list')) - 400);
  await page.waitForFunction(() => document.querySelector('#engines .engine-list li:last-child')?.hasAttribute('data-revealed'));
  const delays = await page.evaluate(() => [...document.querySelectorAll('#engines [data-revealed]')].map(el => el.style.getPropertyValue('--reveal-delay')));
  assert.ok(delays.every(delay => /^\d+ms$/.test(delay) && Number.parseInt(delay) % 60 === 0 && Number.parseInt(delay) <= 300), delays.join(' '));
  await context.close();
});

dom('reveal: only transform and opacity move on a revealed element, and the page does not shift', async () => {
  const { page, context } = await open({ reducedMotion: 'no-preference' });
  await page.evaluate(() => { window.__shift = 0; new PerformanceObserver(list => { for (const entry of list.getEntries()) if (!entry.hadRecentInput) window.__shift += entry.value; }).observe({ type: 'layout-shift', buffered: false }); });
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  for (const y of [800, 1600, 2400, 3200, 4800, 6400]) { await jump(page, y); await page.waitForTimeout(120); }
  const props = await page.evaluate(() => [...new Set([...document.querySelectorAll('[data-revealed]')].flatMap(el => getComputedStyle(el).transitionProperty.split(', ')))].sort());
  assert.deepEqual(props, ['opacity', 'transform']);
  const stitch = await page.evaluate(() => [...new Set([...document.querySelectorAll('h2[data-revealed]')].map(el => getComputedStyle(el, '::after').transitionProperty))]);
  assert.deepEqual(stitch, ['clip-path']);
  assert.equal(await page.evaluate(() => document.documentElement.scrollHeight), height, 'the document height does not change');
  assert.equal(await page.evaluate(() => window.__shift), 0, 'no layout shift');
  await context.close();
});

dom('reveal: reduced motion shows everything with no transform and no transition', async () => {
  const { page, context } = await open({ reducedMotion: 'reduce' });
  const facts = await page.evaluate(() => [...document.querySelectorAll('[data-reveal]')].map(el => { const s = getComputedStyle(el); return { opacity: s.opacity, transform: s.transform, duration: s.transitionDuration }; }));
  assert.ok(facts.length > 20);
  for (const fact of facts) assert.deepEqual(fact, { opacity: '1', transform: 'none', duration: '0s' });
  await jump(page, (await top(page, CARD)) - 300);
  await page.waitForFunction(selector => document.querySelector(selector).hasAttribute('data-revealed'), CARD);
  const after = await page.evaluate(() => [...document.querySelectorAll('[data-reveal]')].map(el => { const s = getComputedStyle(el); return { duration: s.transitionDuration, delay: s.transitionDelay, stitch: getComputedStyle(el, '::after').transitionDuration }; }));
  assert.ok(after.every(fact => fact.duration === '0s' && fact.delay === '0s' && fact.stitch === '0s'), 'no transition remains after the reveal');
  await context.close();
});

dom('reveal: a malformed hash does not stop the page from rendering, and the content is visible', async () => {
  for (const hash of ['#%', '#%E0%A4%A', '#no-such-id', '#a[b', '#%20']) {
    const { page, context } = await open({ reducedMotion: 'no-preference' });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${base}${hash}`, { waitUntil: 'networkidle' });
    assert.ok(await page.locator('h1').first().isVisible(), `${hash}: the page renders`);
    assert.equal(await page.evaluate(() => document.documentElement.classList.contains('js-reveal')), true, `${hash}: the script ran`);
    await page.evaluate(() => { location.hash = '#%E0%A4%A'; });
    await page.waitForTimeout(100);
    assert.deepEqual(errors, [], `${hash}: no script error`);
    await jump(page, (await top(page, CARD)) - 300);
    await page.waitForFunction(selector => getComputedStyle(document.querySelector(selector)).opacity === '1', CARD);
    await context.close();
  }
});

dom('reveal: with JavaScript off nothing is hidden, and without the class every target shows', async () => {
  const off = await open({ javaScriptEnabled: false });
  assert.equal(await off.page.evaluate(() => document.documentElement.classList.contains('js-reveal')), false);
  await off.context.close();
  const { page, context } = await open({ reducedMotion: 'no-preference' });
  await page.evaluate(() => document.documentElement.classList.remove('js-reveal'));
  const facts = await page.evaluate(() => [...document.querySelectorAll('[data-reveal]')].map(el => { const s = getComputedStyle(el); return `${s.opacity}|${s.transform}`; }));
  assert.ok(facts.length > 20);
  assert.ok(facts.every(fact => fact === '1|none'), 'every target is visible before the script adds the class');
  await context.close();
});

dom('reveal: a jump to #install shows the install card at once, with no transition', async () => {
  const { page, context } = await open({ reducedMotion: 'no-preference' });
  assert.equal((await state(page, CARD)).opacity, 0);
  await page.evaluate(() => { location.hash = '#install'; });
  await page.waitForFunction(selector => document.querySelector(selector).hasAttribute('data-revealed'), CARD);
  assert.deepEqual(await state(page, CARD), { opacity: 1, transform: 'none', revealed: true });
  await context.close();
  const direct = await open({ reducedMotion: 'no-preference' });
  await direct.page.goto(`${base}#install`, { waitUntil: 'networkidle' });
  assert.equal((await state(direct.page, CARD)).opacity, 1, 'a deep link shows the card');
  await direct.context.close();
});

dom('reveal: keyboard focus on a hidden element reveals it at once', async () => {
  const { page, context } = await open({ reducedMotion: 'no-preference' });
  assert.equal((await state(page, '#install-cli')).opacity, 0);
  await page.keyboard.press('Tab');
  await page.locator('#install-cli .command-block').focus();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  assert.deepEqual(await state(page, '#install-cli'), { opacity: 1, transform: 'none', revealed: true });
  await context.close();
});

dom('reveal: print shows everything', async () => {
  const { page, context } = await open({ reducedMotion: 'no-preference' });
  await page.emulateMedia({ media: 'print' });
  const facts = await page.evaluate(() => [...document.querySelectorAll('[data-reveal]')].map(el => { const s = getComputedStyle(el); return `${s.opacity}|${s.transform}`; }));
  assert.ok(facts.every(fact => fact === '1|none'));
  await context.close();
});

// The caption plate and the X are placed by numbers in each frame's CSS, so this checks where they really land: in each theme, at a wide and a phone width,
// for the longest caption, and the device fits the window without a scroll. The plate stays inside the dialog and above the picture with no clipped line. The X sits in the top right corner area and takes
// the click at its centre. The part colours resolve, so an unset variable cannot leave a clear button or plate.
dom('the caption plate sits on the top rail and the X on the corner plate, in every theme and width', async () => {
  const { screenshotSlots } = await import('../src/screenshots.ts');
  const longest = [...screenshotSlots].sort((a, b) => b.caption.length - a.caption.length)[0];
  for (const [label, colorScheme, saved] of [['light', 'light', null], ['system dark', 'dark', null], ['saved dark', 'light', 'dark']]) {
    for (const viewport of [{ width: 1600, height: 1000 }, { width: 1280, height: 800 }, { width: 740, height: 360 }, { width: 390, height: 844 }]) {
      const { page, context } = await open({ viewport, colorScheme });
      if (saved) { await page.evaluate(theme => localStorage.setItem('bowerloom.theme', theme), saved); await page.reload({ waitUntil: 'networkidle' }); }
      await page.locator(`[data-screenshot-slot="${longest.id}"] .screenshot-enlarge`).click();
      await page.waitForFunction(() => { const d = document.querySelector('.screenshot-dialog[open]'); return d && getComputedStyle(d).opacity === '1'; });
      const where = `${label} at ${viewport.width}`;
      const facts = await page.evaluate(() => {
        const dialog = document.querySelector('.screenshot-dialog[open]');
        const box = el => el.getBoundingClientRect();
        const caption = dialog.querySelector('.screenshot-dialog-caption'), close = dialog.querySelector('.screenshot-close');
        const style = getComputedStyle(dialog);
        const c = box(close);
        const hit = document.elementFromPoint(c.left + c.width / 2, c.top + c.height / 2);
        return {
          dialog: box(dialog), device: box(dialog.querySelector('.screenshot-device')), picture: box(dialog.querySelector('.screenshot-scroll')), caption: box(caption), close: c,
          hitsClose: close.contains(hit), scrolls: dialog.scrollHeight > dialog.clientHeight + 1, theme: document.documentElement.dataset.theme,
          s: Number(style.getPropertyValue('--s')), cutT: Number(style.getPropertyValue('--cut-t')), cutR: Number(style.getPropertyValue('--cut-r')),
          vars: ['--rail-y', '--rail-h', '--close-x', '--close-y', '--lcd', '--lcd-ink', '--knob'].map(name => [name, style.getPropertyValue(name).trim()]),
          closeBg: getComputedStyle(close).backgroundColor, captionBg: getComputedStyle(caption).backgroundColor,
        };
      });
      for (const [name, value] of facts.vars) assert.ok(value, `${where}: ${name} is set`);
      assert.notEqual(facts.closeBg, 'rgba(0, 0, 0, 0)', `${where}: the X is a solid button`);
      assert.notEqual(facts.captionBg, 'rgba(0, 0, 0, 0)', `${where}: the plate is a solid readout`);
      assert.equal(facts.theme, label === "light" ? "light" : "dark", `${where}: the theme applied`);
      assert.ok(!facts.scrolls, `${where}: the device fits the window, so the dialog does not scroll`);
      assert.ok(facts.caption.top >= facts.dialog.top, `${where}: the plate stays inside the dialog`);
      assert.ok(facts.caption.bottom <= facts.picture.top + 1, `${where}: the plate never covers the picture`);
      assert.ok(facts.caption.left >= facts.device.left && facts.caption.right <= facts.device.right, `${where}: the plate stays on the frame`);
      const centre = { x: facts.close.left + facts.close.width / 2, y: facts.close.top + facts.close.height / 2 };
      assert.ok(centre.x >= facts.device.right - facts.cutR * facts.s && centre.x <= facts.device.right && centre.y >= facts.device.top && centre.y <= facts.device.top + facts.cutT * facts.s, `${where}: the X sits on the top right corner plate ${JSON.stringify(centre)}`);
      const overlap = facts.caption.left < facts.close.right && facts.close.left < facts.caption.right && facts.caption.top < facts.close.bottom && facts.close.top < facts.caption.bottom;
      assert.ok(!overlap, `${where}: the plate and the X do not overlap`);
      assert.ok(facts.close.width >= 43.5 && facts.close.height >= 43.5, `${where}: a 44 px target ${facts.close.width}x${facts.close.height}`);
      assert.ok(facts.hitsClose, `${where}: nothing covers the X`);
      await context.close();
    }
  }
});
