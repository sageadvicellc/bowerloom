/**
 * The map and the sketch board, in the real window, on the sandbox (made by the real tool in a temporary place) and on the sample.
 * Also: the page's policy is not broken by any library, and the screenshots of the map in light and dark.
 */
import { _electron as electron, expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import electronPath from 'electron';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const desktop = join(dirname(fileURLToPath(import.meta.url)), '..');
const shots = join(desktop, 'screenshots');
mkdirSync(shots, { recursive: true });
const nav = (page: Page, label: string) => page.locator('nav.nav').getByRole('button', { name: label });

async function launch(args: string[], extraEnv: Record<string, string> = {}): Promise<{ app: ElectronApplication; page: Page; violations: string[] }> {
  const userData = mkdtempSync(join(tmpdir(), 'bowerloom-viewer-e2e-'));
  const app = await electron.launch({ executablePath: electronPath as unknown as string, args: [desktop, ...args, `--user-data-dir=${userData}`], env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: '1', ...extraEnv } });
  const page = await app.firstWindow();
  const violations: string[] = [];
  page.on('console', m => { if (m.type() === 'error' || /Content Security Policy|Refused to/.test(m.text())) violations.push(m.text()); });
  page.on('pageerror', e => violations.push(`pageerror: ${e.message}`));
  await page.waitForLoadState('domcontentloaded');
  await page.evaluate(() => document.addEventListener('securitypolicyviolation', e => { (window as unknown as { __csp: string[] }).__csp = [...((window as unknown as { __csp?: string[] }).__csp ?? []), `${e.violatedDirective}: ${e.blockedURI}`]; }));
  return { app, page, violations };
}

const sandboxRoot = (): string => {
  const box = join(realpathSync(mkdtempSync(join(tmpdir(), 'bowerloom-e2e-map-'))), 'Map Sandbox');
  const made = spawnSync(process.execPath, [join(desktop, 'tools', 'make-sandbox.mjs')], { encoding: 'utf8', env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', BOWERLOOM_VIEWER_SANDBOX: box } });
  expect(made.status, made.stderr + made.stdout).toBe(0);
  return box;
};
const snap = async (page: Page, name: string, theme: string): Promise<void> => { await page.waitForTimeout(450); await page.screenshot({ path: join(shots, `${name}-${theme}.png`), scale: 'css' }); };
const nodeCount = (page: Page) => page.locator('#bw-page-map .react-flow__node').count();

for (const theme of ['light', 'dark'] as const) {
  test(`the map in ${theme}: nodes, wires, filters, search, the panel, dragging, tidy up, and the saved places`, async () => {
    test.setTimeout(300_000);
    const box = sandboxRoot();
    const { app, page, violations } = await launch(['--sandbox'], { BOWERLOOM_VIEWER_SANDBOX: box });
    try {
      await nav(page, 'Settings').click();
      await page.getByRole('button', { name: theme === 'dark' ? 'Dark' : 'Light', exact: true }).click();
      // The map is first in the navigation after Home.
      const labels = await page.locator('nav.nav button').allInnerTexts(); expect(labels.map(l => l.split('\n')[0])[1]).toBe('Map');
      await nav(page, 'Map').click();
      await expect(page.getByRole('heading', { name: 'Map', exact: true })).toBeVisible();
      await expect(page.locator('main h1')).toBeFocused();
      await expect(page.locator('#bw-page-map .react-flow__node').first()).toBeVisible();
      // The map opens on the overview: this computer and the folders, not what is inside them. Everything is one click away.
      await expect(page.getByRole('button', { name: 'This computer and projects' })).toHaveAttribute('aria-pressed', 'true');
      const overviewCount = await nodeCount(page); expect(overviewCount).toBeGreaterThan(4); expect(overviewCount).toBeLessThan(14);
      await expect(page.locator('#bw-page-map .react-flow__minimap')).toHaveCount(0);
      await snap(page, 'M1-map-overview', theme);
      await page.getByRole('button', { name: 'Everything', exact: true }).click(); await page.waitForTimeout(700);
      expect(await nodeCount(page)).toBeGreaterThan(15);
      // Wires are faint until a thing is pointed at, or all are asked for. The small map and the key are on request, and do not cover anything.
      await expect(page.locator('#bw-page-map .react-flow__edge.is-dim').first()).toBeAttached();
      await page.getByRole('button', { name: 'Small map' }).click(); await expect(page.locator('#bw-page-map .react-flow__minimap')).toBeVisible();
      await page.locator('#bw-page-map summary', { hasText: 'What the wires mean' }).click(); await expect(page.locator('#bw-page-map .bw-legend')).toBeVisible();
      const mini = (await page.locator('#bw-page-map .react-flow__minimap').boundingBox())!, status = (await page.locator('#bw-page-map .bw-overlay').boundingBox())!;
      expect(mini.x).toBeGreaterThanOrEqual(status.x + status.width - 1);
      await snap(page, 'M1b-map-everything', theme);
      await page.getByRole('button', { name: 'Small map' }).click(); await page.getByRole('button', { name: 'Show all wires' }).click(); await expect(page.locator('#bw-page-map .react-flow__edge.is-dim')).toHaveCount(0);
      await snap(page, 'M1c-map-all-wires', theme);
      await page.getByRole('button', { name: 'Show all wires' }).click();

      // Scope: this computer shows only the shared library and the knowledge folders.
      await page.getByRole('button', { name: 'This computer', exact: true }).click(); await page.waitForTimeout(400);
      const labelsGlobal = await page.locator('#bw-page-map .bw-node .bw-node-kind').allInnerTexts(); expect(labelsGlobal.every(l => ['This computer', 'Team', 'Skill', 'Prompt', 'Knowledge folder'].includes(l))).toBe(true);
      await snap(page, 'M2-map-this-computer', theme);
      await page.getByRole('button', { name: 'Everything' }).click();

      // Search keeps what matches and what is next to it, and dims the rest.
      const total = await nodeCount(page);
      await page.getByRole('searchbox', { name: 'Find something on the map' }).fill('site-app');
      await page.waitForTimeout(500); expect(await nodeCount(page)).toBeLessThan(total); await expect(page.locator('#bw-page-map .bw-node', { hasText: 'site-app' }).first()).toBeVisible();
      await page.getByRole('searchbox', { name: 'Find something on the map' }).fill('');

      // Hovering says one plain line; clicking opens the panel with the reasons.
      const site = page.locator('#bw-page-map .react-flow__node', { hasText: 'site-app' }).first();
      await site.hover(); await expect(page.locator('#bw-page-map .bw-status')).toContainText('Project (Drifted)');
      await site.click(); await expect(page.locator('#bw-page-map .bw-panel.open')).toBeVisible(); await expect(page.locator('#bw-page-map .bw-panel h2')).toHaveText('site-app'); await expect(page.locator('#bw-page-map .bw-panel')).toContainText('Why');
      await snap(page, 'M3-map-panel', theme);
      // The panel takes the keyboard when it opens, says so for a screen reader, and Close gives the keyboard back to the thing.
      await expect(page.locator('#bw-page-map .bw-panel h2')).toBeFocused(); await expect(page.locator('p.sr-only[role="status"]')).toContainText('Opened Project site-app');
      await page.getByRole('button', { name: 'Close the details' }).click(); await expect(page.locator('#bw-page-map .bw-panel.open')).toHaveCount(0);
      await expect(site).toBeFocused();

      // Dragging a node moves it, and the place is kept by the viewer (and only there).
      const box0 = (await site.boundingBox())!;
      await page.mouse.move(box0.x + 40, box0.y + 20); await page.mouse.down(); await page.mouse.move(box0.x + 140, box0.y + 100, { steps: 6 }); await page.mouse.up();
      await page.waitForTimeout(700);
      const box1 = (await site.boundingBox())!; expect(Math.abs(box1.x - box0.x) + Math.abs(box1.y - box0.y)).toBeGreaterThan(40);
      const kept = await page.evaluate(async () => (await (window as unknown as { bowerloom: { getSettings(): Promise<{ mapLayout: Record<string, { x: number; y: number }> }> } }).bowerloom.getSettings()).mapLayout);
      expect(Object.keys(kept).some(k => k.includes('site-app'))).toBe(true);

      // Every move can be taken back.
      await page.getByRole('button', { name: 'Undo' }).click(); await page.waitForTimeout(600);
      const box2 = (await site.boundingBox())!; expect(Math.abs(box2.x - box0.x) + Math.abs(box2.y - box0.y)).toBeLessThan(8);
      // Two drags in quick succession are both kept, and so is a move made with the arrow keys.
      const other = page.locator('#bw-page-map .react-flow__node', { hasText: 'archive-app' }).first(), ob0 = (await other.boundingBox())!;
      await page.mouse.move(ob0.x + 40, ob0.y + 20); await page.mouse.down(); await page.mouse.move(ob0.x + 100, ob0.y + 80, { steps: 4 }); await page.mouse.up();
      const sb = (await site.boundingBox())!; await page.mouse.move(sb.x + 40, sb.y + 20); await page.mouse.down(); await page.mouse.move(sb.x + 90, sb.y + 70, { steps: 4 }); await page.mouse.up();
      await page.waitForTimeout(900);
      const both = await page.evaluate(async () => Object.keys((await (window as unknown as { bowerloom: { getSettings(): Promise<{ mapLayout: Record<string, unknown> }> } }).bowerloom.getSettings()).mapLayout));
      expect(both.some(k => k.includes('site-app')) && both.some(k => k.includes('archive-app')), both.join(',')).toBe(true);
      const xBefore = await page.evaluate(async () => (await (window as unknown as { bowerloom: { getSettings(): Promise<{ mapLayout: Record<string, { x: number }> }> } }).bowerloom.getSettings()).mapLayout);
      const key0 = Object.keys(xBefore).find(k => k.includes('site-app'))!;
      // The arrow keys move a chosen thing.
      await site.focus(); await page.keyboard.press('Enter'); await page.keyboard.press('Escape'); await site.focus();
      const boxK = (await site.boundingBox())!;
      await page.keyboard.press('Space'); for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowRight'); await page.waitForTimeout(300);
      const box3 = (await site.boundingBox())!; expect(box3.x).toBeGreaterThan(boxK.x + 4);
      await page.waitForTimeout(700);
      const afterKeys = await page.evaluate(async () => (await (window as unknown as { bowerloom: { getSettings(): Promise<{ mapLayout: Record<string, { x: number }> }> } }).bowerloom.getSettings()).mapLayout);
      const siteKey = Object.keys(afterKeys).find(k => k.includes('site-app'))!; expect(afterKeys[siteKey]!.x, 'a key move is saved like a drag').toBeGreaterThan(xBefore[key0]!.x);
      await page.getByRole('button', { name: 'Undo' }).click(); await page.waitForTimeout(500);
      // Tidy up, fit all, reset layout.
      await page.getByRole('button', { name: 'Tidy up' }).click(); await page.waitForTimeout(700);
      await page.getByRole('button', { name: 'Fit all' }).click(); await page.waitForTimeout(500);
      await page.getByRole('button', { name: 'Reset layout' }).click(); await page.waitForTimeout(700);
      const cleared = await page.evaluate(async () => (await (window as unknown as { bowerloom: { getSettings(): Promise<{ mapLayout: object }> } }).bowerloom.getSettings()).mapLayout);
      expect(Object.keys(cleared)).toHaveLength(0);

      // The text outline is the same map as words.
      await page.getByRole('button', { name: 'Text outline' }).click(); await expect(page.getByRole('region', { name: 'The map as text' })).toContainText('This computer: This computer');
      await snap(page, 'M4-map-outline', theme);
      await page.getByRole('button', { name: 'Text outline' }).click();

      // Keyboard: a node can be reached with Tab, and Enter opens it.
      await page.locator('#bw-page-map .react-flow__node').first().focus(); await page.keyboard.press('Enter'); await expect(page.locator('#bw-page-map .bw-panel.open')).toBeVisible();

      // No library broke the page's policy.
      const csp = await page.evaluate(() => (window as unknown as { __csp?: string[] }).__csp ?? []);
      expect(csp, csp.join('\n')).toEqual([]); expect(violations.filter(v => /Content Security Policy|Refused to/.test(v)), violations.join('\n')).toEqual([]);
    } finally { await app.close(); }
  });
}

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
