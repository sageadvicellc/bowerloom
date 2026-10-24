/**
 * Journeys 3 and 4 in a real window. Journey 3: make a bad edit, open the history, compare two versions, restore one.
 * Journey 4: export, "save" the file, open it in the colleague's Bowerloom, read the files and the secrets, and install.
 * The page (e2e/proto-versions-page.ts) holds the real Versions screen and a store with three versions. A second test walks the
 * real prototype from the Setup screen to the Versions screen. Set PROTO_SETUP_SHOTS to a folder to also save screenshots
 * at 1440 by 900 and 900 by 600. Run `npm run bundle` first.
 */
import { _electron as electron, expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import electronPath from 'electron';
import { build } from 'esbuild';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { animationsDone, framesPainted } from './proto-wait.js';
import { EXPORT_PROMISE } from '../shared/proto/export-flow.js';
import { buildBundle } from '../shared/proto/bundle.js';
import { generateWorld } from '../shared/proto/sample.js';
import { removeTempDirs, tempDir } from './proto-temp.js';

const desktop = join(dirname(fileURLToPath(import.meta.url)), '..');
const shotsDir = process.env.PROTO_SETUP_SHOTS ?? null;
if (shotsDir !== null) mkdirSync(shotsDir, { recursive: true });
const SIZES = [[1440, 900], [900, 600]] as const;

let app: ElectronApplication, page: Page, url = '';
type Store = { getState(): { committed: unknown; draft: unknown }; dispatch(a: unknown): void };

test.beforeAll(async () => {
  test.setTimeout(120_000);
  const dir = tempDir('bowerloom-proto-versions-');
  await build({ entryPoints: [join(desktop, 'e2e/proto-versions-page.ts')], outfile: join(dir, 'page.js'), bundle: true, format: 'iife', platform: 'browser', target: 'chrome140', jsx: 'automatic', loader: { '.css': 'css' }, define: { 'process.env.NODE_ENV': '"production"' }, legalComments: 'none', logLevel: 'warning' });
  const css = (file: string): string => `<link rel="stylesheet" href="${pathToFileURL(join(desktop, 'renderer', file)).href}">`;
  writeFileSync(join(dir, 'page.html'), `<!doctype html><html lang="en" data-theme="light"><head><meta charset="utf-8"><title>Versions page</title>${css('tokens.css')}${css('styles.css')}<link rel="stylesheet" href="page.css"></head><body><div class="shell"><aside class="sidebar"><div class="brand">Bowerloom</div><div class="sandbox-badge" role="note">Prototype: nothing is saved</div></aside><main id="main"></main><footer class="footer"><span>Bowerloom prototype</span><span class="spacer"></span><span>Sample data. Nothing is saved.</span></footer></div><script src="page.js"></script></body></html>`);
  url = pathToFileURL(join(dir, 'page.html')).href;
  const userData = tempDir('bowerloom-prototype-e2e-');
  app = await electron.launch({ executablePath: electronPath as unknown as string, args: [desktop, '--prototype', `--user-data-dir=${userData}`], env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: '1' } });
  await app.firstWindow();
});
test.afterAll(async () => { try { await app.close(); } finally { removeTempDirs(); } });

async function openPage(w = 1440, h = 900): Promise<Page> {
  const before = app.windows().length;
  await app.evaluate(({ BrowserWindow }, o) => { const win = new BrowserWindow({ width: o.w, height: o.h, useContentSize: true, show: true, webPreferences: { contextIsolation: true, sandbox: true, partition: `proto-versions-${Date.now()}` } }); void win.loadURL(o.url); }, { url, w, h });
  await expect.poll(() => app.windows().length).toBe(before + 1);
  const p = app.windows()[app.windows().length - 1]!;
  await p.waitForFunction(() => (window as unknown as { __ready?: boolean }).__ready === true, null, { timeout: 30_000 });
  return p;
}
async function resize(p: Page, w: number, h: number): Promise<void> {
  await app.evaluate(({ BrowserWindow }, o) => { const win = BrowserWindow.getAllWindows().find(x => x.webContents.getTitle() === 'Versions page'); win?.setContentSize(o.w, o.h); }, { w, h });
  await expect.poll(() => p.evaluate(() => window.innerWidth)).toBe(w);
  await framesPainted(p); // the resized page has been laid out and drawn once
}
/** Saves the screen at both sizes. `prepare` runs after each resize, so the part to look at is in view at both sizes. */
async function shoot(p: Page, name: string, prepare?: () => Promise<void>): Promise<void> {
  if (shotsDir === null) return;
  for (const [w, h] of [...SIZES].reverse()) { await resize(p, w, h); if (prepare !== undefined) await prepare(); await animationsDone(p); await p.screenshot({ path: join(shotsDir, `${name}-${w}x${h}.png`), scale: 'css' }); }
}
/** Scrolls so that the element is at the top of the scrolling area, for a screenshot. */
const atTop = (l: ReturnType<Page['locator']>): Promise<void> => l.evaluate(el => { el.scrollIntoView({ block: 'start' }); });
const snapshot = (p: Page): Promise<string> => p.evaluate(() => JSON.stringify((window as unknown as { __store: Store }).__store.getState().committed));
const versionHeadings = (p: Page): Promise<string[]> => p.getByRole('heading', { level: 3, name: /^Version \d+$/ }).allInnerTexts();

test('journey 3: a bad edit, the history, a comparison, and a restore that keeps every version', async () => {
  test.setTimeout(120_000);
  const p = await openPage();
  await expect(p.getByRole('heading', { level: 1, name: 'Versions' })).toBeVisible();
  await expect(p.getByRole('tab', { name: 'History' })).toHaveAttribute('aria-selected', 'true');
  expect(await versionHeadings(p)).toEqual(['Version 3', 'Version 2', 'Version 1']);
  await expect(p.locator('.vx-label').first()).toHaveText('Gave the first agent another skill');
  await expect(p.getByText('First version. Nothing came before it.')).toBeVisible();
  await expect(p.getByText('Based on version 2. 1 item changed.')).toBeVisible();
  await expect(p.getByText('Current')).toBeVisible();
  await expect(p.getByText('Unsaved changes', { exact: true })).toHaveCount(0);
  await shoot(p, '05-versions-list');

  // The bad edit, made through the store as the Harness screen would. The draft is now dirty.
  await p.evaluate(() => { const w = window as unknown as { __store: Store; __ids: Record<string, string> }; w.__store.dispatch({ type: 'setOverride', scopeId: 'scope-copperfen', itemId: w.__ids.hiddenSkill, mode: 'hide' }); });
  await expect(p.getByText('Unsaved changes', { exact: true })).toBeVisible();
  await expect(p.getByText('Restoring a version replaces them.')).toBeVisible();
  const before = await snapshot(p);

  // Compare version 1 with version 3.
  await p.getByLabel('Compare this version').selectOption({ label: 'Version 1: First harness: copied a library agent' });
  await p.getByLabel('with this version').selectOption({ label: 'Version 3: Gave the first agent another skill' });
  await p.getByRole('button', { name: 'Compare', exact: true }).click();
  await expect(p.getByRole('heading', { level: 4, name: 'From version 1 to version 3' })).toBeVisible();
  await expect(p.getByText('2 items differ: 1 added, 0 removed, 1 changed.')).toBeVisible();
  await expect(p.getByText(/Tallowbrook hides /)).toBeVisible();
  await expect(p.locator('.vx-diff li').filter({ hasText: 'Added' })).toHaveCount(1);
  await expect(p.locator('.vx-diff li').filter({ hasText: 'Changed' })).toContainText('agent');
  expect(await snapshot(p)).toBe(before);
  await shoot(p, '06-versions-compare', () => atTop(p.locator('.vx-compare h3')));

  // Restore version 1: a NEW version is made, nothing is deleted, and the unsaved edit is gone.
  await p.getByRole('button', { name: /^Restore this version: version 1,/ }).click();
  // The draft is dirty, so the screen asks first, with Cancel focused. Cancel changes nothing.
  await expect(p.getByText(/Your unsaved changes will be dropped, and Undo will be cleared\. Restore version 1 anyway\?/)).toBeVisible();
  await expect(p.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await p.getByRole('button', { name: 'Cancel' }).click();
  await expect(p.getByText('Unsaved changes', { exact: true })).toBeVisible();
  expect(await versionHeadings(p)).toEqual(['Version 3', 'Version 2', 'Version 1']);
  await p.getByRole('button', { name: /^Restore this version: version 1,/ }).click();
  await p.getByRole('button', { name: 'Restore and drop my changes' }).click();
  await expect(p.getByText(/Version 1 was restored as a new version, version 4\. History was kept: all 3 earlier versions are still in the list\. Your unsaved changes were dropped\./)).toBeVisible();
  expect(await versionHeadings(p)).toEqual(['Version 4', 'Version 3', 'Version 2', 'Version 1']);
  await expect(p.locator('.vx-label').first()).toHaveText('Restored: First harness: copied a library agent');
  await expect(p.getByText('Unsaved changes', { exact: true })).toHaveCount(0);
  const counters = await p.evaluate(() => (window as unknown as { __store: { getState(): { committed: { versions: { counter: number; id: string }[] } } } }).__store.getState().committed.versions.map(v => v.counter));
  expect(counters).toEqual([1, 2, 3, 4]);

  // Version 4 is the same as version 1.
  await p.getByLabel('Compare this version').selectOption({ label: 'Version 1: First harness: copied a library agent' });
  await p.getByLabel('with this version').selectOption({ label: 'Version 4: Restored: First harness: copied a library agent' });
  await p.getByRole('button', { name: 'Compare', exact: true }).click();
  await expect(p.getByText('These two versions are the same. Nothing was added, removed, or changed.')).toBeVisible();
});

test('journey 4: export, save a file, open it in the colleague\'s Bowerloom, read the files and secrets, install', async () => {
  test.setTimeout(120_000);
  const p = await openPage();
  await p.getByRole('tab', { name: 'Share' }).click();
  await expect(p.getByRole('heading', { level: 2, name: 'Share' })).toBeVisible();
  await expect(p.getByRole('heading', { level: 3, name: 'Export' })).toBeVisible();
  await expect(p.getByText(EXPORT_PROMISE, { exact: true })).toBeVisible();
  await expect(p.getByText('No secrets and no wiki page text are in this file.')).toHaveCount(0);
  await expect(p.getByText(/Their harness now has 0 skills, 0 agents, 0 tools, and 0 slices\./)).toBeVisible();
  await expect(p.getByRole('button', { name: 'Open an exported file' })).toBeDisabled();
  await expect(p.getByText('Saved as a file (simulated)')).toHaveCount(0);

  // Pick the scopes, read the summary.
  await expect(p.getByRole('checkbox', { name: /^Studio/ })).toBeChecked();
  await p.getByRole('checkbox', { name: /^Reedmarsh/ }).check();
  await p.getByRole('checkbox', { name: /^Reedmarsh/ }).uncheck();
  await expect(p.getByText(/\d+ skills, \d+ agents, \d+ tool references, 3 slice rules\./)).toBeVisible();
  await expect(p.getByText(/Needs a secret: LANTERN_TOKEN, an environment variable\./)).toBeVisible();
  await expect(p.getByText('hook (runs code)').first()).toBeVisible();
  await expect(p.getByRole('heading', { level: 5, name: 'Slice rules' })).toBeVisible();
  await shoot(p, '07-export-summary', () => atTop(p.getByRole('heading', { level: 3, name: 'Export' })));
  const mine = await snapshot(p);

  await p.getByRole('button', { name: 'Save file' }).click();
  await expect(p.getByText('Saved as a file (simulated)')).toBeVisible();
  // Changing the choice makes the saved message go, so it never claims a file that is not the one on screen.
  await p.getByRole('checkbox', { name: /^Copperfen/ }).check();
  await expect(p.getByText('Saved as a file (simulated)')).toHaveCount(0);
  await p.getByRole('checkbox', { name: /^Copperfen/ }).uncheck();

  // The colleague opens the file. Nothing is installed yet, and nothing of mine changed.
  await p.getByRole('button', { name: 'Open an exported file' }).click();
  await expect(p.getByRole('heading', { level: 4, name: 'What opening this file would do' })).toBeVisible();
  await expect(p.getByRole('heading', { level: 5, name: /^Files that would be written \(\d+\)$/ })).toBeVisible();
  const files = await p.locator('.vx-files li').count();
  expect(files).toBeGreaterThan(20);
  await expect(p.locator('.vx-files li').first()).toContainText('/sample/harness/.bowerloom/');
  await expect(p.getByRole('heading', { level: 5, name: 'Secrets you must add (3)' })).toBeVisible();
  await expect(p.locator('.vx-preview').getByText('LANTERN_TOKEN, an environment variable')).toBeVisible();
  await expect(p.locator('.vx-preview').getByText('TIDAL_KEY, a keychain entry')).toBeVisible();
  await expect(p.getByRole('heading', { level: 5, name: 'Clashes (0)' })).toBeVisible();
  // Every file says how big it is, and the grants are listed. The whole Studio file holds its owned skills, so nothing points at nothing.
  await expect(p.locator('.vx-files li').first()).toContainText(/\d+ characters?$/);
  await expect(p.getByRole('heading', { level: 5, name: /^What agents could use after the install \([1-9]\d*\)$/ })).toBeVisible();
  await expect(p.locator('.vx-grants li').first()).toHaveText(/ may use .+: (read only|read and write)\.$/);
  await expect(p.getByRole('heading', { level: 5, name: /^References that point at nothing/ })).toHaveCount(0);
  await expect(p.getByText(/Their harness now has 0 skills/)).toBeVisible();
  await shoot(p, '08-import-preview', () => atTop(p.getByRole('heading', { level: 3, name: "Colleague's Bowerloom" })));

  // The test aids are in a disclosure that starts closed.
  await expect(p.getByRole('button', { name: 'Open a damaged file (to see the error)' })).toBeHidden();
  await expect(p.locator('details.vx-try')).not.toHaveAttribute('open', '');
  await p.getByText('Try it with a file of your own', { exact: true }).click();
  // A damaged file is refused in plain words, in a live region.
  await p.getByRole('button', { name: 'Open a damaged file (to see the error)' }).click();
  await expect(p.getByRole('alert')).toContainText('This file is damaged, or it is not a Bowerloom file. Bowerloom could not read it. Nothing was installed.');
  await expect(p.getByRole('alert')).not.toContainText(/SyntaxError|JSON|undefined/);
  await expect(p.getByRole('button', { name: 'Install' })).toHaveCount(0);

  // Install into the colleague's Bowerloom only.
  await p.getByRole('button', { name: 'Open an exported file' }).click();
  await expect(p.getByRole('alert')).toHaveText('');
  await p.getByRole('button', { name: 'Install', exact: true }).click();
  await expect(p.getByText(/Installed Their harness now has \d+ skills, \d+ agents, \d+ tools, and 3 slices\. Your own harness was not changed\./)).toBeVisible();
  await expect(p.getByRole('heading', { level: 4, name: 'What the install did' })).toBeVisible();
  expect(await snapshot(p)).toBe(mine);

  // Opening the same file again shows every item as a clash.
  await p.getByRole('button', { name: 'Open an exported file' }).click();
  await expect(p.getByRole('heading', { level: 5, name: /^Clashes \([1-9]\d*\)$/ })).toBeVisible();
  await expect(p.getByText(/already there with the same text, so it is not added again\./).first()).toBeVisible();
  await expect(p.getByRole('heading', { level: 5, name: 'Secrets you must add (3)' })).toBeVisible();
  expect(await snapshot(p)).toBe(mine);
});

test('one project scope travels whole, and a file with a missing reference says so before the install', async () => {
  test.setTimeout(120_000);
  const p = await openPage();
  await p.getByRole('tab', { name: 'Share' }).click();
  // Only Reedmarsh: its agents use skills that live elsewhere. Those owned skills travel in the file, so nothing is missing.
  await p.getByRole('checkbox', { name: /^Studio/ }).uncheck();
  await p.getByRole('checkbox', { name: /^Reedmarsh/ }).check();
  await p.getByRole('button', { name: 'Save file' }).click();
  await p.getByRole('button', { name: 'Open an exported file' }).click();
  await expect(p.getByRole('heading', { level: 4, name: 'What opening this file would do' })).toBeVisible();
  await expect(p.getByRole('heading', { level: 5, name: /^What agents could use after the install \([1-9]\d*\)$/ })).toBeVisible();
  await expect(p.getByRole('heading', { level: 5, name: /^References that point at nothing/ })).toHaveCount(0);
  await expect(p.locator('.vx-missing')).toHaveCount(0);

  // A hand-made file: the same bundle with its skills taken out, so each agent points at a skill the file does not hold.
  const bundle = buildBundle(generateWorld(1), ['scope-reedmarsh']);
  const broken = { ...bundle, items: bundle.items.filter(i => i.kind !== 'skill') };
  expect(broken.items.some(i => i.kind === 'agent' && i.definition.skillIds.length > 0), 'the test file has an agent that uses a skill').toBe(true);
  await p.getByText('Try it with a file of your own', { exact: true }).click();
  await p.getByLabel('Or paste the text of a file here').fill(JSON.stringify(broken));
  // The paste box and its button sit together: no blank gap between them.
  const pasteBox = await p.getByLabel('Or paste the text of a file here').boundingBox(), pasteButton = await p.getByRole('button', { name: 'Open pasted text' }).boundingBox();
  expect(pasteButton!.y - (pasteBox!.y + pasteBox!.height), 'the gap between the paste box and its button').toBeLessThan(40);
  await p.getByRole('button', { name: 'Open pasted text' }).click();
  await expect(p.getByRole('heading', { level: 5, name: /^References that point at nothing \([1-9]\d*\)$/ })).toBeVisible();
  await expect(p.locator('.vx-missing li').first()).toContainText('which is neither in this file nor in your setup.');
  await expect(p.locator('.vx-missing li').first()).toContainText(' uses the skill ');
  // Opening a good file again takes the line away.
  await p.getByRole('button', { name: 'Open an exported file' }).click();
  await expect(p.getByRole('heading', { level: 5, name: /^References that point at nothing/ })).toHaveCount(0);
});

test('reduce motion makes the versions token zero, and the list rows stop animating', async () => {
  const p = await openPage();
  const read = (name: string) => p.evaluate(n => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name);
  expect(await read('--motion-versions-ms')).toBe('240ms');
  await p.emulateMedia({ reducedMotion: 'reduce' });
  await expect.poll(() => read('--motion-versions-ms')).toBe('0ms');
  await expect(p.locator('.vx-version').first()).toHaveCSS('animation-name', 'none');
});

test('the real prototype: Setup makes version 1, Versions lists it, and there is nothing yet to compare or restore', async () => {
  test.setTimeout(120_000);
  const userData = tempDir('bowerloom-prototype-e2e-');
  const real = await electron.launch({ executablePath: electronPath as unknown as string, args: [desktop, '--prototype', `--user-data-dir=${userData}`], env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: '1' } });
  try {
    const w = await real.firstWindow();
    await w.getByRole('button', { name: 'Versions' }).click();
    await expect(w.getByText('No versions yet.')).toBeVisible();
    await expect(w.getByText('Applying makes the first one.')).toBeVisible();
    await w.getByRole('button', { name: 'Setup' }).click();
    await w.getByRole('button', { name: 'Choose where your harness lives' }).click();
    await w.getByRole('group', { name: 'Harness root' }).getByRole('radio', { name: '/Users/sample/Studio', exact: true }).check();
    await w.getByRole('group', { name: 'Knowledge root' }).getByRole('radio', { name: '/Users/sample/Studio/knowledge', exact: true }).check();
    await w.getByRole('button', { name: 'Continue to the scan' }).click();
    await w.getByRole('button', { name: 'Look for settings folders' }).click();
    await w.getByRole('button', { name: 'Choose which places to read' }).click();
    await w.getByRole('button', { name: 'Select all' }).click();
    await w.getByRole('button', { name: 'Read the ticked places' }).click();
    await w.getByRole('button', { name: "Keep this copy: OpenCode's copy" }).click();
    await w.getByRole('button', { name: 'Continue', exact: true }).click();
    await w.getByRole('button', { name: 'Bring these in', exact: true }).click();
    await w.getByRole('button', { name: 'Versions' }).click();
    await expect(w.getByRole('heading', { level: 3, name: 'Version 1' })).toBeVisible();
    await expect(w.getByText('Brought in from this computer', { exact: true })).toBeVisible();
    await expect(w.getByText('This is the version you have now.')).toBeVisible();
    await expect(w.getByRole('button', { name: /^Restore this version/ })).toHaveCount(0);
    await expect(w.getByText('Comparing needs two versions. There is one so far.')).toBeVisible();
    await expect(w.getByText('Unsaved changes', { exact: true })).toHaveCount(0);
  } finally { await real.close(); }
});
