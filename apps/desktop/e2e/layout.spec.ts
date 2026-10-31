/**
 * The map fills exactly the window that is left, at three window sizes, and after the first fit every node is inside the picture.
 * Checked on the sandbox map (the real app) and on the made-up map of 200 things (the same screen in a plain frame).
 */
import { _electron as electron, expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import electronPath from 'electron';
import { spawnSync } from 'node:child_process';
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { removeTempDirs, tempDir } from './proto-temp.js';

// Every folder this file made in the temp folder goes when its tests are done, also when one failed.
test.afterAll(() => { removeTempDirs(); });

const desktop = join(dirname(fileURLToPath(import.meta.url)), '..');
const shots = join(desktop, 'screenshots');
mkdirSync(shots, { recursive: true });
const SIZES = [[900, 600], [1100, 760], [1440, 900]] as const;

const sandboxRoot = (): string => {
  const box = join(realpathSync(tempDir('bowerloom-e2e-layout-')), 'Layout Sandbox');
  const made = spawnSync(process.execPath, [join(desktop, 'tools', 'make-sandbox.mjs')], { encoding: 'utf8', env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', BOWERLOOM_VIEWER_SANDBOX: box } });
  expect(made.status, made.stderr + made.stdout).toBe(0);
  return box;
};
let box: string | null = null;

/** What must hold on the map screen: every node inside the picture, and nothing below the bottom of the window. */
async function assertFits(page: Page, label: string): Promise<void> {
  await page.waitForTimeout(1800);
  const r = await page.evaluate(() => {
    const c = document.querySelector('#bw-page-map .bw-canvas')!.getBoundingClientRect(), outside: string[] = [];
    for (const n of document.querySelectorAll('#bw-page-map .react-flow__node')) { const b = n.getBoundingClientRect(); if (b.left < c.left - 2 || b.right > c.right + 2 || b.top < c.top - 2 || b.bottom > c.bottom + 2) outside.push(`${(n.textContent ?? '').slice(0, 30)} [${Math.round(b.left)},${Math.round(b.top)},${Math.round(b.right)},${Math.round(b.bottom)}]`); }
    const low: string[] = [];
    for (const sel of ['.shell', 'main', '#bw-page-map .bw-canvas', '#bw-page-map .bw-toolbar', '#bw-page-map .bw-overlay', '#bw-page-map .react-flow__controls', '.footer', '#bw-page-map .bw-wrap', '#bw-page-map .bw-stage']) { const e = document.querySelector(sel); if (e !== null && e.getBoundingClientRect().bottom > window.innerHeight + 1) low.push(`${sel} bottom ${Math.round(e.getBoundingClientRect().bottom)}`); }
    const main = document.querySelector('main')!;
    return { outside, low, nodes: document.querySelectorAll('#bw-page-map .react-flow__node').length, pageScroll: document.documentElement.scrollHeight - window.innerHeight, mainScroll: main.scrollHeight - main.clientHeight, height: window.innerHeight, toolbar: document.querySelector('#bw-page-map .bw-toolbar')!.getBoundingClientRect().height };
  });
  expect(r.nodes, label).toBeGreaterThan(3);
  expect(r.outside, `${label}: nodes outside the picture`).toEqual([]);
  expect(r.low, `${label}: below the window`).toEqual([]);
  expect(r.pageScroll, `${label}: the page scrolls`).toBeLessThanOrEqual(1);
  expect(r.mainScroll, `${label}: the main area scrolls`).toBeLessThanOrEqual(1);
  expect(r.toolbar, `${label}: the toolbar takes at most two rows`).toBeLessThan(90);
}

for (const [w, h] of SIZES) {
  test(`the sandbox map fits a ${w} by ${h} window: nothing clipped, every node inside the picture`, async () => {
    test.setTimeout(180_000);
    box ??= sandboxRoot();
    const userData = tempDir('bowerloom-viewer-e2e-');
    const app: ElectronApplication = await electron.launch({ executablePath: electronPath as unknown as string, args: [desktop, '--sandbox', `--user-data-dir=${userData}`], env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: '1', BOWERLOOM_VIEWER_SANDBOX: box } });
    try {
      const page = await app.firstWindow(); await page.waitForLoadState('domcontentloaded');
      await app.evaluate(({ BrowserWindow }, size) => { BrowserWindow.getAllWindows()[0]!.setContentSize(size.w, size.h); }, { w, h });
      await page.waitForTimeout(400);
      await page.locator('nav.nav').getByRole('button', { name: 'Map', exact: true }).click();
      await expect(page.locator('#bw-page-map .react-flow__node').first()).toBeVisible();
      await assertFits(page, `sandbox ${w}x${h}`);
      await page.screenshot({ path: join(shots, `M1-map-overview-${w}x${h}.png`), scale: 'css' });
      // Everything too: still inside the picture, and the hint says so when the words are small.
      await page.getByRole('button', { name: 'Everything', exact: true }).click();
      await assertFits(page, `sandbox everything ${w}x${h}`);
      await page.screenshot({ path: join(shots, `M1b-map-everything-${w}x${h}.png`), scale: 'css' });
    } finally { await app.close(); }
  });
}

for (const [w, h] of SIZES) {
  test(`the map of 200 things fits a ${w} by ${h} window: nothing clipped, every node inside the picture`, async () => {
    test.setTimeout(180_000);
    const dir = tempDir('bowerloom-layout-');
    const html = join(dir, 'layout.html');
    writeFileSync(html, `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="${pathToFileURL(join(desktop, 'dist/renderer/tokens.css')).href}"><link rel="stylesheet" href="${pathToFileURL(join(desktop, 'dist/renderer/styles.css')).href}"><link rel="stylesheet" href="${pathToFileURL(join(desktop, '.build/perf/harness.css')).href}"></head><body><script src="${pathToFileURL(join(desktop, '.build/perf/harness.js')).href}"></script></body></html>`);
    const userData = tempDir('bowerloom-layout-ud-');
    const app = await electron.launch({ executablePath: electronPath as unknown as string, args: [desktop, '--sample-data', `--user-data-dir=${userData}`] });
    try {
      await app.firstWindow();
      await app.evaluate(({ BrowserWindow }, o) => { const win = new BrowserWindow({ width: o.w, height: o.h, useContentSize: true, show: true, webPreferences: { contextIsolation: true, sandbox: true, partition: 'layout-test' } }); void win.loadURL(`${o.file}?n=${o.n}`); }, { file: pathToFileURL(html).href, n: 200, w, h });
      await expect.poll(() => app.windows().length).toBe(2);
      const page = app.windows()[1]!;
      await page.waitForFunction(() => (window as unknown as { __ready?: boolean }).__ready === true, null, { timeout: 30_000 });
      await page.waitForSelector('.react-flow__node');
      await assertFits(page, `200 things ${w}x${h}`);
      await page.screenshot({ path: join(shots, `M5-map-large-200-overview-${w}x${h}.png`), scale: 'css' });
      await page.getByRole('button', { name: 'Everything', exact: true }).click();
      await assertFits(page, `200 things everything ${w}x${h}`);
      await page.screenshot({ path: join(shots, `M6-map-large-200-everything-stacked-${w}x${h}.png`), scale: 'css' });
    } finally { await app.close(); }
  });
}
