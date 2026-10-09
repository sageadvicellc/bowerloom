// `skills add --replace` at the package level: planManifestChange with { replace } moves one pinned entry to a new
// version or commit of the same package or repository, and binds the before-sha256 like an add.
import test from '../../../dist/tests/support/lock-slot-retry.js';
import assert from 'node:assert/strict';
import { after } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { denyNetwork } from './support/fixtures.mjs';
import { npmCollections, gitVerificationLoop } from './support/expected.mjs';
import { addLocalEntry, planManifestChange, applyManifestChange } from '../../../dist/packages/skill-manifest/src/add.js';
import { parseManifest, serializeManifest } from '../../../dist/packages/skill-manifest/src/schema.js';
import { withProjectLock } from '../../../dist/packages/project-context/src/index.js';

const network = denyNetwork();
after(() => assert.deepEqual(network, [], 'no test in this file touches the network'));
const code = expected => error => error?.code === expected;
const sha = b => createHash('sha256').update(b).digest('hex');
const COMMIT2 = 'c0ffee01'.repeat(5);
/** The npm collections entry at another version. The bytes are the recorded ones; only the pin moves. */
const npmAt = (version, id = 'synthetic-db-collections', pkg = '@synthetic/db-skills') => { const e = npmCollections(); return { id, ...e, source: { ...e.source, package: pkg, version } }; };
const gitAt = (commit, id = 'verification-loop', repository = 'synthetic-owner/skills-repo') => { const e = gitVerificationLoop(); return { id, teams: ['first-team'], ...e, source: { ...e.source, repository, commit } }; };
const local = id => ({ id, source: { kind: 'local', path: `skills/${id}` } });
function project(t, skills) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'bowerloom-manifest-replace-'))); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, '.bowerloom'), { mode: 0o755 }); fs.chmodSync(path.join(dir, '.bowerloom'), 0o755);
  const file = path.join(dir, '.bowerloom', 'skills.json');
  if (skills) fs.writeFileSync(file, serializeManifest(parseManifest(Buffer.from(JSON.stringify({ format: 'bowerloom/skills/v1beta1', harnesses: ['claude', 'codex'], skills })))));
  return { dir, file, listing: () => fs.readdirSync(path.join(dir, '.bowerloom')).sort() };
}
const locked = (dir, work) => withProjectLock(dir, new AbortController().signal, async held => work(held));
const skillsOf = file => parseManifest(fs.readFileSync(file)).skills;

test('replace moves an npm entry to a new version: the plan names the old and the new entry and binds the before-sha256', async t => {
  const p = project(t, [npmAt('0.0.1'), local('house-style')]), before = fs.readFileSync(p.file);
  const plan = planManifestChange(p.dir, { replace: npmAt('0.0.2') });
  assert.deepEqual(Object.keys(plan.change), ['replace']);
  assert.equal(plan.change.replace.from.source.version, '0.0.1'); assert.equal(plan.change.replace.to.source.version, '0.0.2');
  assert.equal(plan.change.replace.to.id, 'synthetic-db-collections');
  assert.deepEqual(plan.before, { sha256: sha(before), bytes: before.length });
  assert.equal(plan.after.sha256, sha(plan.text));
  assert.deepEqual(fs.readFileSync(p.file), before, 'planning writes nothing');
  assert.equal(planManifestChange(p.dir, { replace: npmAt('0.0.2') }).revision, plan.revision, 'the same inputs give the same revision');
  const receipt = await locked(p.dir, held => applyManifestChange(plan, plan.revision, held));
  assert.equal(receipt.replaced, 'synthetic-db-collections'); assert.equal(receipt.added, undefined); assert.equal(receipt.sha256, plan.after.sha256);
  assert.equal(fs.readFileSync(p.file, 'utf8'), plan.text); assert.deepEqual(p.listing(), ['skills.json']);
  const skills = skillsOf(p.file);
  assert.deepEqual(skills.map(s => [s.id, s.source.kind === 'npm' ? s.source.version : s.source.path]), [['house-style', 'skills/house-style'], ['synthetic-db-collections', '0.0.2']]);
});

test('replace moves a GitHub entry to a new commit and keeps the other entries and the teams it is given', async t => {
  const p = project(t, [npmAt('0.0.1'), gitAt('c0ffee00'.repeat(5))]);
  const plan = planManifestChange(p.dir, { replace: gitAt(COMMIT2) });
  assert.equal(plan.change.replace.from.source.commit, 'c0ffee00'.repeat(5)); assert.equal(plan.change.replace.to.source.commit, COMMIT2);
  await locked(p.dir, held => applyManifestChange(plan, plan.revision, held));
  const skills = skillsOf(p.file);
  assert.deepEqual(skills.map(s => s.id), ['synthetic-db-collections', 'verification-loop']);
  assert.equal(skills[1].source.commit, COMMIT2); assert.deepEqual(skills[1].teams, ['first-team']); assert.equal(skills[0].source.version, '0.0.1');
});

test('replace refuses a change of kind, package or repository with SKILLS_ADD_SOURCE_CHANGED, and writes nothing', t => {
  const p = project(t, [npmAt('0.0.1'), gitAt('c0ffee00'.repeat(5))]), before = fs.readFileSync(p.file);
  assert.throws(() => planManifestChange(p.dir, { replace: npmAt('0.0.2', 'synthetic-db-collections', '@synthetic/other-skills') }), code('SKILLS_ADD_SOURCE_CHANGED'), 'another package');
  assert.throws(() => planManifestChange(p.dir, { replace: gitAt(COMMIT2, 'synthetic-db-collections') }), code('SKILLS_ADD_SOURCE_CHANGED'), 'npm to GitHub');
  assert.throws(() => planManifestChange(p.dir, { replace: npmAt('0.0.2', 'verification-loop') }), code('SKILLS_ADD_SOURCE_CHANGED'), 'GitHub to npm');
  assert.throws(() => planManifestChange(p.dir, { replace: gitAt(COMMIT2, 'verification-loop', 'synthetic-owner/other-repo') }), code('SKILLS_ADD_SOURCE_CHANGED'), 'another repository');
  assert.deepEqual(fs.readFileSync(p.file), before);
});

test('replace refuses a local entry: an existing local skill has no pin to move, and a local replacement is invalid', t => {
  const p = project(t, [local('house-style'), npmAt('0.0.1')]), before = fs.readFileSync(p.file);
  assert.throws(() => planManifestChange(p.dir, { replace: npmAt('0.0.2', 'house-style') }), code('SKILLS_ADD_SOURCE_CHANGED'));
  assert.throws(() => planManifestChange(p.dir, { replace: local('house-style') }), code('MANIFEST_INVALID'));
  assert.throws(() => planManifestChange(p.dir, { replace: local('synthetic-db-collections') }), code('MANIFEST_INVALID'));
  assert.deepEqual(fs.readFileSync(p.file), before);
});

test('replace refuses a missing id, an unchanged pin, and a pin another entry already holds', t => {
  const empty = project(t);
  assert.throws(() => planManifestChange(empty.dir, { replace: npmAt('0.0.2') }), code('SKILLS_ADD_REPLACE_MISSING'), 'no skills.json');
  const p = project(t, [npmAt('0.0.1'), npmAt('0.0.2', 'collections-next')]);
  assert.throws(() => planManifestChange(p.dir, { replace: npmAt('0.0.2', 'other-id') }), code('SKILLS_ADD_REPLACE_MISSING'));
  assert.throws(() => planManifestChange(p.dir, { replace: npmAt('0.0.1') }), code('SKILLS_ADD_EXISTS'), 'the same pin');
  assert.throws(() => planManifestChange(p.dir, { replace: npmAt('0.0.2') }), code('SKILLS_ADD_EXISTS'), 'collections-next already pins 0.0.2');
  assert.throws(() => planManifestChange(p.dir, { add: npmAt('0.0.2'), replace: npmAt('0.0.2') }), code('MANIFEST_INVALID'), 'one change at a time');
});

test('a replace plan is stale after a concurrent edit or a concurrent replace; nothing is written', async t => {
  const p = project(t, [npmAt('0.0.1')]);
  const plan = planManifestChange(p.dir, { replace: npmAt('0.0.2') });
  fs.writeFileSync(p.file, serializeManifest(addLocalEntry(parseManifest(fs.readFileSync(p.file)), 'house-style', [])));
  const edited = fs.readFileSync(p.file);
  await assert.rejects(locked(p.dir, held => applyManifestChange(plan, plan.revision, held)), code('STALE_APPROVAL'));
  assert.deepEqual(fs.readFileSync(p.file), edited); assert.deepEqual(p.listing(), ['skills.json']);
  const first = planManifestChange(p.dir, { replace: npmAt('0.0.2') }), second = planManifestChange(p.dir, { replace: npmAt('0.0.3') });
  await locked(p.dir, held => applyManifestChange(first, first.revision, held));
  const applied = fs.readFileSync(p.file);
  await assert.rejects(locked(p.dir, held => applyManifestChange(second, second.revision, held)), code('STALE_APPROVAL'));
  assert.deepEqual(fs.readFileSync(p.file), applied); assert.equal(skillsOf(p.file).find(s => s.id === 'synthetic-db-collections').source.version, '0.0.2');
  const forged = { ...first, change: { replace: { ...first.change.replace, to: npmAt('0.0.9') } } };
  await assert.rejects(locked(p.dir, held => applyManifestChange(forged, first.revision, held)), code('STALE_APPROVAL'));
});
