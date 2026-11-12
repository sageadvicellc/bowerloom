/**
 * Modules (route `modules`, the bundled extension) on the sample launch (--sample): the view lists the stock modules, the open one runs inside it (Local models, drawn from the sample bridge), and the view says what the module
 * can read. The sample launch has no modules bridge, so it keeps no approval and offers no Approve button, and it says so. The real launch (approve, read, remove, with main's own chooser) is held by the unit tests of the bridge
 * and of main (tests/modules-ipc.test.ts, tests/modules-flow.test.ts), because the chooser is a native window. Route-to-spec matrix: extension route modules, sample mode.
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

test('the view lists the stock modules after the list answers, and the navigation has its own entry that is the current page', async () => {
  const p = page();
  await fresh(p, '#sample/modules');
  await expect(p.locator('[data-screen="modules"]')).toBeVisible();
  await expect(p.getByRole('heading', { level: 1, name: 'Modules', exact: true })).toBeVisible();
  await expect(p.locator('[data-modules-hint]')).toContainText('reads only what you pick');
  await expect(p.locator('[data-module]')).toHaveCount(1);
  await expect(p.locator('[data-module="local-models"]')).toContainText('Local models');
  await expect(p.locator('[data-module="modules"]')).toHaveCount(0);
  const item = p.locator('nav [data-nav-key="modules"]');
  await expect(item).toBeVisible();
  await expect(item).toHaveAttribute('aria-current', 'page');
});

test('opening Local models runs it inside the view: the same three sample servers, with what the module can read above them', async () => {
  const p = page();
  await fresh(p, '#sample/modules');
  await p.getByRole('button', { name: 'Open Local models', exact: true }).click();
  await expect(p).toHaveURL(/#sample\/modules\/local-models$/);
  const open = p.locator('[data-module-open="local-models"]');
  await expect(open).toBeVisible();
  await expect(open.locator('[data-module-screen="local-models"]')).toBeVisible();
  await expect(open.locator('[data-model]')).toHaveCount(3);
  await expect(open.locator('[data-model="llama-server:8091"] [data-fact="speed"] dd')).toHaveText('38.4 tokens/s');
  await expect(open.locator('[data-local-sample]')).toContainText('Sample data');
  await expect(open.locator('[data-module-reads]')).toContainText('Folders you approve once for this module.');
  await expect(open.locator('[data-module-reads]')).toContainText('Nothing leaves this computer.');
  await expect(p.getByRole('heading', { level: 1 })).toHaveCount(1);
  await expect(p.getByRole('heading', { level: 1, name: 'Modules', exact: true })).toBeVisible();
  const text = await open.locator('[data-module-reads]').evaluate(node => (node.compareDocumentPosition(document.querySelector('[data-module-screen]')!) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0);
  expect(text).toBe(true);
});

test('the sample launch keeps no approval: it says so and has no Approve button', async () => {
  const p = page();
  await fresh(p, '#sample/modules/local-models');
  await expect(p.locator('[data-module-state="sample"]')).toContainText('Approvals are kept only in the app on your own folders.');
  await expect(p.getByRole('button', { name: 'Approve a folder' })).toHaveCount(0);
  expect(await p.evaluate(() => typeof (window as unknown as { bowerloomModules?: unknown }).bowerloomModules)).toBe('undefined');
});

test('All modules goes back to the list, and an address that names no module says so', async () => {
  const p = page();
  await fresh(p, '#sample/modules/local-models');
  await p.getByRole('button', { name: 'All modules', exact: true }).click();
  await expect(p).toHaveURL(/#sample\/modules$/);
  await expect(p.locator('[data-module-open]')).toHaveCount(0);
  await fresh(p, '#sample/modules/nothing-here');
  await expect(p.locator('[data-modules-state="unknown"]')).toContainText('No module has that name.');
  await expect(p.locator('[data-module]')).toHaveCount(1);
});

test('Local models still has its own page and its own navigation entry, as before', async () => {
  const p = page();
  await fresh(p, '#sample/local-models');
  await expect(p.locator('[data-screen="local-models"]')).toBeVisible();
  await expect(p.getByRole('heading', { level: 1, name: 'Local models', exact: true })).toBeVisible();
  await expect(p.locator('[data-model]')).toHaveCount(3);
  await expect(p.locator('nav [data-nav-key="local-models"]')).toBeVisible();
});
