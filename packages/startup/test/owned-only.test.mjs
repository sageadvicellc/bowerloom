import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { inspectOwnedOnly } from '../../../dist/packages/startup/src/index.js';

/** A project folder with an authored .bowerloom and no startup receipt. */
function project(t) {
  const parent = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), 'bowerloom-owned-only-'))); fs.chmodSync(parent, 0o700);
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  const dir = join(parent, 'studio'); fs.mkdirSync(dir, { mode: 0o755 });
  const bowerloom = join(dir, '.bowerloom'); fs.mkdirSync(bowerloom, { mode: 0o700 });
  return { dir, bowerloom };
}
function fakeOwner(name, claimed, verdict) {
  const calls = [];
  return { calls, owner: { owner: name, claims: (p, kind) => Object.hasOwn(claimed, p) && claimed[p] === kind, async verify(p, kind) { calls.push([p, kind]); return verdict; } } };
}

test('1. an entry a fake owner claims is returned as owned', async t => {
  const p = project(t); fs.writeFileSync(join(p.bowerloom, 'skills.json'), '{}\n'); fs.mkdirSync(join(p.bowerloom, 'teams'));
  const ok = fakeOwner('manifest', { 'skills.json': 'file', teams: 'directory' }, { result: 'verified' });
  const result = await inspectOwnedOnly(p.dir, [ok.owner]);
  assert.deepEqual(result.drift, []);
  assert.deepEqual(result.owned, [{ path: '.bowerloom/skills.json', owner: 'manifest', state: 'verified' }, { path: '.bowerloom/teams', owner: 'manifest', state: 'verified' }]);
  assert.deepEqual(ok.calls.sort(), [['skills.json', 'file'], ['teams', 'directory']]);
  const edited = await inspectOwnedOnly(p.dir, [fakeOwner('manifest', { 'skills.json': 'file', teams: 'directory' }, { result: 'edited' }).owner]);
  assert.deepEqual(edited.owned.map(o => o.state), ['edited', 'edited']);
  const refused = await inspectOwnedOnly(p.dir, [fakeOwner('manifest', { 'skills.json': 'file' }, { result: 'refused', code: 'MANIFEST_INVALID' }).owner]);
  assert.ok(refused.drift.some(d => d.path === '.bowerloom/skills.json' && d.kind === 'owner-refused' && d.code === 'MANIFEST_INVALID'));
});

test('2. an entry no owner claims becomes drift unexpected', async t => {
  const p = project(t); fs.writeFileSync(join(p.bowerloom, 'stray.txt'), 'x'); fs.mkdirSync(join(p.bowerloom, 'folder'));
  assert.deepEqual((await inspectOwnedOnly(p.dir, [])).drift, [{ path: '.bowerloom/folder', kind: 'unexpected' }, { path: '.bowerloom/stray.txt', kind: 'unexpected' }]);
});

test('3. a link becomes drift unsafe and no owner is asked', async t => {
  const p = project(t); fs.writeFileSync(join(p.dir, 'real'), 'x'); fs.symlinkSync(join(p.dir, 'real'), join(p.bowerloom, 'skills.json'));
  const ok = fakeOwner('manifest', { 'skills.json': 'file' }, { result: 'verified' });
  const result = await inspectOwnedOnly(p.dir, [ok.owner]);
  assert.deepEqual(result.drift, [{ path: '.bowerloom/skills.json', kind: 'unsafe' }]);
  assert.deepEqual(ok.calls, []);
});

test('4. more than 256 entries returns the drift unsafe for .bowerloom', async t => {
  const p = project(t); for (let i = 0; i < 257; i++) fs.writeFileSync(join(p.bowerloom, `f${String(i).padStart(3, '0')}`), 'x');
  assert.deepEqual(await inspectOwnedOnly(p.dir, []), { drift: [{ path: '.bowerloom', kind: 'unsafe' }], owned: [] });
  fs.rmSync(join(p.bowerloom, 'f256'));
  assert.equal((await inspectOwnedOnly(p.dir, [])).drift.length, 256, '256 entries are fine');
});

test('5. it succeeds for a project with no installation-receipt.json, and does not walk into a claimed folder', async t => {
  const p = project(t); fs.mkdirSync(join(p.bowerloom, 'teams', 'x'), { recursive: true });
  const ok = fakeOwner('authoring', { teams: 'directory' }, { result: 'verified' });
  const result = await inspectOwnedOnly(p.dir, [ok.owner]);
  assert.deepEqual(result.drift, []); assert.deepEqual(ok.calls, [['teams', 'directory']]);
  assert.deepEqual(await inspectOwnedOnly(p.dir, []), { drift: [{ path: '.bowerloom/teams', kind: 'unexpected' }], owned: [] }, 'an unclaimed folder is not walked either');
});

test('6. a .bowerloom that is not owned by the user returns the drift unsafe before any walk', async t => {
  const p = project(t); fs.writeFileSync(join(p.bowerloom, 'skills.json'), '{}');
  const ok = fakeOwner('manifest', { 'skills.json': 'file' }, { result: 'verified' });
  fs.chmodSync(p.bowerloom, 0o770);
  try { assert.deepEqual(await inspectOwnedOnly(p.dir, [ok.owner]), { drift: [{ path: '.bowerloom', kind: 'unsafe' }], owned: [] }); } finally { fs.chmodSync(p.bowerloom, 0o700); }
  assert.deepEqual(ok.calls, []);
  fs.rmSync(p.bowerloom, { recursive: true }); assert.deepEqual((await inspectOwnedOnly(p.dir, [])).drift, [{ path: '.bowerloom', kind: 'unsafe' }], 'a missing folder');
});
