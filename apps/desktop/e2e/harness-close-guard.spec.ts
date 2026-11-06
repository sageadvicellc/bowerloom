/**
 * The close guard (owner decision Q1A) in the real window on the sample launch: with unsaved Builder changes, closing the window, Quit from the application menu (Cmd+Q) and a reload ask "Discard N changes?" in main's own native box. Keep editing keeps the window, and the quit stops. Discard lets the window close, and the quit go on.
 * With no change, nothing asks. The native box is stubbed in the main process (e2e/hidden.ts `answerCloseQuestion`): a test answers it, and reads what it was asked.
 * Each test starts its own app, because a closed window cannot be opened again from the page.
 */
import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { answerCloseQuestion, closeAsks } from './hidden.js';
import { fresh, launchHarness } from './harness-page.js';
import type { Harness } from './harness-page.js';
import { removeTempDirs } from './temp-dirs.js';

const BUILDER = '#sample/builder/sample-weekly-report';
const count = (p: Page): Locator => p.locator('[data-draft]');
const tick = (p: Page, agent: string, skill: string): Locator => p.locator(`[data-agent="${agent}"]`).getByRole('checkbox', { name: `${skill}: ${agent}` });

let h: Harness | null = null;
test.afterEach(async () => {
  // A last answer of Discard, so that ending the run never waits on a box.
  if (h !== null) { try { await answerCloseQuestion(h.app, 1); await h.app.close(); } catch { /* the app is already gone */ } }
  h = null;
  removeTempDirs();
});

async function start(answer: 0 | 1): Promise<Harness> {
  test.setTimeout(180_000);
  h = await launchHarness();
  await answerCloseQuestion(h.app, answer);
  return h;
}

/** Opens the weekly-report folder in the Builder and makes one change: a tick on an agent. */
async function change(p: Page): Promise<void> {
  await fresh(p, BUILDER);
  await expect(count(p)).toContainText('No change yet.');
  await tick(p, 'writer', 'check-facts').check();
  await expect(count(p)).toContainText('1 change, not saved yet.');
}

const windows = (h: Harness): Promise<number> => h.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter(w => !w.isDestroyed()).length);
const closeWindow = (h: Harness): Promise<void> => h.app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0]!.close(); });
/**
 * Chooses Quit from the application menu, which is what Cmd+Q does. On macOS the menu's Quit item (role `quit`) is a native item: its action is the system's `terminate:`, sent to the
 * application, and Electron answers it by closing every window through its unload (as `app.quit()` does). A JS `click` on the item does nothing on macOS (roles are handled natively), and a key press
 * through `webContents.sendInputEvent` goes to the page, not the menu. So this checks that the item exists with its accelerator, then sends the same `terminate:` action the item sends.
 */
const chooseQuit = (h: Harness): Promise<{ found: boolean; accelerator: string }> => h.app.evaluate(({ Menu }) => {
  const find = (items: Electron.MenuItem[]): Electron.MenuItem | null => { for (const i of items) { if (i.role === 'quit') return i; const inner = i.submenu ? find(i.submenu.items) : null; if (inner !== null) return inner; } return null; };
  const item = find(Menu.getApplicationMenu()?.items ?? []);
  if (item === null) return { found: false, accelerator: '' };
  Menu.sendActionToFirstResponder('terminate:');
  return { found: true, accelerator: String(item.accelerator ?? '') };
});
const settle = (ms = 700): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

test('the page title carries the count for main, and the window title bar keeps the name', async () => {
  const x = await start(0);
  await change(x.page);
  await expect.poll(() => x.page.title()).toBe('Bowerloom, 1 unsaved change');
  expect(await x.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.getTitle())).not.toMatch(/unsaved/);
  await tick(x.page, 'writer', 'check-facts').uncheck();
  await expect(count(x.page)).toContainText('No change yet.');
  await expect.poll(() => x.page.title()).toBe('Bowerloom');
});

test('closing the window with a change asks "Discard 1 change?": Keep editing keeps the window and the change', async () => {
  const x = await start(0);
  await change(x.page);
  await closeWindow(x);
  await expect.poll(async () => (await closeAsks(x.app)).length).toBe(1);
  const [ask] = await closeAsks(x.app);
  expect(ask).toEqual({ title: 'Discard 1 change?', detail: 'Your changes are not saved. If you go on, they are lost.', buttons: ['Keep editing', 'Discard'], defaultId: 0, cancelId: 0 });
  await settle();
  expect(await windows(x)).toBe(1);
  await expect(count(x.page)).toContainText('1 change, not saved yet.');
  await expect(tick(x.page, 'writer', 'check-facts')).toBeChecked();
});

test('closing the window with a change: Discard closes it', async () => {
  const x = await start(1);
  await change(x.page);
  await closeWindow(x);
  await expect.poll(() => windows(x)).toBe(0);
  const asks = await closeAsks(x.app);
  expect(asks.map(a => a.title)).toEqual(['Discard 1 change?']);
});

test('with no change, the window closes and no box appears', async () => {
  const x = await start(0);
  await fresh(x.page, BUILDER);
  await expect(count(x.page)).toContainText('No change yet.');
  await closeWindow(x);
  await expect.poll(() => windows(x)).toBe(0);
  expect(await closeAsks(x.app)).toEqual([]);
});

test('a change that was undone asks nothing when the window closes', async () => {
  const x = await start(0);
  await change(x.page);
  await x.page.locator('[data-builder-undo]').click();
  await expect(count(x.page)).toContainText('No change yet.');
  await closeWindow(x);
  await expect.poll(() => windows(x)).toBe(0);
  expect(await closeAsks(x.app)).toEqual([]);
});

test('a window that stayed after Keep editing asks again at the next close, and Discard closes it', async () => {
  // This build's Window menu has no Close item, so Cmd+W is not bound; the close button and `window.close()` are the paths (see the manual check in apps/desktop/README.md).
  const x = await start(0);
  await change(x.page);
  await closeWindow(x);
  await expect.poll(async () => (await closeAsks(x.app)).length).toBe(1);
  await settle();
  expect(await windows(x)).toBe(1);
  await answerCloseQuestion(x.app, 1);
  await closeWindow(x);
  await expect.poll(() => windows(x)).toBe(0);
  expect((await closeAsks(x.app)).map(a => a.title)).toEqual(['Discard 1 change?']);
});

test('a reload with a change asks: Keep editing keeps the page and the change, Discard reloads it and the change goes', async () => {
  const x = await start(0);
  await change(x.page);
  await x.page.evaluate(() => { location.reload(); });
  await expect.poll(async () => (await closeAsks(x.app)).length).toBe(1);
  await settle();
  // The page was not reloaded: its change is still on screen. (Read through main, because the cancelled reload leaves the test driver waiting for a navigation.)
  expect(await x.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.webContents.executeJavaScript('document.querySelector("[data-draft]")?.textContent ?? ""'))).toContain('1 change, not saved yet.');
  await answerCloseQuestion(x.app, 1);
  await x.page.evaluate(() => { location.reload(); });
  await expect.poll(async () => (await closeAsks(x.app)).length).toBe(1);
  await x.page.waitForSelector('[data-home]');
  await expect(count(x.page)).toContainText('No change yet.');
});

test('Quit from the application menu (Cmd+Q) with a change asks, and no quit happens while the window refuses to close', async () => {
  const x = await start(0);
  await change(x.page);
  let closed = false;
  x.app.on('close', () => { closed = true; });
  expect(await chooseQuit(x)).toEqual({ found: true, accelerator: 'CommandOrControl+Q' });
  await expect.poll(async () => (await closeAsks(x.app)).length).toBe(1);
  await settle(1000);
  expect(closed).toBe(false);
  expect(await windows(x)).toBe(1);
  await expect(count(x.page)).toContainText('1 change, not saved yet.');
  // The app is still alive, and a second Cmd+Q asks again. Discard ends it.
  await answerCloseQuestion(x.app, 1);
  const gone = x.app.waitForEvent('close');
  await chooseQuit(x);
  await gone;
  expect(closed).toBe(true);
});

test('Quit from the application menu (Cmd+Q) with no change quits at once and asks nothing', async () => {
  const x = await start(0);
  await fresh(x.page, BUILDER);
  await expect(count(x.page)).toContainText('No change yet.');
  // The stub answers Keep editing: if main asked, the window would stay and the quit would not happen.
  const gone = x.app.waitForEvent('close');
  await chooseQuit(x);
  await gone;
});
