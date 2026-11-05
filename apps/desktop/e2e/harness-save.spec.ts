/**
 * The save sheet in the real window, on the sample launch (--sample): synthetic folders in memory, nothing read or written.
 * "Edit from a folder" on Projects: pick the folder, link a skill to an agent as a draft, read the change list, approve its revision and save, see the save
 * point kept and the install offered, then use "Go back" on the first save point and see the link gone. Set HARNESS_SHOTS to a folder to save screenshots.
 */
import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { removeTempDirs } from './temp-dirs.js';
import { fresh, launchHarness, shot } from './harness-page.js';
import type { Harness } from './harness-page.js';

let h: Harness;
const page = (): Page => h.page;
const PROJECTS = '#sample/projects';
const EDITOR_FILE = '.bowerloom/agents/editor.md';

test.beforeAll(async () => { test.setTimeout(240_000); h = await launchHarness(); });
test.afterAll(async () => { try { await h.app.close(); } finally { removeTempDirs(); } });
test.beforeEach(async () => { await page().emulateMedia({ reducedMotion: 'reduce', colorScheme: 'light' }); await fresh(page(), PROJECTS); });

const saveSheet = (p: Page): Locator => p.getByRole('dialog', { name: 'Edit a folder\'s harness' });

test('Edit from a folder: link a skill to an agent, read the change list, save, see the save point, then go back and see the link gone', async () => {
  const p = page();
  await p.getByRole('button', { name: 'Edit from a folder', exact: true }).click();
  const s = saveSheet(p);
  await expect(s).toBeVisible();
  await expect(s.getByText('Sample folders. Nothing is read or written.')).toBeVisible();
  await expect(s.locator('[data-folder="sample-weekly-report"]')).toHaveAttribute('aria-pressed', 'true');
  await s.getByRole('button', { name: 'Next', exact: true }).click();

  // The edit: no draft yet, no save point yet, and the review is not offered.
  const draft = s.locator('[data-draft]');
  await expect(draft).toContainText('No change yet.');
  await expect(s.locator('[data-section="save-points"]')).toContainText('No save point yet');
  await expect(s.locator('[data-plan-save]')).toBeDisabled();
  const box = s.locator('[data-agent="editor"]').getByRole('checkbox', { name: 'check-facts: editor' });
  await expect(box).not.toBeChecked();
  await box.check();
  await expect(draft).toContainText('1 change, not saved yet.');
  await shot(p, 'S1-save-edit');
  await s.getByRole('button', { name: 'Review the save', exact: true }).click();

  // The review: one file changes, the agent now lists the skill, and Save waits for the tick.
  const review = s.locator('[data-save-review="save"]');
  await expect(review).toBeVisible();
  await expect(review.locator(`[data-file="${EDITOR_FILE}"]`)).toHaveAttribute('data-action', 'update');
  await expect(review.locator('[data-file]')).toHaveCount(1);
  await expect(review.locator('[data-agent-after="editor"]')).toContainText('check-facts');
  const save = s.getByRole('button', { name: 'Save 1 file', exact: true });
  await expect(save).toBeDisabled();
  await shot(p, 'S2-save-review');
  await review.locator('[data-approve-plan] input').check();
  await expect(save).toBeEnabled();
  await save.click();

  // Done: the file written, the save point kept, and the install offered.
  const kept = s.locator('[data-version-kept]');
  await expect(kept).toContainText('Save point kept:');
  await expect(kept).toHaveAttribute('data-version-kept', 'v2');
  await expect(s.getByRole('region', { name: 'What Bowerloom did' })).toContainText(EDITOR_FILE);
  await expect(s.locator('[data-install-next]')).toHaveText('Install it');
  await shot(p, 'S3-save-done');

  // The save points: the one kept before the first save is "as it was", the newest is now.
  await s.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(s.locator('[data-draft]')).toContainText('No change yet.');
  await expect(s.locator('[data-agent="editor"]').getByRole('checkbox', { name: 'check-facts: editor' })).toBeChecked();
  const points = s.locator('[data-section="save-points"]');
  await expect(points.locator('[data-version]')).toHaveCount(2);
  await expect(points.locator('[data-version="v2"]')).toHaveAttribute('data-current', '');
  await expect(points.locator('[data-version="v2"]')).toContainText('Now');
  await expect(points.locator('[data-version="v1"]')).toContainText(/as it was/i);
  await expect(points.locator('[data-version="v1"]')).not.toHaveAttribute('data-current', '');
  await shot(p, 'S4-save-points');

  // Go back: a reviewed and approved plan whose target is the first save point.
  await points.getByRole('button', { name: 'Go back to v1', exact: true }).click();
  const back = s.locator('[data-save-review="restore"]');
  await expect(back).toBeVisible();
  await expect(back.locator('[data-going-back="v1"]')).toContainText(/as it was/i);
  await expect(back.locator(`[data-file="${EDITOR_FILE}"]`)).toHaveAttribute('data-action', 'update');
  await expect(back.locator('[data-agent-after="editor"]')).toContainText('No skills');
  const goBack = s.getByRole('button', { name: 'Go back to v1', exact: true });
  await expect(goBack).toBeDisabled();
  await back.locator('[data-approve-plan] input').check();
  await goBack.click();
  await expect(s.getByRole('region', { name: 'What Bowerloom did' })).toContainText(EDITOR_FILE);
  await expect(s.locator('[data-version-kept]')).toBeVisible();

  // The link is gone, and the save points keep every state.
  await s.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(s.locator('[data-agent="editor"]').getByRole('checkbox', { name: 'check-facts: editor' })).not.toBeChecked();
  await expect(s.locator('[data-agent="writer"]').getByRole('checkbox', { name: 'draft-outline: writer' })).toBeChecked();
  // Three save points: as it was (v1), the link (v2), and the go-back itself (v3). v1 and v3 hold the same files, so both read as now; v2 does not.
  await expect(points.locator('[data-version]')).toHaveCount(3);
  await expect(points.locator('[data-version="v3"]')).toHaveAttribute('data-current', '');
  await expect(points.locator('[data-version="v2"]')).not.toHaveAttribute('data-current', '');
  await expect(points.locator('[data-version="v2"]').getByRole('button', { name: 'Go back to v2', exact: true })).toBeEnabled();
  await shot(p, 'S5-save-went-back');

  // Nothing is different from the harness now, so the review is not offered.
  await expect(s.locator('[data-plan-save]')).toBeDisabled();
});
