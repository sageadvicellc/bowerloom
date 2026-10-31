/**
 * A window on the person's own folders whose bridge is missing shows the no-bridge screen, and its one button closes the window (not the app). Hidden, like every e2e run (e2e/hidden.ts).
 * The made-up launch has no preload, so the page has no `bowerloomReal` at all before it mounts; opening its page on the address of the launch on the person's own folders (`#app`, on its Choose screen) is the
 * same case as a real launch whose bridge did not load: the page reads its mode from the address, never from the bridge.
 */
import { expect, test } from '@playwright/test';
import { fresh, launchHarness } from './harness-page.js';
import type { Harness } from './harness-page.js';
import { removeTempDirs } from './temp-dirs.js';

let h: Harness;
test.beforeAll(async () => { h = await launchHarness(); });
test.afterAll(async () => { await h?.app.close(); removeTempDirs(); });

const windowCount = (): Promise<number> => h.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);

test('with no bridge, the screen says so and "Close this window" closes the window', async () => {
  await fresh(h.page, '#app/choose');
  // Before the page mounts there is no bridge in it, and the page is in the mode of the launch on the person's own folders.
  expect(await h.page.evaluate(() => typeof (window as unknown as { bowerloomReal?: unknown }).bowerloomReal)).toBe('undefined');
  const screen = h.page.locator('[data-error="NO_BRIDGE"]');
  await expect(screen).toBeVisible();
  await expect(h.page.getByRole('button', { name: 'Close Bowerloom' })).toHaveCount(0);
  const close = h.page.getByRole('button', { name: 'Close this window', exact: true });
  await expect(close).toBeVisible();
  expect(await windowCount()).toBe(1);
  await close.click();
  await expect.poll(windowCount, { message: 'the window is gone' }).toBe(0);
});
