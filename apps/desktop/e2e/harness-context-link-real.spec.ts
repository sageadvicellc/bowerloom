/**
 * The empty Context tab and "Link a notes folder" (beta.2 Context page) on a made-up home. Electron starts with no flag, HOME and XDG_STATE_HOME point at a made-up folder, and the main process runs the packages.
 *  - The empty tab shows the action, not the generic line, and the plus has its word.
 *  - The link opens main's chooser at once, then picks the folder that holds a harness, reviews, and writes only after one approval.
 *  - A folder with no harness starts the New harness sheet, and nothing is written before that sheet's own approval.
 * Every expected value is read from the files by this test, never from the app's code or its answers.
 */
import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { chmodSync, existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { filesOf, teamFolder } from '../tests/helpers-engine/folders.js';
import { bundleOnce, launchReal } from './harness-real-page.js';
import type { RealHarness } from './harness-real-page.js';
import { removeTempDirs, tempDir } from './temp-dirs.js';
import { GIT, NO_GIT_REASON, commitAll, git } from './harness-notes-support.js';

let h: RealHarness, home: string;
const page = (): Page => h.page;
const shots = process.env.CONTEXT_SHOTS ?? null;
if (shots !== null) mkdirSync(shots, { recursive: true });

test.beforeAll(() => { test.setTimeout(240_000); bundleOnce(); });
test.afterAll(() => { removeTempDirs(); });
test.afterEach(async () => { await h?.app.close().catch(() => undefined); });

async function start(tab: string): Promise<void> {
  home = realpathSync(tempDir('bowerloom-ctxlink-home-'));
  chmodSync(home, 0o700);
  h = await launchReal(home, { XDG_STATE_HOME: join(home, '.local', 'state') }, false);
  await page().emulateMedia({ reducedMotion: 'reduce', colorScheme: 'light' });
  await page().evaluate(t => { location.hash = `#app/library/${t}`; location.reload(); }, tab);
  await page().waitForLoadState('domcontentloaded');
  await page().waitForSelector('[data-home]');
}
const put = (file: string, text: string): void => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, text); };
/** The record of approvals of linked home folders, in the private state folder the app was given. */
const approvalsFile = (): string => join(home, '.local', 'state', 'bowerloom', 'linked-notes', 'approved.json');
const linkSheet = (p: Page): Locator => p.getByRole('dialog', { name: 'Link a notes folder', exact: true });
const shot = async (p: Page, name: string): Promise<void> => { if (shots !== null) await p.screenshot({ path: join(shots, name) }); };
/** Notes with a first commit, so the step has no history question. */
function wiki(dir: string): string {
  put(join(dir, 'index.md'), '# Field notes\n\nStart here.\n');
  put(join(dir, 'topics/water.md'), '# Water\n\nWhere it goes.\n');
  git(dir, ['init']); commitAll(dir, 'start', '2026-01-01');
  return dir;
}

test('the empty Context tab shows the link action and the plus has its word; other tabs keep the plain line', async () => {
  test.setTimeout(120_000);
  await start('context');
  const p = page();
  const empty = p.locator('[data-library-link-empty]');
  await expect(empty).toBeVisible();
  await expect(empty.getByRole('button', { name: 'Link a notes folder', exact: true })).toBeVisible();
  await expect(empty).toContainText('No notes are linked yet.');
  await expect(p.getByText('Nothing in the Library matches.', { exact: true })).toHaveCount(0);
  await expect(p.locator('[data-library-add]')).toHaveText('Add');
  await shot(p, 'context-empty.png');
  // A search that finds nothing is not the empty tab.
  await p.getByRole('searchbox').fill('zzz');
  await expect(empty).toHaveCount(0);
  await expect(p.getByText('Nothing in the Library matches.', { exact: true })).toBeVisible();
  await p.evaluate(() => { location.hash = '#app/library/skill'; });
  await expect(p.locator('[data-library-link-empty]')).toHaveCount(0);
  await expect(p.locator('[data-library-add]')).toHaveText('Add');
});

test.describe('Link a notes folder', () => {
  test.skip(GIT === null, NO_GIT_REASON);

  test('a folder with a harness: the chooser opens at once, one approval writes knowledge.json, and a new read shows the pages as context items', async () => {
    test.setTimeout(240_000);
    await start('context');
    const p = page(), dir = teamFolder(home, 'wiki');
    wiki(dir);
    put(join(dir, 'deep/.claude/settings.json'), '{}\n');
    put(join(dir, 'deep/inside.md'), '# Inside\n\nBelow a tool folder.\n');
    commitAll(dir, 'more', '2026-01-02');
    const before = filesOf(dir);
    await h.pick(dir);
    await p.locator('[data-link-notes]').click();
    const s = linkSheet(p);
    await expect(s).toBeVisible();
    await expect(s.locator('[data-notes-chosen]')).toContainText('wiki');
    await expect(s.locator('[data-notes-chosen] [data-tone]')).toHaveAttribute('data-tone', 'good');
    expect(await h.asked(), 'no write was asked').toEqual([]);
    await s.getByRole('button', { name: 'Next', exact: true }).click();
    // Main lists no folder yet: the sheet asks for the folder again, and finds its harness.
    await expect(s.locator('[data-link-needs-harness]')).toContainText('Choose that folder again');
    await h.pick(dir);
    await s.getByRole('button', { name: 'Choose a folder', exact: true }).click();
    // The person picked the folder in main's chooser, so it is the folder that gets the link. A name alone never picks one (tests/library-add.test.ts).
    await s.locator('[data-folder]', { hasText: 'wiki' }).click();
    await expect(s.locator('[data-folder]', { hasText: 'wiki' })).toHaveAttribute('aria-pressed', 'true');
    await expect(s.locator('[data-link-needs-harness]')).toHaveCount(0);
    await shot(p, 'context-link.png');
    await s.getByRole('button', { name: 'Review the change', exact: true }).click();
    const review = s.locator('[data-save-review="save"]');
    await expect(review.locator('[data-file=".bowerloom/knowledge.json"]')).toBeVisible();
    expect(filesOf(dir), 'nothing is written while the person reads').toEqual(before);
    await review.locator('[data-approve-plan] input').check();
    await s.getByRole('button', { name: /^Save \d+ files?$/ }).click();
    await expect(s.locator('[data-version-kept]')).toBeVisible();
    const knowledge = JSON.parse(readFileSync(join(dir, '.bowerloom/knowledge.json'), 'utf8')) as { sources: { name: string; kind: string }[] };
    expect(knowledge.sources.map(x => x.name)).toEqual(['wiki']);
    // A new read: the folder is a place, and its pages are context items.
    await s.locator('[data-add-read-again]').click();
    await expect(p.getByRole('button', { name: 'Add a folder', exact: true })).toBeVisible();
    await h.pick(join(home, 'Projects'));
    await p.getByRole('button', { name: 'Add a folder', exact: true }).click();
    await expect(p.locator('.hxf-card').filter({ hasText: 'wiki' }).first()).toBeVisible();
    await p.getByRole('button', { name: 'Looks right', exact: true }).click();
    await p.getByRole('button', { name: 'Yes, read them', exact: true }).click();
    await expect(p.getByRole('heading', { level: 1, name: /^Read \d+ sources?\. Make a harness from each\.$/ })).toBeVisible({ timeout: 20_000 });
    await p.evaluate(() => { location.hash = '#app/library/context'; });
    await expect(p.locator('[data-library-link-empty]')).toHaveCount(0);
    await expect(p.locator('[data-part]', { hasText: 'wiki notes' })).toHaveCount(1);
  });

  test('a folder with no harness starts the New harness sheet, and nothing is written before its own approval', async () => {
    test.setTimeout(240_000);
    await start('context');
    const p = page(), dir = wiki(join(home, 'Documents', 'bare-notes'));
    const before = filesOf(dir);
    await h.pick(dir);
    await p.locator('[data-link-notes]').click();
    const s = linkSheet(p);
    await expect(s.locator('[data-notes-chosen]')).toContainText('bare-notes');
    await s.getByRole('button', { name: 'Next', exact: true }).click();
    await h.pick(dir);
    await s.getByRole('button', { name: 'Choose a folder', exact: true }).click();
    await expect(s.locator('[data-left-out]', { hasText: 'bare-notes' })).toContainText('No harness here yet.');
    await expect(s.locator('[data-link-needs-harness]')).toContainText('This folder has no harness yet.');
    await expect(s.getByRole('button', { name: 'Review the change', exact: true })).toBeDisabled();
    await s.getByRole('button', { name: 'Start a harness', exact: true }).click();
    await expect(p.getByRole('dialog', { name: 'New harness from a folder', exact: true })).toBeVisible();
    expect(await h.asked(), 'no write was asked').toEqual([]);
    expect(filesOf(dir), 'nothing is written before the approval').toEqual(before);
  });

  /** Links `notes` (a folder in the home folder) to the team harness through the sheet, approves the review, and ends on the Done step. */
  async function linkHomeNotes(notes: string, team: string): Promise<Locator> {
    const p = page(), before = filesOf(team);
    await h.pick(notes);
    await p.locator('[data-link-notes]').click();
    const s = linkSheet(p);
    await expect(s.locator('[data-notes-chosen]')).toContainText('field-notes');
    await s.getByRole('button', { name: 'Next', exact: true }).click();
    await h.pick(team);
    await s.getByRole('button', { name: 'Choose a folder', exact: true }).click();
    await s.locator('[data-folder]', { hasText: 'team' }).click();
    await s.getByRole('button', { name: 'Review the change', exact: true }).click();
    const review = s.locator('[data-save-review="save"]');
    expect(filesOf(team), 'nothing is written while the person reads').toEqual(before);
    await review.locator('[data-approve-plan] input').check();
    await s.getByRole('button', { name: /^Save \d+ files?$/ }).click();
    await expect(s.locator('[data-version-kept]')).toBeVisible();
    return s;
  }
  /** The read after a write: Read again, add the Projects folder, tick it as it is, and read it. */
  async function readAgain(s: Locator): Promise<void> {
    const p = page();
    await s.locator('[data-add-read-again]').click();
    await h.pick(join(home, 'Projects'));
    await p.getByRole('button', { name: 'Add a folder', exact: true }).click();
    await expect(p.locator('.hxf-card').filter({ hasText: 'team' }).first()).toBeVisible();
    await p.getByRole('button', { name: 'Looks right', exact: true }).click();
    await p.getByRole('button', { name: 'Yes, read them', exact: true }).click();
    await expect(p.getByRole('heading', { level: 1, name: /^Read \d+ sources?\. Make a harness from each\.$/ })).toBeVisible({ timeout: 20_000 });
    await p.evaluate(() => { location.hash = '#app/library/context'; });
  }

  test('a notes folder in the home folder: the review also approves reading it, and its pages show after a read', async () => {
    test.setTimeout(240_000);
    await start('context');
    const p = page(), team = teamFolder(home), notes = wiki(join(home, 'Documents', 'field-notes'));
    await readAgain(await linkHomeNotes(notes, team));
    await expect(p.locator('[data-part]', { hasText: 'team linked notes' })).toHaveCount(1);
    await expect(p.locator('[data-link-problem]')).toHaveCount(0);
  });

  test('a linked folder that is removed before the read is a problem the Library names, not silence', async () => {
    test.setTimeout(240_000);
    await start('context');
    const p = page(), team = teamFolder(home), notes = wiki(join(home, 'Documents', 'field-notes'));
    const s = await linkHomeNotes(notes, team);
    rmSync(notes, { recursive: true, force: true });
    await readAgain(s);
    await expect(p.locator('[data-link-problem="gone"]')).toContainText('Linked folder not found: ~/Documents/field-notes');
  });

  test('picking the folder in the chooser is the approval: the record holds it, and linking it again changes no file and records it again', async () => {
    test.setTimeout(240_000);
    await start('context');
    const p = page(), team = teamFolder(home), notes = wiki(join(home, 'Documents', 'field-notes'));
    await linkHomeNotes(notes, team);
    const keys = (JSON.parse(readFileSync(approvalsFile(), 'utf8')) as { version: number; keys: string[] }).keys;
    expect(keys.length).toBe(1);
    expect(keys[0]).toMatch(/^[0-9a-f]{32}$/);
    // The record is lost, as on a computer where the link was cloned and never picked. The link is in knowledge.json already, so linking it again changes no file.
    rmSync(approvalsFile());
    const tree = filesOf(team), knowledgeBefore = readFileSync(join(team, '.bowerloom', 'knowledge.json'), 'utf8');
    await p.evaluate(() => { location.hash = '#app/library/context'; location.reload(); });
    await p.waitForSelector('[data-home]');
    await p.getByRole('button', { name: 'Add', exact: true }).click();
    const s = p.getByRole('dialog', { name: 'Add notes', exact: true });
    await h.pick(team);
    await s.getByRole('button', { name: 'Choose a folder', exact: true }).click();
    await s.locator('[data-folder]', { hasText: 'team' }).click();
    await s.getByRole('button', { name: 'Next', exact: true }).click();
    await h.pick(notes);
    await s.getByRole('button', { name: 'Use my notes', exact: true }).click();
    await expect(s.locator('[data-notes-chosen]')).toContainText('field-notes');
    await s.getByRole('button', { name: 'Review the change', exact: true }).click();
    await expect(s.locator('[data-save-review="save"]')).toContainText('The folder already matches. Nothing is written.');
    expect(readFileSync(join(team, '.bowerloom', 'knowledge.json'), 'utf8'), 'knowledge.json is unchanged').toBe(knowledgeBefore);
    expect(filesOf(team), 'no file of the harness changed').toEqual(tree);
    expect(existsSync(approvalsFile()), 'the pick recorded the approval again').toBe(true);
    expect((JSON.parse(readFileSync(approvalsFile(), 'utf8')) as { keys: string[] }).keys).toEqual(keys);
  });

  test('a damaged record of approvals is not written over, and the Library says so instead of "needs approval"', async () => {
    test.setTimeout(240_000);
    await start('context');
    const team = teamFolder(home), notes = wiki(join(home, 'Documents', 'field-notes'));
    mkdirSync(dirname(approvalsFile()), { recursive: true });
    writeFileSync(approvalsFile(), '{ damaged');
    await readAgain(await linkHomeNotes(notes, team));
    expect(readFileSync(approvalsFile(), 'utf8')).toBe('{ damaged');
    await expect(page().locator('[data-link-problem="damaged"]')).toContainText('Saved approvals could not be read: ~/Documents/field-notes');
  });

  test('a notes folder outside the home folder and the harness folder is refused at the review, with a clear message, and nothing is written', async () => {
    test.setTimeout(240_000);
    await start('context');
    const p = page(), team = teamFolder(home), outside = wiki(join(tempDir('bowerloom-ctxlink-outside-'), 'far-notes'));
    const before = filesOf(team);
    await h.pick(outside);
    await p.locator('[data-link-notes]').click();
    const s = linkSheet(p);
    await expect(s.locator('[data-notes-chosen]')).toContainText('far-notes');
    await s.getByRole('button', { name: 'Next', exact: true }).click();
    await h.pick(team);
    await s.getByRole('button', { name: 'Choose a folder', exact: true }).click();
    await s.locator('[data-folder]', { hasText: 'team' }).click();
    await s.getByRole('button', { name: 'Review the change', exact: true }).click();
    await expect(s.locator('[data-next-step]')).toHaveText('Move the notes into your home folder, then choose them again.');
    await expect(s.locator('[data-save-review="save"]')).toHaveCount(0);
    expect(filesOf(team), 'nothing was written').toEqual(before);
  });
});
