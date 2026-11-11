/**
 * Local models (route `local-models`, the bundled extension) on the sample launch (--sample): the screen reads the sample bridge, so it shows three made-up servers (two up, one down), says they are sample data,
 * shows memory and uptime as "not reported", and the navigation gets its entry only after the extension list answers. Route-to-spec matrix: extension route local-models, sample mode.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
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

test('the screen lists the three sample servers with their state, figures and "not reported" for memory and uptime', async () => {
  const p = page();
  await fresh(p, '#sample/local-models');
  await expect(p.locator('[data-screen="local-models"]')).toBeVisible();
  await expect(p.getByRole('heading', { level: 1, name: 'Local models', exact: true })).toBeVisible();
  await expect(p.locator('[data-local-sample]')).toContainText('Sample data');
  const rows = p.locator('[data-model]');
  await expect(rows).toHaveCount(3);
  // Rows are sorted by state, then by name: Example-20B before Example-9B, then the server that is down.
  await expect(rows.nth(0)).toHaveAttribute('data-model', 'llama-server:8092');
  const nine = p.locator('[data-model="llama-server:8091"]');
  await expect(nine).toContainText('Example-9B-Q8_0.gguf');
  await expect(nine).toContainText('Q8_0');
  await expect(nine).toContainText('38.4 tokens per second');
  await expect(nine).toContainText('1 active');
  await expect(nine).toContainText('8091');
  await expect(rows.nth(2)).toHaveAttribute('data-state', 'Down');
  await expect(rows.nth(2)).toContainText('Nothing is listening on this port.');
  for (let i = 0; i < 3; i += 1) {
    await expect(rows.nth(i).locator('[data-fact="memory"] dd')).toHaveText('not reported');
    await expect(rows.nth(i).locator('[data-fact="uptime"] dd')).toHaveText('not reported');
  }
  await expect(p.locator('.hx-count')).toHaveText('2 up, 1 down');
  const dir = test.info().outputDir;
  mkdirSync(dir, { recursive: true });
  await p.setViewportSize({ width: 1280, height: 800 });
  await p.screenshot({ path: join(dir, 'local-models-screen.png') });
});

test('a server that is down shows no figure as 0', async () => {
  const p = page();
  await fresh(p, '#sample/local-models');
  const down = p.locator('[data-model="llama-server:8093"]');
  await expect(down).toBeVisible();
  await expect(down.locator('dd', { hasText: /^0$/ })).toHaveCount(0);
  await expect(down.locator('[data-fact="speed"] dd')).toHaveText('not reported');
});

test('the navigation has a Local models item after the list answers, and it is the current page', async () => {
  const p = page();
  await fresh(p, '#sample/local-models');
  const item = p.locator('nav [data-nav-key="local-models"]');
  await expect(item).toBeVisible();
  await expect(item).toContainText('Local models');
  await expect(item).toHaveAttribute('aria-current', 'page');
  await fresh(p, '#sample/help');
  await expect(p.locator('nav [data-nav-key="local-models"]')).not.toHaveAttribute('aria-current', 'page');
  await p.locator('nav [data-nav-key="local-models"]').click();
  await expect(p.locator('[data-screen="local-models"]')).toBeVisible();
});

test('the Refresh button is reachable by keyboard, the rows are named headings, and the list has a name', async () => {
  const p = page();
  await fresh(p, '#sample/local-models');
  const refresh = p.getByRole('button', { name: 'Refresh', exact: true });
  await refresh.focus();
  await expect(refresh).toBeFocused();
  await p.keyboard.press('Enter');
  await expect(p.locator('[data-model]')).toHaveCount(3);
  await expect(p.getByRole('list', { name: 'Local model servers' })).toBeVisible();
  await expect(p.getByRole('heading', { level: 2, name: 'Example-9B-Q8_0.gguf' })).toBeVisible();
});

test('the screen reads again by itself while the page is visible', async () => {
  const p = page();
  await fresh(p, '#sample/local-models');
  const first = await p.locator('[data-model]').first().getAttribute('data-model');
  await p.waitForTimeout(3500);
  await expect(p.locator('[data-model]')).toHaveCount(3);
  expect(await p.locator('[data-model]').first().getAttribute('data-model')).toBe(first);
});
