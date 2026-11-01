/**
 * Journey 4 (spec section 12): "Export and import". The person exports a harness, imports it into a second Bowerloom, reads the preview, and reads the list of secrets to add.
 *
 * Task 1 lane D built the two sheets in the window, against the sample bridge: the Builder has an Export button in its header, and the Harnesses list has "Import from a file" in its Folders block.
 * Until Task 1 lane E replaces this file with the real run, one real test records what a person can reach in the real app: both controls are there, the Export button is the only one of its name,
 * and the bridge holds the six share calls. Each step is a `test.fixme` with its reason.
 */
import { expect, test } from '@playwright/test';
import { bundleOnce } from './harness-real-page.js';
import type { RealHarness } from './harness-real-page.js';
import { newMadeUpHome, openInBuilder, startApp } from './journey-support.js';
import { removeTempDirs } from './temp-dirs.js';

let h: RealHarness;
test.beforeAll(() => { test.setTimeout(240_000); bundleOnce(); });
test.afterAll(() => { removeTempDirs(); });
test.afterEach(async () => { await h?.app.close().catch(() => undefined); });

test('Journey 4 (lane D): the Harnesses list offers one "Import from a file", the Builder header offers one "Export", and the bridge holds the six share calls', async () => {
  test.setTimeout(180_000);
  const home = newMadeUpHome();
  h = await startApp(home, 'harnesses');
  const p = h.page;
  // One entry: in the Folders block, or in the empty state of the list when there is no harness yet.
  await expect(p.getByRole('button', { name: 'Import from a file', exact: true })).toHaveCount(1);
  await expect(p.getByRole('button', { name: 'Import from a file', exact: true })).toBeEnabled();
  await openInBuilder(h, home.rope, 'rope-yard');
  await expect(p.getByRole('button', { name: 'Export', exact: true })).toBeVisible();
  await expect(p.getByRole('button', { name: /^Export/ }), 'the header has the only Export button').toHaveCount(1);
  const bridge = await p.evaluate(() => Object.keys((window as unknown as { bowerloomEngine?: Record<string, unknown> }).bowerloomEngine ?? {}));
  expect(['chooseBundle', 'discardBundle', 'planExport', 'planImport', 'runExport', 'runImport'].filter(k => !bridge.includes(k)), `the calls between the window and main: ${bridge.join(', ')}`).toEqual([]);
});

test.fixme('Journey 4, step 4.1: export a harness (NOT BUILT yet: no export screen or button; the calls are stubs)', () => { /* see the file's header */ });
test.fixme('Journey 4, step 4.2: import it into a second Bowerloom (NOT BUILT yet: no import screen or button; the calls are stubs)', () => { /* see the file's header */ });
test.fixme('Journey 4, step 4.3: read the import preview, every file it will write (NOT BUILT yet)', () => { /* see the file's header */ });
test.fixme('Journey 4, step 4.4: read the list of secrets to add (NOT BUILT yet: tools keep the name of their variable in the harness, but no screen lists the secrets a person must add)', () => { /* see the file's header */ });
