/**
 * Engines and usage (the bundled extension `engines-usage`, reached at the generic extension address) on the sample launch (--sample): the three sample engines with their config, the line that says the sample has no
 * session logs, the entry in the navigation, and the module inside the Modules view. Usage figures come from session logs, so the sample shows none; the unit tests hold the sums and the gaps
 * (tests/engines-usage-model.test.ts) and the secrets rule (tests/engines-usage-secrets.test.ts).
 */
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { fresh, launchHarness } from './harness-page.js';
import type { Harness } from './harness-page.js';
import { removeTempDirs } from './temp-dirs.js';

let h: Harness;
const page = (): Page => h.page;

test.beforeAll(async () => { test.setTimeout(240_000); h = await launchHarness(); });
test.afterAll(async () => { try { await h.app.close(); } finally { removeTempDirs(); } });
test.beforeEach(async () => { await page().emulateMedia({ reducedMotion: 'reduce', colorScheme: 'light' }); });

test('its own address shows the three sample engines, says that the sample has no session logs, and has its navigation entry', async () => {
  const p = page();
  await fresh(p, '#sample/extension/engines-usage');
  await expect(p.locator('[data-screen="engines-usage"]')).toBeVisible();
  await expect(p.getByRole('heading', { level: 1, name: 'Engines and usage', exact: true })).toBeVisible();
  await expect(p.locator('[data-engine]')).toHaveCount(3);
  await expect(p.locator('[data-engine="claude-code"] [data-fact="status"] dd')).toHaveText('Ready');
  await expect(p.locator('[data-engine="opencode"] [data-fact="status"] dd')).toHaveText('Config file has a problem');
  await expect(p.locator('[data-engines-note]').first()).toBeVisible();
  await expect(p.locator('[data-usage-note]').first()).toContainText('sample');
  await expect(p.locator('[data-group="usage"] [data-fact]')).toHaveCount(0);
  await expect(p.locator('nav [data-nav-key="ext:engines-usage"]')).toBeVisible();
});

test('inside the Modules view it opens as a module, and the view keeps its one level-one heading', async () => {
  const p = page();
  await fresh(p, '#sample/modules');
  await p.getByRole('button', { name: 'Open Engines and usage', exact: true }).click();
  await expect(p).toHaveURL(/#sample\/modules\/engines-usage$/);
  const open = p.locator('[data-module-open="engines-usage"]');
  await expect(open).toBeVisible();
  await expect(open.locator('[data-module-screen="engines-usage"]')).toBeVisible();
  await expect(open.locator('[data-engine]')).toHaveCount(3);
  await expect(p.getByRole('heading', { level: 1 })).toHaveCount(1);
});
