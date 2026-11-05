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

dom('Tab wraps inside the lightbox in both directions', async () => {
  const { page, context } = await open();
  await enlarge(page);
  await page.keyboard.press('Tab');
  assert.equal(await active(page), 'screenshot-scroll');
  await page.keyboard.press('Tab');
  assert.equal(await active(page), 'screenshot-close', 'Tab from the last control goes to the first');
  await page.keyboard.press('Shift+Tab');
  assert.equal(await active(page), 'screenshot-scroll', 'Shift+Tab from the first control goes to the last');
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

dom('the npm note is plain text outside the live region, and Copied takes the same slot at the same height', async () => {
  const { page, context } = await open({ permissions: ['clipboard-read', 'clipboard-write'] });
  const button = page.locator('.copy-button');
  const status = page.locator('.copy-status');
  const noteEl = page.locator('.copy-note');
  assert.equal(await status.getAttribute('role'), 'status');
  const note = (await noteEl.innerText()).trim();
  assert.match(note, /not on npm yet/);
  assert.equal(await noteEl.evaluate(el => el.closest('[role="status"], [aria-live]') === null), true, 'the note is not in a live region, so it is never read out again');
  assert.equal((await status.innerText()).trim(), '', 'the live region is empty while idle');
  const slot = await page.locator('.copy-slot').boundingBox();
  const card = await page.locator('.install-card-cli').boundingBox();
  const terminal = await page.locator('.terminal').boundingBox();
  assert.ok(slot.y - (terminal.y + terminal.height) < 20, 'no dead gap between the terminal and the note');
  await button.click();
  await page.waitForFunction(() => document.querySelector('.copy-status').innerText.trim() === 'Copied');
  assert.equal(await noteEl.count(), 0, 'Copied replaces the note in the slot');
  assert.equal((await button.innerText()).split('\n')[0].trim(), 'Copied');
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'npm install -g bowerloom@beta');
  assert.equal((await page.locator('.copy-slot').boundingBox()).height, slot.height, 'the slot keeps its height');
  assert.equal((await page.locator('.install-card-cli').boundingBox()).height, card.height, 'the card does not move');
  await page.waitForFunction(text => document.querySelector('.copy-note')?.innerText.trim() === text, note, { timeout: 5000 });
  assert.equal((await status.innerText()).trim(), '', 'back at idle the live region is empty, so nothing is announced');
  assert.equal((await button.innerText()).split('\n')[0].trim(), 'Copy');
  await context.close();
});

dom('a clipboard that refuses shows the failure words in the same slot, then the note comes back', async () => {
  const { page, context } = await open();
  await page.evaluate(() => { Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: () => Promise.reject(new Error('denied')) } }); });
  const note = (await page.locator('.copy-note').innerText()).trim();
  const before = await page.locator('.install-card-cli').boundingBox();
  const slot = await page.locator('.copy-slot').boundingBox();
  await page.locator('.copy-button').click();
  await page.waitForFunction(() => document.querySelector('.copy-status').innerText.includes('Copy failed'));
  assert.match(await page.locator('.copy-status').innerText(), /Copy failed\. Select the command\./);
  assert.equal((await page.locator('.copy-slot').boundingBox()).height, slot.height);
  assert.equal((await page.locator('.install-card-cli').boundingBox()).height, before.height, 'the failure text takes the same slot');
  await page.waitForFunction(text => document.querySelector('.copy-note')?.innerText.trim() === text, note, { timeout: 5000 });
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
  const button = page.locator('.copy-button');
  await button.click();
  await page.waitForTimeout(1500);
  await button.click();
  await page.waitForTimeout(1500);
  assert.ok((await button.innerText()).includes('Copied'), 'the first timer was cleared, so the second press still shows Copied after 3 s');
  await page.waitForFunction(() => !document.querySelector('.copy-button').innerText.includes('Copied'), null, { timeout: 5000 });
  await context.close();
});
