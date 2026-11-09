/**
 * Interfaces (route `interfaces`, with the optional id) on the sample launch (--sample), as it behaves at the base: three engines with their health and a switch; picking a row fills the details column;
 * an engine that was not found has its switch off and disabled; the switch writes a history entry. Route-to-spec matrix row: interfaces, sample mode.
 */
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { removeTempDirs } from './temp-dirs.js';
import { fresh, launchHarness } from './harness-page.js';
import type { Harness } from './harness-page.js';

let h: Harness;
const page = (): Page => h.page;

test.beforeAll(async () => { test.setTimeout(240_000); h = await launchHarness(); });
test.afterAll(async () => { try { await h.app.close(); } finally { removeTempDirs(); } });
test.beforeEach(async () => { await page().emulateMedia({ reducedMotion: 'reduce', colorScheme: 'light' }); });

test('Interfaces lists the three sample engines with their health, and the hint says how many', async () => {
  const p = page();
  await fresh(p, '#sample/interfaces');
  await expect(p.locator('[data-screen="interfaces"]')).toBeVisible();
  await expect(p.getByRole('heading', { level: 1, name: 'Engines', exact: true })).toBeVisible();
  await expect(p.getByText('3 engines. Bowerloom installs only for the ones that are switched on.')).toBeVisible();
  const rows = p.locator('[data-interface]');
  await expect(rows).toHaveCount(3);
  await expect(p.locator('[data-interface="claude-code"]')).toContainText('Ready');
  await expect(p.locator('[data-interface="codex"]')).toContainText('Ready');
  await expect(p.locator('[data-interface="opencode"]')).toContainText('Config file has a problem');
  await expect(p.locator('[data-interface="claude-code"]').getByRole('switch')).toHaveAttribute('aria-checked', 'true');
  await expect(p.locator('[data-interface="opencode"]').getByRole('switch')).toHaveAttribute('aria-checked', 'false');
});

test('the first engine is picked without an id, and the id in the address picks another; the details column names what it writes and what it cannot use', async () => {
  const p = page();
  await fresh(p, '#sample/interfaces');
  const panel = p.getByRole('complementary');
  await expect(panel.getByRole('heading', { level: 2, name: 'Claude Code' })).toBeVisible();
  await expect(panel).toContainText('.claude/agents/<name>.md');
  await expect(panel).toContainText('Nothing. It uses every kind of part.');
  await fresh(p, '#sample/interfaces/codex');
  await expect(p.locator('[data-interface="codex"]')).toHaveAttribute('data-selected', '');
  await expect(p.getByRole('complementary').getByRole('heading', { level: 2, name: 'Codex' })).toBeVisible();
  await expect(p.getByRole('complementary')).toContainText('.codex/agents/<name>.toml');
  await p.locator('[data-interface="opencode"]').getByRole('button', { name: 'OpenCode', exact: true }).click();
  await expect(p).toHaveURL(/#sample\/interfaces\/opencode$/);
  await expect(p.getByRole('complementary').getByRole('heading', { level: 2, name: 'OpenCode' })).toBeVisible();
});

test('"Look again" says nothing changed', async () => {
  const p = page();
  await fresh(p, '#sample/interfaces');
  await p.getByRole('complementary').getByRole('button', { name: 'Look again', exact: true }).click();
  await expect(p.getByRole('complementary').getByRole('status')).toHaveText('Looked again. Nothing changed.');
});

test('the switch of an engine changes it and adds an undoable entry to Install history', async () => {
  const p = page();
  await fresh(p, '#sample/interfaces');
  const codex = p.locator('[data-interface="codex"]').getByRole('switch', { name: 'Use Codex' });
  await expect(codex).toHaveAttribute('aria-checked', 'true');
  await codex.click();
  await expect(codex).toHaveAttribute('aria-checked', 'false');
  await p.getByRole('navigation').getByText('Install history', { exact: true }).click();
  await expect(p.locator('[data-history]').first()).toContainText('Codex');
});
