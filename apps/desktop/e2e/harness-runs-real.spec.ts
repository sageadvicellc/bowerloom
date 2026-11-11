/**
 * Runs on the person's own folders (beta.2), in the real window (Electron started with no flag, HOME and XDG_STATE_HOME pointed at a made-up folder). A run is a manual record: "Add a run" on Runs, and
 * "Record this run" on Start right after the command is copied. These walks check that:
 *  - an empty list says to record a run after starting an engine;
 *  - Add a run saves a record in Bowerloom's own state folder, and the record is still there after the window is loaded again;
 *  - the project folder is byte for byte as it was, and the saved file holds no text of a chat;
 *  - the figures come from the engine's own session log (time taken, input, output, model, outcome), and an engine with no log, a folder with no log and a log that cannot be read each say so in words, with no zero;
 *  - no full path of the home folder and no chat text reaches the window;
 *  - "Mark as done" is the person's to press: a run is Recorded until then, and never Running;
 *  - "Record this run" shows only after a copy, records once, and Show the command alone records nothing.
 */
import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { chmodSync, existsSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { filesOf, teamFolder } from '../tests/helpers-engine/folders.js';
import { bundleOnce, launchReal } from './harness-real-page.js';
import type { RealHarness } from './harness-real-page.js';
import { removeTempDirs, tempDir } from './temp-dirs.js';
import { MARK, addRun, claudeLog, garbageClaudeLog, goTo, registerFolder, startedMs } from './runs-real-support.js';
import { shot } from './harness-page.js';

let h: RealHarness, home: string;
const page = (): Page => h.page;
const stateFile = (): string => join(h.state, 'bowerloom', 'runs', 'runs.json');

test.beforeAll(() => { test.setTimeout(240_000); bundleOnce(); });
test.afterAll(() => { removeTempDirs(); });
test.beforeEach(async () => {
  test.setTimeout(120_000);
  home = realpathSync(tempDir('bowerloom-runs-home-'));
  chmodSync(home, 0o700);
  h = await launchReal(home, { XDG_STATE_HOME: join(home, '.local', 'state') }, false);
  await h.app.evaluate(({ clipboard }) => {
    const g = globalThis as unknown as { __clips: string[]; __clipText: string };
    g.__clips = []; g.__clipText = '';
    clipboard.writeText = (async (text: string) => { g.__clips.push(text); g.__clipText = text; }) as typeof clipboard.writeText;
    clipboard.readText = (async () => g.__clipText) as typeof clipboard.readText;
  });
  await page().emulateMedia({ reducedMotion: 'reduce', colorScheme: 'light' });
});
test.afterEach(async () => { await h?.app.close(); });

test('an empty list says to record a run after starting an engine, and the Add a run button is there', async () => {
  const p = page();
  await goTo(p, '#app/runs');
  await expect(p.getByRole('heading', { level: 1, name: 'Runs', exact: true })).toBeVisible();
  await expect(p.getByText('No runs yet. Record one after you start an engine.')).toBeVisible();
  await expect(p.getByText('Runs are not in beta.1.')).toHaveCount(0);
  await expect(p.locator('[data-add-run]')).toBeEnabled();
  expect(existsSync(stateFile()), 'looking at an empty list saves nothing').toBe(false);
});

test('Add a run saves a record in the state folder, shows the figures from the Claude Code log and no chat text, leaves the project alone, and keeps the run after a reload', async () => {
  const p = page(), dir = teamFolder(home), before = filesOf(dir), start = startedMs();
  claudeLog(home, dir, start);
  await registerFolder(h, dir);
  await addRun(p, { engine: 'Claude Code', instruction: 'Write a weekly report.', startMs: start });
  const row = p.locator('[data-run="run-1"]');
  await expect(row).toBeVisible();
  await expect(row).toHaveAttribute('data-status', 'recorded');
  await expect(row).toContainText('Claude Code in team');
  await expect(p.getByText('Recorded. Find it in Runs.')).toBeVisible();
  const panel = p.getByRole('complementary');
  await expect(panel.getByRole('heading', { level: 2, name: 'Claude Code run' })).toBeVisible();
  await expect(panel).toContainText('Write a weekly report.');
  await expect(panel).toContainText('~/Projects/team');
  await expect(panel.locator('[data-figure="duration"] dd')).toHaveText('4 minutes');
  await expect(panel.locator('[data-figure="input"] dd')).toHaveText('19');
  await expect(panel.locator('[data-figure="output"] dd')).toHaveText('14');
  await expect(panel.locator('[data-figure="model"] dd')).toHaveText('claude-test-1');
  await expect(panel.locator('[data-figure="outcome"] dd')).toHaveText('Finished');
  await expect(panel).toContainText('Bowerloom reads numbers from the engine log. It never reads the chat.');
  expect(await p.locator('body').innerText(), 'no chat text reaches the window').not.toContain(MARK);
  expect(await p.content(), 'no full path of the home folder reaches the window').not.toContain(home);
  await shot(p, 'runs-real-figures');
  // Saved in the state folder, never in the project, and no chat text in the file.
  const saved = readFileSync(stateFile(), 'utf8');
  expect(saved).toContain('Write a weekly report.');
  expect(saved).not.toContain(MARK);
  expect(filesOf(dir), 'the project folder is as it was').toEqual(before);
  expect(existsSync(join(dir, '.bowerloom', 'runs')), 'nothing was made in the project').toBe(false);
  // The run is there after the window loads again.
  await p.evaluate(() => { location.reload(); });
  await p.waitForSelector('[data-home]');
  await goTo(p, '#app/runs');
  await expect(p.locator('[data-run="run-1"]')).toBeVisible();
});

test('a run is Recorded until the person marks it done, and it is never Running', async () => {
  const p = page(), dir = teamFolder(home), start = startedMs();
  await registerFolder(h, dir);
  await addRun(p, { engine: 'Codex', instruction: 'Check the numbers.', startMs: start });
  await expect(p.locator('[data-run="run-1"]')).toHaveAttribute('data-status', 'recorded');
  await expect(p.getByText('Running', { exact: true })).toHaveCount(0);
  await p.locator('[data-toggle-done]').click();
  await expect(p.locator('[data-run="run-1"]')).toHaveAttribute('data-status', 'done');
  await expect(p.getByRole('button', { name: 'Mark as not done', exact: true })).toBeVisible();
  await p.evaluate(() => { location.reload(); });
  await p.waitForSelector('[data-home]');
  await goTo(p, '#app/runs');
  await expect(p.locator('[data-run="run-1"]')).toHaveAttribute('data-status', 'done');
});

test('a folder with no log, a log that cannot be read and an engine with no reader each say so in words, and show Not read and never a zero', async () => {
  const p = page(), dir = teamFolder(home), start = startedMs();
  await registerFolder(h, dir);
  await addRun(p, { engine: 'Codex', instruction: 'No log for this one.', startMs: start });
  await expect(p.locator('[data-figures-why]')).toHaveText('No session log found in ~/Projects/team, within an hour of the start. Details stay as you recorded them.');
  await expect(p.locator('[data-figure="duration"] dd')).toHaveText('Not read');
  await expect(p.locator('[data-figure="input"] dd')).toHaveText('Not read');
  garbageClaudeLog(home, dir);
  await addRun(p, { engine: 'Claude Code', instruction: 'A log that is not a log.', startMs: start });
  await expect(p.locator('[data-figures-why]')).toHaveText('Could not tell when the log began. Not read.');
  await expect(p.locator('[data-figure="output"] dd')).toHaveText('Not read');
  await addRun(p, { engine: 'OpenCode', instruction: 'An engine with no reader.', startMs: start });
  await expect(p.locator('[data-figures-why]')).toHaveText('Figures are not available for this engine.');
  await expect(p.locator('[data-figure="model"] dd')).toHaveText('Not read');
  expect(await p.locator('body').innerText()).not.toMatch(/\b0 (seconds|minutes)\b/);
  await shot(p, 'runs-real-states');
});

test('the form says what is missing, refuses an empty instruction, closes on Cancel and Escape, and saves nothing then', async () => {
  const p = page(), dir = teamFolder(home);
  await registerFolder(h, dir);
  await goTo(p, '#app/runs');
  await p.locator('[data-add-run]').click();
  const sheet: Locator = p.locator('[data-slot="add-run"]');
  await expect(sheet.locator('[data-save-run]')).toBeDisabled();
  await expect(sheet.locator('[data-add-why]')).toHaveText('Choose a project.');
  await expect(sheet.locator('#har-project option')).not.toHaveCount(1);
  await sheet.locator('#har-project').selectOption({ index: 1 });
  await expect(sheet.locator('[data-add-why]')).toHaveText('Write the instruction you gave.');
  await sheet.locator('#har-instruction').fill('   ');
  await expect(sheet.locator('[data-save-run]')).toBeDisabled();
  await sheet.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(sheet).toHaveCount(0);
  await p.locator('[data-add-run]').click();
  await expect(sheet).toBeVisible();
  await p.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);
  await expect(p.getByText('No runs yet. Record one after you start an engine.')).toBeVisible();
  expect(existsSync(stateFile()), 'nothing was saved').toBe(false);
});

// ---- Record this run, on Start

async function openStart(dir: string): Promise<Locator> {
  const p = page();
  await goTo(p, '#app/harnesses');
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

test('Record this run shows only after a copy, records the run once, and Show the command alone records nothing', async () => {
  const p = page(), dir = teamFolder(home);
  const sheet = await openStart(dir);
  await installFromStart(sheet);
  await sheet.locator('#hs-instruction').fill('fix the login');
  await sheet.getByRole('button', { name: 'Show the command', exact: true }).click();
  const results = sheet.locator('[data-start-results]');
  await expect(results).toBeVisible();
  await expect(sheet.locator('[data-record]'), 'no record button before a copy').toHaveCount(0);
  expect(existsSync(stateFile()), 'showing the command records nothing').toBe(false);
  await results.locator('[data-copy="claude-code"]').click();
  await expect(results.locator('[data-command-for="claude-code"] [data-copied]')).toBeVisible();
  const record = results.locator('[data-record="claude-code"]');
  await expect(record).toBeVisible();
  await expect(sheet.locator('[data-record="codex"]'), 'the other engine was not copied').toHaveCount(0);
  await expect(results.locator('[data-record-block]')).toContainText('Bowerloom cannot see your Terminal.');
  expect(existsSync(stateFile()), 'copying records nothing').toBe(false);
  await shot(p, 'start-record-button');
  await record.click();
  const done = results.locator('[data-recorded="claude-code"]');
  await expect(done).toContainText('Recorded. Find it in Runs.');
  await expect(sheet.locator('[data-record="claude-code"]'), 'it records once').toHaveCount(0);
  const saved = JSON.parse(readFileSync(stateFile(), 'utf8')) as { runs: { engine: string; instruction: string; status: string }[] };
  expect(saved.runs).toHaveLength(1);
  expect(saved.runs[0]).toMatchObject({ engine: 'claude-code', instruction: 'fix the login', status: 'recorded' });
  // Changing the instruction clears the commands and the record line, so what the person sees is always what a press would record.
  await sheet.locator('#hs-instruction').fill('another one');
  await expect(results).toHaveCount(0);
  await sheet.getByRole('button', { name: 'Show the command', exact: true }).click();
  await expect(sheet.locator('[data-recorded]')).toHaveCount(0);
  await sheet.locator('[data-start-results] [data-copy="claude-code"]').click();
  await expect(sheet.locator('[data-record="claude-code"]')).toBeVisible();
  // Open Runs from the recorded line.
  await sheet.locator('[data-record="claude-code"]').click();
  await sheet.locator('[data-open-runs]').click();
  await expect(p.getByRole('heading', { level: 1, name: 'Runs', exact: true })).toBeVisible();
  await expect(p.locator('[data-run]')).toHaveCount(2);
  await expect(p.locator('[data-run]').first()).toContainText('Claude Code in team');
});

test('a damaged saved file is shown as damaged, a record is refused and nothing is written, and only "Start a new list" moves it aside under a name with the time', async () => {
  const p = page(), dir = teamFolder(home), file = stateFile();
  await registerFolder(h, dir);
  await addRun(p, { engine: 'Codex', instruction: 'The first run.', startMs: startedMs() });
  writeFileSync(file, 'not json at all');
  await p.evaluate(() => { location.reload(); });
  await p.waitForSelector('[data-home]');
  await goTo(p, '#app/runs');
  await expect(p.locator('[data-runs-state="damaged"]')).toHaveText('Your saved runs file is damaged. Start a new list.');
  expect(readFileSync(file, 'utf8'), 'looking at it changes nothing').toBe('not json at all');
  await p.locator('[data-start-new-list]').click();
  await expect(p.locator('[data-kept]')).toContainText('Bowerloom kept it as runs.damaged-');
  const asides = readdirSync(join(h.state, 'bowerloom', 'runs')).filter(n => n.startsWith('runs.damaged-'));
  expect(asides).toHaveLength(1);
  expect(readFileSync(join(h.state, 'bowerloom', 'runs', asides[0]!), 'utf8')).toBe('not json at all');
  await expect(p.getByText('No runs yet. Record one after you start an engine.')).toBeVisible();
  expect(await p.locator('body').innerText()).not.toContain(home);
});
