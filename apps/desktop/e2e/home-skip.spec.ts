/**
 * The Skip link of the page ("Skip to the content", the first stop of Tab) in the sample pages, in the real window (Electron started with --prototype-v2): Enter on it moves the focus to the main region and
 * leaves the address and the page as they were, in the full app and in read-only mode. (Real mode has its own case in home-real-shell.spec.ts.)
 */
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { removeTempDirs } from './temp-dirs.js';
import { fresh, launchHome } from './home-page.js';
import type { Home } from './home-page.js';

let home: Home;
const page = (): Page => home.page;
test.beforeAll(async () => { test.setTimeout(240_000); home = await launchHome(); });
test.afterAll(async () => { try { await home.app.close(); } finally { removeTempDirs(); } });

for (const [label, hash, marker, readOnly] of [
  ['the app', '#prototype-v2', '[data-screen="welcome"]', false],
  ['the map in read-only mode', '#prototype-v2/map/readonly', '.hm-grid', true],
  ['the map', '#prototype-v2/map', '.hm-grid', false],
] as const) {
  test(`${label}: Tab to Skip and Enter keeps the page, keeps read-only as it was, and puts the focus on main`, async () => {
    await fresh(page(), hash);
    await expect(page().locator(marker).first()).toBeVisible();
    const held = async (): Promise<number> => page().locator('[data-readonly]').count();
    const before = await held();
    expect(before > 0, 'read-only controls are held back exactly in read-only mode').toBe(readOnly);
    await page().evaluate(() => { (document.activeElement as HTMLElement | null)?.blur(); });
    await page().keyboard.press('Tab');
    expect(await page().evaluate(() => document.activeElement?.className)).toBe('skip');
    await page().keyboard.press('Enter');
    expect(await page().evaluate(() => location.hash), 'the address').toBe(hash);
    await expect(page().locator(marker).first()).toBeVisible();
    expect(await page().evaluate(() => document.activeElement?.id), 'the focus').toBe('main');
    expect(await held(), 'the held controls').toBe(before);
  });
}
