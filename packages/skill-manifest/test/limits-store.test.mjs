import test from '../../../dist/tests/support/lock-slot-retry.js';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { denyNetwork } from './support/fixtures.mjs';
import { npmCollections, gitVerificationLoop } from './support/expected.mjs';
import { addLocalEntry, planManifestChange, applyManifestChange, readManifestState, storeTarget, projectTarget } from '../../../dist/packages/skill-manifest/src/add.js';
import { parseManifest, serializeManifest, validateManifest, MANIFEST_LIMITS, STORE_MANIFEST_LIMITS } from '../../../dist/packages/skill-manifest/src/schema.js';
import { withProjectLock } from '../../../dist/packages/project-context/src/index.js';

denyNetwork();
const code = expected => error => error?.code === expected;
const sha = b => createHash('sha256').update(b).digest('hex');
function store(t) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'bowerloom-manifest-store-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const folder = path.join(dir, 'store'); fs.mkdirSync(folder, { mode: 0o700 });
  return { dir, folder, file: path.join(folder, 'skills.json') };
}
function many(count, limits) { let m = null; for (let i = 0; i < count; i++) m = addLocalEntry(m, `s-${String(i).padStart(3, '0')}`, [], limits); return m; }
// A manifest value with `count` local entries, built without the limit guard.
const raw = count => ({ format: 'bowerloom/skills/v1beta1', harnesses: ['claude', 'codex'], skills: Array.from({ length: count }, (_, i) => ({ id: `s-${String(i).padStart(3, '0')}`, source: { kind: 'local', path: `skills/s-${String(i).padStart(3, '0')}` } })) });
const bytesOf = count => Buffer.from(`${JSON.stringify(raw(count), null, 2)}\n`);

test('the store limits are 256 skills and 4 MiB, and the default object is unchanged', () => {
  assert.deepEqual({ ...STORE_MANIFEST_LIMITS }, { bytes: 4194304, skills: 256, teams: 32, idLength: 64 });
  assert.deepEqual({ ...MANIFEST_LIMITS }, { bytes: 1048576, skills: 128, teams: 32, idLength: 64 });
  assert.ok(Object.isFrozen(STORE_MANIFEST_LIMITS));
});

test('256 skills pass with the store limits and 257 give MANIFEST_LIMIT', () => {
  assert.equal(parseManifest(bytesOf(256), STORE_MANIFEST_LIMITS).skills.length, 256);
  assert.throws(() => parseManifest(bytesOf(257), STORE_MANIFEST_LIMITS), code('MANIFEST_LIMIT'));
  assert.throws(() => validateManifest(raw(257), STORE_MANIFEST_LIMITS), code('MANIFEST_LIMIT'));
});

test('200 skills pass parse, validate, serialize, and addLocalEntry with the store limits', () => {
  const m = many(200, STORE_MANIFEST_LIMITS);
  assert.equal(m.skills.length, 200);
  const text = serializeManifest(m, STORE_MANIFEST_LIMITS);
  assert.equal(parseManifest(Buffer.from(text), STORE_MANIFEST_LIMITS).skills.length, 200);
  assert.equal(validateManifest(JSON.parse(text), STORE_MANIFEST_LIMITS).skills.length, 200);
  assert.equal(addLocalEntry(m, 'one-more', [], STORE_MANIFEST_LIMITS).skills.length, 201);
  assert.throws(() => parseManifest(Buffer.from(text)), code('MANIFEST_LIMIT'), 'the project limits still refuse it');
});

test('the 257th skill is refused by addLocalEntry with the store limits, and the 129th with the default', () => {
  assert.throws(() => addLocalEntry(many(256, STORE_MANIFEST_LIMITS), 'x-257', [], STORE_MANIFEST_LIMITS), code('MANIFEST_LIMIT'));
  assert.throws(() => addLocalEntry(many(128), 'x-129', []), code('MANIFEST_LIMIT'));
  assert.throws(() => parseManifest(bytesOf(129)), code('MANIFEST_LIMIT'));
});

test('byte limits: 4 MiB passes with the store limits, one more byte fails; 1 MiB passes by default', () => {
  const pad = (limit, extra) => {
    const base = bytesOf(1).toString(); // ends with "}\n"
    const spaces = limit + extra - Buffer.byteLength(base);
    return Buffer.from(base.replace(/\n$/, ' '.repeat(spaces) + '\n'));
  };
  assert.equal(pad(STORE_MANIFEST_LIMITS.bytes, 0).length, 4194304);
  assert.equal(parseManifest(pad(STORE_MANIFEST_LIMITS.bytes, 0), STORE_MANIFEST_LIMITS).skills.length, 1);
  assert.throws(() => parseManifest(pad(STORE_MANIFEST_LIMITS.bytes, 1), STORE_MANIFEST_LIMITS), code('MANIFEST_LIMIT'));
  assert.equal(parseManifest(pad(MANIFEST_LIMITS.bytes, 0)).skills.length, 1);
  assert.throws(() => parseManifest(pad(MANIFEST_LIMITS.bytes, 1)), code('MANIFEST_LIMIT'));
});

test('readManifestState with a store target reads <store>/skills.json and refuses unsafe files', t => {
  const s = store(t);
  assert.deepEqual(readManifestState(storeTarget(s.folder)).file, null);
  const text = serializeManifest(many(2, STORE_MANIFEST_LIMITS), STORE_MANIFEST_LIMITS);
  fs.writeFileSync(s.file, text, { mode: 0o644 });
  const state = readManifestState(storeTarget(s.folder));
  assert.equal(state.file.sha256, sha(text));
  // A link.
  fs.rmSync(s.file); fs.writeFileSync(path.join(s.dir, 'real.json'), text, { mode: 0o644 }); fs.symlinkSync(path.join(s.dir, 'real.json'), s.file);
  assert.throws(() => readManifestState(storeTarget(s.folder)), code('MANIFEST_UNSAFE'));
  // A second hard link.
  fs.rmSync(s.file); fs.writeFileSync(s.file, text, { mode: 0o644 }); fs.linkSync(s.file, path.join(s.dir, 'second.json'));
  assert.throws(() => readManifestState(storeTarget(s.folder)), code('MANIFEST_UNSAFE'));
  fs.rmSync(path.join(s.dir, 'second.json'));
  // Group write.
  fs.chmodSync(s.file, 0o664);
  assert.throws(() => readManifestState(storeTarget(s.folder)), code('MANIFEST_UNSAFE'));
  fs.chmodSync(s.file, 0o644);
  assert.equal(readManifestState(storeTarget(s.folder)).file.sha256, sha(text));
  // The store limit on bytes applies: a file of 1 MiB + 1 reads in a store and refuses in a project folder.
  const big = Buffer.from(`${JSON.stringify(raw(1), null, 2)}${' '.repeat(MANIFEST_LIMITS.bytes + 1)}\n`);
  fs.writeFileSync(s.file, big, { mode: 0o644 });
  assert.equal(readManifestState(storeTarget(s.folder)).file.bytes.length, big.length);
  assert.throws(() => readManifestState(projectTarget(s.dir)), code('MANIFEST_UNSAFE'), 'no .bowerloom folder there');
});

test('readManifestState allowAbsent returns nulls for a missing folder, and refuses without the option', t => {
  const s = store(t), missing = path.join(s.dir, 'nope');
  assert.deepEqual(readManifestState(storeTarget(missing), { allowAbsent: true }), { bowerloom: null, file: null });
  assert.throws(() => readManifestState(storeTarget(missing)), code('MANIFEST_UNSAFE'));
  assert.throws(() => readManifestState(missing), code('MANIFEST_UNSAFE'));
});

test('a store plan has scope store, a null identity, the store manifest text, and storeCreate from the option only', t => {
  const s = store(t), missing = path.join(s.dir, 'later');
  const change = { add: { id: 'synthetic-db-collections', ...npmCollections() } };
  const plan = planManifestChange(storeTarget(missing), change, { storeCreate: true });
  assert.equal(plan.format, 'bowerloom/skills-manifest-change/v1beta2');
  assert.equal(plan.scope, 'store'); assert.equal(plan.bowerloom, null); assert.equal(plan.storeCreate, true);
  assert.equal(plan.manifest, '~/.bowerloom/skills.json'); assert.equal(plan.project, missing); assert.equal(plan.before, null);
  fs.mkdirSync(missing, { mode: 0o700 });
  assert.equal(planManifestChange(storeTarget(missing), change, { storeCreate: true }).revision, plan.revision, 'creating the folder does not change the revision');
  assert.notEqual(planManifestChange(storeTarget(missing), change, { storeCreate: false }).revision, plan.revision);
  assert.equal(planManifestChange(storeTarget(missing), change).storeCreate, false);
  const project = planManifestChange(storeTarget(s.folder), change);
  assert.equal(project.scope, 'store');
  const ofProject = (() => { fs.mkdirSync(path.join(s.dir, '.bowerloom'), { mode: 0o700 }); return planManifestChange(s.dir, change); })();
  assert.equal(ofProject.scope, 'project'); assert.equal(ofProject.storeCreate, false); assert.equal(ofProject.manifest, '.bowerloom/skills.json');
  assert.deepEqual(Object.keys(ofProject.bowerloom).sort(), ['device', 'inode']);
});

test('apply writes <store>/skills.json, keeps the hash checks, and reuses plan.storeCreate on its re-plan', async t => {
  const s = store(t), change = { add: { id: 'synthetic-db-collections', ...npmCollections() } };
  const plan = planManifestChange(storeTarget(s.folder), change, { storeCreate: true });
  const receipt = await withProjectLock(s.folder, new AbortController().signal, async held => applyManifestChange(plan, plan.revision, held));
  assert.equal(fs.readFileSync(s.file, 'utf8'), plan.text); assert.equal(receipt.manifest, '~/.bowerloom/skills.json');
  assert.equal(fs.statSync(s.file).mode & 0o777, 0o644);
  // A replay finds the skill already there.
  await assert.rejects(withProjectLock(s.folder, new AbortController().signal, async held => applyManifestChange(plan, plan.revision, held)), code('SKILLS_ADD_EXISTS'));
  // A tampered storeCreate invalidates the revision.
  const fresh = planManifestChange(storeTarget(s.folder), { add: { id: 'verification-loop', ...gitVerificationLoop() } }, {});
  await assert.rejects(withProjectLock(s.folder, new AbortController().signal, async held => applyManifestChange({ ...fresh, storeCreate: true }, fresh.revision, held)), code('STALE_APPROVAL'));
});
