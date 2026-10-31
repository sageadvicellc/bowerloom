// How the app starts: a built app with no flag opens the harness-first app on the person's own folders; one neutral flag opens the sample engine.
// Pure: the arguments go in, the plan for the window comes out. Nothing here needs Electron.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import type { SpawnSyncReturns } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FLAGS, launchOf } from '../main/launch.js';
import { BASE, REAL_BASE } from '../shared/harness/route.js';
import { DESKTOP } from './support.js';

const read = (path: string): string => readFileSync(join(DESKTOP, path), 'utf8');

test('no flag opens the harness-first app on the person\'s own folders, with the real reader, the engine calls and the normal data folder', () => {
  for (const argv of [[], ['/path/to/app'], ['--user-data-dir=/somewhere'], ['--unknown-chromium-flag']]) {
    const l = launchOf(argv);
    assert.equal(l.kind, 'app', JSON.stringify(argv));
    assert.equal(l.hash, REAL_BASE); assert.equal(l.preload, 'real'); assert.equal(l.realReader, true); assert.equal(l.engineCalls, true);
    assert.equal(l.temporaryData, false, 'the lasting data folder of the app, not a temporary one');
    assert.equal(l.samplePreviewEngines, false);
  }
});

test('--sample opens the same app on made-up folders: no bridge, no calls, a temporary data folder', () => {
  const l = launchOf([FLAGS.sample]);
  assert.equal(FLAGS.sample, '--sample');
  assert.deepEqual({ kind: l.kind, hash: l.hash, preload: l.preload, realReader: l.realReader, engineCalls: l.engineCalls, temporaryData: l.temporaryData }, { kind: 'sample', hash: BASE, preload: 'none', realReader: false, engineCalls: false, temporaryData: true });
});

test('the preview engines open only for the sample, and only with their own argument', () => {
  assert.equal(launchOf([FLAGS.sample, '--sample-preview-engines']).samplePreviewEngines, true);
  assert.equal(launchOf(['--sample-preview-engines']).samplePreviewEngines, false, 'never the launch on the person\'s own folders');
});

test('the start fails closed: a flag that looks like a mode flag but is not exactly known is refused, and never opens the app on the person\'s own folders', () => {
  const refused = ['--sample=1', '--sample=', '--Sample', '--SAMPLE', '--smaple', '--sampel', '--samle', '--sample-data', '--sample_preview_engines', '--Sample-Preview-Engines', '--home-sample', '--home-real', '--home', '-sample', '---sample', '--samples'];
  for (const arg of refused) {
    const l = launchOf([arg]);
    assert.equal(l.kind, 'refused', arg);
    assert.match(l.refusal ?? '', new RegExp(`does not know "${arg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`), arg);
    assert.deepEqual({ preload: l.preload, realReader: l.realReader, engineCalls: l.engineCalls }, { preload: 'none', realReader: false, engineCalls: false }, `${arg} gets no bridge and no calls`);
  }
  // A bad flag next to a good one still refuses: the good flag never hides it.
  assert.equal(launchOf([FLAGS.sample, '--smaple']).kind, 'refused');
  assert.equal(launchOf(['--smaple', FLAGS.sample]).kind, 'refused');
});

test('flags that are exactly known, and arguments that are not mode flags, are not refused', () => {
  assert.equal(launchOf([FLAGS.sample, '--sample-preview-engines']).kind, 'sample');
  assert.equal(launchOf(['--sample-preview-engines']).kind, 'app', 'the preview switch alone is known and changes nothing');
  for (const arg of ['/path/to/app', '--user-data-dir=/somewhere', '--no-sandbox', '--remote-debugging-port=0', '--inspect', '--enable-logging', '--prototype-v2', '--prototype-real', '--real-data', 'sample', 'homepage', '-x']) {
    assert.equal(launchOf([arg]).kind, 'app', arg);
    assert.equal(launchOf([arg]).refusal, null, arg);
  }
  assert.deepEqual(Object.keys(FLAGS), ['sample']);
  assert.deepEqual(Object.values(FLAGS).filter(f => /prototype/.test(f)), []);
});

test('a refused start tells main to exit with the words, before any window opens', () => {
  const main = read('main/main.ts');
  assert.match(main, /if \(launch\.refusal !== null\) \{ process\.stderr\.write\(`\$\{launch\.refusal\}\\n`\); app\.exit\(2\); \}/);
  assert.ok(main.indexOf('launch.refusal') < main.indexOf('protocol.handle'), 'the check comes before the page is served');
  assert.ok(main.indexOf('launch.refusal') < main.indexOf('createWindow()'), 'and before the window opens');
});

test('the shipped address of the app and of the sample carry no prototype name', () => {
  assert.doesNotMatch(`${BASE}${REAL_BASE}`, /prototype/);
  assert.equal(REAL_BASE.startsWith(BASE), false, 'one address is not the start of the other, so a route test cannot confuse them');
});

test('main.ts reads its plan from launchOf, and no prototype name is left in the main process, the launcher or the root scripts', () => {
  assert.match(read('main/main.ts'), /launchOf\(argv\)/);
  for (const file of ['main/main.ts', 'main/security.ts', 'main/window-options.ts', 'tools/run.mjs']) assert.doesNotMatch(read(file), /prototype/i, file);
  const scripts = (JSON.parse(read('../../package.json')) as { scripts: Record<string, string> }).scripts;
  assert.deepEqual(Object.keys(scripts).filter(name => /prototype/.test(name) || /prototype/.test(scripts[name]!)), []);
  assert.equal(scripts.desktop, 'node apps/desktop/tools/run.mjs');
  assert.equal(scripts['desktop:sample'], 'node apps/desktop/tools/run.mjs --sample');
  assert.equal(scripts['desktop:dev'], 'node apps/desktop/tools/run.mjs --sample');
});

test('the built app exits with code 2 and the words on stderr for a misspelled or retired flag, and opens no window', async t => {
  const { electronBinary } = await import(`${join(DESKTOP, 'tools', 'run.mjs')}`) as { electronBinary(desktop: string, platform: string): string | null };
  const binary = electronBinary(DESKTOP, process.platform);
  if (binary === null || !existsSync(join(DESKTOP, 'dist', 'main.mjs'))) { t.skip('the app window or the built bundle is not here'); return; }
  for (const flag of ['--smaple', '--Sample', '--sample=1', '--home-real']) {
    const r: SpawnSyncReturns<string> = spawnSync(binary, [DESKTOP, flag], { encoding: 'utf8', timeout: 60000, env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', ELECTRON_DISABLE_SECURITY_WARNINGS: '1' } });
    assert.equal(r.status, 2, `${flag}: ${r.stderr}`);
    assert.match(r.stderr, new RegExp(`Bowerloom does not know "${flag}"`), flag);
  }
});
