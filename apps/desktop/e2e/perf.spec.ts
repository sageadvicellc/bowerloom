/**
 * Speed of the map with 200 and 500 things, measured in the real window: the time between frames while the map is panned and zoomed.
 * The numbers are printed so they can be read; the limits below are loose, because the speed of a machine varies.
 */
import { _electron as electron, expect, test } from '@playwright/test';
import electronPath from 'electron';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const desktop = join(dirname(fileURLToPath(import.meta.url)), '..');
mkdirSync(join(desktop, 'screenshots'), { recursive: true });

for (const n of [200, 500]) {
  test(`the map with ${n} things pans and zooms smoothly`, async () => {
    test.setTimeout(120_000);
    const dir = mkdtempSync(join(tmpdir(), 'bowerloom-perf-'));
    const html = join(dir, 'perf.html');
    writeFileSync(html, `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="${pathToFileURL(join(desktop, 'dist/renderer/tokens.css')).href}"><link rel="stylesheet" href="${pathToFileURL(join(desktop, 'dist/renderer/styles.css')).href}"><link rel="stylesheet" href="${pathToFileURL(join(desktop, '.build/perf/harness.css')).href}"></head><body><script src="${pathToFileURL(join(desktop, '.build/perf/harness.js')).href}"></script></body></html>`);
    const userData = mkdtempSync(join(tmpdir(), 'bowerloom-perf-ud-'));
    const app = await electron.launch({ executablePath: electronPath as unknown as string, args: [desktop, '--sample-data', `--user-data-dir=${userData}`] });
    try {
      await app.firstWindow();
      await app.evaluate(({ BrowserWindow }, { file, count }) => { const w = new BrowserWindow({ width: 1100, height: 760, show: true, webPreferences: { contextIsolation: true, sandbox: true, partition: 'perf-test' } }); void w.loadURL(`${file}?n=${count}`); }, { file: pathToFileURL(html).href, count: n });
      await expect.poll(() => app.windows().length).toBe(2);
      const page = app.windows()[1]!;
      await page.waitForFunction(() => (window as unknown as { __ready?: boolean }).__ready === true, null, { timeout: 30_000 });
      await page.waitForSelector('.react-flow__node');
      // The map opens on the overview with its long lists stacked. For the speed test, show everything and open every stack.
      const shots = join(desktop, 'screenshots');
      await page.screenshot({ path: join(shots, `M5-map-large-${n}-overview.png`) });
      await page.getByRole('button', { name: 'Everything', exact: true }).click(); await page.waitForTimeout(600);
      await page.screenshot({ path: join(shots, `M6-map-large-${n}-everything-stacked.png`) });
      await page.locator('#bw-page-map summary', { hasText: 'More' }).click(); await page.getByRole('button', { name: 'Open all stacks' }).click(); await page.keyboard.press('Escape'); await page.waitForTimeout(1500);
      await page.screenshot({ path: join(shots, `M7-map-large-${n}-all-open.png`) });
      const rendered = await page.locator('.react-flow__node').count();
      await page.evaluate(() => { const w = window as unknown as { __frames: number[]; __stop: boolean }; w.__frames = []; w.__stop = false; let last = performance.now(); const tick = (t: number): void => { w.__frames.push(t - last); last = t; if (!w.__stop) requestAnimationFrame(tick); }; requestAnimationFrame(tick); });
      const canvas = page.locator('#bw-page-map .bw-canvas'), box = (await canvas.boundingBox())!;
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      for (let i = 0; i < 60; i++) { await page.mouse.wheel(i % 2 === 0 ? 40 : -20, 25); await page.waitForTimeout(8); }
      for (let i = 0; i < 20; i++) { await page.keyboard.down('Control'); await page.mouse.wheel(0, -30); await page.keyboard.up('Control'); await page.waitForTimeout(8); }
      const frames = await page.evaluate(() => { const w = window as unknown as { __frames: number[]; __stop: boolean }; w.__stop = true; return w.__frames.slice(5); });
      const avg = frames.reduce((a, b) => a + b, 0) / frames.length, sorted = [...frames].sort((a, b) => a - b), p95 = sorted[Math.floor(sorted.length * 0.95)]!;
      console.log(`PERF ${n} things (${rendered} drawn): ${frames.length} frames, average ${avg.toFixed(1)} ms (${(1000 / avg).toFixed(0)} per second), 95th ${p95.toFixed(1)} ms`);
      expect(rendered).toBeGreaterThan(0);
      expect(avg, `average frame ${avg.toFixed(1)} ms`).toBeLessThan(n <= 200 ? 24 : 40);
    } finally { await app.close(); }
  });
}
