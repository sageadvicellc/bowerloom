/**
 * Install history (route `history`) on the sample launch (--sample), as it behaves at the base: four sample changes, newest first and grouped by day; Undo puts back what the change replaced, the row stays marked "Undone",
 * and only the newest change of one harness or install can be undone. Route-to-spec matrix row: history, sample mode.
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

test('History lists the four sample changes, newest first, with a day heading and the hint line', async () => {
  const p = page();
  await fresh(p, '#sample/history');
  await expect(p.locator('[data-screen="history"]')).toBeVisible();
  await expect(p.getByRole('heading', { level: 1, name: 'Install history', exact: true })).toBeVisible();
  await expect(p.getByText('Newest first. Undo puts back what the change replaced.')).toBeVisible();
  const rows = p.locator('[data-history]');
  await expect(rows).toHaveCount(4);
  await expect(rows.nth(0)).toContainText('Installed Weekly report crew in bowerloom');
  await expect(rows.nth(1)).toContainText('Added Spreadsheet to Weekly report crew');
  await expect(rows.nth(2)).toContainText('Linked Writer to Translate in Weekly report crew');
  await expect(rows.nth(3)).toContainText('Made Weekly report crew from a scan');
  expect(await p.locator('.hxh-day').count(), 'the changes are grouped by day').toBeGreaterThanOrEqual(1);
  await expect(rows.nth(0)).toContainText('Robin');
  await expect(rows.nth(0)).toContainText('this Mac');
});

test('an older change of the same harness has Undo off with the reason beside it, and a change of another kind of thing does not block', async () => {
  const p = page();
  await fresh(p, '#sample/history');
  const rows = p.locator('[data-history]');
  const undo = (n: number) => rows.nth(n).getByRole('button', { name: /^Undo / });
  // The newest change is the install of a harness in a project, the next adds a part to the harness: neither has a newer change that touches the same thing.
  await expect(undo(0)).toBeEnabled();
  await expect(undo(1)).toBeEnabled();
  await expect(rows.nth(0)).not.toContainText('Undo the newer change first');
  await expect(rows.nth(1)).not.toContainText('Undo the newer change first');
  // The link and the first save of the harness each have a newer change to the same harness.
  await expect(undo(2)).toBeDisabled();
  await expect(rows.nth(2)).toContainText('Undo the newer change first');
  await expect(undo(3)).toBeDisabled();
  await expect(rows.nth(3)).toContainText('Undo the newer change first');
});

test('Undo marks the row "Undone", adds an undo row at the top, and the undo row itself has no Undo', async () => {
  const p = page();
  await fresh(p, '#sample/history');
  const rows = p.locator('[data-history]');
  await rows.nth(0).getByRole('button', { name: /^Undo Installed Weekly report crew/ }).click();
  await expect(p.locator('[data-history][data-undone]')).toHaveCount(1);
  await expect(p.locator('[data-history][data-undone]')).toContainText('Undone');
  await expect(p.locator('[data-history]')).toHaveCount(5);
  await expect(p.locator('[data-history]').first().getByRole('button', { name: /^Undo / }), 'a row that is itself an undo cannot be undone').toHaveCount(0);
});
