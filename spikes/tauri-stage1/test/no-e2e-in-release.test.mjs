// The plan, Security: the test-only parts (the WebdriverIO plugin, the embedded WebDriver server, the test-only dialog answer) are not compiled into a release build.
// A check against the built binary proves it. The test build is the positive control: the same check must find them there, or it proves nothing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { SPIKE, TAURI_APP, tauriExe } from './support.mjs';
import { MARKERS, findMarkers } from '../scripts/check-release-clean.mjs';

const E2E_APP = join(SPIKE, 'tauri', 'src-tauri', 'target-e2e', 'release', 'bundle', 'macos', 'Bowerloom Tauri Spike E2E.app');
const e2eExe = join(E2E_APP, 'Contents', 'MacOS', 'bowerloom-tauri-spike');

test('R1. the check looks for the 2 plugin crates and the test-only command (at least 4 markers)', () => {
  assert.ok(MARKERS.length >= 4);
  for (const m of ['tauri_plugin_wdio', 'tauri_plugin_wdio_webdriver', 'pick_folder']) assert.ok(MARKERS.some(x => x.includes(m)), m);
});

test('R2. the release binary holds none of the markers (0 found)', () => {
  assert.ok(existsSync(tauriExe(TAURI_APP)), 'release binary is built');
  assert.deepEqual(findMarkers(tauriExe(TAURI_APP)), []);
});

test('R3. positive control: the test binary holds the markers, so the check can see them', () => {
  assert.ok(existsSync(e2eExe), `test binary is built at ${e2eExe}`);
  const found = findMarkers(e2eExe);
  assert.ok(found.some(m => m.includes('wdio')), `found: ${found}`);
  assert.ok(found.includes('pick_folder'), `found: ${found}`);
});

test('R4. the release capability file does not name the wdio permission', async () => {
  const { readFileSync } = await import('node:fs');
  const text = readFileSync(join(SPIKE, 'tauri', 'src-tauri', 'capabilities', 'default.json'), 'utf8');
  assert.doesNotMatch(text, /wdio/);
});
