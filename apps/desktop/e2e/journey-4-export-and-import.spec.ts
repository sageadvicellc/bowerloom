/**
 * Journey 4 (spec section 12): "Export and import". The person exports a harness, imports it into a second Bowerloom, reads the preview, and reads the list of secrets to add.
 *
 * STAGE 1 of Task 1: the calls between the window and the main process are in the contract (shared/engine/types.ts: planExport, runExport, chooseBundle, planImport, runImport, discardBundle)
 * and packages/harness-bundle holds the format, but nothing behind them is built, and no screen offers them. Task 1 lane E replaces this file with the real run.
 *
 * Until then, one real test records what a person can reach: no control for export or import on any screen, sheet or drawer, and the bridge holds exactly the six share calls. Each step is a
 * `test.fixme` with its reason.
 */
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { bundleOnce } from './harness-real-page.js';
import type { RealHarness } from './harness-real-page.js';
import { adoptSheet, installSheet, newMadeUpHome, openInBuilder, saveSheet, startApp } from './journey-support.js';
import { removeTempDirs } from './temp-dirs.js';

let h: RealHarness;
test.beforeAll(() => { test.setTimeout(240_000); bundleOnce(); });
test.afterAll(() => { removeTempDirs(); });
test.afterEach(async () => { await h?.app.close().catch(() => undefined); });

const SHARING = /\bexport|\bimport\b|\bshare\b|secrets? to add/i;

/** The names of every button, link and menu item the page shows now. */
async function controls(p: Page): Promise<string[]> {
  return p.evaluate(() => [...document.querySelectorAll('button, a[href], [role="button"], [role="menuitem"], [role="tab"]')]
    .filter(e => e.getClientRects().length > 0)
    .map(e => (e.getAttribute('aria-label') ?? e.textContent ?? '').trim()).filter(t => t !== ''));
}

test('Journey 4 (stage 1): no screen, sheet or drawer of the app offers export or import yet, and the bridge holds the six share calls', async () => {
  test.setTimeout(180_000);
  const home = newMadeUpHome();
  h = await startApp(home, 'harnesses');
  const p = h.page;
  const seen = new Map<string, string[]>();
  const look = async (where: string): Promise<void> => { seen.set(where, [...await controls(p), ...(await p.locator('body').innerText()).split('\n').filter(l => SHARING.test(l))]); };

  for (const route of ['harnesses', 'projects', 'library/skill', 'library/agent', 'library/tool', 'library/context', 'runs', 'interfaces', 'history', 'help']) {
    await p.evaluate(r => { location.hash = `#app/${r}`; }, route);
    await expect(p.locator('[data-home]')).toBeVisible();
    await look(route);
  }
  // The folder list, the Builder, its save points, and the three sheets of the Projects screen.
  await p.evaluate(() => { location.hash = '#app/harnesses'; });
  await openInBuilder(h, home.rope, 'rope-yard');
  await look('builder');
  await p.getByRole('button', { name: 'Save points', exact: true }).click();
  await look('save points');
  await p.keyboard.press('Escape');
  await p.evaluate(() => { location.hash = '#app/projects'; });
  await p.getByRole('button', { name: 'Edit from a folder', exact: true }).click();
  await look('edit sheet');
  await saveSheet(p).getByRole('button', { name: 'Close', exact: true }).last().click();
  await p.getByRole('button', { name: 'Install from a folder', exact: true }).click();
  await look('install sheet');
  await installSheet(p).getByRole('button', { name: 'Close', exact: true }).last().click();
  await p.getByRole('button', { name: 'From a folder', exact: true }).click();
  await look('adopt sheet');
  await adoptSheet(p).getByRole('button', { name: 'Close', exact: true }).last().click();

  const found = [...seen].flatMap(([where, names]) => names.filter(n => SHARING.test(n)).map(n => `${where}: ${n}`));
  expect(found, 'a control for export or import exists now: write the real Journey 4 test').toEqual([]);
  expect(seen.size).toBeGreaterThanOrEqual(15);
  // The contract is in place: the bridge has the six share calls, and main answers each one with a failure until lane C builds it.
  const bridge = await p.evaluate(() => Object.keys((window as unknown as { bowerloomEngine?: Record<string, unknown> }).bowerloomEngine ?? {}));
  expect(['chooseBundle', 'discardBundle', 'planExport', 'planImport', 'runExport', 'runImport'].filter(k => !bridge.includes(k)), `the calls between the window and main: ${bridge.join(', ')}`).toEqual([]);
});

test.fixme('Journey 4, step 4.1: export a harness (NOT BUILT yet: no export screen or button; the calls are stubs)', () => { /* see the file's header */ });
test.fixme('Journey 4, step 4.2: import it into a second Bowerloom (NOT BUILT yet: no import screen or button; the calls are stubs)', () => { /* see the file's header */ });
test.fixme('Journey 4, step 4.3: read the import preview, every file it will write (NOT BUILT yet)', () => { /* see the file's header */ });
test.fixme('Journey 4, step 4.4: read the list of secrets to add (NOT BUILT yet: tools keep the name of their variable in the harness, but no screen lists the secrets a person must add)', () => { /* see the file's header */ });
