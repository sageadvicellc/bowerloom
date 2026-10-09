import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { planStartup, applyStartup, inspectStartup } from '../../../dist/packages/startup/src/index.js';
import { authoringVerifier, manifestVerifier } from '../../../dist/packages/project-authoring/src/index.js';

/** An existing project folder with a real startup install. */
async function project(t) {
  const parent = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), 'bowerloom-owners-'))); fs.chmodSync(parent, 0o700);
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  const targetDir = join(parent, 'studio'); fs.mkdirSync(targetDir, { mode: 0o755 });
  const input = { mode: 'existing', targetDir, brief: { projectName: 'Studio handbook', goal: 'Prepare a fictional onboarding kit for an independent design studio.' } };
  await applyStartup(input, (await planStartup(input)).revision);
  return { dir: targetDir, bowerloom: join(targetDir, '.bowerloom') };
}
/** A fake owner that claims the listed paths and answers with `verdict`; it records each verify call. */
function fakeOwner(name, claimed, verdict) {
  const calls = [];
  return { calls, owner: { owner: name, claims: (p, kind) => Object.hasOwn(claimed, p) && claimed[p] === kind, async verify(p, kind) { calls.push([p, kind]); if (verdict instanceof Error) throw verdict; return verdict; } } };
}

test('with no verifiers, added files stay unexpected, as at cc117ac', async t => {
  const p = await project(t);
  fs.mkdirSync(join(p.bowerloom, 'teams', 'x')); fs.writeFileSync(join(p.bowerloom, 'skills.json'), '{}\n'); fs.writeFileSync(join(p.bowerloom, 'stray.txt'), 'x');
  for (const result of [await inspectStartup(p.dir), await inspectStartup(p.dir, {}), await inspectStartup(p.dir, { owners: [] })]) {
    assert.equal(result.status, 'drifted');
    assert.deepEqual([...result.drift].sort((a, b) => a.path < b.path ? -1 : 1), [{ path: '.bowerloom/skills.json', kind: 'unexpected' }, { path: '.bowerloom/stray.txt', kind: 'unexpected' }, { path: '.bowerloom/teams/x', kind: 'unexpected' }]);
    assert.equal(Object.hasOwn(result, 'owned'), false);
  }
});

test('a registered item passes only when exactly one owner claims it and verifies it', async t => {
  const p = await project(t);
  fs.mkdirSync(join(p.bowerloom, 'teams', 'x')); fs.writeFileSync(join(p.bowerloom, 'notes.md'), 'x');
  const ok = fakeOwner('authoring', { 'teams/x': 'directory', 'notes.md': 'file' }, { result: 'verified' });
  const ready = await inspectStartup(p.dir, { owners: [ok.owner] });
  assert.equal(ready.status, 'ready-for-review'); assert.deepEqual(ready.drift, []); assert.equal(ready.specReady, true);
  assert.deepEqual(ready.owned, [{ path: '.bowerloom/notes.md', owner: 'authoring', state: 'verified' }, { path: '.bowerloom/teams/x', owner: 'authoring', state: 'verified' }]);
  assert.deepEqual(ok.calls.sort(), [['notes.md', 'file'], ['teams/x', 'directory']]);

  const edited = fakeOwner('authoring', { 'teams/x': 'directory', 'notes.md': 'file' }, { result: 'edited' });
  const shown = await inspectStartup(p.dir, { owners: [edited.owner] });
  assert.equal(shown.status, 'ready-for-review'); assert.deepEqual(shown.drift, []);
  assert.deepEqual(shown.owned.map(o => o.state), ['edited', 'edited']);

  const refused = fakeOwner('authoring', { 'teams/x': 'directory', 'notes.md': 'file' }, { result: 'refused', code: 'AUTHORING_UNREGISTERED' });
  const drifted = await inspectStartup(p.dir, { owners: [refused.owner] });
  assert.equal(drifted.status, 'drifted');
  assert.deepEqual(drifted.drift, [{ path: '.bowerloom/notes.md', kind: 'owner-refused', code: 'AUTHORING_UNREGISTERED' }, { path: '.bowerloom/teams/x', kind: 'owner-refused', code: 'AUTHORING_UNREGISTERED' }]);

  // Two owners that claim one path: neither is trusted, and neither is asked.
  const a = fakeOwner('authoring', { 'notes.md': 'file' }, { result: 'verified' }), b = fakeOwner('manifest', { 'notes.md': 'file' }, { result: 'verified' });
  const both = await inspectStartup(p.dir, { owners: [a.owner, b.owner, ok.owner] });
  assert.deepEqual(both.drift, [{ path: '.bowerloom/notes.md', kind: 'owner-refused', code: 'OWNER_CONFLICT' }]);
  assert.deepEqual(a.calls, []); assert.deepEqual(b.calls, []);

  // A verifier that throws, or answers with anything but a verdict, refuses.
  for (const verdict of [new Error('boom'), { result: 'yes' }, null, { result: 'refused', code: 'bad code' }, { result: 'verified', extra: 1 }]) {
    const odd = fakeOwner('authoring', { 'teams/x': 'directory', 'notes.md': 'file' }, verdict);
    const r = await inspectStartup(p.dir, { owners: [odd.owner] });
    assert.equal(r.status, 'drifted', JSON.stringify(verdict)); assert.ok(r.drift.every(d => d.kind === 'owner-refused' && d.code === 'OWNER_REFUSED'), JSON.stringify(r.drift));
  }
});

test('an owner claim of the wrong kind is no claim', async t => {
  const p = await project(t);
  fs.writeFileSync(join(p.bowerloom, 'notes.md'), 'x');
  const dirOnly = fakeOwner('authoring', { 'notes.md': 'directory' }, { result: 'verified' });
  const r = await inspectStartup(p.dir, { owners: [dirOnly.owner] });
  assert.deepEqual(r.drift, [{ path: '.bowerloom/notes.md', kind: 'unexpected' }]); assert.deepEqual(dirOnly.calls, []);
});

test('an unregistered teams/x/, a stray root file, and a symlink are drift with the real owners', async t => {
  const p = await project(t), owners = [authoringVerifier(p.dir), manifestVerifier(p.dir)];
  fs.mkdirSync(join(p.bowerloom, 'teams', 'x')); fs.writeFileSync(join(p.bowerloom, 'teams', 'x', 'team.yaml'), 'id: x\n');
  fs.writeFileSync(join(p.bowerloom, 'stray.txt'), 'x');
  fs.symlinkSync(join(p.bowerloom, 'teams', 'first-team'), join(p.bowerloom, 'teams', 'linked'));
  fs.symlinkSync(join(p.bowerloom, 'brief.json'), join(p.bowerloom, 'skills.json'));
  const r = await inspectStartup(p.dir, { owners });
  assert.equal(r.status, 'drifted');
  assert.deepEqual(r.drift, [
    { path: '.bowerloom/skills.json', kind: 'unsafe' },
    { path: '.bowerloom/stray.txt', kind: 'unexpected' },
    { path: '.bowerloom/teams/linked', kind: 'unsafe' },
    { path: '.bowerloom/teams/x', kind: 'owner-refused', code: 'AUTHORING_UNREGISTERED' },
  ]);
  // Nothing claimed is trusted by its name alone: an owner is never asked about a symlink.
  const spy = fakeOwner('authoring', { 'teams/linked': 'directory', 'teams/linked/': 'directory' }, { result: 'verified' });
  const again = await inspectStartup(p.dir, { owners: [spy.owner] });
  assert.ok(again.drift.some(d => d.path === '.bowerloom/teams/linked' && d.kind === 'unsafe')); assert.deepEqual(spy.calls.filter(([x]) => x === 'teams/linked'), []);
});

test('a valid skills.json passes the manifest owner, and an invalid one is refused with its code', async t => {
  const p = await project(t), owners = [authoringVerifier(p.dir), manifestVerifier(p.dir)];
  fs.writeFileSync(join(p.bowerloom, 'skills.json'), '{\n  "format": "bowerloom/skills/v1beta1",\n  "harnesses": [\n    "claude",\n    "codex"\n  ],\n  "skills": []\n}\n', { mode: 0o644 });
  const ready = await inspectStartup(p.dir, { owners });
  assert.equal(ready.status, 'ready-for-review', JSON.stringify(ready.drift)); assert.deepEqual(ready.owned, [{ path: '.bowerloom/skills.json', owner: 'manifest', state: 'verified' }]);
  fs.writeFileSync(join(p.bowerloom, 'skills.json'), '{"format": "nope"}\n');
  const bad = await inspectStartup(p.dir, { owners });
  assert.deepEqual(bad.drift, [{ path: '.bowerloom/skills.json', kind: 'owner-refused', code: 'MANIFEST_INVALID' }]);
  fs.chmodSync(join(p.bowerloom, 'skills.json'), 0o666);
  assert.deepEqual((await inspectStartup(p.dir, { owners })).drift, [{ path: '.bowerloom/skills.json', kind: 'owner-refused', code: 'MANIFEST_UNSAFE' }]);
});

test('the 256-entry limit still applies to the unowned walk; an owned folder is verified whole and not walked', async t => {
  const p = await project(t);
  // A claimed folder with 300 entries: its owner verifies it whole, so the walk does not count them.
  fs.mkdirSync(join(p.bowerloom, 'bulk'));
  for (let i = 0; i < 300; i++) fs.writeFileSync(join(p.bowerloom, 'bulk', `f${i}`), 'x');
  const bulk = fakeOwner('authoring', { bulk: 'directory' }, { result: 'verified' });
  const ok = await inspectStartup(p.dir, { owners: [bulk.owner] });
  assert.equal(ok.status, 'ready-for-review', JSON.stringify(ok.drift.slice(0, 3)));
  // 257 unowned root files pass the limit, with or without owners.
  for (let i = 0; i < 257; i++) fs.writeFileSync(join(p.bowerloom, `stray-${i}`), 'x');
  for (const options of [undefined, { owners: [bulk.owner] }]) {
    const r = await inspectStartup(p.dir, options);
    assert.equal(r.status, 'drifted'); assert.ok(r.drift.some(d => d.path === '.bowerloom' && d.kind === 'unsafe'), JSON.stringify(r.drift.slice(-2)));
  }
});

test('owners must be a list of verifiers', async t => {
  const p = await project(t);
  for (const owners of [{}, [null], [{ owner: 'authoring' }], [{ owner: 'other', claims: () => false, verify: async () => ({ result: 'verified' }) }], Array.from({ length: 9 }, () => ({ owner: 'authoring', claims: () => false, verify: async () => ({ result: 'verified' }) }))]) {
    await assert.rejects(inspectStartup(p.dir, { owners }), e => e?.code === 'STARTUP_INPUT', JSON.stringify(owners));
  }
  await assert.rejects(inspectStartup(p.dir, { owners: [], extra: 1 }), e => e?.code === 'STARTUP_INPUT');
});
