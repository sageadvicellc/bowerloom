/**
 * The built app (apps/desktop/release, from `npm run desktop:build`), started with no flag and a made-up HOME. It opens the harness-first app on the person's own folders:
 * the Welcome screen of that app, a read of the made-up home that finds its four places, the one bridge, and no screen of the old viewer. Its data folder is the one it was
 * given, and it is still there after the app quits. The package holds no sample data of the old viewer.
 *
 * The fuses of a packaged build turn off Node's inspect argument, which Playwright's Electron launcher needs, so the app is started as a plain process with Chromium's
 * remote debugging port and Playwright attaches to the window over that port. The spec is skipped when no build for this machine is in release/.
 */
import { chromium, expect, test } from '@playwright/test';
import type { Browser, Page } from '@playwright/test';
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { buildShellHome } from '../tests/fixtures-real/shell-home.js';
import type { ShellHome } from '../tests/fixtures-real/shell-home.js';
import { desktop } from './harness-page.js';
import { removeTempDirs, tempDir } from './temp-dirs.js';

const folder = process.arch === 'arm64' ? 'mac-arm64' : 'mac';
const bundle = join(desktop, 'release', folder, 'Bowerloom.app');
const binary = join(bundle, 'Contents', 'MacOS', 'Bowerloom');
const missing = process.platform !== 'darwin' ? 'the packaged app check runs on macOS' : !existsSync(binary) ? `no build in ${join('release', folder)}: run npm run desktop:build first` : false;

let fixture: ShellHome | null = null, child: ChildProcess | null = null, browser: Browser | null = null;
test.afterAll(async () => {
  try { await browser?.close(); } catch { /* already gone */ }
  if (child !== null && child.exitCode === null) { child.kill('SIGTERM'); await new Promise<void>(resolve => { child!.once('exit', () => resolve()); setTimeout(resolve, 5000); }); }
  fixture?.cleanup(); removeTempDirs();
});

async function portOf(userData: string): Promise<number> {
  const file = join(userData, 'DevToolsActivePort');
  for (let i = 0; i < 300; i++) {
    if (existsSync(file)) { const port = Number(readFileSync(file, 'utf8').split('\n')[0]); if (Number.isInteger(port) && port > 0) return port; }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('The built app did not open its debugging port.');
}

test('the built app opens the harness-first app on the person\'s own folders, with no viewer, and keeps its data folder', async () => {
  test.skip(missing !== false, String(missing));
  test.setTimeout(240_000);
  fixture = buildShellHome();
  const userData = tempDir('bowerloom-e2e-packaged-');
  // The package holds the kits and no sample data of the old viewer.
  const resources = join(bundle, 'Contents', 'Resources');
  expect(existsSync(join(resources, 'kits'))).toBe(true);
  expect(existsSync(join(resources, 'sample-data'))).toBe(false);
  const asar = createRequire(import.meta.url)('@electron/asar') as { listPackage(archive: string): string[] };
  const listed = asar.listPackage(join(resources, 'app.asar')).map(f => f.replace(/\\/g, '/'));
  expect(listed.some(f => f.endsWith('/dist/renderer/app.js'))).toBe(true);
  expect(listed.filter(f => /sample-data|preload\.cjs$|force-graph|\/screenshots\//.test(f) && !f.endsWith('preload-real.cjs'))).toEqual([]);
  expect(listed.some(f => f.endsWith('/dist/preload-real.cjs'))).toBe(true);

  child = spawn(binary, ['--remote-debugging-port=0', `--user-data-dir=${userData}`], { stdio: 'ignore', env: { PATH: process.env.PATH ?? '', HOME: fixture.home, ELECTRON_DISABLE_SECURITY_WARNINGS: '1' } });
  const port = await portOf(userData);
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  let page: Page | undefined;
  for (let i = 0; i < 100 && page === undefined; i++) {
    page = browser.contexts().flatMap(c => c.pages()).find(p => p.url().startsWith('app://viewer/index.html'));
    if (page === undefined) await new Promise(resolve => setTimeout(resolve, 200));
  }
  expect(page, 'the app window').toBeDefined();
  const p = page!;
  await p.waitForSelector('[data-home]');
  expect(p.url()).toBe('app://viewer/index.html#app');
  // The harness-first app, on the person's own folders: its Welcome screen, its one bridge, and nothing of the old viewer.
  await expect(p.getByRole('heading', { level: 1, name: 'Bowerloom', exact: true })).toBeVisible();
  await expect(p.getByText('Bowerloom only reads. Nothing changes until you press Install.')).toBeVisible();
  const facts = await p.evaluate(() => ({
    viewerBridge: typeof (window as unknown as { bowerloom?: unknown }).bowerloom,
    readerBridge: Object.keys((window as unknown as { bowerloomReal: object }).bowerloomReal).sort(),
    engineMode: (window as unknown as { bowerloomEngine: { mode: string } }).bowerloomEngine.mode,
    viewerParts: document.querySelectorAll('nav.nav, .sidebar, .map-page, .kg-host, .shell').length,
  }));
  expect(facts).toEqual({ viewerBridge: 'undefined', readerBridge: ['discoverPlaces', 'pickFolder', 'readSelected'], engineMode: 'real', viewerParts: 0 });
  // A read of the made-up home finds its four places: the app is on the real reader, not the sample.
  await p.getByRole('button', { name: 'Find my files', exact: true }).click();
  await expect(p.getByRole('heading', { level: 1, name: 'Found 4 places' })).toBeVisible();
  expect(await p.locator('body').innerText()).not.toContain(fixture.root);
  // The made-up launch would have made and removed a data folder of its own; this one is the one it was given.
  const exited = new Promise<void>(resolve => child!.once('exit', () => resolve()));
  child.kill('SIGTERM');
  await exited;
  expect(existsSync(userData)).toBe(true);
  expect(readdirSync(userData).length).toBeGreaterThan(0);
});
