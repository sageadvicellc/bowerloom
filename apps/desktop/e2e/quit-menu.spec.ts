/**
 * Quit from the application menu (Cmd+Q) on the app on the person's own folders, hidden, on a made-up home. The app starts with `--e2e-hidden` and no stub of the close question, so these
 * runs also prove that a hidden start shows no native box: the boxes are the quiet ones of main/window-options.ts (a test checks that before it quits anything).
 * A click on the menu's `quit` item does nothing on macOS (roles are handled natively), so the test sends the same `terminate:` action the item sends.
 *  - An idle engine: the quit ends the app.
 *  - An unsaved draft: the close question is quieted to "Keep editing", so the app stays.
 *  - A busy engine (a file dialog is open), then Keep editing, then the last window closes: on macOS the app stays alive, and no backstop ends it.
 * Every test ends every process it started.
 */
import { _electron as electron, expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import type { ChildProcess } from 'node:child_process';
import electronPath from 'electron';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { desktop } from './harness-page.js';
import { hiddenArgs } from './hidden.js';
import { removeTempDirs, tempDir } from './temp-dirs.js';

test.skip(process.platform !== 'darwin', 'the menu quit is the macOS terminate: action');

let app: ElectronApplication | null = null;
/** The process of the app, kept at the start: Playwright forgets it once the app has ended. */
let child: ChildProcess | null = null;
let stderr = '';

async function start(): Promise<Page> {
  test.setTimeout(120_000);
  stderr = '';
  const home = tempDir('bowerloom-e2e-quit-home-');
  mkdirSync(join(home, '.claude'), { recursive: true });
  const userData = tempDir('bowerloom-e2e-quit-data-');
  app = await electron.launch({ executablePath: electronPath as unknown as string, args: [desktop, `--user-data-dir=${userData}`, ...hiddenArgs()], env: { PATH: process.env.PATH ?? '', HOME: home, ELECTRON_DISABLE_SECURITY_WARNINGS: '1' } });
  child = app.process();
  child.stderr?.on('data', d => { stderr += String(d); });
  // The hidden start must have quieted every native box before anything can quit or ask.
  const quiet = await app.evaluate(({ dialog }) => [dialog.showMessageBoxSync, dialog.showMessageBox, dialog.showErrorBox, dialog.showOpenDialog].every(f => !String(f).includes('[native code]')));
  expect(quiet, 'every native box is replaced in a hidden start').toBe(true);
  const page = await app.firstWindow();
  await page.waitForSelector('[data-home]');
  return page;
}

const exited = (_a: ElectronApplication): Promise<number | null> => new Promise(resolve => { const p = child!; if (p.exitCode !== null) resolve(p.exitCode); else p.once('exit', code => resolve(code)); });
const alive = (_a: ElectronApplication): boolean => child !== null && child.exitCode === null && child.signalCode === null;
const terminate = (a: ElectronApplication): Promise<void> => a.evaluate(({ Menu }) => {
  const find = (items: Electron.MenuItem[]): Electron.MenuItem | null => { for (const i of items) { if (i.role === 'quit') return i; const inner = i.submenu ? find(i.submenu.items) : null; if (inner !== null) return inner; } return null; };
  if (find(Menu.getApplicationMenu()?.items ?? []) === null) throw new Error('the menu has no Quit item');
  Menu.sendActionToFirstResponder('terminate:');
});
const windows = (a: ElectronApplication): Promise<number> => a.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter(w => !w.isDestroyed()).length);
const draft = (p: Page, on: boolean): Promise<void> => p.evaluate(on => {
  const w = window as unknown as { __hold?: (e: BeforeUnloadEvent) => void };
  if (on) { w.__hold = e => { e.preventDefault(); e.returnValue = ''; }; window.addEventListener('beforeunload', w.__hold); document.title = 'Bowerloom, 2 unsaved changes'; }
  else { if (w.__hold) window.removeEventListener('beforeunload', w.__hold); document.title = 'Bowerloom'; }
}, on);
const wait = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

test.afterEach(async () => {
  // Ends the process this test started, whatever state it is in, and waits for it.
  if (app !== null) {
    const a = app; app = null;
    if (alive(a)) { const done = exited(a); try { child!.kill('SIGKILL'); } catch { /* already gone */ } await done; }
  }
  removeTempDirs();
});

test('an idle engine: Quit from the menu ends the app', async () => {
  await start();
  const done = exited(app!);
  await terminate(app!);
  const code = await Promise.race([done, wait(15_000).then(() => 'timeout' as const)]);
  expect(code, `the app ended (stderr: ${stderr.slice(-400)})`).toBe(0);
});

test('an unsaved draft with the quiet close question: Quit keeps the app and its window, and says why on stderr', async () => {
  const p = await start();
  await draft(p, true);
  await terminate(app!);
  await expect.poll(() => stderr, { timeout: 15_000 }).toContain('a window kept its unsaved changes');
  await wait(1500);
  expect(alive(app!), 'the app is still running').toBe(true);
  expect(await windows(app!)).toBe(1);
  // Without the draft the same Quit ends the app.
  await draft(p, false);
  const done = exited(app!);
  await terminate(app!);
  expect(await Promise.race([done, wait(15_000).then(() => 'timeout' as const)])).toBe(0);
});

test('a busy engine, then Keep editing, then the last window closes: the app stays alive, and no backstop ends it', async () => {
  const p = await start();
  // A file dialog that never answers makes the engine busy (the call is open). It is a stub, so no box shows.
  await app!.evaluate(({ dialog }) => { dialog.showOpenDialog = (() => new Promise(() => undefined)) as unknown as typeof dialog.showOpenDialog; });
  await p.evaluate(() => { void (window as unknown as { bowerloomEngine: { chooseBundle(): Promise<unknown> } }).bowerloomEngine.chooseBundle(); });
  await draft(p, true);
  await terminate(app!);
  await expect.poll(() => stderr, { timeout: 15_000 }).toContain('a window kept its unsaved changes');
  expect(alive(app!)).toBe(true);
  expect(await windows(app!)).toBe(1);
  // The draft is gone and the last window closes. On macOS the app stays, and the backstop (5 s) must not end it.
  await draft(p, false);
  await app!.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0]!.close(); });
  await expect.poll(() => windows(app!)).toBe(0);
  await wait(7000);
  expect(alive(app!), 'the app stays alive after its last window closes').toBe(true);
  expect(stderr).not.toContain('did not reach will-quit');
});
