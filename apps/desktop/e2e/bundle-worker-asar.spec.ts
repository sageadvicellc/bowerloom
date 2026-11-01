// The worker file of export and import must load from inside app.asar, where the packaged app keeps its files (package.json: "asar": true). This test packs the real
// dist/bundle-worker.mjs into a small asar, with a main file that starts it the way main/engine-bundle-host.ts does (`new Worker(new URL('./bundle-worker.mjs', import.meta.url))`),
// and runs it in the Electron of this repository, started the way the other specs start it (Playwright). A bare Electron started from a shell stalled before it was ready about one start in ten, and every start while the unit tests ran, so the test does not start one by hand. The worker answers a job only after its whole bundle has loaded, so an answer proves the file and its code load from the asar.
// What it does not cover: the production fuses (OnlyLoadAppFromAsar, asar integrity) and a signed build. The release build runs the packaged-app spec (e2e/packaged-app.spec.ts)
// for those; it must pass before a release.
import { _electron as electronLauncher, expect, test } from '@playwright/test';
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { desktop as DESKTOP } from './harness-page.js';
import { bundleOnce } from './harness-real-page.js';
import { removeTempDirs, tempDir } from './temp-dirs.js';

const require = createRequire(join(DESKTOP, 'package.json'));

test.afterAll(() => { removeTempDirs(); });

test('the worker file of export and import loads and answers from inside an asar, in the Electron of this repository', async () => {
  test.setTimeout(120_000);
  bundleOnce();
  const electron = require('electron') as unknown;
  test.skip(typeof electron !== 'string' || !existsSync(electron as string), 'the Electron binary is not installed here');
  const worker = join(DESKTOP, 'dist', 'bundle-worker.mjs');
  expect(existsSync(worker)).toBe(true);
  const work = tempDir('bowerloom-asar-');
  const app = join(work, 'app');
  mkdirSync(app);
  writeFileSync(join(app, 'package.json'), '{"name":"asar-check","version":"1.0.0","main":"main.mjs"}\n');
  copyFileSync(worker, join(app, 'bundle-worker.mjs'));
  // The main file starts the worker as main/engine-bundle-host.ts does, sends one job, and keeps the answer where the test can read it.
  writeFileSync(join(app, 'main.mjs'), [
    "import { app } from 'electron';",
    "import { Worker } from 'node:worker_threads';",
    'if (!process.env.BOWERLOOM_E2E_SHOW) app.dock?.hide();',
    'app.whenReady().then(() => {',
    "  const w = new Worker(new URL('./bundle-worker.mjs', import.meta.url));",
    "  w.on('message', m => { globalThis.__asarAnswer = { ok: m.ok, inAsar: import.meta.url.includes('.asar') }; });",
    "  w.on('error', e => { globalThis.__asarAnswer = { error: String(e) }; });",
    "  w.postMessage({ id: 1, job: { op: 'drop', key: 'bundle-1' } });",
    '});',
    '',
  ].join('\n'));
  const asar = require('@electron/asar') as { createPackage(src: string, dest: string): Promise<void> };
  const archive = join(work, 'app.asar');
  await asar.createPackage(app, archive);
  const started = await electronLauncher.launch({ args: [archive], env: { PATH: process.env.PATH ?? '', ELECTRON_DISABLE_SECURITY_WARNINGS: '1', HOME: work } });
  try {
    const answer = await started.evaluate(async () => {
      const g = globalThis as unknown as { __asarAnswer?: unknown };
      for (let i = 0; i < 200 && g.__asarAnswer === undefined; i += 1) await new Promise(resolve => setTimeout(resolve, 100));
      return g.__asarAnswer;
    });
    expect(answer).toEqual({ ok: true, inAsar: true });
  } finally {
    await started.close().catch(() => undefined);
  }
});
