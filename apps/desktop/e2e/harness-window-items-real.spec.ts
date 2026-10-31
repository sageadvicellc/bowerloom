/**
 * The window items on real folders (Electron started with --prototype-v3-real, HOME and XDG_STATE_HOME pointed at a made-up folder). Main runs the packages;
 * its file opener is stubbed and keeps each path it was given; its write question is answered yes by the test and kept.
 *  - Items 1 and 2: a harness whose agents read a notes folder. The Notes panel's report line opens the newest tidy-up report through main, which copies the
 *    report into a private folder of its own and passes that copy to its opener. "Stop using these notes" drafts a removal; the review names the agents that lose the notes; Save writes it, and the
 *    notes folder is byte for byte as it was.
 *  - Items 4 and 5: "Skills from another folder" copies a skill with a script from a second folder. The review marks the script as a file that can run and
 *    names its folder; Save waits for the acknowledgement; main's question names the script; the script is written with its execute bit.
 * Every expected value is read from the files by this test, never from the app's code or its answers. The notes set-up runs main's own service in this
 * process, as the window would, before the app starts.
 */
import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { chmodSync, existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { createEngineService } from '../main/engine-service.js';
import type { Answer, SaveEdit } from '../shared/engine/types.js';
import { filesOf, sourceFolder, teamFolder } from '../tests/helpers-engine/folders.js';
import { bundleOnce, launchReal } from './harness-real-page.js';
import type { RealHarness } from './harness-real-page.js';
import { removeTempDirs, tempDir } from './temp-dirs.js';

let h: RealHarness, home: string;
const page = (): Page => h.page;
const value = <T>(a: Answer<T> | null): T => { if (a === null || !a.ok) throw new Error(a === null ? 'no answer' : `${a.refusal.code}: ${a.refusal.message}`); return a.value; };

test.beforeAll(() => { test.setTimeout(240_000); bundleOnce(); });
test.afterAll(() => { removeTempDirs(); });
test.afterEach(async () => { await h?.app.close().catch(() => undefined); });

const stateOf = (dir: string): string => join(dir, '.local', 'state');
async function start(): Promise<void> {
  h = await launchReal(home, { XDG_STATE_HOME: stateOf(home) }, false);
  await page().emulateMedia({ reducedMotion: 'reduce', colorScheme: 'light' });
  await page().evaluate(() => { location.hash = '#prototype-v3-real/projects'; location.reload(); });
  await page().waitForLoadState('domcontentloaded');
  await page().waitForSelector('[data-home]');
}
const saveSheet = (p: Page): Locator => p.getByRole('dialog', { name: 'Edit a folder\'s harness' });
/** Opens the edit of `dir` through main's (stubbed) folder chooser. */
async function openEdit(dir: string, name: string): Promise<Locator> {
  const p = page();
  await p.getByRole('button', { name: 'Edit from a folder', exact: true }).click();
  const s = saveSheet(p);
  await h.pick(dir);
  await s.getByRole('button', { name: 'Choose a folder', exact: true }).click();
  await expect(s.locator('.hxi-card', { hasText: name })).toHaveAttribute('aria-pressed', 'true');
  await s.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(s.locator('[data-section="graph"]')).toBeVisible();
  return s;
}
function freshHome(prefix: string): string {
  home = realpathSync(tempDir(prefix));
  chmodSync(home, 0o700);
  return home;
}

test('items 1 and 2: the report line opens the newest tidy-up report through main; "Stop using these notes" is saved, and the notes folder does not change', async () => {
  test.setTimeout(180_000);
  freshHome('bowerloom-items-notes-');
  const dir = teamFolder(home), notes = join(home, 'Documents', 'notes');
  for (const [rel, text] of [['index.md', '# Index\n'], ['pages/one.md', '# One\n'], ['reports/2026-10-20-refine.md', '# Older\n'], ['reports/2026-10-27-refine.md', '# Report\n']] as const) {
    mkdirSync(join(notes, rel, '..'), { recursive: true }); writeFileSync(join(notes, rel), text);
  }
  // The harness reads the notes: both agents, saved through main's own service, as the window would save it.
  const service = createEngineService({ home, stateRoot: join(stateOf(home), 'bowerloom'), who: 'test', chooseFolder: async () => dir, chooseNotesFolder: async () => notes, confirm: async () => true });
  const f = value(await service.chooseFolder()), n = value(await service.chooseNotesFolder('use'));
  const attach: SaveEdit[] = [{ kind: 'set-source', name: 'notes', notesId: n.id }, { kind: 'set-agent', id: 'reader', notes: ['notes'] }, { kind: 'set-agent', id: 'writer', notes: ['notes'] }];
  value(await service.runSave(f.id, value(await service.planSave(f.id, attach)).revision, attach));
  expect(readFileSync(join(dir, '.bowerloom', 'agents', 'reader.md'), 'utf8')).toMatch(/^notes:\n {2}- notes$/m);
  const notesBefore = filesOf(notes);

  await start();
  const s = await openEdit(dir, 'team');

  // 2. The report line is a button named by its date. Main asks first, then passes a private copy of the report to its opener, never the report itself.
  const card = s.locator('[data-section="notes"] [data-card]');
  await expect(card).toHaveCount(1);
  const report = card.locator('[data-open-report]');
  await expect(report).toHaveText('Tidy-up report 2026-10-27');
  await expect(report).toHaveAccessibleName('Open the tidy-up report of 2026-10-27');
  await report.click();
  await expect(s.locator('[data-report-opened]')).toHaveAttribute('data-report-opened', 'reports/2026-10-27-refine.md');
  const opened = await h.opened();
  expect(opened).toHaveLength(1);
  expect(basename(opened[0]!)).toBe('report.md');
  expect(opened[0]!.startsWith(realpathSync(notes))).toBe(false);
  expect(readFileSync(opened[0]!, 'utf8')).toBe('# Report\n');
  expect(statSync(opened[0]!).mode & 0o777).toBe(0o600);
  expect(statSync(dirname(opened[0]!)).mode & 0o777).toBe(0o700);
  expect((await h.asked()).at(-1)!.message).toBe('Open reports/2026-10-27-refine.md from ~/Documents/notes?');
  await expect(s).not.toContainText(home);

  // 1. Stop using the notes: one change in the draft, the card stays and says so, and the review names the agents that lose them.
  await card.locator('[data-stop-notes]').click();
  await expect(card).toHaveAttribute('data-stopped', '');
  await expect(card).toContainText('Stops when you save.');
  await expect(s.locator('[data-draft]')).toContainText('1 change, not saved yet.');
  await s.getByRole('button', { name: 'Review the save', exact: true }).click();
  const review = s.locator('[data-save-review="save"]');
  await expect(review.locator('[data-stopped-notes="notes"]')).toContainText('reader and writer lose these notes.');
  await expect(review).toContainText('Your notes folder itself does not change.');
  await expect(review.locator('[data-file=".bowerloom/knowledge.json"]')).toHaveAttribute('data-action', 'delete');
  await review.locator('[data-approve-plan] input').check();
  await s.getByRole('button', { name: /^Save \d+ files$/ }).click();
  await expect(s.locator('[data-version-kept]')).toBeVisible();

  // On disk: no source, no agent reads notes, and the notes folder is as it was.
  expect(existsSync(join(dir, '.bowerloom', 'knowledge.json'))).toBe(false);
  for (const agent of ['reader', 'writer']) expect(readFileSync(join(dir, '.bowerloom', 'agents', `${agent}.md`), 'utf8')).not.toMatch(/^notes:/m);
  expect(filesOf(notes)).toEqual(notesBefore);
  expect(await h.opened(), 'the save opens nothing').toHaveLength(1);
});

test('items 4 and 5: a skill with a script, copied from another folder, is marked in the review, waits for the acknowledgement, and keeps its execute bit', async () => {
  test.setTimeout(180_000);
  freshHome('bowerloom-items-copy-');
  const dir = teamFolder(home), src = sourceFolder(home);
  const script = readFileSync(join(src, '.bowerloom/skills/summarize/scripts/count.sh'), 'utf8');
  await start();
  const s = await openEdit(dir, 'team');

  // 5. Skills from another folder: choose the folder, read its skills, add one.
  const copy = s.locator('[data-section="copy-skills"]');
  await expect(copy.locator('[data-copy-from]')).toHaveCount(0);
  await h.pick(src);
  await copy.locator('[data-copy-choose]').click();
  const from = copy.locator('[data-copy-from]');
  await expect(from).toHaveCount(1);
  await expect(from).toHaveText('~/Projects/source');
  await from.click();
  await expect(from).toHaveAttribute('aria-pressed', 'true');
  await copy.getByRole('button', { name: 'Add summarize from ~/Projects/source', exact: true }).click();
  await expect(s.locator('[data-skill-row="summarize"]')).toHaveAttribute('data-copied', '');
  await expect(s.locator('[data-draft]')).toContainText('1 change, not saved yet.');
  await s.getByRole('button', { name: 'Review the save', exact: true }).click();

  // 4. The review: each copied file names its folder, the script is marked, and Save waits for the plan tick and the acknowledgement.
  const review = s.locator('[data-save-review="save"]');
  const skill = review.locator('[data-file=".bowerloom/skills/summarize/SKILL.md"]'), sh = review.locator('[data-file=".bowerloom/skills/summarize/scripts/count.sh"]');
  await expect(skill).toHaveAttribute('data-from', '~/Projects/source');
  await expect(skill).not.toHaveAttribute('data-executable', '');
  await expect(sh).toHaveAttribute('data-executable', '');
  await expect(sh).toHaveAttribute('data-from', '~/Projects/source');
  await expect(sh).toContainText('Can run as a program.');
  const save = s.getByRole('button', { name: 'Save 2 files', exact: true });
  await review.locator('[data-approve-plan] input').check();
  await expect(save).toBeDisabled();
  await review.locator('[data-acknowledge-executables] input').check();
  await expect(save).toBeEnabled();
  expect(existsSync(join(dir, '.bowerloom/skills/summarize')), 'nothing is written while the person reads').toBe(false);
  await save.click();
  await expect(s.locator('[data-version-kept]')).toBeVisible();

  // Main's question named the script; on disk the script is the source's bytes, and it can run.
  const asked = (await h.asked()).at(-1)!;
  expect(asked.message).toBe('Change 2 files in ~/Projects/team/.bowerloom?');
  expect(asked.detail).toContain('This file can run as a program: .bowerloom/skills/summarize/scripts/count.sh.');
  const written = join(dir, '.bowerloom/skills/summarize/scripts/count.sh');
  expect(readFileSync(written, 'utf8')).toBe(script);
  expect(statSync(written).mode & 0o111).toBe(0o111);
});
