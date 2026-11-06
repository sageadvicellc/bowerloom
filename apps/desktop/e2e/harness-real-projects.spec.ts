/**
 * Projects on the person's own folders (Electron started with no flag, HOME and XDG_STATE_HOME pointed at a made-up folder): Add a folder, Install, Update and Review.
 * Each row follows the folder's real install. The sheets are the ones "Install from a folder" uses: they plan first, ask for the person's approval, and write only after it.
 * Each test gets its own made-up home, state root and app, so any test passes alone or after the others.
 */
import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { chmodSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ENGINE_CHANNELS } from '../shared/engine/types.js';
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
/** Waits until main's chooser call has finished (the list stops being busy). */
const idle = async (): Promise<void> => { await expect(page().locator('.hxp-rows')).not.toHaveAttribute('aria-busy', 'true'); };
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
  await expect(addButton).toBeEnabled();
  await idle();
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
  // A folder with no harness: a row that says so. Assign harness offers two ways, and opens nothing else.
  await add(plain);
  const plainRow = row('adopt-me');
  await expect(plainRow).toContainText('No harness yet');
  await plainRow.getByRole('button', { name: 'Assign harness', exact: true }).click();
  const assign = p.getByRole('dialog', { name: 'Assign a harness' });
  await expect(assign.getByRole('button', { name: 'From this folder', exact: true })).toBeVisible();
  await expect(assign).toContainText('Make the harness from the files this folder already has.');
  await expect(assign.getByRole('button', { name: 'From a file', exact: true })).toBeVisible();
  await expect(assign).toContainText('Copy a harness in from a bundle file.');
  await assign.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(p.locator('[aria-modal="true"]')).toHaveCount(0);
  await expect(p.locator('[data-toast]')).not.toContainText('Not in beta.1.');
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
  const beforeUpdate = filesOf(dir);
  await update.click();
  // Update opens on the plan, for the engines the install covered, and writes nothing until the plan is approved.
  await expect(s.locator('[data-approve-plan] input')).toBeVisible();
  expect(filesOf(dir), 'Update writes nothing before approval').toEqual(beforeUpdate);
  await expect(s.getByRole('button', { name: /^Write \d+ files?$/ })).toBeDisabled();
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
  await expect(p.locator('[data-refusal]')).toContainText('That is not a folder Bowerloom can use. Choose a folder.');
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
  await expect(p.locator('.hxp-row'), 'the wrong folder never joined the list').toHaveCount(1);
  // A closed chooser opens nothing.
  await h.pick(null);
  await install.click();
  await idle();
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

test('a harness that does not load is a Review that says why in the row and in the sheet, keeps that folder picked, and writes nothing', async () => {
  const p = page(), good = teamFolder(home, 'good'), dir = teamFolder(home, 'broken');
  writeFileSync(join(dir, '.bowerloom', 'harness.json'), '{ this is not json');
  const before = filesOf(dir), goodBefore = filesOf(good);
  // A good folder is known first, so a sheet that fell back to the first usable folder would open it.
  await add(good);
  await idle();
  await add(dir);
  const r = row('broken');
  await expect(r).toContainText('Has a harness');
  await expect(r.locator('[data-reason]')).not.toBeEmpty();
  const reason = (await r.locator('[data-reason]').innerText()).trim();
  expect(reason.length).toBeGreaterThan(10);
  await expect(r).not.toContainText('Not checked yet');
  const review = r.getByRole('button', { name: 'Review harness in broken', exact: true });
  await expect(review).toHaveText('Review');
  await review.click();
  const s = p.getByRole('dialog', { name: 'Install a folder\'s harness' });
  await expect(s.locator('.hxi-card', { hasText: 'broken' })).toHaveAttribute('aria-pressed', 'true');
  await expect(s.locator('.hxi-card', { hasText: 'good' })).toHaveAttribute('aria-pressed', 'false');
  await expect(s.locator('.hxi-card', { hasText: 'broken' })).toContainText(reason.slice(0, 20));
  await expect(s.getByRole('button', { name: 'Next', exact: true })).toBeDisabled();
  await expect(s).not.toContainText(home);
  expect(filesOf(dir), 'nothing is written').toEqual(before);
  expect(filesOf(good), 'the other folder is not touched').toEqual(goodBefore);
});

test('an installed row says Checking until its plan answers, and never installed before', async () => {
  const p = page(), dir = teamFolder(home);
  await add(dir);
  const r = row('team');
  await r.getByRole('button', { name: 'Install harness in team', exact: true }).click();
  const s = p.getByRole('dialog', { name: 'Install a folder\'s harness' });
  await s.getByRole('button', { name: 'Next', exact: true }).click();
  await s.getByRole('button', { name: 'Next', exact: true }).click();
  await s.locator('[data-approve-plan] input').check();
  await s.getByRole('button', { name: /^Write \d+ files?$/ }).click();
  await expect(s.locator('[data-done]')).toBeVisible();
  await s.getByRole('contentinfo').getByRole('button', { name: 'Close', exact: true }).click();
  // Main answers the next status plan late.
  await h.app.evaluate(({ ipcMain }, channel) => {
    const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, (...a: unknown[]) => Promise<unknown>> })._invokeHandlers;
    const original = handlers.get(channel)!;
    handlers.set(channel, async (...a: unknown[]) => { await new Promise(done => setTimeout(done, 2500)); return original(...a); });
  }, ENGINE_CHANNELS.planProjection);
  await p.evaluate(() => { location.hash = '#app/history'; });
  await p.evaluate(() => { location.hash = '#app/projects'; });
  await expect(r.locator('[data-row-state="checking"]')).toContainText('Checking');
  await expect(r).not.toContainText('installed');
  await expect(r.getByRole('button', { name: /^(Install|Update|Review)/ })).toHaveCount(0);
  await expect(r).toContainText('Claude Code installed', { timeout: 10_000 });
  await expect(r).not.toContainText('Checking');
});

test('Assign harness, from this folder: the same plan, approvals, main\'s question and write as "From a folder", into .bowerloom only', async () => {
  const p = page(), dir = engineFolder(home), before = filesOf(dir);
  await add(dir);
  const r = row('adopt-me');
  await r.getByRole('button', { name: 'Assign harness', exact: true }).click();
  await p.getByRole('dialog', { name: 'Assign a harness' }).getByRole('button', { name: 'From this folder', exact: true }).click();
  const s = p.getByRole('dialog', { name: 'New harness from a folder' });
  await expect(s.locator('.hxi-card', { hasText: 'adopt-me' })).toHaveAttribute('aria-pressed', 'true');
  await s.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(s.getByText(/^Read \d+ files in ~\/Projects\/adopt-me\. Nothing is written yet\.$/)).toBeVisible();
  await s.locator('[data-conflict="system-prompt/AGENTS.md"]').getByRole('radio', { name: /^AGENTS\.md/ }).click();
  await s.getByRole('button', { name: 'Next', exact: true }).click();
  const approvals = s.locator('[data-section="approvals"] [data-tick]');
  await expect(approvals).toHaveCount(2);
  await s.locator('[data-section="acknowledgements"] input').check();
  for (const tick of await approvals.all()) await tick.getByRole('checkbox').check();
  expect(filesOf(dir), 'nothing is written before the write').toEqual(before);
  const write = s.getByRole('button', { name: /^Write \d+ files$/ });
  await h.confirm(false);
  await write.click();
  await expect(s.getByRole('alert')).toContainText('Nothing was written.');
  expect(filesOf(dir), 'a no writes nothing').toEqual(before);
  await h.confirm(true);
  await write.click();
  await expect(s.locator('[data-done]')).toContainText('.bowerloom/harness.json');
  const after = filesOf(dir);
  for (const [path, hash] of Object.entries(before)) expect(after[path], path).toBe(hash);
  expect(Object.keys(after).filter(f => !(f in before)).every(f => f.startsWith('.bowerloom/'))).toBe(true);
  await s.getByRole('contentinfo').getByRole('button', { name: 'Close', exact: true }).click();
  // The folder now has a harness: the row offers Install.
  await expect(r).toContainText('Has a harness');
  await expect(r.getByRole('button', { name: 'Install harness in adopt-me', exact: true })).toBeVisible();
});

test('Assign harness, from a file: the Import sheet opens with the folder picked, and writes the bundle into .bowerloom only after the plan is approved', async () => {
  const p = page(), source = teamFolder(home, 'source'), target = join(home, 'Projects', 'new-place'), file = join(home, 'source.bowerloom.json');
  mkdirSync(target, { recursive: true });
  writeFileSync(join(target, 'README.md'), '# New place\n');
  // Make a bundle file from the source folder, through main's export and its save dialog.
  await h.app.evaluate(({ dialog }, path) => { dialog.showSaveDialog = (async () => ({ canceled: false, filePath: path })) as unknown as typeof dialog.showSaveDialog; }, file);
  await add(source);
  await idle();
  const ids = await p.evaluate(async () => {
    const bridge = (window as unknown as { bowerloomEngine: Record<string, (...x: unknown[]) => Promise<{ ok: boolean; value: unknown }>> }).bowerloomEngine;
    const folders = await bridge.folders!() as unknown as { id: string; name: string }[];
    const id = folders.find(f => f.name === 'source')!.id;
    const plan = (await bridge.planExport!(id) as { value: { revision: string; acknowledge: string | null } }).value;
    const out = await bridge.runExport!(id, plan.revision, plan.acknowledge);
    return out.ok;
  });
  expect(ids).toBe(true);
  expect(existsSync(file)).toBe(true);
  await add(target);
  await idle();
  const before = filesOf(target);
  await row('new-place').getByRole('button', { name: 'Assign harness', exact: true }).click();
  await p.getByRole('dialog', { name: 'Assign a harness' }).getByRole('button', { name: 'From a file', exact: true }).click();
  const s = p.getByRole('dialog', { name: 'Import a harness' });
  await h.pick(file);
  await s.locator('[data-choose-file]').click();
  await s.locator('[data-import-next]').click();
  await expect(s.locator('.hxi-card', { hasText: 'new-place' })).toHaveAttribute('aria-pressed', 'true');
  await s.locator('[data-import-plan]').click();
  await expect(s.locator('[data-approve-plan] input').first()).toBeVisible();
  expect(filesOf(target), 'nothing is written before approval').toEqual(before);
  for (const tick of await s.locator('[data-approve-plan] input').all()) await tick.check();
  for (const tick of await s.locator('[data-ack] input, [data-acknowledge] input').all()) await tick.check();
  await s.locator('[data-import-write]').click();
  await expect(s.locator('[data-imported]')).toBeVisible();
  const after = filesOf(target);
  for (const [path, hash] of Object.entries(before)) expect(after[path], path).toBe(hash);
  expect(Object.keys(after).filter(f => !(f in before)).length).toBeGreaterThan(0);
  expect(Object.keys(after).filter(f => !(f in before)).every(f => f.startsWith('.bowerloom/'))).toBe(true);
});

test('two folders outside home with one name are never taken for each other: another name is refused before it joins the list, and the same name in another place is a row of its own', async () => {
  const p = page(), base = realpathSync(tempDir('bowerloom-outside-'));
  const make = (root: string, name: string): string => {
    const dir = join(base, root, name);
    mkdirSync(join(dir, '.claude', 'agents'), { recursive: true });
    writeFileSync(join(dir, '.claude', 'agents', 'helper.md'), '---\nname: Helper\ndescription: Helps with the work.\n---\nHelp.\n');
    return dir;
  };
  const first = make('a', 'shared'), second = make('b', 'shared'), other = make('c', 'other');
  void second;
  // The read finds the project outside home, which the window shows cut down to …/shared.
  await p.evaluate(() => { location.hash = '#app'; });
  await p.getByRole('button', { name: 'Find my files', exact: true }).click();
  await expect(p.getByRole('heading', { level: 1, name: 'Nothing found yet' })).toBeVisible();
  await h.pick(join(base, 'a'));
  await p.getByRole('button', { name: 'Add a folder', exact: true }).click();
  await expect(p.getByRole('heading', { level: 1, name: /^Found \d+ places?$/ })).toBeVisible();
  await p.getByRole('button', { name: 'Looks right', exact: true }).click();
  await p.getByRole('button', { name: 'Yes, read them', exact: true }).click();
  await expect(p.getByRole('heading', { level: 1, name: /^Read \d+ sources?\. Make a harness from each\.$/ })).toBeVisible({ timeout: 20_000 });
  await p.getByRole('button', { name: 'Make a harness from this' }).first().click();
  await p.locator('[data-nav-key="projects"]').click();
  await expect(p.getByRole('heading', { level: 1, name: 'Projects', exact: true })).toBeVisible();
  const shared = p.locator('.hxp-row').filter({ has: p.getByRole('button', { name: 'shared', exact: true }) });
  await expect(shared).toHaveCount(1);
  await expect(shared).toContainText('No harness yet');
  // A pick with another name is refused in main, and never joins the list.
  await shared.getByRole('button', { name: 'Assign harness', exact: true }).click();
  await p.getByRole('dialog', { name: 'Assign a harness' }).getByRole('button', { name: 'From this folder', exact: true }).click();
  await h.pick(other);
  await idle();
  await expect(p.locator('[data-toast]')).toContainText('That is not the folder shown.');
  await expect(p.locator('[aria-modal="true"]')).toHaveCount(0);
  await expect(p.locator('.hxp-row')).toHaveCount(1);
  // The row holds the full path of its folder, so adding that folder is the row. A second folder with the same name in another place is not: it is a row of its own, and is not called listed.
  await add(first);
  await expect(p.locator('[data-toast]')).toContainText('Already in the list.');
  await expect(p.locator('.hxp-row')).toHaveCount(1);
  await add(second);
  await expect(p.locator('[data-toast]')).toContainText('Added shared to Projects.');
  await expect(p.locator('.hxp-row')).toHaveCount(2);
  await expect(p.locator('.hxp-row').filter({ has: p.getByRole('button', { name: 'shared', exact: true }) })).toHaveCount(2);
});

/** Makes one engine call of main fail (a refusal on the page's side), or answer late, from now on. */
async function breakCall(channel: string, how: 'throw' | 'keep' | 'count' | 'refuse'): Promise<void> {
  await h.app.evaluate(({ ipcMain }, [name, mode]) => {
    const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, (...a: unknown[]) => Promise<unknown>> })._invokeHandlers;
    const original = handlers.get(name as string)!;
    (globalThis as unknown as Record<string, unknown>)[`__orig_${name}`] ??= original;
    const kept = (globalThis as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>)[`__orig_${name}`]!;
    const g = globalThis as unknown as { __calls: Record<string, number> };
    g.__calls ??= {};
    g.__calls[name as string] = 0;
    handlers.set(name as string, mode === 'throw' ? async () => { throw new Error('FAILED'); }
      : mode === 'refuse' ? async () => ({ ok: false, refusal: { code: 'PORTABLE_PATH_OCCUPIED', message: 'A folder stands where a file should go.', paths: [] } })
      : mode === 'count' ? async (...a: unknown[]) => { g.__calls[name as string]! += 1; return kept(...a); } : kept);
  }, [channel, how]);
}
/** Installs a folder through its row, for the tests that need an installed row. */
async function installRow(dir: string, name: string): Promise<void> {
  const p = page();
  await add(dir);
  await row(name).getByRole('button', { name: `Install harness in ${name}`, exact: true }).click();
  const s = p.getByRole('dialog', { name: 'Install a folder\'s harness' });
  await s.getByRole('button', { name: 'Next', exact: true }).click();
  await s.getByRole('button', { name: 'Next', exact: true }).click();
  await s.locator('[data-approve-plan] input').check();
  await s.getByRole('button', { name: /^Write \d+ files?$/ }).click();
  await expect(s.locator('[data-done]')).toBeVisible();
  await s.getByRole('contentinfo').getByRole('button', { name: 'Close', exact: true }).click();
  await expect(row(name)).toContainText('Claude Code installed');
}
const away = async (): Promise<void> => {
  await page().evaluate(() => { location.hash = '#app/history'; });
  await page().evaluate(() => { location.hash = '#app/projects'; });
};

test('a list that cannot be read again makes every row say "Not checked", and says the list may be old; the next good read brings the states back', async () => {
  const p = page();
  await installRow(teamFolder(home), 'team');
  // A sheet opens and closes while main cannot list its folders: the screen reads the list again, is refused, and keeps the rows it had.
  await breakCall(ENGINE_CHANNELS.folders, 'throw');
  await p.getByRole('button', { name: 'From a folder', exact: true }).click();
  await p.getByRole('dialog', { name: 'New harness from a folder' }).getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(p.locator('[data-list-stale]')).toContainText('This list may not be current.');
  await expect(row('team')).toContainText('Not checked');
  await expect(row('team')).not.toContainText('installed');
  await breakCall(ENGINE_CHANNELS.folders, 'keep');
  await p.getByRole('button', { name: 'From a folder', exact: true }).click();
  await p.getByRole('dialog', { name: 'New harness from a folder' }).getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(p.locator('[data-list-stale]')).toHaveCount(0);
  await expect(row('team')).toContainText('Claude Code installed');
});

test('a status check that cannot be done is a Review that says so, never a bare conflict', async () => {
  const p = page();
  await installRow(teamFolder(home), 'team');
  await breakCall(ENGINE_CHANNELS.planProjection, 'throw');
  await away();
  await expect(row('team')).toContainText('Could not check this install. Press Review.');
  await expect(row('team').getByRole('button', { name: 'Review harness in team', exact: true })).toBeVisible();
  await breakCall(ENGINE_CHANNELS.planProjection, 'keep');
  await away();
  await expect(row('team')).toContainText('Claude Code installed');
  await expect(p.locator('[data-reason]')).toHaveCount(0);
});

test('Assign harness, from this folder: a folder that gained a harness since the row was drawn stays picked and cannot be taken, and no other folder is swapped in', async () => {
  const p = page(), a = engineFolder(home, 'plain-a'), b = engineFolder(home, 'plain-b');
  await add(a);
  await idle();
  await add(b);
  await idle();
  await expect(row('plain-a')).toContainText('No harness yet');
  // The folder gains a harness outside the app, after its row was drawn.
  mkdirSync(join(a, '.bowerloom'), { recursive: true });
  writeFileSync(join(a, '.bowerloom', 'harness.json'), JSON.stringify({ format: 'bowerloom/harness/v1beta1', id: 'plain-a', description: 'Made by hand.', engines: [{ id: 'claude-code' }], parts: {} }));
  const before = filesOf(a), beforeB = filesOf(b);
  await row('plain-a').getByRole('button', { name: 'Assign harness', exact: true }).click();
  await p.getByRole('dialog', { name: 'Assign a harness' }).getByRole('button', { name: 'From this folder', exact: true }).click();
  const s = p.getByRole('dialog', { name: 'New harness from a folder' });
  await expect(s.locator('.hxi-card', { hasText: 'plain-a' })).toHaveAttribute('aria-pressed', 'true');
  await expect(s.locator('.hxi-card', { hasText: 'plain-a' })).toContainText('Holds a harness already.');
  await expect(s.locator('.hxi-card', { hasText: 'plain-b' })).toHaveAttribute('aria-pressed', 'false');
  await expect(s.getByRole('button', { name: 'Next', exact: true })).toBeDisabled();
  expect(filesOf(a), 'nothing is written').toEqual(before);
  expect(filesOf(b), 'the other folder is not touched').toEqual(beforeB);
});

const callsOf = (channel: string): Promise<number> => h.app.evaluate((_e, name) => (globalThis as unknown as { __calls: Record<string, number> }).__calls[name] ?? 0, channel);

test('a sheet that closes triggers one status pass, not two, and the rows never blank to "Checking" twice', async () => {
  const p = page();
  await installRow(teamFolder(home), 'team');
  await breakCall(ENGINE_CHANNELS.planProjection, 'count');
  await p.getByRole('button', { name: 'From a folder', exact: true }).click();
  await p.getByRole('dialog', { name: 'New harness from a folder' }).getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(row('team')).toContainText('Claude Code installed');
  await p.waitForTimeout(800);
  expect(await callsOf(ENGINE_CHANNELS.planProjection), 'one installed folder, one plan').toBe(1);
});

test('a check main refuses keeps main\'s own plain words as the reason, and a Review button', async () => {
  await installRow(teamFolder(home), 'team');
  await breakCall(ENGINE_CHANNELS.planProjection, 'refuse');
  await away();
  await expect(row('team')).toContainText('A folder stands where a file should go.');
  await expect(row('team')).not.toContainText('Could not check this install');
  await expect(row('team').getByRole('button', { name: 'Review harness in team', exact: true })).toBeVisible();
});

test('a folder named with a hidden character is one row for the project and its folder, and Install opens its sheet', async () => {
  const p = page(), dir = teamFolder(home, 'wan\u200Bted');
  mkdirSync(join(dir, '.claude', 'agents'), { recursive: true });
  writeFileSync(join(dir, '.claude', 'agents', 'helper.md'), '---\nname: Helper\ndescription: Helps with the work.\n---\nHelp.\n');
  await p.evaluate(() => { location.hash = '#app'; });
  await p.getByRole('button', { name: 'Find my files', exact: true }).click();
  await expect(p.getByRole('heading', { level: 1, name: 'Nothing found yet' })).toBeVisible();
  // The folder itself is picked as a place (the reader does not walk into a folder with such a name), so its path reaches the window cleaned.
  await h.pick(dir);
  await p.getByRole('button', { name: 'Add a folder', exact: true }).click();
  await expect(p.getByRole('heading', { level: 1, name: /^Found \d+ places?$/ })).toBeVisible();
  await p.getByRole('button', { name: 'Looks right', exact: true }).click();
  await p.getByRole('button', { name: 'Yes, read them', exact: true }).click();
  await expect(p.getByRole('heading', { level: 1, name: /^Read \d+ sources?\. Make a harness from each\.$/ })).toBeVisible({ timeout: 20_000 });
  await p.getByRole('button', { name: 'Make a harness from this' }).first().click();
  await p.locator('[data-nav-key="projects"]').click();
  await expect(p.getByRole('heading', { level: 1, name: 'Projects', exact: true })).toBeVisible();
  await expect(p.locator('.hxp-row')).toHaveCount(1);
  const r = p.locator('.hxp-row').first();
  await expect(r).toContainText('Has a harness');
  await r.getByRole('button', { name: /^Install harness in/ }).click();
  await idle();
  const s = p.getByRole('dialog', { name: 'Install a folder\'s harness' });
  await expect(s.locator('.hxi-card').first()).toHaveAttribute('aria-pressed', 'true');
  await s.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(p.locator('.hxp-row'), 'the folder is the same row, not a second one').toHaveCount(1);
});
