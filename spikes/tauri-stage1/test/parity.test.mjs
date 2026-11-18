// The spike app is packaged with the same settings as the shipped app, so a packaged result speaks for the shipped packaging.
// This test holds the spike's `build` block to the desktop app's for every setting that decides signing, fuses and file layout.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { APP_DIR, DESKTOP } from './support.mjs';

const read = file => JSON.parse(readFileSync(file, 'utf8'));
const desktop = read(join(DESKTOP, 'package.json')).build;
const spike = read(join(APP_DIR, 'package.json')).build;

test('1. the mac targets, signing and hardened-runtime setting match the shipped app', () => {
  assert.deepEqual(spike.mac, desktop.mac);
});

test('2. the Electron fuses match the shipped app', () => {
  assert.deepEqual(spike.electronFuses, desktop.electronFuses);
  assert.equal(spike.electronFuses.runAsNode, false);
  assert.equal(spike.electronFuses.enableNodeOptionsEnvironmentVariable, false);
});

test('3. asar is on, as in the shipped app', () => {
  assert.equal(spike.asar, desktop.asar);
  assert.equal(spike.asar, true);
});

test('4. the spike pins the same Electron version as the shipped app', () => {
  const version = read(join(DESKTOP, 'package.json')).devDependencies.electron;
  assert.equal(spike.electronVersion, version);
});
