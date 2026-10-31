/**
 * The knowledge graph, in the real window, on the sandbox's made-up wiki: the picture loads, filters and search work, a page opens
 * in the panel, the list view is a keyboard-friendly alternative, no network, and no policy violation. Screenshots (sandbox only).
 */
import { _electron as electron, expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import electronPath from 'electron';
import { spawnSync } from 'node:child_process';
import { mkdirSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { removeTempDirs, tempDir } from './proto-temp.js';

// Every folder this file made in the temp folder goes when its tests are done, also when one failed.
test.afterAll(() => { removeTempDirs(); });

const desktop = join(dirname(fileURLToPath(import.meta.url)), '..');
const shots = join(desktop, 'screenshots');
mkdirSync(shots, { recursive: true });
const nav = (page: Page, label: string) => page.locator('nav.nav').getByRole('button', { name: label });

async function launch(extraEnv: Record<string, string>): Promise<{ app: ElectronApplication; page: Page; violations: string[] }> {
  const userData = tempDir('bowerloom-viewer-e2e-');
  const app = await electron.launch({ executablePath: electronPath as unknown as string, args: [desktop, '--sandbox', `--user-data-dir=${userData}`], env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: '1', ...extraEnv } });
  const page = await app.firstWindow();
  const violations: string[] = [];
  page.on('console', m => { if (m.type() === 'error' || /Content Security Policy|Refused to/.test(m.text())) violations.push(m.text()); });
  page.on('pageerror', e => violations.push(`pageerror: ${e.message}`));
  await page.waitForLoadState('domcontentloaded');
  return { app, page, violations };
}
const sandboxRoot = (): string => {
  const box = join(realpathSync(tempDir('bowerloom-e2e-graph-')), 'Graph Sandbox');
  const made = spawnSync(process.execPath, [join(desktop, 'tools', 'make-sandbox.mjs')], { encoding: 'utf8', env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', BOWERLOOM_VIEWER_SANDBOX: box } });
  expect(made.status, made.stderr + made.stdout).toBe(0);
  return box;
};
const snap = async (page: Page, name: string, theme: string): Promise<void> => { await page.waitForTimeout(4200); await page.screenshot({ path: join(shots, `${name}-${theme}.png`), scale: 'css' }); };

for (const theme of ['light', 'dark'] as const) {
  test(`the knowledge graph in ${theme}: loads the wiki, filters, search, the panel, the list view, and no policy violation`, async () => {
    test.setTimeout(300_000);
    const box = sandboxRoot();
    const { app, page, violations } = await launch({ BOWERLOOM_VIEWER_SANDBOX: box });
    try {
      await nav(page, 'Settings').click();
      await page.getByRole('button', { name: theme === 'dark' ? 'Dark' : 'Light', exact: true }).click();
      const labels = await page.locator('nav.nav button').allInnerTexts(); expect(labels.map(l => l.split('\n')[0])[2]).toBe('Knowledge graph');
      await nav(page, 'Knowledge graph').click();
      await expect(page.getByRole('heading', { name: 'Knowledge graph', exact: true })).toBeVisible();
      await expect(page.locator('.kg-status')).toContainText(/\d+ pages, \d+ links, \d+ with no links/, { timeout: 20_000 });
      await expect(page.locator('.kg-canvas canvas').first()).toBeVisible();
      const status = await page.locator('.kg-status').innerText(); const pages = Number(/^(\d+) pages/.exec(status)![1]); expect(pages).toBeGreaterThanOrEqual(40);
      await snap(page, 'G1-knowledge-graph', theme);

      // The list view is the accessible alternative: reachable with the keyboard, and it opens the same panel.
      await page.getByRole('button', { name: 'Show as a list' }).click();
      const first = page.locator('.kg-rows .kg-link').first(); await expect(first).toBeVisible();
      await first.focus(); await page.keyboard.press('Enter');
      await expect(page.locator('.kg-panel h2')).not.toHaveText(/^$/); await expect(page.locator('.kg-panel')).toContainText('Linked from');
      await page.getByRole('button', { name: 'Read this page' }).click();
      await expect(page.locator('.kg-panel pre.file')).toBeVisible();
      await expect(page.locator('details.explain summary', { hasText: 'Bowerloom items that point at this store' })).toBeVisible();
      await page.getByRole('button', { name: 'Show as a picture' }).click();

      // Search narrows the pages; clearing the filters brings them back.
      await page.getByLabel('Search pages').fill('zzzz-nothing');
      await expect(page.locator('.kg-status')).toContainText('Showing 0 of');
      await page.getByRole('button', { name: 'Clear filters' }).click();
      await expect(page.locator('.kg-status')).not.toContainText('Showing');
      // Local graph around the selected page.
      await page.getByRole('button', { name: 'Show as a list' }).click(); await page.locator('.kg-rows .kg-link').first().click();
      await page.getByRole('button', { name: 'Show only nearby pages' }).click();
      await expect(page.locator('.kg-status')).toContainText('Showing');
      await page.getByRole('button', { name: 'Show as a picture' }).click();
      await page.getByRole('button', { name: 'Pause' }).click(); await expect(page.getByRole('button', { name: 'Resume' })).toBeVisible(); await page.getByRole('button', { name: 'Resume' }).click();
      await snap(page, 'G2-knowledge-graph-local', theme);

      // The page's policy was never broken by the library.
      expect(await page.evaluate(() => (window as unknown as { __csp?: string[] }).__csp ?? [])).toEqual([]);
      expect(violations).toEqual([]);
    } finally { await app.close(); }
  });
}
