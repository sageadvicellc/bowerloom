/**
 * The built app (apps/desktop/release, from `npm run desktop:build`), started with no flag and a made-up HOME. It opens the harness-first app on the person's own folders:
 * the Welcome screen of that app, a read of the made-up home that finds its four places, the one bridge, and no screen of the old viewer. Its data folder is the one it was
 * given, and it is still there after the app quits. The package holds no sample data of the old viewer.
 *
 * The fuses of a packaged build turn off Node's inspect argument, which Playwright's Electron launcher needs, so the app is started as a plain process with Chromium's
 * remote debugging port and Playwright attaches to the window over that port. The spec is skipped when no build for this machine is in release/, except when CI is set: then a missing build,
 * and a build older than the source, fail it. The fuses of the build are checked here too (tools/check-fuses.mjs), so a build that lost one cannot pass.
 */
import { chromium, expect, test } from '@playwright/test';
import type { Browser, Page } from '@playwright/test';
import { spawn, spawnSync } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { buildShellHome } from '../tests/fixtures-real/shell-home.js';
import type { ShellHome } from '../tests/fixtures-real/shell-home.js';
import { desktop } from './harness-page.js';
import { hiddenArgs } from './hidden.js';
import { removeTempDirs, tempDir } from './temp-dirs.js';

const folder = process.arch === 'arm64' ? 'mac-arm64' : 'mac';
const bundle = join(desktop, 'release', folder, 'Bowerloom.app');
const binary = join(bundle, 'Contents', 'MacOS', 'Bowerloom');
const missing = process.platform !== 'darwin' ? 'the packaged app check runs on macOS' : !existsSync(binary) ? `no build in ${join('release', folder)}: run npm run desktop:build first` : false;

/** The newest change time, in milliseconds, of any file under `dir` (a missing folder counts as 0). */
function newestChange(dir: string): number {
  if (!existsSync(dir)) return 0;
  let newest = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.build' || entry.name === 'release') continue;
    const path = join(dir, entry.name);
    newest = Math.max(newest, entry.isDirectory() ? newestChange(path) : statSync(path).mtimeMs);
  }
  return newest;
}

/** The sources that the build holds: the app, and the packages that tools/bundle.mjs bundles into it. A build made before the newest of them does not show what the source says. */
function newestSource(): number {
  const packages = join(desktop, '..', '..', 'packages');
  return Math.max(
    ...['main', 'preload', 'renderer', 'shared'].map(dir => newestChange(join(desktop, dir))),
    statSync(join(desktop, 'tools', 'bundle.mjs')).mtimeMs,
    ...readdirSync(packages).map(name => newestChange(join(packages, name, 'src'))),
    statSync(join(desktop, 'package.json')).mtimeMs,
  );
}

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
  // On a machine that is not set up for it, this spec skips. In CI a skip proves nothing, so a missing build fails there.
  if (missing !== false && process.env.CI) throw new Error(`The packaged app check cannot run in CI: ${String(missing)}`);
  test.skip(missing !== false, String(missing));
  test.setTimeout(240_000);
  // A build older than the source would pass this spec and say nothing about the source. Build first: npm run desktop:build.
  const builtAt = statSync(join(bundle, 'Contents', 'Resources', 'app.asar')).mtimeMs, changedAt = newestSource();
  expect(builtAt, 'the build in release/ is older than the source: run npm run desktop:build').toBeGreaterThan(changedAt);
  // The safety switches of the build itself, read from the built binary.
  const fuses = spawnSync(process.execPath, [join(desktop, 'tools', 'check-fuses.mjs'), binary], { encoding: 'utf8' });
  expect(fuses.status, `${fuses.stdout}${fuses.stderr}`).toBe(0);
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

  child = spawn(binary, ['--remote-debugging-port=0', `--user-data-dir=${userData}`, ...hiddenArgs()], { stdio: 'ignore', env: { PATH: process.env.PATH ?? '', HOME: fixture.home, ELECTRON_DISABLE_SECURITY_WARNINGS: '1' } });
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
  // The made-up launch would have made and removed a data folder of its own; this one is the one it was given. It is closed the way a person closes it, with the quit of the
  // application, so the browser engine writes its profile (Local State) before the process ends. The AppleEvent quit needs no permission for an app this process started; if the
  // system refuses it, the spec falls back to a termination signal, which Electron also treats as a quit, and says so in the report.
  const exited = new Promise<number | null>(resolve => child!.once('exit', code => resolve(code)));
  const quit = spawnSync('osascript', ['-e', `tell application ${JSON.stringify(bundle)} to quit`], { encoding: 'utf8', timeout: 30_000 });
  if (quit.status !== 0) { test.info().annotations.push({ type: 'quit', description: `AppleEvent quit refused (${quit.stderr.trim()}); closed with SIGTERM` }); child.kill('SIGTERM'); }
  expect(await exited, 'the app quits cleanly').toBe(0);
  expect(existsSync(userData)).toBe(true);
  expect(existsSync(join(userData, 'Local State')), 'the browser profile was written before the app ended').toBe(true);
  expect(readdirSync(userData).length).toBeGreaterThan(0);
});
