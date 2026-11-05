/**
 * Beta.1, demo mode (Electron started with --sample, no extra argument): the install sheet locks OpenCode like the real app does. OpenCode, with Pi and
 * DeepSeek Harness where a harness lists them, shows a Preview tag, unticked and disabled, and the sheet goes on with Claude Code and Codex.
 */
import { expect, test } from '@playwright/test';
import { removeTempDirs } from './temp-dirs.js';
import { fresh, launchHarness } from './harness-page.js';
import type { Harness } from './harness-page.js';

let h: Harness;
test.beforeAll(async () => { test.setTimeout(240_000); h = await launchHarness(); });
test.afterAll(async () => { try { await h.app.close(); } finally { removeTempDirs(); } });
test.beforeEach(async () => { await h.page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'light' }); await fresh(h.page, '#sample/projects'); });

test('the default demo launch carries no switch, and the install sheet shows OpenCode locked', async () => {
  const p = h.page;
  expect(await p.evaluate(() => document.body.hasAttribute('data-sample-preview-engines'))).toBe(false);
  await p.getByRole('button', { name: 'Install from a folder', exact: true }).click();
  const s = p.getByRole('dialog', { name: 'Install a folder\'s harness' });
  await expect(s.locator('[data-folder="sample-weekly-report"]')).toContainText('OpenCode (preview)');
  await s.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(s.getByRole('checkbox')).toHaveCount(3);
  await expect(s.locator('[data-engine="claude-code"] input')).toBeChecked();
  await expect(s.locator('[data-engine="codex"] input')).toBeChecked();
  const card = s.locator('[data-engine="opencode"]');
  await expect(card.locator('input')).not.toBeChecked();
  await expect(card.locator('input')).toBeDisabled();
  await expect(card.locator('[data-slot="preview-note"]')).toContainText('Preview');
  await expect(card.locator('[data-slot="preview-why"]')).toContainText('BOWERLOOM_PREVIEW_ENGINES=1');
  await s.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(s.locator('[data-section="approve-lines"]')).toBeVisible();
});
