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

/** A browser test. It skips, with the reason, on a machine that has no headless Chromium. */
const dom = (name, run) => test(name, async context => { if (skipReason) return context.skip(skipReason); await run(); });
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
const dialogOpen = page => page.locator(`[data-screenshot-dialog="${SHOT}"]`).first().evaluate(dialog => dialog.open);
async function enlarge(page) {
  const trigger = page.locator(`[data-screenshot-slot="${SHOT}"] .screenshot-enlarge`).first();
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
  await page.locator(`[data-screenshot-slot="${SHOT}"] .screenshot-open`).first().click();
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

dom('the copy button goes from Copy to Copied and back, and the status slot says what happened', async () => {
  const { page, context } = await open({ permissions: ['clipboard-read', 'clipboard-write'] });
  const button = page.locator('.copy-button');
  const status = page.locator('.copy-status');
  assert.equal((await button.innerText()).split('\n')[0].trim(), 'Copy');
  assert.equal(await status.getAttribute('role'), 'status');
  const before = await page.locator('.install-card-cli').boundingBox();
  await button.click();
  await page.waitForFunction(() => document.querySelector('.copy-button').innerText.includes('Copied'));
  assert.equal((await button.innerText()).split('\n')[0].trim(), 'Copied');
  await page.waitForFunction(() => document.querySelector('.copy-status').innerText.trim() === 'Copied');
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'npm install -g bowerloom@beta');
  const during = await page.locator('.install-card-cli').boundingBox();
  assert.equal(during.height, before.height, 'the card does not change height when the words change');
  await page.waitForFunction(() => !document.querySelector('.copy-button').innerText.includes('Copied'), null, { timeout: 5000 });
  assert.equal((await status.innerText()).trim(), '');
  await context.close();
});

dom('a clipboard that refuses shows the failure words in the status slot, then goes back to idle', async () => {
  const { page, context } = await open();
  await page.evaluate(() => { Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: () => Promise.reject(new Error('denied')) } }); });
  const before = await page.locator('.install-card-cli').boundingBox();
  await page.locator('.copy-button').click();
  await page.waitForFunction(() => document.querySelector('.copy-status').innerText.includes('Copy failed'));
  assert.match(await page.locator('.copy-status').innerText(), /Copy failed\. Select the command and copy it\./);
  assert.equal((await page.locator('.install-card-cli').boundingBox()).height, before.height, 'the failure text takes the reserved slot');
  await page.waitForFunction(() => document.querySelector('.copy-status').innerText.trim() === '', null, { timeout: 5000 });
  await context.close();
});
