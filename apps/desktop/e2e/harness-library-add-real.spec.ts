/**
 * Library Add on the person's own folders (issue 148, variant C). Electron starts with no flag, HOME and XDG_STATE_HOME point at a made-up folder, and the main process runs the packages.
 * Each tab has a small form: Skills copies a skill from another folder, Agents adds the Notes keeper, Context attaches a notes folder, and Tools is off with a reason. Every write is the save
 * step's own: a plan, the list of files, one tick, main's own question, then the write, with a save point kept. After a write the only way back is Save points, then Go back.
 * Every expected value is read from the files by this test, never from the app's code or its answers.
 */
import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { chmodSync, existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { engineFolder, filesOf, sourceFolder, teamFolder } from '../tests/helpers-engine/folders.js';
import { bundleOnce, launchReal } from './harness-real-page.js';
import type { RealHarness } from './harness-real-page.js';
import { removeTempDirs, tempDir } from './temp-dirs.js';
import { GIT, NO_GIT_REASON, commitAll, git, kitSkillIds } from './harness-notes-support.js';

let h: RealHarness, home: string;
const page = (): Page => h.page;

test.beforeAll(() => { test.setTimeout(240_000); bundleOnce(); });
test.afterAll(() => { removeTempDirs(); });
test.afterEach(async () => { await h?.app.close().catch(() => undefined); });

/** Starts the app on a new made-up home, on a Library tab. */
async function start(tab: string): Promise<void> {
  home = realpathSync(tempDir('bowerloom-libadd-home-'));
  chmodSync(home, 0o700);
  h = await launchReal(home, { XDG_STATE_HOME: join(home, '.local', 'state') }, false);
  await page().emulateMedia({ reducedMotion: 'reduce', colorScheme: 'light' });
  await page().evaluate(t => { location.hash = `#app/library/${t}`; location.reload(); }, tab);
  await page().waitForLoadState('domcontentloaded');
  await page().waitForSelector('[data-home]');
}
const put = (file: string, text: string): void => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, text); };
const addSheet = (p: Page, title: string): Locator => p.getByRole('dialog', { name: title, exact: true });
/** Registers a folder with main through the sheet's own "Choose a folder": the test answers main's chooser. */
async function choose(s: Locator, dir: string): Promise<void> {
  await h.pick(dir);
  await s.getByRole('button', { name: 'Choose a folder', exact: true }).click();
}
/** The choose flow after "Read again": adds the folder, reads it, and lands on the Read screen. */
async function readFolders(p: Page, dir: string): Promise<void> {
  await expect(p.getByRole('button', { name: 'Add a folder', exact: true })).toBeVisible();
  await h.pick(dir);
  await p.getByRole('button', { name: 'Add a folder', exact: true }).click();
  await expect(p.locator('.hxf-card').filter({ hasText: 'team' })).toHaveCount(1);
  await p.getByRole('button', { name: 'Looks right', exact: true }).click();
  await p.getByRole('button', { name: 'Yes, read them', exact: true }).click();
  await expect(p.getByRole('heading', { level: 1, name: /^Read \d+ sources?\. Make a harness from each\.$/ })).toBeVisible({ timeout: 20_000 });
}
const readTree = (dir: string): Record<string, string> => filesOf(dir);

test('Skills: the form lists only folders with a harness and says why the others are left out, copies a skill after one approval, keeps a save point, and Go back undoes it', async () => {
  test.setTimeout(180_000);
  await start('skill');
  const p = page(), team = teamFolder(home), source = sourceFolder(home), plain = engineFolder(home);
  const sourceBytes = readFileSync(join(source, '.bowerloom/skills/summarize/SKILL.md'));
  const before = readTree(team);

  await p.getByRole('button', { name: 'Add', exact: true }).click();
  const s = addSheet(p, 'Add a skill');
  await expect(s).toBeVisible();
  // No folder is chosen yet. The form says so and never remembers a folder.
  await expect(s.locator('[data-add-no-targets]')).toHaveText('No folder has a harness yet. Make one first.');
  await choose(s, plain);
  await expect(s.locator('[data-left-out]')).toHaveCount(1);
  await expect(s.locator('[data-left-out]')).toContainText('adopt-me');
  await expect(s.locator('[data-left-out]')).toContainText('No harness here yet.');
  await expect(s.locator('[data-folder]')).toHaveCount(0);
  await choose(s, team);
  await choose(s, source);
  await expect(s.locator('[data-folder]')).toHaveCount(2);
  await expect(s.locator('[data-left-out]')).toHaveCount(1);
  await expect(s).not.toContainText(home);
  await s.locator('[data-folder]', { hasText: 'team' }).click();
  await expect(s.locator('[data-folder]', { hasText: 'team' })).toHaveAttribute('aria-pressed', 'true');
  await s.getByRole('button', { name: 'Next', exact: true }).click();

  // The skill comes from another folder's harness, never from the folder that gets it.
  await expect(s.locator('[data-source]')).toHaveCount(1);
  await expect(s.locator('[data-source]')).toContainText('source');
  await expect(s.getByRole('button', { name: 'Review the change', exact: true })).toBeDisabled();
  await s.locator('[data-source]').click();
  await expect(s.locator('[data-skill="summarize"]')).toBeVisible();
  await s.getByRole('radio', { name: 'summarize', exact: true }).check();
  await s.getByRole('button', { name: 'Review the change', exact: true }).click();

  // The review lists the files; the file that can run needs its own acknowledgement; Save waits for both ticks.
  const review = s.locator('[data-save-review="save"]');
  await expect(review.locator('[data-file=".bowerloom/skills/summarize/SKILL.md"]')).toHaveAttribute('data-action', 'create');
  await expect(review.locator('[data-file=".bowerloom/skills/summarize/scripts/count.sh"]')).toHaveAttribute('data-executable', '');
  expect(readTree(team), 'nothing is written while the person reads').toEqual(before);
  const save = s.getByRole('button', { name: /^Save \d+ files?$/ });
  await expect(save).toBeDisabled();
  await review.locator('[data-approve-plan] input').check();
  await expect(save).toBeDisabled();
  await review.locator('[data-acknowledge-executables] input').check();
  await expect(save).toBeEnabled();
  await save.click();
  await expect(s.locator('[data-version-kept]')).toBeVisible();
  expect((await h.asked()).at(-1)!.message).toMatch(/\.bowerloom\?$/);

  // The skill is on disk, byte for byte, with its permission to run. Nothing else in the folder changed.
  const after = readTree(team);
  expect(readFileSync(join(team, '.bowerloom/skills/summarize/SKILL.md')).equals(sourceBytes)).toBe(true);
  expect(statSync(join(team, '.bowerloom/skills/summarize/scripts/count.sh')).mode & 0o111).not.toBe(0);
  for (const [path, hash] of Object.entries(before)) expect(after[path], path).toBe(hash);
  expect(Object.keys(after).filter(f => !(f in before)).sort()).toEqual(['.bowerloom/skills/summarize/SKILL.md', '.bowerloom/skills/summarize/scripts/count.sh']);

  // After the write the way back is Save points. This sheet has no Undo of its own.
  await expect(s.getByRole('button', { name: 'Undo', exact: true })).toHaveCount(0);
  await expect(s.locator('[data-add-after]')).toContainText('To undo, open Save points and press Go back.');
  await s.locator('[data-add-save-points]').click();
  const save2 = p.getByRole('dialog', { name: 'Edit a folder\'s harness', exact: true });
  await expect(save2.locator('[data-folder][aria-pressed="true"]')).toContainText('team');
  await save2.getByRole('button', { name: 'Next', exact: true }).click();
  const points = save2.locator('[data-section="save-points"]');
  await expect(points.locator('[data-version]')).toHaveCount(2);
  await points.getByRole('button', { name: 'Go back to v1', exact: true }).click();
  const back = save2.locator('[data-save-review="restore"]');
  await back.locator('[data-approve-plan] input').check();
  const ackBack = back.locator('[data-acknowledge-executables] input');
  if (await ackBack.count() > 0) await ackBack.check();
  await save2.getByRole('button', { name: 'Go back to v1', exact: true }).click();
  await expect(save2.locator('[data-version-kept]')).toBeVisible();
  expect(readTree(team), 'Go back puts the folder as it was').toEqual(before);
});

test('Agents: the Notes keeper only, from the ready-made kit; a harness that holds it says so', async () => {
  test.setTimeout(180_000);
  await start('agent');
  const p = page(), team = teamFolder(home);
  const before = readTree(team);
  await p.getByRole('button', { name: 'Add', exact: true }).click();
  const s = addSheet(p, 'Add an agent');
  await expect(s).toBeVisible();
  await choose(s, team);
  await s.locator('[data-folder]', { hasText: 'team' }).click();
  await s.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(s.locator('[data-section="add-keeper"]')).toContainText('The Notes keeper is a ready-made agent');
  await s.getByRole('button', { name: 'Review the change', exact: true }).click();
  const review = s.locator('[data-save-review="save"]');
  await expect(review.locator('[data-file=".bowerloom/agents/notes-keeper.md"]')).toHaveAttribute('data-action', 'create');
  for (const id of kitSkillIds()) await expect(review.locator(`[data-file=".bowerloom/skills/${id}/SKILL.md"]`), id).toHaveAttribute('data-action', 'create');
  expect(readTree(team)).toEqual(before);
  await review.locator('[data-approve-plan] input').check();
  const ack = review.locator('[data-acknowledge-executables] input');
  if (await ack.count() > 0) await ack.check();
  await s.getByRole('button', { name: /^Save \d+ files?$/ }).click();
  await expect(s.locator('[data-version-kept]')).toBeVisible();
  expect(existsSync(join(team, '.bowerloom/agents/notes-keeper.md'))).toBe(true);
  expect(readFileSync(join(team, '.bowerloom/harness.json'), 'utf8')).toContain('team');
  // Read again: the Library lists the keeper.
  await s.locator('[data-add-read-again]').click();
  await readFolders(p, team);
  await p.evaluate(() => { location.hash = '#app/library/agent'; });
  await expect(p.locator('[data-part]', { hasText: /notes-keeper/i })).toHaveCount(1);

  // The same folder again: the form says it has the keeper and offers no review.
  await p.getByRole('button', { name: 'Add', exact: true }).click();
  const again = addSheet(p, 'Add an agent');
  await again.locator('[data-folder]', { hasText: 'team' }).click();
  await again.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(again.locator('[data-section="add-keeper"]')).toContainText('This harness has the Notes keeper already.');
  await expect(again.getByRole('button', { name: 'Review the change', exact: true })).toBeDisabled();
});

test.describe('Context', () => {
  test.skip(GIT === null, NO_GIT_REASON);
  test('attach a notes folder: one approval, knowledge.json holds its name and nothing else changes; a new read lists it in the Library', async () => {
    test.setTimeout(240_000);
    await start('context');
    const p = page(), team = teamFolder(home), notes = join(home, 'Documents', 'field-notes');
    put(join(notes, 'index.md'), '# Field notes\n');
    put(join(notes, 'topics/water.md'), '# Water\n');
    const before = readTree(team), notesBefore = readTree(notes);
    await p.getByRole('button', { name: 'Add', exact: true }).click();
    const s = addSheet(p, 'Add notes');
    await expect(s).toBeVisible();
    await choose(s, team);
    await s.locator('[data-folder]', { hasText: 'team' }).click();
    await s.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(s.getByRole('button', { name: 'Review the change', exact: true })).toBeDisabled();
    await h.pick(notes);
    await s.getByRole('button', { name: 'Use my notes', exact: true }).click();
    await s.getByRole('button', { name: 'No history for now', exact: true }).click();
    await expect(s.locator('[data-notes-chosen]')).toContainText('field-notes');
    expect(await h.asked(), 'no write was asked yet').toEqual([]);
    await s.getByRole('button', { name: 'Review the change', exact: true }).click();
    const review = s.locator('[data-save-review="save"]');
    await expect(review.locator('[data-file=".bowerloom/knowledge.json"]')).toBeVisible();
    await expect(review.locator('[data-file]')).toHaveCount(1);
    expect(readTree(team), 'nothing is written while the person reads').toEqual(before);
    await review.locator('[data-approve-plan] input').check();
    await s.getByRole('button', { name: /^Save \d+ files?$/ }).click();
    await expect(s.locator('[data-version-kept]')).toBeVisible();
    const knowledge = JSON.parse(readFileSync(join(team, '.bowerloom/knowledge.json'), 'utf8')) as { sources: { name: string }[] };
    expect(knowledge.sources.map(x => x.name)).toEqual(['field-notes']);
    const after = readTree(team);
    for (const [path, hash] of Object.entries(before)) expect(after[path], path).toBe(hash);
    expect(Object.keys(after).filter(f => !(f in before))).toEqual(['.bowerloom/knowledge.json']);
    expect(readTree(notes), 'the notes folder is as it was').toEqual(notesBefore);

    // Read again: the choose flow reads the folders, and the Library lists the notes.
    await s.locator('[data-add-read-again]').click();
    await readFolders(p, team);
    await p.evaluate(() => { location.hash = '#app/library/context'; });
    await expect(p.locator('[data-part]', { hasText: 'field-notes' })).toHaveCount(1);
    await p.evaluate(() => { location.hash = '#app/library/skill'; });
    await expect(p.getByRole('heading', { level: 1, name: 'Library', exact: true })).toBeVisible();
  });
});

test.describe('Context, the notes the form would attach', () => {
  test.skip(GIT === null, NO_GIT_REASON);
  const withHistory = (dir: string, day: string): string => { put(join(dir, 'index.md'), '# Notes\n'); git(dir, ['init']); commitAll(dir, 'start', day); return dir; };
  test('choosing another folder replaces the first; a history that cannot be used is not ready; Back clears the choice', async () => {
    test.setTimeout(180_000);
    await start('context');
    const p = page(), team = teamFolder(home);
    const one = withHistory(join(home, 'Documents', 'notes-one'), '2026-01-01'), two = withHistory(join(home, 'Documents', 'notes-two'), '2026-01-02');
    const stuck = join(home, 'Documents', 'notes-stuck');
    put(join(stuck, 'index.md'), '# Stuck\n'); git(stuck, ['init']);
    await p.getByRole('button', { name: 'Add', exact: true }).click();
    const s = addSheet(p, 'Add notes');
    await choose(s, team);
    await s.locator('[data-folder]', { hasText: 'team' }).click();
    await s.getByRole('button', { name: 'Next', exact: true }).click();
    const review = s.getByRole('button', { name: 'Review the change', exact: true });
    // The first folder is ready. Choosing another folder clears it at once.
    await h.pick(one);
    await s.getByRole('button', { name: 'Use my notes', exact: true }).click();
    await expect(s.locator('[data-notes-chosen]')).toContainText('notes-one');
    await expect(review).toBeEnabled();
    await s.getByRole('button', { name: 'Choose another folder', exact: true }).click();
    await expect(s.locator('[data-notes-chosen]')).toHaveCount(0);
    await expect(review).toBeDisabled();
    // A history with no first commit is not ready, and says so in the step's own words.
    await h.pick(stuck);
    await s.getByRole('button', { name: 'Use my notes', exact: true }).click();
    await expect(s.locator('[data-notes-done="no-commit"]')).toBeVisible();
    await expect(s.locator('[data-notes-chosen]')).toHaveCount(0);
    await expect(review).toBeDisabled();
    // The second folder replaces it, and Review attaches the second folder, not the first.
    await s.getByRole('button', { name: 'Choose another folder', exact: true }).click();
    await h.pick(two);
    await s.getByRole('button', { name: 'Use my notes', exact: true }).click();
    await expect(s.locator('[data-notes-chosen]')).toContainText('notes-two');
    await review.click();
    const plan = s.locator('[data-save-review="save"]');
    await plan.locator('[data-approve-plan] input').check();
    // Back clears the choice: the step starts again and Review is off until a folder is chosen.
    await s.getByRole('button', { name: 'Back', exact: true }).click();
    await expect(s.locator('[data-notes-chosen]')).toHaveCount(0);
    await expect(review).toBeDisabled();
    await h.pick(two);
    await s.getByRole('button', { name: 'Use my notes', exact: true }).click();
    await review.click();
    await s.locator('[data-save-review="save"] [data-approve-plan] input').check();
    await s.getByRole('button', { name: /^Save \d+ files?$/ }).click();
    await expect(s.locator('[data-version-kept]')).toBeVisible();
    const k = JSON.parse(readFileSync(join(team, '.bowerloom/knowledge.json'), 'utf8')) as { sources: { name: string }[] };
    expect(k.sources.map(x => x.name)).toEqual(['notes-two']);
  });
});

test('Tools: Add is off, not hidden, and says why in plain words', async () => {
  await start('tool');
  const p = page();
  const add = p.getByRole('button', { name: 'Add', exact: true });
  await expect(add).toBeVisible();
  await expect(add).toHaveAttribute('aria-disabled', 'true');
  await expect(add).toHaveAccessibleDescription('Not yet: tools cannot be added from the app.');
  await add.click({ force: true });
  await expect(p.locator('[data-toast]')).toContainText('Not yet: tools cannot be added from the app.');
  await expect(p.getByRole('dialog')).toHaveCount(0);
});
