/**
 * Start, Runs and Compare (S8, S9) in the real window: the Start sheet (project, ticks, the Compare notice, the instruction), an interface that is out of date opens the install review first,
 * two runs from two ticked interfaces, Runs shows them Running, Compare locks the rating until each run is done (a run finishes by itself after about 15 seconds, so these tests wait up to 20),
 * the rating unlocks, "Save rating and notes" saves in memory, and the saved rating is there when Compare is opened again. The preview opens no window.
 * Everything starts from a harness and a project that are already installed in the sample world (Weekly report crew in site-redesign), so nothing here needs the install sheet to be finished.
 */
import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { removeTempDirs } from './temp-dirs.js';
import { APP, fresh, launchHarness, shot } from './harness-page.js';
import type { Harness } from './harness-page.js';

let h: Harness;
const page = (): Page => h.page;
const FINISH = 20_000;
const INSTRUCTION = 'Check the numbers in the Friday report.';

test.beforeAll(async () => { test.setTimeout(240_000); h = await launchHarness(); });
test.afterAll(async () => { try { await h.app.close(); } finally { removeTempDirs(); } });
test.beforeEach(async () => { await page().emulateMedia({ reducedMotion: 'reduce', colorScheme: 'light' }); await fresh(page(), APP); });

const sheet = (): Locator => page().getByRole('dialog', { name: 'Start Weekly report crew' });
async function openStart(): Promise<Locator> {
  await page().getByRole('complementary').getByRole('button', { name: 'Start', exact: true }).click();
  await expect(sheet()).toBeVisible();
  return sheet();
}

test('the Start sheet opens on the first project that holds the harness, with two ticks, the Compare notice and the instruction', async () => {
  const p = page(), s = await openStart();
  await expect(s.getByRole('combobox', { name: 'Project' })).toHaveValue('project-bowerloom');
  await expect(s.getByRole('checkbox')).toHaveCount(2);
  await expect(s.getByRole('checkbox', { name: /Claude Code/ })).toBeChecked();
  await expect(s.getByRole('checkbox', { name: /Codex/ })).toBeChecked();
  await expect(s).toContainText('Installed in this project.');
  await expect(s).toContainText('Out of date. You review the update before it runs.');
  await expect(s).toContainText('Switched off. Turn it on in Interfaces.');
  await expect(s.getByRole('status')).toContainText('Compare is on. Bowerloom opens 2 runs with the same instruction in one folder, so run them one at a time if they write files.');
  await expect(s.getByRole('textbox', { name: 'Instruction' })).toHaveValue('Write a weekly report from the notes in Meetings. Check that every claim has a source.');
  await expect(s).toContainText('Bowerloom opens each interface with your instruction. It never reads the chat.');
  await expect(s.getByRole('button', { name: 'Review and start 2 runs', exact: true })).toBeEnabled();
  await shot(p, 'S8-start-run');
  await p.keyboard.press('Escape');
  await expect(s).toHaveCount(0);
});

test('unticking an interface drops the notice and changes the count; an empty instruction or no tick disables Start', async () => {
  const s = await openStart();
  await s.getByRole('checkbox', { name: /Codex/ }).uncheck();
  await expect(s.getByRole('status')).toHaveCount(0);
  await expect(s.getByRole('button', { name: 'Review and start 1 run', exact: true })).toBeEnabled();
  await s.getByRole('textbox', { name: 'Instruction' }).fill('   ');
  await expect(s.getByRole('button', { name: /Review and start/ })).toBeDisabled();
  await s.getByRole('textbox', { name: 'Instruction' }).fill(INSTRUCTION);
  await expect(s.getByRole('button', { name: /Review and start/ })).toBeEnabled();
  await s.getByRole('checkbox', { name: /Claude Code/ }).uncheck();
  await expect(s.getByRole('button', { name: 'Review and start 0 runs', exact: true })).toBeDisabled();
  await expect(page().locator('[data-run]')).toHaveCount(0);
});

test('an interface that is out of date does not start silently: the install review opens first and no run is made', async () => {
  const p = page(), s = await openStart();
  await s.getByRole('button', { name: 'Review and start 2 runs', exact: true }).click();
  await expect(p.getByRole('dialog', { name: /Install Weekly report crew/ })).toBeVisible();
  expect(new URL(p.url()).hash).toBe(APP);
  await p.keyboard.press('Escape');
  await expect(p.getByRole('dialog', { name: /Install Weekly report crew/ })).toHaveCount(0);
  await expect(s).toBeVisible();
  await p.keyboard.press('Escape');
  await expect(s).toHaveCount(0);
  await p.evaluate(() => { location.hash = '#sample/runs'; });
  await expect(p.getByText('3 runs. Runs of one instruction are grouped for Compare.')).toBeVisible();
});

test('start two runs from two ticked interfaces: Runs shows them Running, Compare locks the rating, both finish, the rating unlocks and saves', async () => {
  test.setTimeout(90_000);
  const p = page(), s = await openStart();
  await s.getByRole('combobox', { name: 'Project' }).selectOption({ label: 'site-redesign' });
  await expect(s.getByRole('checkbox', { name: /Claude Code/ })).toBeChecked();
  await expect(s.getByRole('checkbox', { name: /Codex/ })).toBeChecked();
  await expect(s).toContainText('Installed in this project.');
  await s.getByRole('textbox', { name: 'Instruction' }).fill(INSTRUCTION);
  await s.getByRole('button', { name: 'Review and start 2 runs', exact: true }).click();

  // Runs opens, with the new group at the top and both runs Running.
  await expect(p.getByRole('heading', { level: 1, name: 'Runs', exact: true })).toBeVisible();
  await expect(sheet()).toHaveCount(0);
  await expect(p.getByText('5 runs. Runs of one instruction are grouped for Compare.')).toBeVisible();
  const group = p.locator('.hr-group').first();
  await expect(group).toContainText(`Compare: ${INSTRUCTION}`);
  const rows = group.locator('.hr-row');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText('Weekly report crew in Claude Code');
  await expect(rows.nth(1)).toContainText('Weekly report crew in Codex');
  await expect(rows.nth(0)).toContainText('site-redesign · started');
  await expect(rows.nth(0)).toContainText('Running'); await expect(rows.nth(1)).toContainText('Running');
  await expect(p.locator('.hr-row[data-selected]')).toHaveCount(1);
  await expect(p.locator('.hr-row[data-selected]')).toContainText('Weekly report crew in Claude Code');
  const details = p.getByRole('complementary');
  await expect(details).toContainText('Claude Code run'); await expect(details).toContainText('Running'); await expect(details).toContainText(INSTRUCTION);
  await expect(details).toContainText('Weekly report crew in site-redesign'); await expect(details).toContainText('Today at');
  await expect(details).toContainText('Bowerloom does not read or keep the chat. Read it in the interface window.');
  expect(await p.evaluate(() => typeof (window as unknown as { bowerloom?: unknown }).bowerloom)).toBe('undefined');

  // Picking the second run changes the details.
  await rows.nth(1).getByRole('button', { name: 'Weekly report crew in Codex', exact: true }).click();
  await expect(details).toContainText('Codex run');
  await expect(p.locator('.hr-row[data-selected]')).toContainText('Weekly report crew in Codex');

  // "Bring window to the front" opens no window: it says so, and nothing changes.
  await details.getByRole('button', { name: 'Bring window to the front', exact: true }).click();
  await expect(p.getByText('Not in this preview. The full app brings it forward.')).toBeVisible();
  await expect(rows.nth(0)).toContainText('Running');

  // Compare: both columns, the rating locked and the reason in words.
  await details.getByRole('button', { name: 'Open compare', exact: true }).click();
  await expect(p.getByRole('heading', { level: 1, name: 'Compare', exact: true })).toBeVisible();
  await expect(p.getByText('Same instruction in both runs')).toBeVisible();
  await expect(p.getByText(INSTRUCTION, { exact: true })).toBeVisible();
  const cols = p.locator('.hc-col');
  await expect(cols).toHaveCount(2);
  const first = cols.nth(0), second = cols.nth(1);
  await expect(first).toContainText('Claude Code'); await expect(second).toContainText('Codex');
  await expect(first).toContainText('Running'); await expect(second).toContainText('Running');
  await expect(first).toContainText('Weekly report crew in site-redesign');
  await expect(first).toContainText('How did it do? You can rate it when the run is done.');
  for (const col of [first, second]) for (const name of ['Better', 'Same', 'Worse']) await expect(col.getByRole('button', { name, exact: true })).toBeDisabled();
  await first.getByRole('button', { name: 'Better', exact: true }).click({ force: true });
  await expect(first.getByRole('button', { name: 'Better', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await first.getByRole('textbox', { name: 'Your notes' }).fill('Numbers match.');
  await shot(p, 'S9-compare-running');

  // Both finish by themselves: the status words change in both screens, and the rating unlocks.
  await expect(first).toContainText('Done', { timeout: FINISH }); await expect(second).toContainText('Done', { timeout: FINISH });
  await expect(first).toContainText('How did it do?'); await expect(first).not.toContainText('when the run is done');
  for (const col of [first, second]) for (const name of ['Better', 'Same', 'Worse']) await expect(col.getByRole('button', { name, exact: true })).toBeEnabled();
  await first.getByRole('button', { name: 'Better', exact: true }).click();
  await expect(first.getByRole('button', { name: 'Better', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await second.getByRole('button', { name: 'Worse', exact: true }).click();
  await second.getByRole('textbox', { name: 'Your notes' }).fill('Skipped a table.');
  await expect(p.getByText('Saved on this computer, in Bowerloom. Your project files do not change.')).toBeVisible();
  await p.getByRole('button', { name: 'Save rating and notes', exact: true }).click();
  await expect(p.getByText('Saved rating and notes.')).toBeVisible();

  // Close compare, and the list agrees: both runs Done. Open compare again: the saved rating and notes are there.
  await p.getByRole('button', { name: 'Close compare', exact: true }).click();
  await expect(p.getByRole('heading', { level: 1, name: 'Runs', exact: true })).toBeVisible();
  await expect(p.locator('.hr-group').first().locator('.hr-row').nth(0)).toContainText('Done');
  await expect(p.locator('.hr-group').first().locator('.hr-row').nth(1)).toContainText('Done');
  await p.locator('.hr-group').first().getByRole('button', { name: 'Open compare', exact: true }).click();
  await expect(cols).toHaveCount(2);
  await expect(cols.nth(0).getByRole('button', { name: 'Better', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(cols.nth(0).getByRole('textbox', { name: 'Your notes' })).toHaveValue('Numbers match.');
  await expect(cols.nth(1).getByRole('button', { name: 'Worse', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(cols.nth(1).getByRole('textbox', { name: 'Your notes' })).toHaveValue('Skipped a table.');
  await p.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(p.getByRole('heading', { level: 1, name: 'Runs', exact: true })).toBeVisible();
});

test('the sample group in Compare is as in the design: the Codex run is Done and rated Worse, the Claude Code run is not rated', async () => {
  const p = page();
  await fresh(p, '#sample/compare/group-1');
  const cols = p.locator('.hc-col');
  await expect(cols).toHaveCount(2);
  await expect(cols.nth(1)).toContainText('Codex'); await expect(cols.nth(1)).toContainText('Done');
  await expect(cols.nth(1).getByRole('button', { name: 'Worse', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(cols.nth(1).getByRole('textbox', { name: 'Your notes' })).toHaveValue('Skipped the fact check on section 2.');
  await expect(cols.nth(0).getByRole('textbox', { name: 'Your notes' })).toHaveValue('Found all three sources. Report is clean.');
  await expect(cols.nth(0)).toContainText(/Started .+\. Open for 1[2-3] minutes\./);
  await expect(p.locator('.hc-col [aria-pressed="true"]')).toHaveCount(1);
  await shot(p, 'S9-compare');
  await fresh(p, '#sample/runs');
  await expect(p.getByText('3 runs. Runs of one instruction are grouped for Compare.')).toBeVisible();
  await expect(p.locator('.hr-row')).toHaveCount(3);
  await expect(p.locator('.hr-row').nth(2)).toContainText('Closed');
  await expect(p.locator('.hr-row').nth(2)).toContainText('notes · started yesterday 16:05');
  await expect(p.locator('.hr-row[data-selected]')).toContainText('Weekly report crew in Claude Code');
  await shot(p, 'S9-runs');
  await fresh(p, '#sample/compare/group-404');
  await expect(p.getByText('That group of runs is not here.')).toBeVisible();
});

test('Start with an interface that is not installed yet: the review lists its files, Install adds them, and Start then goes on', async () => {
  test.setTimeout(90_000);
  const p = page();
  // Caveman pack is in garden for Claude Code only (out of date). Tick Codex too.
  await p.getByRole('button', { name: 'Start Caveman pack', exact: true }).click();
  const start = p.getByRole('dialog', { name: 'Start Caveman pack' });
  await expect(start.getByRole('combobox', { name: 'Project' })).toHaveValue('project-garden');
  await expect(start.getByRole('checkbox', { name: /Claude Code/ })).toBeChecked();
  await expect(start.getByRole('checkbox', { name: /Codex/ })).not.toBeChecked();
  await start.getByRole('checkbox', { name: /Codex/ }).check();
  await start.getByRole('textbox', { name: 'Instruction' }).fill(INSTRUCTION);
  await start.getByRole('button', { name: 'Review and start 2 runs', exact: true }).click();

  // The review lists the files of both ticked interfaces, so Codex is not left out.
  const review = p.getByRole('dialog', { name: 'Install Caveman pack' });
  await expect(review).toBeVisible();
  await expect(review.locator('[data-group="claude-code"] .hxi-file').first()).toBeVisible();
  await expect(review.locator('[data-group="codex"] .hxi-file').first()).toBeVisible();
  await expect(review.locator('[data-file^=".codex/agents/"]').first()).toBeVisible();
  const install = review.getByRole('button', { name: /^Install \d+ files$/ });
  await expect(install).toBeEnabled();
  await install.click();
  await expect(review).toHaveCount(0);

  // The note is above the Start sheet and can be pressed.
  const toast = p.locator('[data-toast]');
  await expect(toast).toContainText('Installed.');
  await toast.getByRole('button', { name: 'Undo', exact: true }).click({ trial: true });
  await expect(start).toBeVisible();
  await expect(start.getByText('Installed in this project.')).toHaveCount(2);

  // Start now goes on: two runs, no second review.
  await start.getByRole('button', { name: 'Review and start 2 runs', exact: true }).click();
  await expect(p.getByRole('heading', { level: 1, name: 'Runs', exact: true })).toBeVisible();
  await expect(p.getByRole('dialog')).toHaveCount(0);
  await expect(p.getByText('5 runs. Runs of one instruction are grouped for Compare.')).toBeVisible();
  await expect(p.locator('.hr-group').first().locator('.hr-row')).toHaveCount(2);
});

test('a note stops its timer while the pointer is on it, and starts again when the pointer leaves', async () => {
  test.setTimeout(60_000);
  const p = page();
  await fresh(p, '#sample/runs');
  await p.locator('.hr-row').first().getByRole('button', { name: /^Bring .* window to the front$/ }).click();
  const toast = p.locator('[data-toast]');
  await expect(toast).toContainText('Not in this preview.');
  await toast.hover();
  await p.waitForTimeout(9_000);
  await expect(toast).toBeVisible();
  await p.mouse.move(5, 5);
  await expect(toast).toHaveCount(0, { timeout: 15_000 });
});
