/**
 * The adopt and install sheets on a person's own folders (Electron started with --prototype-v3-real, HOME and XDG_STATE_HOME pointed at a made-up folder).
 * The main process runs the packages: the plans are real, nothing is written while the person reads, and the writes land only after each approval, through
 * the packages, in the chosen folder and the private state folder under the made-up home. Undo is a removal plan, and it puts the folder back byte for byte.
 */
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { chmodSync, existsSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { definedFolder, engineFolder, filesOf } from '../tests/helpers-engine/folders.js';
import { launchReal } from './harness-real-page.js';
import type { RealHarness } from './harness-real-page.js';
import { removeTempDirs, tempDir } from './proto-temp.js';
import { shot } from './harness-page.js';

let h: RealHarness, home: string;
const page = (): Page => h.page;

test.beforeAll(async () => {
  test.setTimeout(240_000);
  home = realpathSync(tempDir('bowerloom-engine-home-'));
  chmodSync(home, 0o700);
  h = await launchReal(home, { XDG_STATE_HOME: join(home, '.local', 'state') });
  await page().emulateMedia({ reducedMotion: 'reduce', colorScheme: 'light' });
});
test.afterAll(async () => { try { await h?.app.close(); } finally { removeTempDirs(); } });
test.beforeEach(async () => {
  await page().evaluate(() => { location.hash = '#prototype-v3-real/projects'; location.reload(); });
  await page().waitForLoadState('domcontentloaded');
  await page().waitForSelector('[data-home]');
});

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
  await write.click();
  await expect(p.locator('[data-toast]')).toContainText(/Wrote \d+ files into the \.bowerloom folder\./);
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
  await expect(p.locator('[data-toast]')).toContainText(/Installed\. \d+ files written\./);
  expect(readFileSync(join(dir, 'CLAUDE.md'), 'utf8')).toBe('@AGENTS.md\n');
  expect(existsSync(join(dir, '.codex', 'rules', 'bowerloom.rules'))).toBe(true);
  expect(existsSync(join(home, '.local', 'state', 'bowerloom', 'desktop'))).toBe(true);
  await p.locator('[data-toast]').getByRole('button', { name: 'Undo', exact: true }).click();
  const r = p.getByRole('dialog', { name: 'Remove what Bowerloom wrote' });
  await expect(r.locator('[data-file="CLAUDE.md"]')).toContainText('Puts yours back');
  await r.locator('[data-approve-plan] input').check();
  await r.getByRole('button', { name: /^Remove \d+ files?$/ }).click();
  await expect(p.locator('[data-toast]')).toContainText(/^Removed\./);
  expect(filesOf(dir), 'the folder is as it was').toEqual(before);
});
