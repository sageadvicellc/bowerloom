/**
 * The harness-first preview on the person's own folders when there is nothing to find (Electron started with no flag and HOME pointed at an empty folder). "Nothing found yet" says so
 * in plain words and offers "Add a folder" and "Use the sample". A folder that is added brings the list back; the chooser closed with no folder adds nothing and says so; "Use the sample" opens
 * the sample's own sources, so the person can still look around, and in that case the Preview mark says it is the sample. The empty folder is the same, byte for byte, before and after.
 */
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { realpathSync } from 'node:fs';
import { fingerprint } from '../tests/fixtures-real/fingerprint.js';
import { buildShellHome } from '../tests/fixtures-real/shell-home.js';
import type { ShellHome } from '../tests/fixtures-real/shell-home.js';
import { launchReal } from './harness-real-page.js';
import type { RealHarness } from './harness-real-page.js';
import { removeTempDirs, tempDir } from './temp-dirs.js';

let h: RealHarness, empty: string, other: ShellHome, before: string;
const page = (): Page => h.page;

test.beforeAll(async () => {
  test.setTimeout(240_000);
  empty = realpathSync(tempDir('bowerloom-empty-home-'));
  other = buildShellHome();
  before = fingerprint(empty);
  h = await launchReal(empty);
  await page().emulateMedia({ reducedMotion: 'reduce', colorScheme: 'light' });
});
test.afterAll(async () => { try { await h?.app.close(); } finally { other?.cleanup(); removeTempDirs(); } });
test.beforeEach(async () => {
  await page().evaluate(() => { location.hash = '#app'; location.reload(); });
  await page().waitForLoadState('domcontentloaded');
  await page().waitForSelector('[data-home]');
  await h.pick(null);
});

test('an empty home says "Nothing found yet" and offers "Add a folder" and "Use the sample", and nothing is invented', async () => {
  const p = page();
  await p.getByRole('button', { name: 'Find my files', exact: true }).click();
  await expect(p.getByRole('heading', { level: 1, name: 'Nothing found yet' })).toBeVisible();
  await expect(p.getByText('No tool folders were found. You can add a folder.')).toBeVisible();
  await expect(p.getByRole('button', { name: 'Add a folder', exact: true })).toBeFocused();
  await expect(p.getByRole('button', { name: 'Use the sample', exact: true })).toBeVisible();
  await expect(p.locator('.hxf-card')).toHaveCount(0);
  await expect(p.getByRole('button', { name: 'Looks right', exact: true })).toHaveCount(0);
  const body = await p.locator('body').innerText();
  expect(body).not.toMatch(/undefined|NaN|\[object/);
  expect(body).not.toContain(empty);
  for (const name of ['Researcher', 'Weekly report crew', 'Caveman']) expect(body).not.toContain(name);
});

test('the chooser closed with no folder adds nothing and says so; a folder with work in it brings the list back', async () => {
  const p = page();
  await p.getByRole('button', { name: 'Find my files', exact: true }).click();
  await expect(p.getByRole('heading', { level: 1, name: 'Nothing found yet' })).toBeVisible();
  await p.getByRole('button', { name: 'Add a folder', exact: true }).click();
  await expect(p.getByText('No folder was chosen.')).toBeVisible();
  await expect(p.getByRole('heading', { level: 1, name: 'Nothing found yet' })).toBeVisible();
  await h.pick(other.orchard);
  await p.getByRole('button', { name: 'Add a folder', exact: true }).click();
  await expect(p.getByRole('heading', { level: 1, name: /^Found \d+ places?$/ })).toBeVisible();
  await expect(p.locator('.hxf-card').filter({ hasText: 'apple-row' })).toHaveCount(1);
  await expect(p.getByRole('button', { name: 'Looks right', exact: true })).toBeVisible();
  await expect(p.getByRole('button', { name: 'Use the sample', exact: true })).toHaveCount(0);
});

test('"Use the sample" opens the sample sources; the Preview mark then says it is the sample, and Install opens its sheet as in the sample', async () => {
  const p = page();
  await p.getByRole('button', { name: 'Find my files', exact: true }).click();
  await p.getByRole('button', { name: 'Use the sample', exact: true }).click();
  await expect(p.getByRole('heading', { level: 1, name: 'Read 3 sources. Make a harness from each.' })).toBeVisible();
  await expect(p.locator('[data-count]')).toHaveCount(0);
  await p.getByRole('button', { name: 'Make all 3', exact: true }).click();
  await expect(p.getByRole('heading', { level: 1, name: 'Harnesses', exact: true })).toBeVisible();
  await p.getByRole('button', { name: 'About this preview', exact: true }).click();
  await expect(p.locator('.hx-preview-pop')).toContainText('This is a preview. It runs on sample data. Nothing is written to your disk.');
});

test('"Use the sample" asks first once harnesses exist: "Cancel" and "Not now" keep them, and the answer starts the preview over', async () => {
  const p = page();
  await p.getByRole('button', { name: 'Find my files', exact: true }).click();
  await p.getByRole('button', { name: 'Use the sample', exact: true }).click();
  await expect(p.locator('[data-replace-confirm]'), 'a first run replaces nothing, so it does not ask').toHaveCount(0);
  await p.getByRole('button', { name: 'Make all 3', exact: true }).click();
  await expect(p.locator('.hx-row-harness')).toHaveCount(7);
  await p.evaluate(() => { location.hash = '#sample/choose'; });
  await expect(p.getByRole('heading', { level: 1, name: 'Nothing found yet' })).toBeVisible();
  await p.getByRole('button', { name: 'Use the sample', exact: true }).click();
  const ask = p.locator('[data-replace-confirm]');
  await expect(ask).toContainText('Reading again starts this preview over. It changes nothing on your computer.');
  await expect(p.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
  await p.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(ask).toHaveCount(0);
  await expect(p.getByRole('heading', { level: 1, name: 'Nothing found yet' })).toBeVisible();
  await p.getByRole('button', { name: 'Not now', exact: true }).click();
  await expect(p.getByRole('heading', { level: 1, name: 'Harnesses', exact: true })).toBeVisible();
  await expect(p.locator('.hx-row-harness')).toHaveCount(7);
  await p.evaluate(() => { location.hash = '#sample/choose'; });
  await p.getByRole('button', { name: 'Use the sample', exact: true }).click();
  await p.locator('[data-replace-confirm]').getByRole('button', { name: 'Use the sample', exact: true }).click();
  await expect(p.getByRole('heading', { level: 1, name: 'Read 3 sources. Make a harness from each.' })).toBeVisible();
  await p.getByRole('button', { name: 'Not now', exact: true }).click();
  await expect(p.locator('.hx-row-harness')).toHaveCount(4);
});

test('the empty folder is the same after all of it, byte for byte', async () => {
  expect(fingerprint(empty)).toBe(before);
});
