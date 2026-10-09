import test from '../../../dist/tests/support/lock-slot-retry.js';
import assert from 'node:assert/strict';
import { after } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { denyNetwork } from './support/fixtures.mjs';
import { npmCollections, gitVerificationLoop } from './support/expected.mjs';
import { addLocalEntry, planManifestChange, applyManifestChange, MANIFEST_CHANGE_FORMAT } from '../../../dist/packages/skill-manifest/src/add.js';
import { parseManifest, serializeManifest } from '../../../dist/packages/skill-manifest/src/schema.js';
import { checkManifest } from '../../../dist/packages/skill-manifest/src/check.js';
import { withProjectLock } from '../../../dist/packages/project-context/src/index.js';

const network = denyNetwork();
after(() => assert.deepEqual(network, [], 'no test in this file touches the network'));
const code = expected => error => error?.code === expected;
const sha = b => createHash('sha256').update(b).digest('hex');
const npmEntry = (id = 'synthetic-db-collections') => ({ id, ...npmCollections() });
const gitEntry = () => ({ id: 'verification-loop', teams: ['first-team'], ...gitVerificationLoop() });
function project(t) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'bowerloom-manifest-add-'))); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, '.bowerloom'), { mode: 0o755 }); fs.chmodSync(path.join(dir, '.bowerloom'), 0o755);
  return { dir, file: path.join(dir, '.bowerloom', 'skills.json'), listing: () => fs.readdirSync(path.join(dir, '.bowerloom')).sort() };
}
const locked = (dir, work) => withProjectLock(dir, new AbortController().signal, async held => work(held));

test('addLocalEntry is pure: it starts a manifest for both harnesses and returns a new one each time', () => {
  const first = addLocalEntry(null, 'house-style', []);
  assert.deepEqual(JSON.parse(serializeManifest(first)), { format: 'bowerloom/skills/v1beta1', harnesses: ['claude', 'codex'], skills: [{ id: 'house-style', source: { kind: 'local', path: 'skills/house-style' } }] });
  const second = addLocalEntry(first, 'brand-voice', ['writers', 'first-team']);
  assert.equal(first.skills.length, 1); assert.ok(Object.isFrozen(second));
  assert.deepEqual(second.skills.map(s => s.id), ['brand-voice', 'house-style']); assert.deepEqual(second.skills[0].teams, ['first-team', 'writers']);
  assert.equal(serializeManifest(parseManifest(Buffer.from(serializeManifest(second)))), serializeManifest(second));
  assert.throws(() => addLocalEntry(second, 'house-style', []), code('MANIFEST_DUPLICATE_ID'));
  for (const id of ['personal-assistant', 'prompt-x', 'Bad', '../x', '']) assert.throws(() => addLocalEntry(null, id, []), code('MANIFEST_INVALID'), id);
  assert.throws(() => addLocalEntry(null, 'ok', ['Bad Team']), code('MANIFEST_INVALID'));
  assert.throws(() => addLocalEntry(null, 'ok', ['a', 'a']), code('MANIFEST_INVALID'));
  let full = null; for (let i = 0; i < 32; i++) full = addLocalEntry(full, `s-${i}`, []);
  assert.throws(() => addLocalEntry(full, 's-32', []), code('MANIFEST_LIMIT'));
  assert.throws(() => addLocalEntry({ format: 'forged', harnesses: [], skills: [] }, 'x', []), code('MANIFEST_INVALID'));
});

test('a plan for a project with no skills.json binds a null before, the new bytes, and writes nothing', t => {
  const p = project(t), plan = planManifestChange(p.dir, { add: npmEntry() });
  assert.equal(plan.format, MANIFEST_CHANGE_FORMAT); assert.equal(plan.format, 'bowerloom/skills-manifest-change/v1beta1');
  assert.equal(plan.before, null); assert.match(plan.revision, /^[a-f0-9]{64}$/);
  assert.equal(plan.after.sha256, sha(plan.text)); assert.equal(plan.after.bytes, Buffer.byteLength(plan.text));
  assert.deepEqual(parseManifest(Buffer.from(plan.text)).skills.map(s => s.id), ['synthetic-db-collections']);
  assert.equal(plan.writesAuthorized, false); assert.equal(plan.executionAuthorized, false);
  assert.deepEqual(p.listing(), []);
  assert.equal(planManifestChange(p.dir, { add: npmEntry() }).revision, plan.revision, 'the same inputs give the same revision');
});

test('apply under the project lock writes exactly the planned bytes, atomically, and leaves no temporary', async t => {
  const p = project(t), plan = planManifestChange(p.dir, { add: npmEntry() });
  const receipt = await locked(p.dir, held => applyManifestChange(plan, plan.revision, held));
  assert.equal(fs.readFileSync(p.file, 'utf8'), plan.text); assert.deepEqual(p.listing(), ['skills.json']);
  assert.equal(fs.statSync(p.file).mode & 0o777, 0o644); assert.equal(receipt.sha256, plan.after.sha256);
  // The second change binds the first file's sha256.
  const next = planManifestChange(p.dir, { add: gitEntry() });
  assert.deepEqual(next.before, { sha256: sha(fs.readFileSync(p.file)), bytes: fs.statSync(p.file).size });
  await locked(p.dir, held => applyManifestChange(next, next.revision, held));
  assert.deepEqual(parseManifest(fs.readFileSync(p.file)).skills.map(s => s.id), ['synthetic-db-collections', 'verification-loop']);
  assert.equal(checkManifest(p.dir).skills.length, 2);
});

test('an edit after the plan, a file created after a null plan, and a wrong revision are stale; nothing is written', async t => {
  const p = project(t), plan = planManifestChange(p.dir, { add: npmEntry() });
  fs.writeFileSync(p.file, serializeManifest(addLocalEntry(null, 'house-style', [])));
  const edited = fs.readFileSync(p.file);
  await assert.rejects(locked(p.dir, held => applyManifestChange(plan, plan.revision, held)), code('STALE_APPROVAL'));
  assert.deepEqual(fs.readFileSync(p.file), edited); assert.deepEqual(p.listing(), ['skills.json']);
  const second = planManifestChange(p.dir, { add: npmEntry() });
  fs.writeFileSync(p.file, serializeManifest(addLocalEntry(null, 'other-style', [])));
  await assert.rejects(locked(p.dir, held => applyManifestChange(second, second.revision, held)), code('STALE_APPROVAL'));
  const third = planManifestChange(p.dir, { add: npmEntry() });
  await assert.rejects(locked(p.dir, held => applyManifestChange(third, '0'.repeat(64), held)), code('STALE_APPROVAL'));
  const forged = { ...third, text: third.text.replace('synthetic-db-collections', 'synthetic-db-collectionz') };
  await assert.rejects(locked(p.dir, held => applyManifestChange(forged, third.revision, held)), code('STALE_APPROVAL'));
  assert.deepEqual(p.listing(), ['skills.json']);
});

test('apply needs a live lock token for this project', async t => {
  const p = project(t), other = project(t), plan = planManifestChange(p.dir, { add: npmEntry() });
  assert.throws(() => applyManifestChange(plan, plan.revision, { dir: p.dir, assertHeld() {} }), code('PROJECT_LOCKED'));
  let kept; await locked(p.dir, async held => { kept = held; });
  assert.throws(() => applyManifestChange(plan, plan.revision, kept), code('PROJECT_LOCKED'));
  await assert.rejects(locked(other.dir, held => applyManifestChange(plan, plan.revision, held)), code('PROJECT_LOCKED'));
  assert.deepEqual(p.listing(), []);
});

test('an existing id or source, and an invalid existing manifest, refuse at plan time', t => {
  const p = project(t);
  fs.writeFileSync(p.file, serializeManifest(parseManifest(Buffer.from(JSON.stringify({ format: 'bowerloom/skills/v1beta1', harnesses: ['claude', 'codex'], skills: [npmEntry()] })))));
  assert.throws(() => planManifestChange(p.dir, { add: npmEntry() }), code('SKILLS_ADD_EXISTS'));
  assert.throws(() => planManifestChange(p.dir, { add: npmEntry('collections') }), code('SKILLS_ADD_EXISTS'), 'the same source under another id');
  fs.writeFileSync(p.file, '{"format":"bowerloom/skills/v1beta1"}');
  assert.throws(() => planManifestChange(p.dir, { add: npmEntry() }), code('MANIFEST_INVALID'));
  assert.throws(() => planManifestChange(p.dir, { add: { id: 'x', source: { kind: 'local', path: 'skills/y' } } }), code('MANIFEST_INVALID'));
  assert.throws(() => planManifestChange('relative/path', { add: npmEntry() }), code('USAGE'));
});

test('an unsafe skills.json or .bowerloom folder refuses: a link, a hard link, group write, a folder, oversize', t => {
  const cases = [
    p => { fs.writeFileSync(path.join(p.dir, 'real.json'), serializeManifest(addLocalEntry(null, 'a', []))); fs.symlinkSync(path.join(p.dir, 'real.json'), p.file); },
    p => { fs.writeFileSync(p.file, serializeManifest(addLocalEntry(null, 'a', []))); fs.linkSync(p.file, path.join(p.dir, 'second.json')); },
    p => { fs.writeFileSync(p.file, serializeManifest(addLocalEntry(null, 'a', []))); fs.chmodSync(p.file, 0o664); },
    p => { fs.mkdirSync(p.file); },
  ];
  for (const prepare of cases) { const p = project(t); prepare(p); assert.throws(() => planManifestChange(p.dir, { add: npmEntry() }), code('MANIFEST_UNSAFE')); assert.throws(() => checkManifest(p.dir), code('MANIFEST_UNSAFE')); }
  const big = project(t); fs.writeFileSync(big.file, Buffer.alloc(1024 * 1024 + 1, 0x20));
  assert.throws(() => planManifestChange(big.dir, { add: npmEntry() }), code('MANIFEST_LIMIT'));
  const loose = project(t); fs.chmodSync(path.join(loose.dir, '.bowerloom'), 0o775);
  assert.throws(() => planManifestChange(loose.dir, { add: npmEntry() }), code('MANIFEST_UNSAFE'));
  const linked = project(t); fs.renameSync(path.join(linked.dir, '.bowerloom'), path.join(linked.dir, 'real')); fs.symlinkSync(path.join(linked.dir, 'real'), path.join(linked.dir, '.bowerloom'));
  assert.throws(() => planManifestChange(linked.dir, { add: npmEntry() }), code('MANIFEST_UNSAFE'));
});

test('a .bowerloom folder replaced after the plan is stale', async t => {
  const p = project(t), plan = planManifestChange(p.dir, { add: npmEntry() });
  fs.renameSync(path.join(p.dir, '.bowerloom'), path.join(p.dir, 'old')); fs.mkdirSync(path.join(p.dir, '.bowerloom'), { mode: 0o755 }); fs.chmodSync(path.join(p.dir, '.bowerloom'), 0o755);
  await assert.rejects(locked(p.dir, held => applyManifestChange(plan, plan.revision, held)), code('STALE_APPROVAL'));
  assert.deepEqual(p.listing(), []);
});

test('checkManifest reports a valid file, and refuses an absent or invalid one with its code', t => {
  const p = project(t);
  assert.throws(() => checkManifest(p.dir), code('MANIFEST_NOT_FOUND'));
  fs.writeFileSync(p.file, serializeManifest(parseManifest(Buffer.from(JSON.stringify({ format: 'bowerloom/skills/v1beta1', harnesses: ['codex'], skills: [npmEntry(), gitEntry(), { id: 'house-style', source: { kind: 'local', path: 'skills/house-style' } }] })))));
  const check = checkManifest(p.dir);
  assert.equal(check.format, 'bowerloom/skills-manifest-check/v1beta1'); assert.equal(check.valid, true);
  assert.equal(check.sha256, sha(fs.readFileSync(p.file))); assert.deepEqual(check.harnesses, ['codex']);
  assert.deepEqual(check.skills, [
    { id: 'house-style', kind: 'local', pin: 'skills/house-style', teams: null },
    { id: 'synthetic-db-collections', kind: 'npm', pin: '@synthetic/db-skills@0.0.1:skills/synthetic-db/collections', teams: null },
    { id: 'verification-loop', kind: 'git', pin: `synthetic-owner/skills-repo@${gitEntry().source.commit}:skills/verification-loop`, teams: ['first-team'] },
  ]);
  fs.writeFileSync(p.file, fs.readFileSync(p.file, 'utf8').replace('"0.0.1"', '"^0.0.1"'));
  assert.throws(() => checkManifest(p.dir), code('MANIFEST_PIN_NOT_EXACT'));
  fs.writeFileSync(p.file, fs.readFileSync(p.file, 'utf8').replace('"^0.0.1"', '"0.0.1"').replace(/"spdx": "MIT"/, '"spdx": "GPL-3.0"'));
  assert.throws(() => checkManifest(p.dir), code('MANIFEST_LICENSE_UNSUPPORTED'));
});
