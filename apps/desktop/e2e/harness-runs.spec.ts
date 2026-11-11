/**
 * Runs (route `runs`, with the optional id) on the sample launch (--sample), as it behaves at the base: three sample runs, two of one instruction in a group with "Open compare"; picking a run fills the details
 * column; "Bring window to the front" does nothing and says so; the search filters; an id that is not here shows a named empty state. Compare has its own spec (harness-compare). Route-to-spec matrix row: runs, sample mode only
 * (Runs on the person's own folders has its own spec, harness-runs-real).
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

test('Runs lists the three sample runs, the two of one instruction in a group with Open compare', async () => {
  const p = page();
  await fresh(p, '#sample/runs');
  await expect(p.locator('[data-screen="runs"]')).toBeVisible();
  await expect(p.getByRole('heading', { level: 1, name: 'Runs', exact: true })).toBeVisible();
  await expect(p.getByText('3 runs. Runs of one instruction are grouped for Compare.')).toBeVisible();
  await expect(p.locator('[data-run]')).toHaveCount(3);
  await expect(p.locator('[data-run="run-2"]')).toHaveAttribute('data-status', 'done');
  await expect(p.locator('[data-run="run-3"]')).toHaveAttribute('data-status', 'closed');
  await expect(p.locator('[data-run="run-1"]')).toHaveAttribute('data-status', /^(running|done)$/);
  await expect(p.locator('[data-group="group-1"] [data-run]')).toHaveCount(2);
  await expect(p.locator('[data-group="group-1"]').getByRole('button', { name: 'Open compare', exact: true })).toBeVisible();
  await expect(p.locator('[data-run="run-3"]')).toContainText('Research desk in Claude Code');
});

test('the first run is picked, and the details column holds its instruction, harness and project, start time and the chat note', async () => {
  const p = page();
  await fresh(p, '#sample/runs');
  const panel = p.getByRole('complementary');
  await expect(p.locator('[data-run="run-1"]')).toHaveAttribute('data-selected', '');
  await expect(panel.getByRole('heading', { level: 2, name: 'Claude Code run' })).toBeVisible();
  await expect(panel).toContainText('Write a weekly report from the notes in Meetings. Check that every claim has a source.');
  await expect(panel).toContainText('Bowerloom does not read or keep the chat. Read it in the engine window.');
  await p.locator('[data-run="run-3"]').getByRole('button', { name: 'Research desk in Claude Code', exact: true }).click();
  await expect(p).toHaveURL(/#sample\/runs\/run-3$/);
  await expect(p.getByRole('complementary')).toContainText('Find three sources for the note on pricing.');
});

test('"Bring window to the front" opens no window and says "Not in this preview."', async () => {
  const p = page();
  await fresh(p, '#sample/runs');
  await p.getByRole('complementary').getByRole('button', { name: 'Bring window to the front', exact: true }).click();
  await expect(p.getByRole('status').filter({ hasText: 'Not in this preview.' })).toBeVisible();
});

test('"Open compare" leads to Compare, and the search narrows the list or says nothing matches', async () => {
  const p = page();
  await fresh(p, '#sample/runs');
  await p.locator('[data-group="group-1"]').getByRole('button', { name: 'Open compare', exact: true }).click();
  await expect(p).toHaveURL(/#sample\/compare\/group-1$/);
  await fresh(p, '#sample/runs');
  await p.getByRole('button', { name: 'Search', exact: true }).click();
  const box = p.getByRole('searchbox', { name: 'Search' });
  await box.fill('pricing');
  await expect(p.locator('[data-run]')).toHaveCount(1);
  await expect(p.locator('[data-run="run-3"]')).toBeVisible();
  await box.fill('zzzz-nothing');
  await expect(p.locator('[data-run]')).toHaveCount(0);
});

test('a run id that is not here shows the named empty state with a way back to Runs', async () => {
  const p = page();
  await fresh(p, '#sample/runs/run-404');
  await expect(p.getByText('That run is not here.')).toBeVisible();
  await expect(p.locator('[data-run]')).toHaveCount(0);
  await p.locator('[data-screen="runs"]').getByRole('button', { name: 'Runs', exact: true }).click();
  await expect(p.locator('[data-run]')).toHaveCount(3);
});

test('the sample Runs screen is saved as a picture of the screen, with the three made-up runs', async ({}, testInfo) => {
  const p = page();
  await fresh(p, '#sample/runs');
  await expect(p.locator('[data-run]')).toHaveCount(3);
  await p.screenshot({ path: testInfo.outputPath('runs-screen.png'), scale: 'css' });
});
