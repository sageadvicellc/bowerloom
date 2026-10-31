/**
 * Journey 4 (spec section 12): "Export and import". Hanna exports a harness, imports it into a second Bowerloom, reads the preview, and reads the list of secrets to add.
 *
 * NOT BUILT in beta.1. The harness-first app has no export and no import: no screen, no button, no call between the window and the main process (the calls are listed in
 * shared/engine/types.ts: folders, adoption, projection, removal, recovery, merge, save, versions, restore, set aside, notes). The old home app had them, and it was removed. What is left of it is
 * the type `ImportPreview` (with `secretsToAdd`) in shared/world/types.ts, which nothing in the app uses. The command line has no 0.8 export or import either: `bowerloom harness` has the verbs
 * status, adopt, install, accept, merge, drift, remove and recover. Its `portable` and `authoring export` commands belong to the 0.7 bundle formats and do not carry a 0.8 harness.
 *
 * So no step runs. Each step is a `test.fixme` with its reason, and one real test records the absence on the screens a person could reach, so the day a control appears the test says so.
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

test('Journey 4: no screen, sheet or drawer of the app offers export or import', async () => {
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
  // The bridge has no call for it either.
  const bridge = await p.evaluate(() => Object.keys((window as unknown as { bowerloomEngine?: Record<string, unknown> }).bowerloomEngine ?? {}));
  expect(bridge.filter(k => SHARING.test(k)), `the calls between the window and main: ${bridge.join(', ')}`).toEqual([]);
});

test.fixme('Journey 4, step 4.1: export a harness (NOT BUILT in beta.1: no export screen, button or call)', () => { /* see the file's header */ });
test.fixme('Journey 4, step 4.2: import it into a second Bowerloom (NOT BUILT in beta.1: no import screen, button or call)', () => { /* see the file's header */ });
test.fixme('Journey 4, step 4.3: read the import preview, every file it will write (NOT BUILT in beta.1)', () => { /* see the file's header */ });
test.fixme('Journey 4, step 4.4: read the list of secrets to add (NOT BUILT in beta.1: tools keep the name of their variable in the harness, but no screen lists the secrets a person must add)', () => { /* see the file's header */ });
