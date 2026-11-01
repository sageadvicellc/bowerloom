// The worker file of export and import must load from inside app.asar, where the packaged app keeps its files (package.json: "asar": true). This test packs the real
// dist/bundle-worker.mjs into a small asar, with a main file that starts it the way main/engine-bundle-host.ts does (`new Worker(new URL('./bundle-worker.mjs', import.meta.url))`),
// and runs it in the Electron of this repository. The worker answers a job only after its whole bundle has loaded, so an answer proves the file and its code load from the asar.
// What it does not cover: the production fuses (OnlyLoadAppFromAsar, asar integrity) and a signed build. The release build runs the packaged-app spec (e2e/packaged-app.spec.ts)
// for those; it must pass before a release.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { DESKTOP, tempDir } from './support.js';

const require = createRequire(join(DESKTOP, 'package.json'));

test('the worker file of export and import loads and answers from inside an asar, in the Electron of this repository', { timeout: 120_000 }, async t => {
  const electron = require('electron') as unknown;
  if (typeof electron !== 'string' || !existsSync(electron)) { t.skip('the Electron binary is not installed here'); return; }
  const worker = join(DESKTOP, 'dist', 'bundle-worker.mjs');
  assert.ok(existsSync(worker), 'run npm run bundle first (npm test builds it)');
  const work = tempDir(t, 'bowerloom-asar-');
  const app = join(work, 'app');
  mkdirSync(app);
  writeFileSync(join(app, 'package.json'), '{"name":"asar-check","version":"1.0.0","main":"main.mjs"}\n');
  copyFileSync(worker, join(app, 'bundle-worker.mjs'));
  writeFileSync(join(app, 'main.mjs'), [
    "import { app } from 'electron';",
    "import { Worker } from 'node:worker_threads';",
    'app.dock?.hide();',
    'app.whenReady().then(() => {',
    "  const w = new Worker(new URL('./bundle-worker.mjs', import.meta.url));",
    '  const done = (code, text) => { process.stdout.write(`${text}\\n`); w.terminate().finally(() => app.exit(code)); };',
    "  w.on('message', m => done(m.ok ? 0 : 3, `ANSWER ${JSON.stringify({ ok: m.ok, inAsar: import.meta.url.includes('.asar') })}`));",
    "  w.on('error', e => done(2, `ERROR ${String(e)}`));",
    "  w.postMessage({ id: 1, job: { op: 'drop', key: 'bundle-1' } });",
    '});',
    '',
  ].join('\n'));
  const asar = require('@electron/asar') as { createPackage(src: string, dest: string): Promise<void> };
  const archive = join(work, 'app.asar');
  await asar.createPackage(app, archive);
  const r = spawnSync(electron, [archive], { encoding: 'utf8', timeout: 90_000, env: { PATH: process.env.PATH ?? '', ELECTRON_DISABLE_SECURITY_WARNINGS: '1', HOME: work } });
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout, /ANSWER \{"ok":true,"inAsar":true\}/);
});
