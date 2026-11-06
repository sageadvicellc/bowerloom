/**
 * Start on the person's own folders (beta.2), in the real window (Electron started with no flag, HOME and XDG_STATE_HOME pointed at a made-up folder, windows hidden).
 * Start shows the command for an engine in a folder and copies it. It runs nothing. These walks check that:
 *  - the sheet opens from a folder row, lists the folders main knows, and offers Claude Code and Codex with the state of each;
 *  - an engine that is not installed opens the install review first, and shows no command;
 *  - once the engines are installed, "Show the command" shows one command for each ticked engine, with `~` and never the full path of the home folder;
 *  - Copy puts the same command on the clipboard with the full folder path (main's `clipboard.writeText` is replaced by a recorder, so the person's own clipboard is never touched);
 *  - the folder is byte for byte as it was, and Start made no run record;
 *  - a bad instruction (too long, a leading dash) blocks the button, and a change clears the commands;
 *  - the "Not in beta.1" note is gone for Start only.
 */
import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { chmodSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { filesOf, teamFolder } from '../tests/helpers-engine/folders.js';
import { bundleOnce, launchReal } from './harness-real-page.js';
import type { RealHarness } from './harness-real-page.js';
import { removeTempDirs, tempDir } from './temp-dirs.js';
import { shot } from './harness-page.js';

let h: RealHarness, home: string;
const page = (): Page => h.page;

test.beforeAll(() => { test.setTimeout(240_000); bundleOnce(); });
test.afterAll(() => { removeTempDirs(); });
test.beforeEach(async () => {
  test.setTimeout(120_000);
  home = realpathSync(tempDir('bowerloom-start-home-'));
  chmodSync(home, 0o700);
  h = await launchReal(home, { XDG_STATE_HOME: join(home, '.local', 'state') }, false);
  // Main's clipboard write is replaced by a recorder, so a run never overwrites the clipboard of the person who runs it.
  await h.app.evaluate(({ clipboard }) => {
    const g = globalThis as unknown as { __clips: string[] };
    g.__clips = [];
    clipboard.writeText = ((text: string) => { g.__clips.push(text); }) as typeof clipboard.writeText;
  });
  await page().emulateMedia({ reducedMotion: 'reduce', colorScheme: 'light' });
  await page().evaluate(() => { location.hash = '#app/harnesses'; location.reload(); });
  await page().waitForLoadState('domcontentloaded');
  await page().waitForSelector('[data-home]');
});
test.afterEach(async () => { await h?.app.close(); });

const clips = (): Promise<string[]> => h.app.evaluate(() => (globalThis as unknown as { __clips: string[] }).__clips);

/** Registers a folder through main's chooser (answered by the test) and opens the Start sheet from its row. */
async function openStart(dir: string): Promise<Locator> {
  const p = page();
  await h.pick(dir);
  await p.getByRole('button', { name: 'Choose a folder', exact: true }).click();
  const row = p.locator('[data-folder-row]').first();
  await expect(row).toBeVisible();
  await row.locator('[data-start-folder]').click();
  const sheet = p.locator('[data-slot="start"]');
  await expect(sheet.getByRole('heading', { name: 'Start in a project', exact: true })).toBeVisible();
  await expect(sheet.locator('[data-engine]').first()).toBeVisible();
  return sheet;
}

/** Installs the folder's harness for both engines through the install review that Start opens, and returns to the Start sheet. */
async function installFromStart(sheet: Locator): Promise<void> {
  const p = page();
  await sheet.locator('#hs-instruction').fill('check the install');
  await sheet.getByRole('button', { name: 'Show the command', exact: true }).click();
  const review = p.getByRole('dialog', { name: 'Install a folder\'s harness' });
  await expect(review).toBeVisible();
  await review.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(review.getByRole('checkbox')).toHaveCount(2);
  await review.getByRole('button', { name: 'Next', exact: true }).click();
  await review.locator('[data-approve-plan] input').check();
  await review.getByRole('button', { name: /^Write \d+ files$/ }).click();
  await expect(review.locator('[data-done]')).toBeVisible();
  await review.getByRole('button', { name: 'Close', exact: true }).last().click();
  await expect(review).toHaveCount(0);
}

test('an engine that is not installed opens the install review first, shows no command, and writes nothing until the person approves', async () => {
  const p = page(), dir = teamFolder(home), before = filesOf(dir);
  const sheet = await openStart(dir);
  await expect(sheet.locator('#hs-project')).toHaveValue(/^folder-\d+$/);
  await expect(sheet.locator('[data-start-where]')).toHaveText('~/Projects/team');
  await expect(sheet.locator('[data-engine="claude-code"]')).toContainText('Not installed here');
  await expect(sheet.locator('[data-engine="codex"]')).toContainText('Not installed here');
  const show = sheet.getByRole('button', { name: 'Show the command', exact: true });
  await expect(show, 'no instruction yet').toBeDisabled();
  await expect(sheet).toContainText('Write an instruction.');
  await sheet.locator('#hs-instruction').fill('fix the login');
  await expect(sheet).toContainText('Claude Code is not ready here. The install review opens first.');
  await expect(show).toBeEnabled();
  await show.click();
  const review = p.getByRole('dialog', { name: 'Install a folder\'s harness' });
  await expect(review).toBeVisible();
  await expect(sheet.locator('[data-start-results]'), 'no command is shown before the install').toHaveCount(0);
  expect(await clips(), 'nothing was copied').toEqual([]);
  expect(filesOf(dir), 'the install review writes nothing while the person reads').toEqual(before);
  await shot(p, 'start-real-install-first');
  await p.keyboard.press('Escape');
  await expect(review).toHaveCount(0);
  await expect(sheet, 'the Start sheet stays under the review, with the same words').toBeVisible();
  await expect(sheet.locator('#hs-instruction')).toHaveValue('fix the login');
  expect(await clips()).toEqual([]);
  expect(filesOf(dir)).toEqual(before);
});

test('once the engines are installed, Show the command shows one command for each ticked engine with ~, and Copy puts the same command on the clipboard with the full path', async () => {
  const p = page(), dir = teamFolder(home);
  const sheet = await openStart(dir);
  await installFromStart(sheet);
  await expect(sheet.locator('[data-engine="claude-code"]')).toContainText('Installed here');
  await expect(sheet.locator('[data-engine="codex"]')).toContainText('Installed here');
  // The tick the person had stays; the other engine is installed now, so it can be ticked.
  await expect(sheet.locator('[data-engine="claude-code"] input')).toBeChecked();
  await sheet.locator('[data-engine="codex"] input').check();
  const after = filesOf(dir);
  const text = "fix the login; it's \"broken\" $(touch x)\nthen run the tests";
  await sheet.locator('#hs-instruction').fill(text);
  await sheet.getByRole('button', { name: 'Show the command', exact: true }).click();
  const results = sheet.locator('[data-start-results]');
  await expect(results).toBeVisible();
  await expect(results.locator('[data-start-norun]')).toHaveText('Bowerloom does not run this. Paste it into your own Terminal.');
  const quoted = "'fix the login; it'\\''s \"broken\" $(touch x)\nthen run the tests'";
  await expect(results.locator('[data-command-for="claude-code"] pre')).toHaveText(`cd ~/Projects/team && claude ${quoted}`);
  await expect(results.locator('[data-command-for="codex"] pre')).toHaveText(`cd ~/Projects/team && codex ${quoted}`);
  await expect(results.locator('[data-start-differs]')).toHaveText('The copy has the full folder path where this shows ~.');
  expect(await p.locator('body').innerText(), 'the window never holds the full path of the home folder').not.toContain(home);
  expect(await p.content()).not.toContain(home);
  expect(await clips(), 'showing copies nothing').toEqual([]);
  await shot(p, 'start-real-commands');
  // Copy for Codex.
  await results.locator('[data-copy="codex"]').click();
  await expect(results.locator('[data-command-for="codex"] [data-copied]')).toHaveText('Copied. Paste it into your Terminal.');
  expect(await clips()).toEqual([`cd ${dir} && codex ${quoted}`]);
  // Copy for Claude Code.
  await results.locator('[data-copy="claude-code"]').click();
  await expect(results.locator('[data-command-for="claude-code"] [data-copied]')).toBeVisible();
  expect((await clips()).at(-1)).toBe(`cd ${dir} && claude ${quoted}`);
  expect(await clips()).toHaveLength(2);
  await shot(p, 'start-real-copied');
  // Changing the instruction clears the commands, so what Copy copies is always what is on screen.
  await sheet.locator('#hs-instruction').fill('another one');
  await expect(results).toHaveCount(0);
  // Unticking an engine clears them too, and the next show lists only the ticked one.
  await sheet.locator('[data-engine="codex"] input').uncheck();
  await sheet.getByRole('button', { name: 'Show the command', exact: true }).click();
  await expect(sheet.locator('[data-command-for]')).toHaveCount(1);
  await expect(sheet.locator('[data-command-for="claude-code"] pre')).toHaveText("cd ~/Projects/team && claude 'another one'");
  // Start wrote nothing in the folder and made no run record: Runs still says runs are not in beta.1.
  expect(filesOf(dir), 'the folder is as the install left it').toEqual(after);
  await p.keyboard.press('Escape');
  await p.evaluate(() => { location.hash = '#app/runs'; });
  await expect(p.getByText('Runs are not in beta.1.')).toBeVisible();
});

test('a bad instruction blocks the button and says why: over 4,000 characters, or a leading dash', async () => {
  const dir = teamFolder(home), before = filesOf(dir);
  const sheet = await openStart(dir);
  const show = sheet.getByRole('button', { name: 'Show the command', exact: true });
  await sheet.locator('#hs-instruction').fill('x'.repeat(4000));
  await expect(show).toBeEnabled();
  await sheet.locator('#hs-instruction').fill('x'.repeat(4001));
  await expect(show).toBeDisabled();
  await expect(sheet).toContainText('The instruction is over 4,000 characters.');
  await sheet.locator('#hs-instruction').fill('--help');
  await expect(show).toBeDisabled();
  await expect(sheet).toContainText('The instruction cannot start with a dash.');
  await sheet.locator('#hs-instruction').fill('  ');
  await expect(sheet).toContainText('Write an instruction.');
  await sheet.locator('[data-engine="claude-code"] input').uncheck();
  await expect(sheet).toContainText('Tick at least one engine.');
  expect(await clips()).toEqual([]);
  expect(filesOf(dir)).toEqual(before);
});

test('the Beta mark no longer lists Start, and still lists the controls that are not in beta.1', async () => {
  const p = page();
  await p.getByRole('button', { name: 'About this beta', exact: true }).click();
  await expect(p.locator('.hx-preview-pop li')).toHaveText(['Compare', 'Runs', 'Assign to project, in the Harnesses details', 'Assign harness, Install, Update and Review, in Projects', 'Add (the plus button), in the Library', 'Add a folder, in Projects']);
  await p.keyboard.press('Escape');
});
