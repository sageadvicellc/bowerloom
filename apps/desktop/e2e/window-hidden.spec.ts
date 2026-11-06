/**
 * The proof that an e2e run is hidden: in the main process, no window of the app is visible or focused, the Dock has no icon (macOS), and a window that
 * a spec opens with the shared options stays hidden too. With BOWERLOOM_E2E_SHOW=1 the same spec checks the opposite, so the opt-out is held as well.
 * The page of a hidden window still paints, answers keys and hover, runs animation frames, and takes a screenshot.
 */
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { launchHarness } from './harness-page.js';
import type { Harness } from './harness-page.js';
import { extraWindowOptions, watching } from './hidden.js';
import { removeTempDirs } from './temp-dirs.js';

let h: Harness;
test.beforeAll(async () => { h = await launchHarness(); });
test.afterAll(async () => { await h?.app.close(); removeTempDirs(); });

const states = (app: Harness['app']): Promise<{ visible: boolean; focused: boolean }[]> => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map(w => ({ visible: w.isVisible(), focused: w.isFocused() })));

test('every window of the app is hidden, unless the person asked to watch', async () => {
  const all = await states(h.app);
  expect(all.length).toBeGreaterThan(0);
  if (watching) { expect(all.every(w => w.visible)).toBe(true); return; }
  expect(all.every(w => !w.visible && !w.focused)).toBe(true);
  if (process.platform === 'darwin') expect(await h.app.evaluate(({ app }) => app.dock?.isVisible())).toBe(false);
});

test('a window that a spec opens in the main process takes the same rule', async () => {
  const before = h.app.windows().length;
  await h.app.evaluate(({ BrowserWindow }, options) => { const w = new BrowserWindow({ width: 400, height: 300, ...options }); void w.loadURL('about:blank'); }, extraWindowOptions());
  await expect.poll(() => h.app.windows().length).toBe(before + 1);
  const all = await states(h.app);
  expect(all.every(w => w.visible === watching)).toBe(true);
  await h.app.windows()[before]!.close();
});

test('the page of a hidden window still draws, takes keys and hover, runs animation frames, and takes a screenshot', async () => {
  const p: Page = h.page;
  const frames = await p.evaluate(() => new Promise<number>(resolve => { let n = 0; const tick = (): void => { if (++n === 5) resolve(n); else requestAnimationFrame(tick); }; requestAnimationFrame(tick); }));
  expect(frames).toBe(5);
  await p.keyboard.press('Tab');
  expect(await p.evaluate(() => document.activeElement !== document.body)).toBe(true);
  await p.mouse.move(100, 100);
  expect((await p.screenshot()).byteLength).toBeGreaterThan(1000);
});
