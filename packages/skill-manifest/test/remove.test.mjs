// Spec 08, 4.5: the manifest change `{ remove: id }`. It drops one local entry from skills.json, binds the
// before-sha256 like an add, and never drops a pinned (npm or GitHub) entry. `receipt clean` uses it.
import test from '../../../dist/tests/support/lock-slot-retry.js';
import assert from 'node:assert/strict';
import { after } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { denyNetwork } from './support/fixtures.mjs';
import { npmCollections } from './support/expected.mjs';
import { planManifestChange, applyManifestChange, changeOf, storeTarget } from '../../../dist/packages/skill-manifest/src/add.js';
import { parseManifest, serializeManifest, MANIFEST_LIMITS, STORE_MANIFEST_LIMITS } from '../../../dist/packages/skill-manifest/src/schema.js';
import { withProjectLock } from '../../../dist/packages/project-context/src/index.js';

const network = denyNetwork();
after(() => assert.deepEqual(network, [], 'no test in this file touches the network'));
const code = expected => error => error?.code === expected;
const sha = b => createHash('sha256').update(b).digest('hex');
const npm = (id = 'synthetic-db-collections') => ({ id, ...npmCollections() });
const local = (id, teams) => ({ id, ...(teams ? { teams } : {}), source: { kind: 'local', path: `skills/${id}` } });
function project(t, skills, limits = MANIFEST_LIMITS) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'bowerloom-manifest-remove-'))); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, '.bowerloom'), { mode: 0o755 }); fs.chmodSync(path.join(dir, '.bowerloom'), 0o755);
  const file = path.join(dir, '.bowerloom', 'skills.json');
  if (skills) fs.writeFileSync(file, serializeManifest(parseManifest(Buffer.from(JSON.stringify({ format: 'bowerloom/skills/v1beta1', harnesses: ['claude', 'codex'], skills })), limits), limits));
  return { dir, file, listing: () => fs.readdirSync(path.join(dir, '.bowerloom')).sort() };
}
const locked = (dir, work) => withProjectLock(dir, new AbortController().signal, async held => work(held));
const skillsOf = file => parseManifest(fs.readFileSync(file), MANIFEST_LIMITS).skills;

test('1. remove drops a local entry; the last removal leaves a valid manifest with zero skills', async t => {
  const p = project(t, [local('house-style', ['research']), local('notes')]);
  const plan = planManifestChange(p.dir, { remove: 'house-style' });
  await locked(p.dir, held => applyManifestChange(plan, plan.revision, held));
  assert.deepEqual(skillsOf(p.file).map(s => s.id), ['notes']);
  const last = planManifestChange(p.dir, { remove: 'notes' });
  await locked(p.dir, held => applyManifestChange(last, last.revision, held));
  const text = fs.readFileSync(p.file, 'utf8');
  assert.deepEqual(JSON.parse(text), { format: 'bowerloom/skills/v1beta1', harnesses: ['claude', 'codex'], skills: [] });
  assert.deepEqual(parseManifest(Buffer.from(text), MANIFEST_LIMITS).skills, [], 'the file stays and parses');
  assert.deepEqual(p.listing(), ['skills.json']);
});

test('2. remove refuses a pinned entry with MANIFEST_INVALID and a missing id with SKILLS_ADD_REPLACE_MISSING; nothing is written', t => {
  const p = project(t, [npm(), local('notes')]), before = fs.readFileSync(p.file);
  assert.throws(() => planManifestChange(p.dir, { remove: 'synthetic-db-collections' }), code('MANIFEST_INVALID'), 'a pinned entry is never removed');
  assert.throws(() => planManifestChange(p.dir, { remove: 'nope' }), code('SKILLS_ADD_REPLACE_MISSING'));
  assert.throws(() => planManifestChange(project(t).dir, { remove: 'notes' }), code('SKILLS_ADD_REPLACE_MISSING'), 'no skills.json');
  assert.throws(() => planManifestChange(p.dir, { remove: 'notes', add: local('x') }), code('MANIFEST_INVALID'), 'one change at a time');
  assert.throws(() => planManifestChange(p.dir, { remove: 7 }), code('MANIFEST_INVALID'), 'the id is a string');
  assert.deepEqual(fs.readFileSync(p.file), before);
});

test('3. the plan carries change.remove with the removed entry and binds both hashes; changeOf gives { remove: id }', t => {
  const p = project(t, [local('house-style', ['research']), npm()]), before = fs.readFileSync(p.file);
  const plan = planManifestChange(p.dir, { remove: 'house-style' });
  assert.deepEqual(Object.keys(plan.change), ['remove']);
  assert.deepEqual(plan.change.remove, local('house-style', ['research']));
  assert.deepEqual(plan.before, { sha256: sha(before), bytes: before.length });
  assert.equal(plan.after.sha256, sha(plan.text)); assert.equal(plan.after.bytes, Buffer.byteLength(plan.text));
  assert.deepEqual(parseManifest(Buffer.from(plan.text), MANIFEST_LIMITS).skills.map(s => s.id), ['synthetic-db-collections']);
  assert.deepEqual(changeOf(plan), { remove: 'house-style' });
  assert.deepEqual(changeOf(planManifestChange(p.dir, { add: local('other') })), { add: local('other') }, 'an add is unchanged');
  assert.deepEqual(fs.readFileSync(p.file), before, 'planning writes nothing');
  assert.equal(planManifestChange(p.dir, { remove: 'house-style' }).revision, plan.revision, 'the same inputs give the same revision');
});

test('4. applyManifestChange writes the planned bytes and returns removed; a stale or forged remove plan writes nothing', async t => {
  const p = project(t, [local('house-style'), local('notes')]);
  const plan = planManifestChange(p.dir, { remove: 'notes' });
  const receipt = await locked(p.dir, held => applyManifestChange(plan, plan.revision, held));
  assert.deepEqual(receipt, { manifest: '.bowerloom/skills.json', removed: 'notes', sha256: plan.after.sha256, bytes: plan.after.bytes });
  assert.equal(fs.readFileSync(p.file, 'utf8'), plan.text);
  // The same plan again: the entry is gone, so the plan made again under the lock differs.
  await assert.rejects(locked(p.dir, held => applyManifestChange(plan, plan.revision, held)), code('SKILLS_ADD_REPLACE_MISSING'));
  const next = planManifestChange(p.dir, { remove: 'house-style' }), written = fs.readFileSync(p.file);
  const forged = { ...next, change: { remove: local('notes') } };
  await assert.rejects(locked(p.dir, held => applyManifestChange(forged, next.revision, held)), code('STALE_APPROVAL'));
  assert.deepEqual(fs.readFileSync(p.file), written);
});

test('4b. remove works on the store manifest with the store limits', async t => {
  const p = project(t, [local('house-style')], STORE_MANIFEST_LIMITS);
  // The store keeps skills.json in its own folder: the target's folder is `.bowerloom` here, locked by the project folder.
  const target = storeTarget(path.join(p.dir, ".bowerloom"));
  const plan = planManifestChange(target, { remove: 'house-style' });
  assert.equal(plan.scope, 'store'); assert.equal(plan.manifest, '~/.bowerloom/skills.json');
  await locked(path.join(p.dir, '.bowerloom'), held => applyManifestChange(plan, plan.revision, held));
  assert.deepEqual(parseManifest(fs.readFileSync(p.file), STORE_MANIFEST_LIMITS).skills, []);
});
