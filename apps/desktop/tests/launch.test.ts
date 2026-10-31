// How the app starts: a built app with no flag opens the harness-first app on the person's own folders; one neutral flag opens the sample engine.
// Pure: the arguments go in, the plan for the window comes out. Nothing here needs Electron.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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

test('the retired home flags and every old prototype name are not modes: the start opens the app on the person\'s own folders', () => {
  for (const old of ['--home-sample', '--home-real', '--prototype-v2', '--prototype-v3', '--prototype-real', '--prototype-v3-real', '--sample-data', '--real-data']) assert.equal(launchOf([old]).kind, 'app', old);
  assert.deepEqual(Object.keys(FLAGS), ['sample']);
  assert.deepEqual(Object.values(FLAGS).filter(f => /prototype/.test(f)), []);
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
