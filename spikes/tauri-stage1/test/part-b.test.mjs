// Gate 1 Part B on macOS, unsigned part only: the Tauri app bundle holds the sidecar, and the sidecar works from an install path with spaces and non-ASCII characters.
// NOT RUN: the notarized build. It waits for the Apple spend decision (open question 8). Gate 1 cannot pass for macOS until it runs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { TAURI_APP, TAURI_NAME, launch, tauriExe, tempDir } from './support.mjs';

test('B1. the bundle holds the Node runtime as the sidecar beside the shell, and the core script as a resource', () => {
  assert.ok(existsSync(join(TAURI_APP, 'Contents', 'MacOS', 'node')), 'sidecar runtime');
  assert.ok(statSync(join(TAURI_APP, 'Contents', 'MacOS', 'node')).size > 10 * 1024 * 1024);
  assert.ok(existsSync(join(TAURI_APP, 'Contents', 'Resources', 'core.mjs')), 'core script');
});

test('B2. the bundle signing state (recorded: unsigned or ad-hoc, with no team)', () => {
  const run = spawnSync('codesign', ['-dv', '--verbose=2', TAURI_APP], { encoding: 'utf8' });
  const text = `${run.stdout}${run.stderr}`;
  assert.doesNotMatch(text, /Authority=Developer ID/);
  assert.doesNotMatch(text, /TeamIdentifier=[A-Z0-9]{10}/);
});

test('B3. the app copied to a path with spaces and non-ASCII characters starts the sidecar and a call returns', { timeout: 120000 }, async t => {
  const target = join(tempDir(t, 'stage1-tauri-'), 'Ünïcode Späce ✓ dir');
  mkdirSync(target, { recursive: true });
  execFileSync('ditto', [TAURI_APP, join(target, `${TAURI_NAME}.app`)]);
  const exe = tauriExe(join(target, `${TAURI_NAME}.app`));
  const started = launch(t, 'ping', {}, { exe, packaged: true });
  const end = await started.ended;
  const r = started.result();
  assert.ok(r, `no result (exit ${end.code} ${end.signal}): ${started.stderr().slice(0, 400)}`);
  assert.equal(r.pong, true, JSON.stringify(r).slice(0, 400));
  assert.equal(r.childIsNotShell, true);
  assert.match(r.exePath, /Ünïcode Späce ✓ dir/);
  assert.equal(end.code, 0);
});

test('B4. the same path also carries a scan call (the core script and the engine code load from the resource folder)', { timeout: 120000 }, async t => {
  const { makeScanFixture } = await import('../src/fixture.mjs');
  const made = makeScanFixture(tempDir(t), { projects: 3, skills: 3, fileBytes: 600 });
  const target = join(tempDir(t, 'stage1-tauri-'), 'Späce ✓');
  mkdirSync(target, { recursive: true });
  execFileSync('ditto', [TAURI_APP, join(target, `${TAURI_NAME}.app`)]);
  const started = launch(t, 'payload', { picked: made.picked, home: made.home }, { exe: tauriExe(join(target, `${TAURI_NAME}.app`)), packaged: true });
  await started.ended;
  const r = started.result();
  assert.ok(r && r.digestMatch === true, JSON.stringify(r));
  assert.equal(r.items, 9);
});
