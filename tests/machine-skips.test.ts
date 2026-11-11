// The skip conditions of tests/support/machine-skips.ts. They must run a test on macOS and on a user who is not root,
// and they must give a reason when they skip.
import './support/isolate-home.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import { fileTimesAreCoarse, folderIdentityIsReused, isRoot, skipAsRoot, skipOnCoarseFileTimes, skipOnReusedFolderIdentity } from './support/machine-skips.js';

test('skipAsRoot runs the test for a user who is not root, and names the reason for root', t => {
  const original = Object.getOwnPropertyDescriptor(process, 'getuid');
  t.after(() => { if (original) Object.defineProperty(process, 'getuid', original); else delete (process as { getuid?: unknown }).getuid; });
  Object.defineProperty(process, 'getuid', { value: () => 501, configurable: true, writable: true });
  assert.equal(isRoot(), false); assert.equal(skipAsRoot('a folder at mode 0 cannot be listed'), false);
  Object.defineProperty(process, 'getuid', { value: () => 0, configurable: true, writable: true });
  assert.equal(isRoot(), true);
  const reason = skipAsRoot('a folder at mode 0 cannot be listed');
  assert.equal(typeof reason, 'string'); assert.match(String(reason), /root ignores file modes/); assert.match(String(reason), /a folder at mode 0 cannot be listed/);
  delete (process as { getuid?: unknown }).getuid;
  assert.equal(isRoot(), false, 'a platform with no getuid is not root');
});

test('on macOS the file system checks never skip a test, and they do not touch the disk', t => {
  const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
  t.after(() => Object.defineProperty(process, 'platform', platform));
  Object.defineProperty(process, 'platform', { value: 'darwin' });
  t.mock.method(fs, 'mkdtempSync', () => { throw new Error('the check touched the disk on macOS'); });
  assert.equal(fileTimesAreCoarse(), false); assert.equal(folderIdentityIsReused(), false);
  assert.equal(skipOnCoarseFileTimes('a change'), false); assert.equal(skipOnReusedFolderIdentity('a folder'), false);
});

test('the file system checks answer with a boolean, and give a reason that names the change when they skip', () => {
  assert.equal(typeof fileTimesAreCoarse(), 'boolean'); assert.equal(typeof folderIdentityIsReused(), 'boolean');
  const times = skipOnCoarseFileTimes('a sibling file'), identity = skipOnReusedFolderIdentity('a replaced folder');
  assert.equal(times === false, !fileTimesAreCoarse()); assert.equal(identity === false, !folderIdentityIsReused());
  if (times !== false) assert.match(times, /a sibling file/);
  if (identity !== false) assert.match(identity, /a replaced folder/);
});

test('a check leaves no folder behind in the temporary folder', () => {
  const before = fs.readdirSync(os.tmpdir()).filter(n => n.startsWith('bowerloom-fs-probe-'));
  fileTimesAreCoarse(); folderIdentityIsReused();
  assert.deepEqual(fs.readdirSync(os.tmpdir()).filter(n => n.startsWith('bowerloom-fs-probe-')), before);
});
