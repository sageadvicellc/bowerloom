/**
 * The adopt and install sheets on a person's own folders (Electron started with no flag, HOME and XDG_STATE_HOME pointed at a made-up folder).
 * The main process runs the packages: the plans are real, nothing is written while the person reads, and the writes land only after each approval, through
 * the packages, in the chosen folder and the private state folder under the made-up home. Undo is a removal plan, and it puts the folder back byte for byte.
 * Each test gets its own made-up home, its own state root and its own app: one test's folders, records, approval drafts, window size and answers to main's
 * question never reach the next, so any test passes alone or after the others, in any order.
 */
import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { chmodSync, existsSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { definedFolder, engineFolder, filesOf } from '../tests/helpers-engine/folders.js';
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
  home = realpathSync(tempDir('bowerloom-engine-home-'));
  chmodSync(home, 0o700);
  h = await launchReal(home, { XDG_STATE_HOME: join(home, '.local', 'state') }, false);
  await page().emulateMedia({ reducedMotion: 'reduce', colorScheme: 'light' });
  await page().evaluate(() => { location.hash = '#app/projects'; location.reload(); });
  await page().waitForLoadState('domcontentloaded');
  await page().waitForSelector('[data-home]');
});
test.afterEach(async () => { await h?.app.close(); });

/** Goes from the interfaces step to the weaker rules, waits until the plan shows all of them, and ticks each one. */
async function tickWeakerRules(s: Locator, count: number): Promise<void> {
  await s.getByRole('button', { name: 'Next', exact: true }).click();
  const lines = s.locator('[data-section="approve-lines"] input');
  await expect(lines).toHaveCount(count);
  for (const line of await lines.all()) await line.check();
  await expect(s.locator('[data-section="approve-lines"]')).toContainText(`${count} of ${count} ticked`);
}

test('New harness from a folder writes .bowerloom only after the pick, each acknowledgement and each approval, and leaves the engine files as they were', async () => {
  const p = page(), dir = engineFolder(home), before = filesOf(dir);
  await p.getByRole('button', { name: 'From a folder', exact: true }).click();
  const s = p.getByRole('dialog', { name: 'New harness from a folder' });
  await expect(s.getByText('No folder yet. Choose one to start.')).toBeVisible();
  await h.pick(dir);
  await s.getByRole('button', { name: 'Choose a folder', exact: true }).click();
  const card = s.locator('.hxi-card', { hasText: 'adopt-me' });
  await expect(card).toHaveAttribute('aria-pressed', 'true');
  await expect(card).toContainText('~/Projects/adopt-me');
  await expect(s).not.toContainText(home);
  await s.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(s.getByText(/^Read \d+ files in ~\/Projects\/adopt-me\. Nothing is written yet\.$/)).toBeVisible();
  await expect(s.locator('[data-item="mcp/files"]')).toContainText('.mcp.json#/mcpServers/files');
  await expect(s.locator('[data-unmapped=".claude/settings.json#/permissions/defaultMode"]')).toContainText('Permission modes do not translate between engines');
  await s.locator('[data-conflict="system-prompt/AGENTS.md"]').getByRole('radio', { name: /^AGENTS\.md/ }).click();
  await expect(s.locator('[data-conflict="system-prompt/AGENTS.md"]')).toContainText('Using AGENTS.md.');
  await shot(p, 'R1-real-adopt-review');
  await s.getByRole('button', { name: 'Next', exact: true }).click();
  const approvals = s.locator('[data-section="approvals"] [data-tick]');
  await expect(approvals).toHaveCount(2);
  await expect(approvals.nth(0)).toContainText('A hook runs a command.');
  await expect(approvals.nth(1)).toContainText('An MCP server that uses stdio runs a command.');
  const write = s.getByRole('button', { name: /^Write \d+ files$/ });
  await expect(write).toBeDisabled();
  await s.locator('[data-section="acknowledgements"] input').check();
  await approvals.nth(0).getByRole('checkbox').check();
  await expect(write).toBeDisabled();
  expect(filesOf(dir), 'nothing written while the person reads').toEqual(before);
  await approvals.nth(1).getByRole('checkbox').check();
  await expect(write).toBeEnabled();
  await shot(p, 'R2-real-adopt-confirm');
  // Main asks once more in its own words; a "Cancel" writes nothing and says so.
  await h.confirm(false);
  await write.click();
  await expect(s.getByRole('alert')).toContainText('Nothing was written. The confirmation was closed without a yes.');
  expect(filesOf(dir), 'a no writes nothing').toEqual(before);
  const asked = await h.asked();
  expect(asked.at(-1)!.message).toMatch(/^Write \d+ files into ~\/Projects\/adopt-me\/\.bowerloom\?$/);
  expect(asked.at(-1)!.detail).toMatch(/^From plan [a-f0-9]{8}\./);
  await h.confirm(true);
  await write.click();
  await expect(s.locator('[data-done]')).toContainText('.bowerloom/harness.json');
  expect(existsSync(join(dir, '.bowerloom', 'harness.json'))).toBe(true);
  const after = filesOf(dir);
  for (const [path, hash] of Object.entries(before)) expect(after[path], path).toBe(hash);
  expect(Object.keys(after).filter(f => !(f in before)).every(f => f.startsWith('.bowerloom/'))).toBe(true);
});

test('Install a folder\'s harness: approve the weaker rules, read the plan, approve its revision, write, then Undo through an approved removal', async () => {
  const p = page(), dir = definedFolder(home), before = filesOf(dir);
  await p.getByRole('button', { name: 'Install from a folder', exact: true }).click();
  const s = p.getByRole('dialog', { name: 'Install a folder\'s harness' });
  await h.pick(dir);
  await s.getByRole('button', { name: 'Choose a folder', exact: true }).click();
  await expect(s.locator('.hxi-card', { hasText: 'defined' })).toHaveAttribute('aria-pressed', 'true');
  await s.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(s.getByRole('checkbox')).toHaveCount(2);
  await s.getByRole('button', { name: 'Next', exact: true }).click();
  const lines = s.locator('[data-section="approve-lines"] [data-tick]');
  await expect(lines).toHaveCount(2);
  await expect(lines.nth(0)).toContainText('Codex carries the rule as a forbidden prefix rule');
  for (const line of await lines.all()) await line.getByRole('checkbox').check();
  await s.getByRole('button', { name: 'Plan with these approvals', exact: true }).click();
  await expect(s.locator('[data-section="drift"]').getByRole('radio', { name: /Accept AGENTS\.md/ })).toHaveAttribute('aria-checked', 'true');
  await expect(s.locator('[data-review="code"][data-path=".codex/rules/bowerloom.rules"] pre')).toContainText('decision = "forbidden"');
  await expect(s.locator('[data-engine="codex"] [data-part="mcp"]')).toContainText('Absent');
  await expect(s.locator('[data-section="approved"] li')).toHaveCount(2);
  await expect(s).not.toContainText(home);
  expect(filesOf(dir), 'nothing written while the person reads').toEqual(before);
  await shot(p, 'R3-real-install-plan');
  const write = s.getByRole('button', { name: /^Write \d+ files$/ });
  await expect(write).toBeDisabled();
  await s.locator('[data-approve-plan] input').check();
  await write.click();
  await expect(s.locator('[data-done]')).toContainText('.codex/rules/bowerloom.rules');
  expect(readFileSync(join(dir, 'CLAUDE.md'), 'utf8')).toBe('@AGENTS.md\n');
  expect(existsSync(join(dir, '.codex', 'rules', 'bowerloom.rules'))).toBe(true);
  // The record is in the layout the command line shares (decision 7B): <state root>/<project id>/harness/portable, and no desktop/ folder.
  const root = join(home, '.local', 'state', 'bowerloom');
  expect(existsSync(join(root, 'desktop'))).toBe(false);
  expect(readdirSync(root).filter(id => existsSync(join(root, id, 'harness', 'portable', 'receipt.json')))).toHaveLength(1);
  await s.getByRole('button', { name: 'Undo', exact: true }).click();
  const r = p.getByRole('dialog', { name: 'Remove what Bowerloom wrote' });
  await expect(r.locator('[data-file="CLAUDE.md"]')).toContainText('Puts yours back');
  await r.locator('[data-approve-plan] input').check();
  await r.getByRole('button', { name: /^Remove \d+ files?$/ }).click();
  await expect(r.locator('[data-section="result-Put back"]')).toContainText('CLAUDE.md');
  expect(filesOf(dir), 'the folder is as it was').toEqual(before);
});

test('Merge on a real folder: its own plan, main asks before the harness changes, then the install accepts AGENTS.md', async () => {
  const p = page(), dir = definedFolder(home, 'merge-me');
  const instructions = join(dir, '.bowerloom', 'instructions', 'AGENTS.md'), original = readFileSync(instructions, 'utf8');
  await p.getByRole('button', { name: 'Install from a folder', exact: true }).click();
  const s = p.getByRole('dialog', { name: 'Install a folder\'s harness' });
  await h.pick(dir);
  await s.getByRole('button', { name: 'Choose a folder', exact: true }).click();
  await expect(s.locator('.hxi-card', { hasText: 'merge-me' })).toHaveAttribute('aria-pressed', 'true');
  await s.getByRole('button', { name: 'Next', exact: true }).click();
  await tickWeakerRules(s, 2);
  await s.getByRole('button', { name: 'Plan with these approvals', exact: true }).click();
  await s.locator('[data-section="drift"]').getByRole('radio', { name: /Merge/ }).click();
  const plan = s.locator('[data-section="merge"]');
  await expect(plan.locator('pre')).toHaveText('# Demo for Claude\n\nUse pnpm.\n');
  await expect(plan.locator('[data-file=".bowerloom/instructions/AGENTS.md"]')).toContainText('Update');
  await expect(s).not.toContainText(home);
  await s.locator('[data-approve-plan] input').check();
  await h.confirm(false);
  await s.getByRole('button', { name: 'Merge into the harness', exact: true }).click();
  await expect(s.getByRole('alert')).toContainText('Nothing was written.');
  expect(readFileSync(instructions, 'utf8'), 'a no writes nothing').toBe(original);
  expect((await h.asked()).at(-1)!.message).toBe('Write 1 file into ~/Projects/merge-me/.bowerloom?');
  await h.confirm(true);
  await s.getByRole('button', { name: 'Plan again', exact: true }).click();
  await s.locator('[data-approve-plan] input').check();
  await s.getByRole('button', { name: 'Merge into the harness', exact: true }).click();
  await expect(s.locator('[data-merged]')).toBeVisible();
  expect(readFileSync(instructions, 'utf8')).toContain('## From CLAUDE.md');
  await expect(s.locator('[data-section="drift"]').getByRole('radio', { name: /Accept AGENTS\.md/ })).toHaveAttribute('aria-checked', 'true');
  await shot(p, 'R4-real-merged');
  await s.locator('[data-approve-plan] input').check();
  await s.getByRole('button', { name: /^Write \d+ files$/ }).click();
  await expect(s.locator('[data-done]')).toContainText('CLAUDE.md');
  expect(readFileSync(join(dir, 'CLAUDE.md'), 'utf8')).toBe('@AGENTS.md\n');
  expect(readFileSync(join(dir, 'AGENTS.md'), 'utf8')).toContain('Use pnpm.');
});

test('a mode drift line in the real window: both actions fit 900 by 600, answer the pointer and the keyboard, and Restore mode puts the mode back', async () => {
  const p = page(), dir = definedFolder(home, 'mode-me');
  await p.setViewportSize({ width: 900, height: 600 });
  await p.getByRole('button', { name: 'Install from a folder', exact: true }).click();
  const s = p.getByRole('dialog', { name: 'Install a folder\'s harness' });
  await h.pick(dir);
  await s.getByRole('button', { name: 'Choose a folder', exact: true }).click();
  await expect(s.locator('.hxi-card', { hasText: 'mode-me' })).toHaveAttribute('aria-pressed', 'true');
  await s.getByRole('button', { name: 'Next', exact: true }).click();
  await tickWeakerRules(s, 2);
  await s.getByRole('button', { name: 'Plan with these approvals', exact: true }).click();
  await s.locator('[data-approve-plan] input').check();
  await s.getByRole('button', { name: /^Write \d+ files$/ }).click();
  await expect(s.locator('[data-done]')).toBeVisible();
  const target = join(dir, 'AGENTS.md'), recorded = statSync(target).mode & 0o777;
  chmodSync(target, 0o700);
  // The footer's Close; the sheet's corner has its own.
  await s.getByRole('button', { name: 'Close', exact: true }).last().click();
  await p.getByRole('button', { name: 'Install from a folder', exact: true }).click();
  await s.locator('.hxi-card', { hasText: 'mode-me' }).click();
  await s.getByRole('button', { name: 'Next', exact: true }).click();
  await s.getByRole('button', { name: 'Next', exact: true }).click();
  const note = s.getByRole('alert');
  await expect(note).toContainText('PORTABLE_DRIFT');
  await expect(note.locator('[data-drift-line="AGENTS.md"]')).toContainText('Mode changed since');
  const restore = note.getByRole('button', { name: 'Restore mode: AGENTS.md', exact: true }), keepNew = note.getByRole('button', { name: 'Keep new mode: AGENTS.md', exact: true });
  const sheetBox = (await s.boundingBox())!;
  for (const b of [restore, keepNew]) { const box = (await b.boundingBox())!; expect(box.x + box.width).toBeLessThanOrEqual(sheetBox.x + sheetBox.width); expect(box.height).toBeGreaterThanOrEqual(32); }
  // The pointer changes the button, as on every kit button.
  const look = (): Promise<string> => keepNew.evaluate(el => { const st = getComputedStyle(el); return `${st.backgroundColor}|${st.borderColor}|${st.color}`; });
  const still = await look();
  await keepNew.hover();
  await expect.poll(look).not.toBe(still);
  // The keyboard reaches it, with a ring of 2 px or more.
  await restore.focus();
  await p.keyboard.press('Tab');
  await expect(keepNew).toBeFocused();
  expect(await keepNew.evaluate(el => { const st = getComputedStyle(el); return st.outlineStyle !== 'none' && parseFloat(st.outlineWidth) >= 2; })).toBe(true);
  await shot(p, 'R5-real-mode-line');
  await restore.click();
  const r = p.getByRole('dialog', { name: 'Finish a stopped install' });
  await expect(r.locator('[data-mode="AGENTS.md"]')).toContainText(`Now 0700. Bowerloom wrote 0${recorded.toString(8)}.`);
  await r.locator('[data-approve-plan] input').check();
  await r.getByRole('button', { name: 'Finish', exact: true }).click();
  await expect(r.locator('[data-section="result-Mode put back"]')).toContainText('AGENTS.md');
  expect((await h.asked()).at(-1)!.message).toBe('Restore or keep 1 file mode in ~/Projects/mode-me?');
  expect(statSync(target).mode & 0o777).toBe(recorded);
  await p.setViewportSize({ width: 1280, height: 800 });
});
