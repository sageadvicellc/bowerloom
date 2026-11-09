/**
 * Help (route `help`) on the sample launch (--sample), as it behaves at the base: the title, the four lines about what a harness is, and "Show me around", which opens the edit of a folder's agents and runs the tour.
 * Route-to-spec matrix row: help, sample mode. Written before the rebuild of v0.9: it asserts the base and nothing new.
 */
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { removeTempDirs } from './temp-dirs.js';
import { fresh, launchHarness } from './harness-page.js';
import type { Harness } from './harness-page.js';

let h: Harness;
const page = (): Page => h.page;

test.beforeAll(async () => { test.setTimeout(240_000); h = await launchHarness(); });
test.afterAll(async () => { try { await h.app.close(); } finally { removeTempDirs(); } });
test.beforeEach(async () => { await page().emulateMedia({ reducedMotion: 'reduce', colorScheme: 'light' }); });

test('Help shows its title and the four sample lines, and the navigation marks it as the current page', async () => {
  const p = page();
  await fresh(p, '#sample/help');
  await expect(p.locator('[data-screen="help"]')).toBeVisible();
  await expect(p.getByRole('heading', { level: 1, name: 'Help', exact: true })).toBeVisible();
  const lines = p.locator('.hx-help-line');
  await expect(lines).toHaveCount(4);
  await expect(lines.nth(0)).toHaveText('A harness is a saved bundle of your AI helpers.');
  await expect(lines.nth(1)).toHaveText('Build one from your agents and skills. Then run it in any engine you use.');
  await expect(lines.nth(2)).toHaveText('Pick a harness to see where it is installed. Open it in the builder to change what it holds.');
  await expect(lines.nth(3)).toHaveText('Bowerloom only reads until you press Install. You can undo an install in Install history.');
  await expect(p.locator('[data-screen="help"] [aria-current="page"], nav [aria-current="page"]').first()).toContainText('Help');
});

test('Help has no details column, and its one action is "Show me around"', async () => {
  const p = page();
  await fresh(p, '#sample/help');
  await expect(p.getByRole('complementary')).toHaveCount(0);
  await expect(p.locator('[data-show-around]')).toHaveCount(1);
  await expect(p.getByRole('button', { name: 'Show me around', exact: true })).toBeVisible();
});

test('"Show me around" opens the edit sheet of a folder', async () => {
  const p = page();
  await fresh(p, '#sample/help');
  await p.getByRole('button', { name: 'Show me around', exact: true }).click();
  await expect(p.getByRole('dialog', { name: 'Edit a folder\'s harness' })).toBeVisible();
});
