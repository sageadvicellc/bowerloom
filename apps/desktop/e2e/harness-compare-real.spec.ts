/**
 * Compare on the person's own folders (beta.2), in the real window (Electron started with no flag, HOME and XDG_STATE_HOME pointed at a made-up folder). Compare shows the recorded runs of one instruction in one
 * project side by side, across engines. These walks check that:
 *  - two runs of one instruction in two engines form a group on Runs, with Open compare, and Compare shows one column for each, with the figures of each from its own session log;
 *  - a run of another instruction is not in the group;
 *  - the rating is locked until the run is marked done, and unlocks when it is;
 *  - a saved rating and notes are there after the window is loaded again;
 *  - a group with one run says a second engine is needed, and a group that is not there is a named empty state;
 *  - no chat text and no full home path reaches the window.
 */
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { chmodSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { teamFolder } from '../tests/helpers-engine/folders.js';
import { bundleOnce, launchReal } from './harness-real-page.js';
import type { RealHarness } from './harness-real-page.js';
import { removeTempDirs, tempDir } from './temp-dirs.js';
import { MARK, addRun, claudeLog, codexLog, goTo, registerFolder, startedMs } from './runs-real-support.js';

let h: RealHarness, home: string;
const page = (): Page => h.page;
const INSTRUCTION = 'Check the numbers in the Friday report.';

test.beforeAll(() => { test.setTimeout(240_000); bundleOnce(); });
test.afterAll(() => { removeTempDirs(); });
test.beforeEach(async () => {
  test.setTimeout(150_000);
  home = realpathSync(tempDir('bowerloom-compare-home-'));
  chmodSync(home, 0o700);
  h = await launchReal(home, { XDG_STATE_HOME: join(home, '.local', 'state') }, false);
  await page().emulateMedia({ reducedMotion: 'reduce', colorScheme: 'light' });
});
test.afterEach(async () => { await h?.app.close(); });

/** Two runs of one instruction (Claude Code and Codex, each with its own log) and one run of another instruction. */
async function recordTwoAndOne(): Promise<void> {
  const p = page(), dir = teamFolder(home), start = startedMs();
  claudeLog(home, dir, start); codexLog(home, dir, start);
  await registerFolder(h, dir);
  await addRun(p, { engine: 'Claude Code', instruction: INSTRUCTION, startMs: start });
  await addRun(p, { engine: 'Codex', instruction: INSTRUCTION, startMs: start });
  await addRun(p, { engine: 'Claude Code', instruction: 'Something else entirely.', startMs: start - 7_200_000 });
}

test('runs of one instruction in two engines form a group with Open compare, and the other instruction is not in it', async () => {
  const p = page();
  await recordTwoAndOne();
  await goTo(p, '#app/runs');
  await expect(p.getByText('3 runs. Runs of one instruction are grouped for Compare.')).toBeVisible();
  await expect(p.locator('[data-run]')).toHaveCount(3);
  const group = p.locator('.hr-group');
  await expect(group).toHaveCount(1);
  await expect(group.locator('[data-run]')).toHaveCount(2);
  await expect(group.getByRole('button', { name: 'Open compare', exact: true })).toBeVisible();
  await expect(group).toContainText('Claude Code in team');
  await expect(group).toContainText('Codex in team');
});

test('Compare shows one column for each engine with the figures of its own log, Not read where a log held nothing, and no chat text', async () => {
  const p = page();
  await recordTwoAndOne();
  await goTo(p, '#app/runs');
  await p.locator('.hr-group').getByRole('button', { name: 'Open compare', exact: true }).click();
  await expect(p.locator('[data-screen="compare"]')).toBeVisible();
  await expect(p.getByText('Same instruction in both runs')).toBeVisible();
  await expect(p.locator('.hc-same-text')).toHaveText(INSTRUCTION);
  const cols = p.locator('.hc-col');
  await expect(cols).toHaveCount(2);
  const claude = cols.filter({ hasText: 'Claude Code' }), codex = cols.filter({ hasText: 'Codex' });
  await expect(claude.locator('[data-figure="duration"] dd')).toHaveText('4 minutes');
  await expect(claude.locator('[data-figure="input"] dd')).toHaveText('19');
  await expect(claude.locator('[data-figure="model"] dd')).toHaveText('claude-test-1');
  await expect(codex.locator('[data-figure="duration"] dd')).toHaveText('6 minutes');
  await expect(codex.locator('[data-figure="input"] dd')).toHaveText('250');
  await expect(codex.locator('[data-figure="output"] dd')).toHaveText('90');
  await expect(codex.locator('[data-figure="model"] dd')).toHaveText('gpt-test-1');
  await expect(claude.locator('[data-figure="outcome"] dd')).toHaveText('Finished');
  expect(await p.locator('body').innerText(), 'no chat text reaches the window').not.toContain(MARK);
  expect(await p.content(), 'no full path of the home folder reaches the window').not.toContain(home);
  await p.screenshot({ path: test.info().outputPath('compare-real-screen.png'), scale: 'css' });
});

test('the rating is locked until the run is marked done, then unlocks; a saved rating and notes are there after a reload', async () => {
  const p = page();
  await recordTwoAndOne();
  await goTo(p, '#app/runs');
  await p.locator('.hr-group').getByRole('button', { name: 'Open compare', exact: true }).click();
  const claude = p.locator('.hc-col').filter({ hasText: 'Claude Code' });
  await expect(claude).toHaveAttribute('data-status', 'recorded');
  await expect(claude).toContainText('Mark the run as done to rate it.');
  const better = claude.getByRole('button', { name: 'Better', exact: true });
  await expect(better).toHaveAttribute('aria-disabled', 'true');
  await better.click({ force: true });
  await expect(better, 'a locked rating does not take a press').toHaveAttribute('aria-pressed', 'false');
  await claude.locator('[data-toggle-done]').click();
  await expect(claude).toHaveAttribute('data-status', 'done');
  await expect(claude.getByRole('button', { name: 'Better', exact: true })).not.toHaveAttribute('aria-disabled', 'true');
  await claude.getByRole('button', { name: 'Better', exact: true }).click();
  await claude.locator('textarea').fill('Fast and clear.');
  await p.locator('[data-save-compare]').click();
  await expect(p.getByText('Saved rating and notes.')).toBeVisible();
  const saved = JSON.parse(readFileSync(join(h.state, 'bowerloom', 'runs', 'runs.json'), 'utf8')) as { runs: { engine: string; status: string; rating: string | null; notes: string }[] };
  expect(saved.runs.find(r => r.engine === 'claude-code' && r.rating !== null)).toMatchObject({ status: 'done', rating: 'better', notes: 'Fast and clear.' });
  expect(saved.runs.find(r => r.engine === 'codex')).toMatchObject({ status: 'recorded', rating: null });
  await p.evaluate(() => { location.reload(); });
  await p.waitForSelector('[data-home]');
  const col = p.locator('.hc-col').filter({ hasText: 'Claude Code' });
  await expect(col.getByRole('button', { name: 'Better', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(col.locator('textarea')).toHaveValue('Fast and clear.');
  await expect(p.locator('.hc-col').filter({ hasText: 'Codex' })).toHaveAttribute('data-status', 'recorded');
});

test('a group with one run says a second engine is needed, and a group that is not there is a named empty state', async () => {
  const p = page(), dir = teamFolder(home);
  await registerFolder(h, dir);
  await addRun(p, { engine: 'Claude Code', instruction: INSTRUCTION, startMs: startedMs() });
  await goTo(p, '#app/runs');
  await expect(p.locator('.hr-group')).toHaveCount(0);
  await expect(p.getByRole('button', { name: 'Open compare', exact: true })).toHaveCount(0);
  await goTo(p, '#app/compare/group-1');
  await expect(p.locator('[data-compare-state="one"]')).toHaveText('Record this instruction in a second engine to compare.');
  await expect(p.locator('.hc-col')).toHaveCount(1);
  await goTo(p, '#app/compare/group-404');
  await expect(p.getByText('That group of runs is not here.')).toBeVisible();
  await p.getByRole('button', { name: 'Close compare', exact: true }).click();
  await expect(p.getByRole('heading', { level: 1, name: 'Runs', exact: true })).toBeVisible();
});
