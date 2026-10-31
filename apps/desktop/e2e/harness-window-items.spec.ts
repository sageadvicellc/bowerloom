/**
 * The window items on the sample launch (--prototype-v3): made-up folders in memory, nothing read, written or opened.
 *  - Item 3: the guided tour starts on its own the first time the edit opens with no Notes keeper saved, and only once; Help replays it. This launch starts
 *    with the tour unseen (`freshTour`), unlike the other specs.
 *  - Items 4 and 5: "Skills from another folder" copies the sample's skill with a script; the review marks it, and Save waits for the acknowledgement.
 */
import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { TOUR_SEEN_KEY } from '../renderer/harness/tour/seen.js';
import { removeTempDirs } from './proto-temp.js';
import { fresh, launchHarness } from './harness-page.js';
import type { Harness } from './harness-page.js';

let h: Harness;
const page = (): Page => h.page;
const PROJECTS = '#prototype-v3/projects';

test.beforeAll(async () => { test.setTimeout(240_000); h = await launchHarness({ freshTour: true }); });
test.afterAll(async () => { try { await h.app.close(); } finally { removeTempDirs(); } });
test.beforeEach(async () => { await page().emulateMedia({ reducedMotion: 'reduce', colorScheme: 'light' }); await fresh(page(), PROJECTS); });

const saveSheet = (p: Page): Locator => p.getByRole('dialog', { name: 'Edit a folder\'s harness' });
const tour = (p: Page): Locator => p.getByRole('dialog', { name: 'Tour' });
async function openEdit(p: Page): Promise<Locator> {
  await p.getByRole('button', { name: 'Edit from a folder', exact: true }).click();
  const s = saveSheet(p);
  await expect(s.locator('[data-folder="sample-weekly-report"]')).toHaveAttribute('aria-pressed', 'true');
  await s.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(s.locator('[data-section="graph"]')).toBeVisible();
  return s;
}

test('item 3: the tour starts on its own at first use, once; a reload, Back and a new open do not repeat it; Help replays it', async () => {
  const p = page();
  expect(await p.evaluate(key => sessionStorage.getItem(key), TOUR_SEEN_KEY)).toBeNull();
  const s = await openEdit(p);
  const t = tour(p);
  await expect(t).toBeVisible();
  await expect(t).toContainText('Step 1 of 7');
  await expect(t).toContainText('These are your AI agents, from every tool.');
  expect(await p.evaluate(key => sessionStorage.getItem(key), TOUR_SEEN_KEY)).toBe('1');
  await t.getByRole('button', { name: 'Skip tour', exact: true }).click();
  await expect(t).toHaveCount(0);

  // Back to the folder and on to the edit again: not again.
  await s.getByRole('button', { name: 'Back', exact: true }).click();
  await s.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(s.locator('[data-section="graph"]')).toBeVisible();
  await expect(t).toHaveCount(0);

  // A new page of the same window: not again either.
  await fresh(p, PROJECTS);
  const again = await openEdit(p);
  await expect(t).toHaveCount(0);

  // Help replays it at any time.
  await again.getByRole('button', { name: 'Help: replay the tour', exact: true }).click();
  await expect(t).toBeVisible();
  await expect(t).toContainText('Step 1 of 7');
  await t.getByRole('button', { name: 'Skip tour', exact: true }).click();
});

test('items 4 and 5: a skill with a script from another sample folder is copied; the review marks it and names the folder; Save waits for the acknowledgement', async () => {
  const p = page();
  const s = await openEdit(p);
  await expect(tour(p)).toHaveCount(0);
  const copy = s.locator('[data-section="copy-skills"]');
  const garden = copy.locator('[data-copy-from="sample-garden"]');
  await expect(garden).toHaveText('~/Projects/garden');
  await garden.click();
  await expect(copy.locator('[data-copy-skill="soil-check"]')).toBeVisible();
  await copy.getByRole('button', { name: 'Add soil-check from ~/Projects/garden', exact: true }).click();
  await expect(copy.getByRole('button', { name: 'Take soil-check out', exact: true })).toBeVisible();
  await expect(s.locator('[data-skill-row="soil-check"]')).toContainText('From ~/Projects/garden');
  // The copy can be linked to an agent like any skill of the folder.
  await s.locator('[data-agent="editor"]').getByRole('checkbox', { name: 'soil-check: editor' }).check();
  await expect(s.locator('[data-draft]')).toContainText('2 changes, not saved yet.');
  await s.getByRole('button', { name: 'Review the save', exact: true }).click();

  const review = s.locator('[data-save-review="save"]');
  const sh = review.locator('[data-file=".bowerloom/skills/soil-check/scripts/soil-check.sh"]');
  await expect(sh).toHaveAttribute('data-executable', '');
  await expect(sh).toHaveAttribute('data-from', '~/Projects/garden');
  await expect(review.locator('[data-file=".bowerloom/skills/soil-check/SKILL.md"]')).toHaveAttribute('data-from', '~/Projects/garden');
  await expect(review.locator('[data-file=".bowerloom/agents/editor.md"]')).not.toHaveAttribute('data-from', /.*/);
  const save = s.getByRole('button', { name: 'Save 3 files', exact: true });
  await review.locator('[data-approve-plan] input').check();
  await expect(save).toBeDisabled();
  await review.locator('[data-acknowledge-executables] input').check();
  await expect(save).toBeEnabled();
  // Taking the tick away holds Save again.
  await review.locator('[data-acknowledge-executables] input').uncheck();
  await expect(save).toBeDisabled();
  await review.locator('[data-acknowledge-executables] input').check();
  await save.click();
  await expect(s.locator('[data-version-kept]')).toBeVisible();
});
