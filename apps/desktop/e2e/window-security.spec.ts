/**
 * The window is locked down, checked from the inside, in both launches of the app: the sample (--sample, no bridge at all) and the app on the person's own folders
 * (no flag, HOME pointed at a made-up folder, the one bridge). Neither has Node, either refuses an inline script, a navigation and a new window, and the old viewer's
 * bridge (`window.bowerloom`) exists in neither.
 */
import { expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { ENGINE_CALLS } from '../shared/engine/types.js';
import { REAL_CALLS } from '../shared/real/types.js';
import { buildShellHome } from '../tests/fixtures-real/shell-home.js';
import type { ShellHome } from '../tests/fixtures-real/shell-home.js';
import { launchHarness } from './harness-page.js';
import { launchReal } from './harness-real-page.js';
import { removeTempDirs } from './temp-dirs.js';

let home: ShellHome | null = null;
test.afterAll(() => { home?.cleanup(); removeTempDirs(); });

async function lockedDown(app: ElectronApplication, page: Page): Promise<void> {
  const prefs = await app.evaluate(({ BrowserWindow }) => {
    const p = (BrowserWindow.getAllWindows()[0]!.webContents as unknown as { getLastWebPreferences(): Record<string, unknown> }).getLastWebPreferences();
    return { contextIsolation: p.contextIsolation, nodeIntegration: p.nodeIntegration, sandbox: p.sandbox, webSecurity: p.webSecurity, webviewTag: p.webviewTag };
  });
  expect(prefs).toMatchObject({ contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, webviewTag: false });
  expect(await page.evaluate(() => [typeof (globalThis as { require?: unknown }).require, typeof (globalThis as { process?: unknown }).process, typeof (globalThis as { Buffer?: unknown }).Buffer])).toEqual(['undefined', 'undefined', 'undefined']);
  expect(await page.evaluate(() => typeof (window as unknown as { bowerloom?: unknown }).bowerloom)).toBe('undefined');
  // An inline script is refused by the policy.
  const blocked = await page.evaluate(() => new Promise<boolean>(resolve => {
    document.addEventListener('securitypolicyviolation', () => resolve(true), { once: true });
    const s = document.createElement('script'); s.textContent = 'window.__ran = true'; document.body.append(s);
    setTimeout(() => resolve((window as unknown as { __ran?: boolean }).__ran !== true), 500);
  }));
  expect(blocked).toBe(true);
  // Navigation and new windows to the outside are refused, even to a host on the link allowlist.
  const before = page.url();
  await page.evaluate(() => { window.open('https://example.com/'); window.open('https://github.com/'); });
  await page.evaluate(() => { location.href = 'https://example.com/'; });
  await page.waitForTimeout(500);
  expect(page.url()).toBe(before);
  expect(app.windows().length).toBe(1);
}

test('the sample launch: locked down, and no bridge of any kind', async () => {
  test.setTimeout(240_000);
  const { app, page } = await launchHarness();
  try {
    await lockedDown(app, page);
    expect(await page.evaluate(() => [typeof (window as unknown as { bowerloomReal?: unknown }).bowerloomReal, typeof (window as unknown as { bowerloomEngine?: unknown }).bowerloomEngine])).toEqual(['undefined', 'undefined']);
    expect(page.url()).toMatch(/^app:\/\/viewer\/index\.html#sample/);
  } finally { await app.close(); }
});

test('the app on the person\'s own folders: locked down, with exactly the reader\'s three calls and the engine calls, and no other bridge', async () => {
  test.setTimeout(240_000);
  home = buildShellHome();
  const h = await launchReal(home.home);
  try {
    await lockedDown(h.app, h.page);
    const bridges = await h.page.evaluate(() => {
      const w = window as unknown as { bowerloomReal: object; bowerloomEngine: object };
      return { real: Object.keys(w.bowerloomReal).sort(), engine: Object.keys(w.bowerloomEngine).sort() };
    });
    expect(bridges.real).toEqual([...REAL_CALLS].sort());
    expect(bridges.engine).toEqual(['mode', ...ENGINE_CALLS].sort());
    expect(h.page.url()).toMatch(/^app:\/\/viewer\/index\.html#app/);
  } finally { await h.app.close(); }
});
