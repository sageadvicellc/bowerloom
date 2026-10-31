/**
 * The sketch board, in the real window, on the sample.
 */
import { _electron as electron, expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import electronPath from 'electron';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { removeTempDirs, tempDir } from './temp-dirs.js';

// Every folder this file made in the temp folder goes when its tests are done, also when one failed.
test.afterAll(() => { removeTempDirs(); });

const desktop = join(dirname(fileURLToPath(import.meta.url)), '..');
const shots = join(desktop, 'screenshots');
mkdirSync(shots, { recursive: true });
const nav = (page: Page, label: string) => page.locator('nav.nav').getByRole('button', { name: label });

async function launch(args: string[], extraEnv: Record<string, string> = {}): Promise<{ app: ElectronApplication; page: Page; violations: string[] }> {
  const userData = tempDir('bowerloom-viewer-e2e-');
  const app = await electron.launch({ executablePath: electronPath as unknown as string, args: [desktop, ...args, `--user-data-dir=${userData}`], env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: '1', ...extraEnv } });
  const page = await app.firstWindow();
  const violations: string[] = [];
  page.on('console', m => { if (m.type() === 'error' || /Content Security Policy|Refused to/.test(m.text())) violations.push(m.text()); });
  page.on('pageerror', e => violations.push(`pageerror: ${e.message}`));
  await page.waitForLoadState('domcontentloaded');
  await page.evaluate(() => document.addEventListener('securitypolicyviolation', e => { (window as unknown as { __csp: string[] }).__csp = [...((window as unknown as { __csp?: string[] }).__csp ?? []), `${e.violatedDirective}: ${e.blockedURI}`]; }));
  return { app, page, violations };
}

const snap = async (page: Page, name: string, theme: string): Promise<void> => { await page.waitForTimeout(450); await page.screenshot({ path: join(shots, `${name}-${theme}.png`), scale: 'css' }); };

for (const theme of ['light', 'dark'] as const) {
  test(`the sketch board in ${theme}: drag from the shelf, thread, name, save, open, delete; it cannot be applied`, async () => {
    test.setTimeout(120_000);
    const { app, page } = await launch(['--sample-data']);
    try {
      await nav(page, 'Settings').click(); await page.getByRole('button', { name: theme === 'dark' ? 'Dark' : 'Light', exact: true }).click();
      await nav(page, 'Map').click(); await page.getByRole('tab', { name: 'Sketch' }).click();
      await expect(page.getByText('An empty board. Drag a team from the shelf to begin.')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Apply to a project' })).toBeDisabled(); await expect(page.getByText('Coming when the app can safely write; for now this is a drawing.')).toBeVisible();
      const canvas = page.locator('.bw-board .bw-canvas'), cbox = (await canvas.boundingBox())!;
      const drag = async (label: RegExp, x: number, y: number): Promise<void> => { await page.locator('.bw-shelf-item', { hasText: label }).first().dragTo(canvas, { targetPosition: { x, y } }); };
      await drag(/Research desk/, 150, 60); await drag(/^editor$/, 150, 190); await drag(/House style/, 150, 320); await page.waitForTimeout(400);
      expect(await page.locator('.bw-board .react-flow__node').count()).toBe(3);
      // Thread team -> helper -> skill by dragging from one handle to the next. (Let the drop settle first: the handles are measured after it.)
      await page.waitForTimeout(800);
      const nodes = page.locator('.bw-board .react-flow__node');
      const handle = async (n: number, side: 'source' | 'target') => (await nodes.nth(n).locator(`.react-flow__handle.${side}`).boundingBox())!;
      for (const [a, b] of [[0, 1], [1, 2]] as const) { const from = await handle(a, 'source'), to = await handle(b, 'target'); await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2); await page.mouse.down(); await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 8 }); await page.mouse.up(); }
      await page.waitForTimeout(300);
      expect(await page.locator('.bw-board .react-flow__edge').count()).toBe(2);
      // A thread that is not allowed (skill to team) is refused.
      const sk = await handle(2, 'source'), tm = await handle(0, 'target'); await page.mouse.move(sk.x + 6, sk.y + 6); await page.mouse.down(); await page.mouse.move(tm.x + 6, tm.y + 6, { steps: 8 }); await page.mouse.up(); await page.waitForTimeout(200); expect(await page.locator('.bw-board .react-flow__edge').count()).toBe(2);
      // Switching to the map and back keeps the board. Clearing a board with unsaved changes asks first.
      await page.getByRole('tab', { name: 'Map' }).click(); await page.getByRole('tab', { name: 'Sketch' }).click(); expect(await page.locator('.bw-board .react-flow__node').count()).toBe(3);
      await page.getByRole('button', { name: 'Clear the board' }).click(); await expect(page.getByRole('alertdialog')).toContainText('not saved'); await page.getByRole('button', { name: 'No, keep it' }).click();
      expect(await page.locator('.bw-board .react-flow__node').count()).toBe(3);
      await page.getByRole('textbox', { name: 'Name of the sketch' }).fill(`Harness ${theme}`);
      await page.getByRole('button', { name: 'Save', exact: true }).click(); await expect(page.locator('.bw-board .bw-status')).toContainText(`Saved "Harness ${theme}".`);
      await snap(page, 'K1-sketch', theme);
      await page.getByRole('button', { name: 'Clear the board' }).click(); await expect(page.getByText('An empty board')).toBeVisible();
      await page.getByLabel('Open a saved sketch').selectOption(`Harness ${theme}`); await expect(page.locator('.bw-board .react-flow__node')).toHaveCount(3);
      await page.getByRole('button', { name: 'Delete this sketch' }).click(); await expect(page.getByRole('alertdialog')).toContainText('cannot be undone'); await page.getByRole('button', { name: 'Yes, delete it' }).click(); await expect(page.locator('.bw-board .bw-status')).toContainText('Deleted');
      void cbox;
    } finally { await app.close(); }
  });
}

test('the sketch board: a thread can be made with the keyboard alone, and a refused thread says why', async () => {
  test.setTimeout(120_000);
  const { app, page } = await launch(['--sample-data']);
  try {
    await nav(page, 'Map').click(); await page.getByRole('tab', { name: 'Sketch' }).click();
    for (const label of [/Research desk/, /^editor$/, /House style/]) { const item = page.locator('.bw-shelf-item', { hasText: label }).first(); await item.focus(); await page.keyboard.press('Enter'); }
    await page.waitForTimeout(800);
    const nodes = page.locator('.bw-board .react-flow__node'); expect(await nodes.count()).toBe(3);
    await nodes.nth(0).focus(); await page.keyboard.press('c'); await expect(page.locator('.bw-board .bw-status')).toContainText('Making a thread from');
    await page.keyboard.press('ArrowRight'); await page.keyboard.press('Enter');
    await expect(page.locator('.bw-board .react-flow__edge')).toHaveCount(1); await expect(page.locator('.bw-board .bw-status')).toContainText('owns');
    // A skill has nothing to thread to.
    await nodes.nth(2).focus(); await page.keyboard.press('c'); await expect(page.locator('.bw-board .bw-status')).toContainText('nothing it can be threaded to');
    // Escape cancels a thread that was started.
    await nodes.nth(1).focus(); await page.keyboard.press('c'); await page.keyboard.press('Escape'); await expect(page.locator('.bw-board .bw-status')).toContainText('cancelled');
    await expect(page.locator('.bw-board .react-flow__edge')).toHaveCount(1);
  } finally { await app.close(); }
});
