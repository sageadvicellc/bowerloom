// The smoke build: the release shell (no `e2e` feature) with a visible window. The smoke check starts it with no arguments, probes its window through the operating
// system, asks it to quit the normal way, and reads its exit code. These tests need no window and no permission. They never start the app.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SPIKE } from './support.mjs';
import { findMarkers } from '../scripts/check-release-clean.mjs';

const conf = JSON.parse(readFileSync(join(SPIKE, 'tauri', 'src-tauri', 'tauri.smoke.conf.json'), 'utf8'));
const APP = join(SPIKE, 'tauri', 'src-tauri', 'target-smoke', 'release', 'bundle', 'macos', 'Bowerloom Tauri Spike Smoke.app');
const EXE = join(APP, 'Contents', 'MacOS', 'bowerloom-tauri-spike');

test('S1. the smoke config shows 1 window, with a title', () => {
  assert.equal(conf.app.windows.length, 1);
  assert.equal(conf.app.windows[0].visible, true);
  assert.equal(conf.app.windows[0].title, 'Bowerloom Tauri Spike Smoke');
});

test('S2. the smoke config turns on no test feature: no capability, no global API, no other frontend', () => {
  assert.equal(conf.app.withGlobalTauri, undefined);
  assert.equal(conf.app.security, undefined);
  assert.equal(conf.build, undefined);
});

test('S3. the smoke binary is a release build with no test-only part (0 of 6 markers)', () => {
  assert.ok(existsSync(EXE), `build it first: npm run build:smoke (${EXE})`);
  assert.deepEqual(findMarkers(EXE), []);
});

test('S4. the smoke bundle holds the sidecar runtime and the core script, as the release bundle does', () => {
  assert.ok(existsSync(join(APP, 'Contents', 'MacOS', 'node')));
  assert.ok(existsSync(join(APP, 'Contents', 'Resources', 'core.mjs')));
});
