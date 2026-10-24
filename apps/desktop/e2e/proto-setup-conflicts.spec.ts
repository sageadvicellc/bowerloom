/**
 * The review step with three conflicts, on a page of its own (e2e/proto-setup-conflicts-page.ts): settling a conflict removes its card, and the
 * keyboard, which was on that card, goes to the next conflict that is still open, and to Continue when none is left.
 */
import { _electron as electron, expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import electronPath from 'electron';
import { build } from 'esbuild';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const desktop = join(dirname(fileURLToPath(import.meta.url)), '..');
let app: ElectronApplication, page: Page;

test.beforeAll(async () => {
  test.setTimeout(120_000);
  const dir = mkdtempSync(join(tmpdir(), 'bowerloom-proto-setup-conflicts-'));
  await build({ entryPoints: [join(desktop, 'e2e/proto-setup-conflicts-page.ts')], outfile: join(dir, 'page.js'), bundle: true, format: 'iife', platform: 'browser', target: 'chrome140', jsx: 'automatic', loader: { '.css': 'css' }, define: { 'process.env.NODE_ENV': '"production"' }, legalComments: 'none', logLevel: 'warning' });
  const css = (file: string): string => `<link rel="stylesheet" href="${pathToFileURL(join(desktop, 'renderer', file)).href}">`;
  writeFileSync(join(dir, 'page.html'), `<!doctype html><html lang="en" data-theme="light"><head><meta charset="utf-8"><title>Setup page</title>${css('tokens.css')}${css('styles.css')}<link rel="stylesheet" href="page.css"></head><body><div class="shell"><aside class="sidebar"><div class="brand">Bowerloom</div></aside><main id="main"></main><footer class="footer"><span>Bowerloom prototype</span></footer></div><script src="page.js"></script></body></html>`);
  const userData = mkdtempSync(join(tmpdir(), 'bowerloom-proto-setup-conflicts-ud-'));
  app = await electron.launch({ executablePath: electronPath as unknown as string, args: [desktop, '--prototype', `--user-data-dir=${userData}`], env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: '1' } });
  await app.firstWindow();
  await app.evaluate(({ BrowserWindow }, url) => { const win = new BrowserWindow({ width: 1440, height: 900, useContentSize: true, show: true, webPreferences: { contextIsolation: true, sandbox: true, partition: `proto-setup-conflicts-${Date.now()}` } }); void win.loadURL(url); }, pathToFileURL(join(dir, 'page.html')).href);
  await expect.poll(() => app.windows().length).toBe(2);
  page = app.windows()[1]!;
  await page.waitForFunction(() => (window as unknown as { __ready?: boolean }).__ready === true, null, { timeout: 30_000 });
});
test.afterAll(async () => { await app.close(); });

const heading = (name: string) => page.getByRole('heading', { level: 4, name: new RegExp(`^${name} `) });
const focusedHeadingText = (): Promise<string> => page.evaluate(() => (document.activeElement?.tagName === 'H4' ? document.activeElement.textContent ?? '' : `not a conflict heading: ${document.activeElement?.tagName}`));

test('settling a conflict sends the keyboard to the next open conflict, then to Continue', async () => {
  test.setTimeout(120_000);
  await page.getByRole('button', { name: 'Choose where your harness lives' }).click();
  await page.getByRole('group', { name: 'Harness root' }).getByRole('radio', { name: '/Users/sample/Studio', exact: true }).check();
  await page.getByRole('group', { name: 'Knowledge root' }).getByRole('radio', { name: '/Users/sample/Studio/knowledge', exact: true }).check();
  await page.getByRole('button', { name: 'Continue to the scan' }).click();
  await page.getByRole('button', { name: 'Look for settings folders' }).click();
  await page.getByRole('button', { name: 'Choose which places to read' }).click();
  await page.getByRole('button', { name: 'Select all' }).click();
  await page.getByRole('button', { name: 'Read the ticked places' }).click();
  const cards = page.locator('article.sx-conflict');
  await expect(cards).toHaveCount(3);
  const names = await cards.locator('h4').evaluateAll(list => list.map(h => (h.childNodes[0]?.textContent ?? '').trim()));
  await expect(page.getByText('Settle 3 items above to go on.')).toBeVisible();

  // Settle the first with the keyboard: the second card gets the keyboard.
  const settle = async (n: number): Promise<void> => {
    await cards.nth(0).getByRole('button', { name: /^Choose a version of / }).focus();
    await page.keyboard.press('Enter');
    await cards.nth(0).getByRole('button', { name: /^Keep the .* version$/ }).first().focus();
    await page.keyboard.press('Enter');
    await expect(cards).toHaveCount(n);
  };
  await settle(2);
  await expect.poll(focusedHeadingText).toContain(names[1]!);
  await settle(1);
  await expect.poll(focusedHeadingText).toContain(names[2]!);
  await settle(0);
  await expect(page.getByRole('button', { name: 'Continue', exact: true })).toBeFocused();
  await expect(heading(names[0]!)).toHaveCount(0);
});
