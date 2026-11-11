/**
 * The hook of the Local models screen (renderer/harness/local-models/useLocalReport.ts), mounted for real in an Electron window on a probe page
 * (tests/component/local-report-page.tsx) whose bridge answers only when the test says. It covers the cleanup on unmount, the last report kept after a failed
 * refresh, no stuck busy state after a call that throws at once, the code of a failure, and the announcement that a manual Refresh makes and an automatic read does not.
 */
import { expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { desktop } from './harness-page.js';
import { extraWindowOptions, launchElectron } from './hidden.js';
import { removeTempDirs, tempDir } from './temp-dirs.js';
import { sampleLocalReport } from '../shared/local-models/sample.js';

let app: ElectronApplication, html: string;

test.beforeAll(async () => {
  test.setTimeout(240_000);
  const out = tempDir('bowerloom-local-hook-');
  const script = `import { build } from 'esbuild'; await build({ entryPoints: ['tests/component/local-report-page.tsx'], outfile: ${JSON.stringify(join(out, 'page.js'))}, bundle: true, format: 'iife', platform: 'browser', target: 'chrome140', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'warning' });`;
  const built = spawnSync(process.execPath, ['--input-type=module', '-e', script], { cwd: desktop, encoding: 'utf8' });
  if (built.status !== 0) throw new Error(built.stderr);
  html = join(out, 'page.html');
  writeFileSync(html, `<!doctype html><html><head><meta charset="utf-8"></head><body><script src="${pathToFileURL(join(out, 'page.js')).href}"></script></body></html>`);
  const bundle = spawnSync(process.execPath, [join(desktop, 'tools', 'bundle.mjs')], { cwd: desktop, encoding: 'utf8' });
  if (bundle.status !== 0) throw new Error(bundle.stderr);
  app = await launchElectron(desktop, ['--sample', `--user-data-dir=${tempDir('bowerloom-e2e-local-hook-')}`]);
  await app.firstWindow();
});
test.afterAll(async () => { await app?.close(); removeTempDirs(); });

let page: Page;
async function open(query = ''): Promise<Page> {
  const before = app.windows().length;
  await app.evaluate(({ BrowserWindow }, { url, options }) => { const w = new BrowserWindow({ width: 900, height: 600, ...options, webPreferences: { contextIsolation: true, sandbox: true, partition: 'local-hook-test' } }); void w.loadURL(url); }, { url: `${pathToFileURL(html).href}${query}`, options: extraWindowOptions() });
  await expect.poll(() => app.windows().length).toBe(before + 1);
  page = app.windows()[before]!;
  await page.waitForFunction(() => (window as unknown as { __ready?: boolean }).__ready === true);
  return page;
}
test.afterEach(async () => { await page?.close().catch(() => undefined); });

const REPORT_A = sampleLocalReport('2026-11-11T10:00:00Z');
const REPORT_B = { ...sampleLocalReport('2026-11-11T10:00:05Z'), models: [] };
const probe = (p: Page, name: string): ReturnType<Page['locator']> => p.locator(`[data-probe="${name}"]`);
const callCount = (p: Page): Promise<number> => p.evaluate(() => (window as unknown as { __driver: { calls: unknown[] } }).__driver.calls.length);
/** Answers the newest call that is waiting, once there is one. */
async function waitingCall(p: Page): Promise<number> {
  await expect.poll(() => p.evaluate(() => (window as unknown as { __driver: { calls: { settled: boolean }[] } }).__driver.calls.findLastIndex(c => !c.settled))).toBeGreaterThanOrEqual(0);
  return p.evaluate(() => (window as unknown as { __driver: { calls: { settled: boolean }[] } }).__driver.calls.findLastIndex(c => !c.settled));
}
const answer = async (p: Page, report: unknown): Promise<void> => { const id = await waitingCall(p); await p.evaluate(([i, r]) => (window as unknown as { __driver: { answer(i: number, r: unknown): void } }).__driver.answer(i as number, r), [id, report]); };
const fail = async (p: Page, message: string): Promise<void> => { const id = await waitingCall(p); await p.evaluate(([i, m]) => (window as unknown as { __driver: { fail(i: number, m: string): void } }).__driver.fail(i as number, m as string), [id, message]); };

test('the first read fills the report, and an automatic read announces nothing', async () => {
  const p = await open();
  await expect(probe(p, 'busy')).toHaveText('true');
  await answer(p, REPORT_A);
  await expect(probe(p, 'report')).toHaveText('2026-11-11T10:00:00Z|3');
  await expect(probe(p, 'busy')).toHaveText('false');
  await expect(probe(p, 'announce')).toHaveText('none');
  // The interval read starts by itself after 3 seconds. It does not mark the hook busy and does not announce.
  await expect.poll(() => callCount(p), { timeout: 8000 }).toBe(2);
  await expect(probe(p, 'busy')).toHaveText('false');
  await expect(probe(p, 'announce')).toHaveText('none');
  await answer(p, REPORT_B);
  await expect(probe(p, 'report')).toHaveText('2026-11-11T10:00:05Z|0');
  await expect(probe(p, 'announce')).toHaveText('none');
});

test('a read with the same figures does not render the probe again', async () => {
  const p = await open();
  await answer(p, REPORT_A);
  await expect(probe(p, 'report')).toHaveText('2026-11-11T10:00:00Z|3');
  const renders = (): Promise<number> => p.evaluate(() => (window as unknown as { __renders: number }).__renders);
  await expect.poll(() => callCount(p), { timeout: 8000 }).toBe(2);
  const before = await renders();
  await answer(p, { ...REPORT_A, sampledAt: '2026-11-11T10:00:03Z', models: REPORT_A.models.map(m => ({ ...m, sampledAt: '2026-11-11T10:00:03Z' })) });
  await expect.poll(() => callCount(p), { timeout: 2000 }).toBe(2);
  await p.waitForTimeout(300);
  expect(await renders()).toBe(before);
  await expect(probe(p, 'report')).toHaveText('2026-11-11T10:00:00Z|3');
});

test('a manual Refresh announces that it reads and then that it updated', async () => {
  const p = await open();
  await answer(p, REPORT_A);
  await expect(probe(p, 'busy')).toHaveText('false');
  await p.getByRole('button', { name: 'Refresh' }).click();
  await expect(probe(p, 'announce')).toHaveText('reading');
  await expect(probe(p, 'busy')).toHaveText('true');
  await answer(p, REPORT_B);
  await expect(probe(p, 'announce')).toHaveText('updated');
  await expect(probe(p, 'busy')).toHaveText('false');
});

test('a failed refresh keeps the last report, marks it stale, and shows the code', async () => {
  const p = await open();
  await answer(p, REPORT_A);
  await expect(probe(p, 'report')).toHaveText('2026-11-11T10:00:00Z|3');
  await p.getByRole('button', { name: 'Refresh' }).click();
  await fail(p, 'HOST_NOT_STARTED');
  await expect(probe(p, 'failed')).toHaveText('true');
  await expect(probe(p, 'stale')).toHaveText('true');
  await expect(probe(p, 'code')).toHaveText('HOST_NOT_STARTED');
  await expect(probe(p, 'report')).toHaveText('2026-11-11T10:00:00Z|3');
  await expect(probe(p, 'busy')).toHaveText('false');
  await expect(probe(p, 'announce')).toHaveText('none');
  await p.getByRole('button', { name: 'Refresh' }).click();
  await answer(p, REPORT_B);
  await expect(probe(p, 'failed')).toHaveText('false');
  await expect(probe(p, 'code')).toHaveText('none');
  await expect(probe(p, 'stale')).toHaveText('false');
});

test('a bridge that throws at once leaves no stuck busy state, and the next read works', async () => {
  const p = await open();
  await answer(p, REPORT_A);
  await p.evaluate(() => { (window as unknown as { __driver: { throwNow: boolean } }).__driver.throwNow = true; });
  await p.getByRole('button', { name: 'Refresh' }).click();
  await expect(probe(p, 'failed')).toHaveText('true');
  await expect(probe(p, 'busy')).toHaveText('false');
  await expect(probe(p, 'code')).toHaveText('FAILED');
  await expect(probe(p, 'report')).toHaveText('2026-11-11T10:00:00Z|3');
  await p.evaluate(() => { (window as unknown as { __driver: { throwNow: boolean } }).__driver.throwNow = false; });
  await p.getByRole('button', { name: 'Refresh' }).click();
  await answer(p, REPORT_B);
  await expect(probe(p, 'failed')).toHaveText('false');
  await expect(probe(p, 'report')).toHaveText('2026-11-11T10:00:05Z|0');
});

test('the first read that throws at once is a failed read, not a read that never ends', async () => {
  const p = await open('?throw=1');
  await expect(probe(p, 'busy')).toHaveText('false');
  await expect(probe(p, 'failed')).toHaveText('true');
  await expect(probe(p, 'code')).toHaveText('FAILED');
  await expect(probe(p, 'report')).toHaveText('none');
});

test('unmounting stops the interval and the listener, and a late answer after unmount does nothing', async () => {
  const p = await open();
  await answer(p, REPORT_A);
  await expect.poll(() => callCount(p), { timeout: 8000 }).toBe(2);
  await p.evaluate(() => (window as unknown as { __driver: { unmount(): void } }).__driver.unmount());
  const at = await callCount(p);
  await answer(p, REPORT_B);
  await p.waitForTimeout(3600);
  await p.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await p.waitForTimeout(200);
  expect(await callCount(p)).toBe(at);
  await expect(p.locator('[data-probe]')).toHaveCount(0);
});
