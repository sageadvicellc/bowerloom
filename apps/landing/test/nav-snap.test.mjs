// The header must never snap. A real browser records the bar on every frame while the page is flung through the threshold and while the scroll reverses in
// the middle of the change. A snap is a speed above 0.36 px/ms in the bar's transform (6 px in one 60 Hz frame; the old curve peaked near 0.48, the current one near 0.27), or above 0.04 per ms in the glass opacity (0.67 in one frame). Each frame is timed by its animation-frame timestamp.
// Playwright is not a dependency of this repository: see dom.test.mjs for how it is found. Without it the tests skip, and in CI they fail.
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
  const candidates = [process.env.PLAYWRIGHT_CORE_PATH, join(dirname(process.execPath), '../lib/node_modules/@playwright/cli/node_modules/playwright-core')];
  try { candidates.push(join(realpathSync(execSync('which playwright-cli', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()), '../../node_modules/playwright-core')); } catch { /* none */ }
  try { candidates.push(join(execSync('npm root -g', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(), '@playwright/cli/node_modules/playwright-core')); } catch { /* none */ }
  for (const path of candidates) { if (!path || !existsSync(path)) continue; try { return require(path).chromium; } catch { /* next */ } }
  return null;
}
const chromium = loadChromium();
let skipReason = chromium ? null : 'no Playwright was found (set PLAYWRIGHT_CORE_PATH)';
let server, browser, base;
before(async () => {
  if (skipReason) return;
  try { browser = await chromium.launch({ headless: true }); } catch { skipReason = 'Chromium is not installed for Playwright'; return; }
  server = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), logLevel: 'silent', server: { host: '127.0.0.1', port: 0, hmr: false, watch: null } });
  await server.listen();
  base = server.resolvedUrls.local[0];
});
after(async () => { await browser?.close(); await server?.close(); });
const dom = (name, run) => test(name, async context => {
  if (skipReason) { if (process.env.CI) assert.fail(`CI needs a browser for this test: ${skipReason}`); return context.skip(skipReason); }
  await run();
});

/** Starts recording the bar on every animation frame. */
const SAMPLER = () => {
  window.__frames = []; window.__recording = true; let n = 0;
  const header = document.querySelector('.site-header');
  const tick = time => {
    const matrix = new DOMMatrixReadOnly(getComputedStyle(header).transform);
    window.__frames.push({ n: n++, time, y: Math.round(scrollY), compact: header.classList.contains('is-compact'), ty: matrix.f, opacity: +getComputedStyle(header, '::before').opacity });
    if (window.__recording) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
};
const MAX_PX_PER_MS = 0.36;
const MAX_OPACITY_PER_MS = 0.04;
/** Every snap in a list of frames. */
const snaps = frames => {
  const found = [];
  for (let i = 1; i < frames.length; i++) {
    const before = frames[i - 1], now = frames[i];
    // Speed, not distance per frame, so a frame stretched by a CPU stall does not read as a snap. 0.36 px/ms is 6 px in one 60 Hz frame, below the old curve's 0.48 peak.
    const ms = Math.max(now.time - before.time, 1);
    if (Math.abs(now.ty - before.ty) / ms > MAX_PX_PER_MS) found.push(`transform jumped ${before.ty.toFixed(1)} to ${now.ty.toFixed(1)} in ${ms.toFixed(1)} ms at frame ${now.n}, scroll ${now.y}`);
    if (Math.abs(now.opacity - before.opacity) / ms >= MAX_OPACITY_PER_MS) found.push(`glass opacity jumped ${before.opacity} to ${now.opacity} at frame ${now.n}`);
  }
  return found;
};
async function record(width, height, run) {
  const context = await browser.newContext({ viewport: { width, height } });
  const page = await context.newPage();
  await page.goto(base, { waitUntil: 'load' });
  await page.waitForSelector('.homepage-banner[data-artwork="ready"]');
  await page.waitForTimeout(800);
  await page.evaluate(SAMPLER);
  await run(page);
  await page.waitForTimeout(600);
  const frames = await page.evaluate(() => { window.__recording = false; return window.__frames; });
  await context.close();
  return frames;
}
const wheel = async (page, dy, steps, gap) => { await page.mouse.move(400, 400); for (let i = 0; i < steps; i++) { await page.mouse.wheel(0, dy); await page.waitForTimeout(gap); } };

for (const [width, height] of [[1440, 900], [1024, 768], [390, 844]]) {
  dom(`${width}x${height}: a fast fling from 0 to 600 px and back never snaps the bar, and the bar really changes`, async () => {
    const frames = await record(width, height, async page => { await wheel(page, 120, 5, 16); await wheel(page, -120, 5, 16); });
    assert.deepEqual(snaps(frames), []);
    assert.ok(frames.some(f => f.compact) && Math.min(...frames.map(f => f.ty)) < -10, 'the bar went compact and moved up');
    assert.equal(frames.at(-1).compact, false);
    assert.ok(Math.abs(frames.at(-1).ty) < 0.01 && frames.at(-1).opacity === 0, 'back to the full bar');
  });
  dom(`${width}x${height}: reversing in the middle of the change, down past 48 px then up past 16 px within 100 ms, never snaps and never leaves the bar half done`, async () => {
    const frames = await record(width, height, async page => {
      await page.evaluate(() => scrollTo(0, 52)); await page.waitForTimeout(60);
      await page.evaluate(() => scrollTo(0, 10)); await page.waitForTimeout(60);
      await page.evaluate(() => scrollTo(0, 60)); await page.waitForTimeout(40);
      await page.evaluate(() => scrollTo(0, 8));
    });
    assert.deepEqual(snaps(frames), []);
    const last = frames.at(-1);
    assert.equal(last.compact, false);
    assert.ok(Math.abs(last.ty) < 0.01 && last.opacity === 0, 'settles on the full bar');
  });
}

dom('a smooth jump to #install and back never snaps the bar', async () => {
  const frames = await record(1440, 900, async page => {
    await page.addStyleTag({ content: 'html { scroll-behavior: smooth; }' });
    await page.evaluate(() => document.getElementById('install').scrollIntoView());
    await page.waitForTimeout(2200);
    await page.evaluate(() => scrollTo(0, 0));
    await page.waitForTimeout(2200);
  });
  assert.deepEqual(snaps(frames), []);
  const flips = frames.filter((f, i) => i > 0 && f.compact !== frames[i - 1].compact).length;
  assert.equal(flips, 2, 'one change down and one back, no double toggle');
});

dom('crossing the 1100 and 1023 px breakpoints while the bar is compact does not snap it', async () => {
  const frames = await record(1200, 800, async page => {
    await page.evaluate(() => scrollTo(0, 300)); await page.waitForTimeout(500);
    for (const w of [1090, 1110, 1020, 1030, 1200]) { await page.setViewportSize({ width: w, height: 800 }); await page.waitForTimeout(350); }
  });
  const jumps = snaps(frames).filter(message => !message.includes('opacity'));
  assert.deepEqual(jumps, []);
});
