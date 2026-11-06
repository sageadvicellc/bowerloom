/**
 * Projects on the person's own folders (Electron started with no flag, HOME and XDG_STATE_HOME pointed at a made-up folder): Add a folder, Install, Update and Review.
 * Each row follows the folder's real install. The sheets are the ones "Install from a folder" uses: they plan first, ask for the person's approval, and write only after it.
 * Each test gets its own made-up home, state root and app, so any test passes alone or after the others.
 */
import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { chmodSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { engineFolder, filesOf, teamFolder } from '../tests/helpers-engine/folders.js';
import { bundleOnce, launchReal } from './harness-real-page.js';
import type { RealHarness } from './harness-real-page.js';
import { removeTempDirs, tempDir } from './temp-dirs.js';

let h: RealHarness, home: string;
const page = (): Page => h.page;

test.beforeAll(() => { test.setTimeout(240_000); bundleOnce(); });
test.afterAll(() => { removeTempDirs(); });
test.beforeEach(async () => {
  test.setTimeout(120_000);
  home = realpathSync(tempDir('bowerloom-projects-home-'));
  chmodSync(home, 0o700);
  h = await launchReal(home, { XDG_STATE_HOME: join(home, '.local', 'state') }, false);
  await page().emulateMedia({ reducedMotion: 'reduce', colorScheme: 'light' });
  await page().evaluate(() => { location.hash = '#app/projects'; location.reload(); });
  await page().waitForLoadState('domcontentloaded');
  await page().waitForSelector('[data-home]');
});
test.afterEach(async () => { await h?.app.close(); });

/** The row of a folder in the list. */
const row = (name: string): Locator => page().locator('.hxp-row').filter({ has: page().getByRole('button', { name, exact: true }) });
/** Adds a folder with the plus button: the test answers main's chooser with the folder. */
async function add(dir: string): Promise<void> {
  await h.pick(dir);
  await page().getByRole('button', { name: 'Add a folder', exact: true }).click();
}
test('Add a folder asks main\'s chooser, lists the folder with what its harness holds, never lists it twice, and writes nothing', async () => {
  const p = page(), team = teamFolder(home), plain = engineFolder(home), before = { team: filesOf(team), plain: filesOf(plain) };
  await expect(p.locator('.hxp-row')).toHaveCount(0);
  const addButton = p.getByRole('button', { name: 'Add a folder', exact: true });
  await expect(addButton).toBeEnabled();
  // A closed chooser adds nothing.
  await h.pick(null);
  await addButton.click();
  await expect(p.locator('.hxp-row')).toHaveCount(0);
  // A folder with a harness: a row with a dot for each engine, and Install.
  await add(team);
  await expect(p.locator('[data-toast]')).toContainText('Added team to Projects.');
  const teamRow = row('team');
  await expect(teamRow).toHaveCount(1);
  await expect(teamRow).toContainText('Has a harness');
  await expect(teamRow).toContainText('Claude Code not installed');
  await expect(teamRow).toContainText('Codex not installed');
  await expect(teamRow.getByRole('button', { name: 'Install harness in team', exact: true })).toHaveText('Install');
  // The path is behind "Show details", and never shows the home folder.
  expect(await p.locator('body').innerText()).not.toContain(home);
  // The same folder again is in the list already.
  await add(team);
  await expect(p.locator('[data-toast]')).toContainText('Already in the list.');
  await expect(p.locator('.hxp-row')).toHaveCount(1);
  // A folder with no harness: a row that says so. Assign harness is not built yet and keeps its note.
  await add(plain);
  const plainRow = row('adopt-me');
  await expect(plainRow).toContainText('No harness yet');
  await plainRow.getByRole('button', { name: 'Assign harness', exact: true }).click();
  await expect(p.locator('[data-toast]')).toContainText('Not in beta.1.');
  await expect(p.locator('[aria-modal="true"]')).toHaveCount(0);
  await expect(p.getByText('Not in beta.1.', { exact: false }).first()).toBeVisible();
  expect(filesOf(team), 'the folder is as it was').toEqual(before.team);
  expect(filesOf(plain), 'the folder is as it was').toEqual(before.plain);
});

test('Install, Update and Review follow the folder: each opens the install sheet, writes only after approval, and the row then says what is true', async () => {
  const p = page(), dir = teamFolder(home);
  await add(dir);
  const r = row('team');
  // Install: the sheet opens with the folder picked, and Done lists what it wrote.
  await r.getByRole('button', { name: 'Install harness in team', exact: true }).click();
  const s = p.getByRole('dialog', { name: 'Install a folder\'s harness' });
  await expect(s.locator('.hxi-card', { hasText: 'team' })).toHaveAttribute('aria-pressed', 'true');
  const before = filesOf(dir);
  await s.getByRole('button', { name: 'Next', exact: true }).click();
  await s.getByRole('button', { name: 'Next', exact: true }).click();
  expect(filesOf(dir), 'nothing is written while the person reads').toEqual(before);
  const write = s.getByRole('button', { name: /^Write \d+ files?$/ });
  await expect(write).toBeDisabled();
  await s.locator('[data-approve-plan] input').check();
  await write.click();
  await expect(s.locator('[data-done]')).toContainText('AGENTS.md');
  expect(existsSync(join(dir, 'AGENTS.md'))).toBe(true);
  await s.getByRole('contentinfo').getByRole('button', { name: 'Close', exact: true }).click();
  // The row now reads the real install: installed, and no button.
  await expect(r).toContainText('Claude Code installed');
  await expect(r).toContainText('Codex installed');
  await expect(r.getByRole('button', { name: /^(Install|Update|Review)/ })).toHaveCount(0);

  // Update: the harness moved on, so the files Bowerloom wrote are behind it.
  const harnessText = join(dir, '.bowerloom', 'instructions', 'AGENTS.md');
  writeFileSync(harnessText, '# Team\n\nUse npm and run the tests.\n');
  await p.evaluate(() => { location.hash = '#app/history'; });
  await p.evaluate(() => { location.hash = '#app/projects'; });
  await expect(r).toContainText('Claude Code out of date');
  const update = r.getByRole('button', { name: 'Update harness in team', exact: true });
  await expect(update).toHaveText('Update');
  await update.click();
  // Update opens on the plan, with nothing yet chosen to read again.
  await expect(s.locator('[data-approve-plan] input')).toBeVisible();
  await s.locator('[data-approve-plan] input').check();
  await s.getByRole('button', { name: /^Write \d+ files?$/ }).click();
  await expect(s.locator('[data-done]')).toContainText('AGENTS.md');
  expect(readFileSync(join(dir, 'AGENTS.md'), 'utf8')).toContain('run the tests');
  await s.getByRole('contentinfo').getByRole('button', { name: 'Close', exact: true }).click();
  await expect(r).toContainText('Claude Code installed');

  // Review: a file Bowerloom wrote was changed by hand, so the install needs a look. The sheet shows it and offers to keep the person's version.
  writeFileSync(join(dir, 'AGENTS.md'), '# Team\n\nMy own words.\n');
  await p.evaluate(() => { location.hash = '#app/history'; });
  await p.evaluate(() => { location.hash = '#app/projects'; });
  await expect(r).toContainText('Claude Code has a conflict');
  await r.getByRole('button', { name: 'Review harness in team', exact: true }).click();
  await expect(s.locator('[data-drift-line="AGENTS.md"]')).toContainText('Changed since');
  expect(readFileSync(join(dir, 'AGENTS.md'), 'utf8'), 'review writes nothing').toBe('# Team\n\nMy own words.\n');
});

test('a pick main refuses is shown in its own words and adds no row', async () => {
  const p = page();
  // A file is not a folder: main refuses it in plain words and registers nothing.
  const file = join(home, 'note.txt');
  writeFileSync(file, 'x');
  await add(file);
  await expect(p.locator('[data-refusal]')).toBeVisible();
  await expect(p.locator('.hxp-row')).toHaveCount(0);
});

test('a project the read found with a harness is chosen first, and only the folder shown is taken', async () => {
  const p = page(), dir = teamFolder(home, 'harnessed');
  mkdirSync(join(dir, '.claude', 'agents'), { recursive: true });
  writeFileSync(join(dir, '.claude', 'agents', 'helper.md'), '---\nname: Helper\ndescription: Helps with the work.\n---\nHelp.\n');
  await p.evaluate(() => { location.hash = '#app'; });
  await p.getByRole('button', { name: 'Find my files', exact: true }).click();
  await expect(p.getByRole('heading', { level: 1, name: 'Nothing found yet' })).toBeVisible();
  await h.pick(join(home, 'Projects'));
  await p.getByRole('button', { name: 'Add a folder', exact: true }).click();
  await expect(p.getByRole('heading', { level: 1, name: /^Found \d+ places?$/ })).toBeVisible();
  await p.getByRole('button', { name: 'Looks right', exact: true }).click();
  await p.getByRole('button', { name: 'Yes, read them', exact: true }).click();
  await expect(p.getByRole('heading', { level: 1, name: /^Read \d+ sources?\. Make a harness from each\.$/ })).toBeVisible({ timeout: 20_000 });
  await p.getByRole('button', { name: 'Make a harness from this' }).first().click();
  await expect(p.getByRole('heading', { level: 1, name: 'Overview', exact: true })).toBeVisible();
  await p.locator('[data-nav-key="projects"]').click();
  await expect(p.getByRole('heading', { level: 1, name: 'Projects', exact: true })).toBeVisible();
  const r = row('harnessed');
  await expect(r).toContainText('Has a harness');
  await expect(r).toContainText('Not checked');
  const install = r.getByRole('button', { name: 'Install harness in harnessed', exact: true });
  // Main does not know the folder yet, so the button opens its chooser. Another folder is refused in words, and no sheet opens.
  await h.pick(teamFolder(home, 'other'));
  await install.click();
  await expect(p.locator('[data-toast]')).toContainText('That is not the folder shown.');
  await expect(p.locator('[aria-modal="true"]')).toHaveCount(0);
  // A closed chooser opens nothing.
  await h.pick(null);
  await install.click();
  await expect(p.locator('[aria-modal="true"]')).toHaveCount(0);
  // The folder shown opens the install sheet with that folder picked, and the row then reads its state.
  await h.pick(dir);
  await install.click();
  const s = p.getByRole('dialog', { name: 'Install a folder\'s harness' });
  await expect(s.locator('.hxi-card', { hasText: 'harnessed' })).toHaveAttribute('aria-pressed', 'true');
  await s.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(r).toContainText('Claude Code not installed');
});

test('Undo in the install sheet puts the folder back, and the row goes back to not installed', async () => {
  const p = page(), dir = teamFolder(home), before = filesOf(dir);
  await add(dir);
  const r = row('team');
  await r.getByRole('button', { name: 'Install harness in team', exact: true }).click();
  const s = p.getByRole('dialog', { name: 'Install a folder\'s harness' });
  await s.getByRole('button', { name: 'Next', exact: true }).click();
  await s.getByRole('button', { name: 'Next', exact: true }).click();
  await s.locator('[data-approve-plan] input').check();
  await s.getByRole('button', { name: /^Write \d+ files?$/ }).click();
  await expect(s.locator('[data-done]')).toBeVisible();
  expect(filesOf(dir)).not.toEqual(before);
  await s.getByRole('button', { name: 'Undo', exact: true }).click();
  const removal = p.getByRole('dialog', { name: 'Remove what Bowerloom wrote' });
  await removal.locator('[data-approve-plan] input').check();
  await removal.getByRole('button', { name: /^Remove \d+ files?$/ }).click();
  await expect(removal.locator('[data-done]')).toBeVisible();
  expect(filesOf(dir), 'the folder is as it was').toEqual(before);
  await removal.getByRole('contentinfo').getByRole('button', { name: 'Close', exact: true }).click();
  await expect(r).toContainText('Claude Code not installed');
});

test('a harness that does not load is a Review that shows why in words, and writes nothing', async () => {
  const p = page(), dir = teamFolder(home, 'broken');
  writeFileSync(join(dir, '.bowerloom', 'harness.json'), '{ this is not json');
  const before = filesOf(dir);
  await add(dir);
  const r = row('broken');
  await expect(r).toContainText('Has a harness');
  const review = r.getByRole('button', { name: 'Review harness in broken', exact: true });
  await expect(review).toHaveText('Review');
  await review.click();
  const s = p.getByRole('dialog', { name: 'Install a folder\'s harness' });
  await expect(s.locator('.hxi-card', { hasText: 'broken' })).toBeVisible();
  await expect(s.getByRole('button', { name: 'Next', exact: true })).toBeDisabled();
  await expect(s).not.toContainText(home);
  expect(filesOf(dir), 'nothing is written').toEqual(before);
});
