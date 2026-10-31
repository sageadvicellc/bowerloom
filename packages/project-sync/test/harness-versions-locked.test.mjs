// Bowerloom 0.8 save step: the version store under the project lock, for a caller that holds no lock (the desktop app). Synthetic folders only.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { harnessStateDirs, listVersions, recordVersionLocked } from '../../../dist/packages/project-sync/src/index.js';
import { withProjectLock } from '../../../dist/packages/project-context/src/index.js';
import { chmodTree, code } from './portable-fixture.mjs';

const NOW = new Date('2026-10-30T12:00:00Z');
const files = text => new Map([['harness.json', Buffer.from(text)]]);

function world(t) {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'bowerloom-versions-locked-'))); fs.chmodSync(base, 0o700);
  t.after(() => { chmodTree(base); fs.rmSync(base, { recursive: true, force: true }); });
  const dir = path.join(base, 'project'); fs.mkdirSync(dir, { mode: 0o755 });
  const stateRoot = path.join(base, 'state', 'bowerloom'); fs.mkdirSync(stateRoot, { recursive: true, mode: 0o700 });
  return { dir, stateRoot, dirs: harnessStateDirs(stateRoot, dir) };
}

test('versions locked: the callback sees the newest version and decides; null records nothing', async t => {
  const w = world(t);
  const seen = [];
  const first = await recordVersionLocked(w.dirs, w.dir, 'definition', newest => { seen.push(newest); return { files: files('{"a":1}\n'), meta: { revision: 'rev-1', label: 'As it was', now: NOW } }; });
  assert.equal(first.id, 'v1');
  const none = await recordVersionLocked(w.dirs, w.dir, 'definition', newest => { seen.push(newest?.id ?? null); return newest?.revision === 'rev-1' ? null : { files: files('x'), meta: { revision: 'rev-1', label: '' } }; });
  assert.equal(none, null);
  assert.deepEqual(seen, [null, 'v1']);
  assert.deepEqual(listVersions(w.dirs, 'definition').map(v => v.id), ['v1']);
});

test('versions locked: it runs under the project lock, so it waits for no one and refuses while another holder has the lock', async t => {
  const w = world(t);
  await withProjectLock(w.dir, new AbortController().signal, async () => {
    await assert.rejects(recordVersionLocked(w.dirs, w.dir, 'definition', () => ({ files: files('x'), meta: { revision: 'rev-1', label: '' } })), code('PROJECT_LOCKED'));
  });
  assert.deepEqual(listVersions(w.dirs, 'definition'), []);
});

test('versions locked: a layout of another project is refused before the lock or the callback', async t => {
  const w = world(t), other = world(t);
  let called = false;
  await assert.rejects(recordVersionLocked(other.dirs, w.dir, 'definition', () => { called = true; return null; }), code('PORTABLE_USAGE'));
  assert.equal(called, false);
});

test('versions locked: a callback that throws records nothing, and its error passes through', async t => {
  const w = world(t);
  await assert.rejects(recordVersionLocked(w.dirs, w.dir, 'definition', () => { throw Object.assign(new Error('nope'), { code: 'X_FAILED' }); }), code('X_FAILED'));
  assert.deepEqual(listVersions(w.dirs, 'definition'), []);
});
