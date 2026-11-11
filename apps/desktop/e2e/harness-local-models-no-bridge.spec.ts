/**
 * Local models on a window with no bridge (the launch on the person's own folders, opened with no preload): no extension list can load, so the route is not available and says so in words. The navigation
 * has no entry for it. Route-to-spec matrix: extension route local-models, no-bridge mode.
 */
import { expect, test } from '@playwright/test';
import { fresh, launchHarness } from './harness-page.js';
import type { Harness } from './harness-page.js';
import { removeTempDirs } from './temp-dirs.js';

let h: Harness;
test.beforeAll(async () => { h = await launchHarness(); });
test.afterAll(async () => { await h?.app.close(); removeTempDirs(); });

test('with no bridge the route is named as not available and nothing is blank', async () => {
  await fresh(h.page, '#app/local-models');
  expect(await h.page.evaluate(() => typeof (window as unknown as { bowerloomLocal?: unknown }).bowerloomLocal)).toBe('undefined');
  await expect(h.page.locator('[data-error="ROUTE_NOT_FOUND"]')).toBeVisible();
  await expect(h.page.locator('[data-screen="local-models"]')).toHaveCount(0);
  await expect(h.page.locator('nav [data-nav-key="local-models"]')).toHaveCount(0);
});
