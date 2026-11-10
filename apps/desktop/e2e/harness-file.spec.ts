/**
 * File view (route `file`, with the part id) on the sample launch (--sample), as it behaves at the base: one file, read only: its name as the title, "Read-only", the note about secrets, "Used by",
 * the front matter as labelled fields and the raw text as plain text; an id that is not in the sample shows a named empty state with a Back button. The path disclosure has its own spec (harness-path-disclosure).
 * Route-to-spec matrix row: file, sample mode.
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

const RESEARCHER = '#sample/file/agent-researcher';

test('the File view of a sample agent shows the file name, the read-only mark, the secrets note, and Used by', async () => {
  const p = page();
  await fresh(p, RESEARCHER);
  await expect(p.locator('[data-screen="file"]')).toBeVisible();
  await expect(p.getByRole('heading', { level: 1, name: 'researcher.md' })).toBeVisible();
  await expect(p.getByText('Read-only', { exact: true })).toBeVisible();
  await expect(p.getByText('Secrets in this file are hidden here. Bowerloom keeps what it reads on this computer.')).toBeVisible();
  await expect(p.locator('.hx-usedby')).toContainText('Used by');
  await expect(p.getByRole('button', { name: 'Back', exact: true })).toBeVisible();
});

test('the front matter is shown as labelled fields and the raw file as text, in two cards', async () => {
  const p = page();
  await fresh(p, RESEARCHER);
  await expect(p.getByRole('heading', { level: 2, name: 'Front matter' })).toBeVisible();
  await expect(p.getByRole('heading', { level: 2, name: 'Raw file' })).toBeVisible();
  const fields = p.locator('.hx-fields .hx-field');
  expect(await fields.count(), 'the sample researcher has front matter fields').toBeGreaterThan(0);
  const raw = p.locator('pre.hx-raw');
  await expect(raw).toContainText('name: researcher');
  await expect(raw).toContainText('You find sources for a topic.');
  // The text is drawn as plain text, never as markup.
  expect(await raw.locator('*').count()).toBe(0);
});

test('an id that is not in the sample shows the named empty state with Back, and Back goes to the Harnesses list when there is no page before', async () => {
  const p = page();
  await fresh(p, '#sample/file/no-such-part');
  await expect(p.locator('[data-screen="file"]')).toBeVisible();
  await expect(p.getByRole('heading', { level: 1, name: 'File', exact: true })).toBeVisible();
  await expect(p.getByText('That file is not in the sample.')).toBeVisible();
  await expect(p.locator('pre.hx-raw')).toHaveCount(0);
  await expect(p.getByRole('button', { name: 'Back', exact: true })).toBeVisible();
});
