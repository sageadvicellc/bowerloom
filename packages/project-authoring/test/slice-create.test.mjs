// Spec 05, section 10.10: `slice create`.
import test from '../../../dist/tests/support/lock-slot-retry.js';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { planStartup, applyStartup, inspectStartup } from '../../../dist/packages/startup/src/index.js';
import { withProjectLock } from '../../../dist/packages/project-context/src/index.js';
import { planCreate, applyCreate, authoringVerifier, manifestVerifier, AUTHORING_REFUSAL_CODES } from '../../../dist/packages/project-authoring/src/index.js';
import { sliceTemplate } from '../../../dist/packages/context-slices/src/render.js';
import { addLocalEntry } from '../../../dist/packages/skill-manifest/src/add.js';
import { MANIFEST_LIMITS } from '../../../dist/packages/skill-manifest/src/schema.js';
import { planManifestChange } from '../../../dist/packages/skill-manifest/src/add.js';

const sha = value => createHash('sha256').update(value).digest('hex');
const code = expected => error => { assert.equal(error?.code, expected, error?.stack); return true; };
const signal = () => new AbortController().signal;
async function project(t) {
  const parent = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), 'bowerloom-slice-create-'))); fs.chmodSync(parent, 0o700);
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  const dir = join(parent, 'studio'); fs.mkdirSync(dir, { mode: 0o755 });
  const input = { mode: 'existing', targetDir: dir, brief: { projectName: 'Studio handbook', goal: 'Prepare a fictional onboarding kit for an independent design studio.', profile: 'founder' } };
  await applyStartup(input, (await planStartup(input)).revision);
  return { dir, bowerloom: join(dir, '.bowerloom') };
}
const slice = (p, name, extra = {}) => ({ kind: 'slice', project: p.dir, name, root: null, includes: null, ...extra });
const create = (p, input) => withProjectLock(p.dir, signal(), async held => applyCreate(input, (await planCreate(input)).revision, held));
const owners = dir => [authoringVerifier(dir), manifestVerifier(dir)];
const receipt = p => JSON.parse(fs.readFileSync(join(p.bowerloom, 'authoring', 'receipt.json'), 'utf8'));
const TEMPLATE = sliceTemplate({ root: { kind: 'project', path: '.' }, includes: ['**/*.md'] });

test('1. slice create wiki plans one file with the template bytes and registers it', async t => {
  const p = await project(t), plan = await planCreate(slice(p, 'wiki'));
  assert.equal(plan.item.kind, 'slice'); assert.equal(plan.item.id, 'wiki'); assert.deepEqual(plan.item.teams, []); assert.equal(plan.register, null);
  assert.deepEqual(plan.files.map(f => [f.path, f.text]), [['slices/wiki.yaml', TEMPLATE]]); assert.deepEqual(plan.slice, { root: { kind: 'project', path: '.' }, includes: ['**/*.md'] });
  assert.deepEqual(plan.folders, ['authoring', 'slices']); assert.equal(plan.writesAuthorized, false);
});
test('2. apply writes the file and the receipt lists kind slice', async t => {
  const p = await project(t); await create(p, slice(p, 'wiki'));
  assert.equal(fs.readFileSync(join(p.bowerloom, 'slices', 'wiki.yaml'), 'utf8'), TEMPLATE);
  const item = receipt(p).items.find(i => i.kind === 'slice'); assert.equal(item.id, 'wiki'); assert.deepEqual(item.teams, []); assert.deepEqual(item.files, [{ path: 'slices/wiki.yaml', sha256: sha(TEMPLATE), bytes: Buffer.byteLength(TEMPLATE) }]);
  assert.equal(fs.lstatSync(join(p.bowerloom, 'slices', 'wiki.yaml')).nlink, 1); assert.deepEqual(fs.readdirSync(join(p.bowerloom, 'authoring')), ['receipt.json']);
  assert.equal((await inspectStartup(p.dir, { owners: owners(p.dir) })).status, 'ready-for-review');
});
test('3. --root wiki --include a/*.md --include b.md writes those values', async t => {
  const p = await project(t); await create(p, slice(p, 'wiki', { root: { kind: 'project', path: 'wiki' }, includes: ['a/*.md', 'b.md'] }));
  assert.equal(fs.readFileSync(join(p.bowerloom, 'slices', 'wiki.yaml'), 'utf8'), sliceTemplate({ root: { kind: 'project', path: 'wiki' }, includes: ['a/*.md', 'b.md'] }));
  // The authoring layer also takes a registered root, which the command line takes only in the second part.
  await create(p, slice(p, 'kb', { root: { kind: 'registered', name: 'kb', path: 'wiki' } }));
  assert.match(fs.readFileSync(join(p.bowerloom, 'slices', 'kb.yaml'), 'utf8'), /root:\n  registered: kb\n  path: "wiki"\n/);
});
test('4. an existing unregistered valid file gives the register plan, and apply keeps its bytes', async t => {
  const p = await project(t), own = TEMPLATE.replace('Describe what this slice holds and which agents use it.', 'Mine, edited by hand.');
  fs.mkdirSync(join(p.bowerloom, 'slices'), { mode: 0o755 }); fs.writeFileSync(join(p.bowerloom, 'slices', 'wiki.yaml'), own, { mode: 0o644 });
  assert.equal((await inspectStartup(p.dir, { owners: owners(p.dir) })).drift.some(d => d.code === 'AUTHORING_UNREGISTERED'), true);
  const plan = await planCreate(slice(p, 'wiki'));
  assert.equal(plan.item, null); assert.deepEqual(plan.register, { kind: 'slice', id: 'wiki', teams: [], files: [{ path: 'slices/wiki.yaml', sha256: sha(own), bytes: Buffer.byteLength(own) }] }); assert.deepEqual(plan.files, []); assert.equal(plan.slice, null);
  await create(p, slice(p, 'wiki'));
  assert.equal(fs.readFileSync(join(p.bowerloom, 'slices', 'wiki.yaml'), 'utf8'), own); assert.equal(receipt(p).items.find(i => i.kind === 'slice').files[0].sha256, sha(own));
  assert.equal((await inspectStartup(p.dir, { owners: owners(p.dir) })).status, 'ready-for-review');
  // Flags that the file already says refuse USAGE.
  fs.writeFileSync(join(p.bowerloom, 'slices', 'other.yaml'), own);
  await assert.rejects(planCreate(slice(p, 'other', { root: { kind: 'project', path: 'x' } })), code('USAGE')); await assert.rejects(planCreate(slice(p, 'other', { includes: ['x.md'] })), code('USAGE'));
});
test('4b. a register plan whose file changes after the plan refuses STALE_APPROVAL', async t => {
  const p = await project(t); fs.mkdirSync(join(p.bowerloom, 'slices'), { mode: 0o755 }); fs.writeFileSync(join(p.bowerloom, 'slices', 'wiki.yaml'), TEMPLATE, { mode: 0o644 });
  const input = slice(p, 'wiki'), plan = await planCreate(input); fs.appendFileSync(join(p.bowerloom, 'slices', 'wiki.yaml'), '# edited\n');
  await assert.rejects(withProjectLock(p.dir, signal(), held => applyCreate(input, plan.revision, held)), code('STALE_APPROVAL')); assert.equal(fs.existsSync(join(p.bowerloom, 'authoring', 'receipt.json')), false);
});
test('5. an existing unregistered invalid file refuses SLICE_INVALID, and the message holds the detail', async t => {
  const p = await project(t); fs.mkdirSync(join(p.bowerloom, 'slices'), { mode: 0o755 });
  fs.writeFileSync(join(p.bowerloom, 'slices', 'wiki.yaml'), 'format: bowerloom/context-slice/v1beta1\ndescription: d\ninclude: [x.md]\nguard: strict\n', { mode: 0o644 });
  await assert.rejects(planCreate(slice(p, 'wiki')), e => { assert.equal(e.code, 'SLICE_INVALID'); assert.match(e.message, /^A slice file in \.bowerloom\/slices cannot be used\. the key guard is root or none\.$/); return true; });
  fs.writeFileSync(join(p.bowerloom, 'slices', 'wiki.yaml'), 'format: bowerloom/context-slice/v1beta1\nincludes: x\n');
  await assert.rejects(planCreate(slice(p, 'wiki')), e => e.code === 'SLICE_KEY_UNKNOWN' || e.code === 'SLICE_INVALID');
});
test('6. a registered slice refuses SLICE_EXISTS', async t => { const p = await project(t); await create(p, slice(p, 'wiki')); await assert.rejects(planCreate(slice(p, 'wiki')), code('SLICE_EXISTS')); });
test('7. a registered slice whose file is gone refuses AUTHORING_ITEM_MISSING', async t => {
  const p = await project(t); await create(p, slice(p, 'wiki')); fs.rmSync(join(p.bowerloom, 'slices', 'wiki.yaml'));
  await assert.rejects(planCreate(slice(p, 'wiki')), code('AUTHORING_ITEM_MISSING'));
  assert.equal((await inspectStartup(p.dir, { owners: owners(p.dir) })).drift.some(d => d.code === 'AUTHORING_ITEM_MISSING'), true);
});
test('8. Wiki.yaml beside slice create wiki refuses SLICE_EXISTS', async t => {
  const p = await project(t); fs.mkdirSync(join(p.bowerloom, 'slices'), { mode: 0o755 }); fs.writeFileSync(join(p.bowerloom, 'slices', 'Wiki.yaml'), TEMPLATE);
  await assert.rejects(planCreate(slice(p, 'wiki')), code('SLICE_EXISTS'));
});
test('9. a local skill or a skills.json entry slice-wiki makes slice create wiki refuse SLICE_EXISTS', async t => {
  const p = await project(t); fs.mkdirSync(join(p.bowerloom, 'skills', 'slice-wiki'), { recursive: true, mode: 0o755 });
  await assert.rejects(planCreate(slice(p, 'wiki')), code('SLICE_EXISTS'));
  const q = await project(t); fs.writeFileSync(join(q.bowerloom, 'skills.json'), JSON.stringify({ format: 'bowerloom/skills/v1beta1', harnesses: ['claude', 'codex'], skills: [{ id: 'slice-wiki', source: { kind: 'local', path: 'skills/slice-wiki' } }] }, null, 2) + '\n');
  await assert.rejects(planCreate(slice(q, 'wiki')), code('SLICE_EXISTS'));
});
test('10. a 58-character id and prompt-x refuse SLICE_NAME_INVALID', async t => {
  const p = await project(t);
  for (const name of ['a'.repeat(58), 'prompt-x', 'Wiki', 'a--b', '']) await assert.rejects(planCreate(slice(p, name)), code('SLICE_NAME_INVALID'), name);
  assert.equal((await planCreate(slice(p, 'a'.repeat(57)))).item.id.length, 57);
});
test('11. a crash after the link plans Finish slice wiki, and pendingState accepts the stage link', async t => {
  const p = await project(t), input = slice(p, 'wiki'), plan = await planCreate(input);
  await assert.rejects(withProjectLock(p.dir, signal(), async held => {
    const unlink = fs.unlinkSync;
    fs.unlinkSync = function (target) { if (/authoring\/\.stage-[a-f0-9]{64}\/slices\/wiki\.yaml$/.test(String(target))) throw Object.assign(new Error('crash'), { code: 'EIO' }); return unlink.call(this, target); };
    try { return await applyCreate(input, plan.revision, held); } finally { fs.unlinkSync = unlink; }
  }), /crash/);
  assert.equal(fs.lstatSync(join(p.bowerloom, 'slices', 'wiki.yaml')).nlink, 2);
  const next = await planCreate(input); assert.equal(next.finish.id, 'wiki'); assert.equal(next.finish.kind, 'slice'); assert.equal(next.item, null);
  await withProjectLock(p.dir, signal(), held => applyCreate(input, next.revision, held));
  assert.equal(fs.lstatSync(join(p.bowerloom, 'slices', 'wiki.yaml')).nlink, 1); assert.deepEqual(fs.readdirSync(join(p.bowerloom, 'authoring')), ['receipt.json']);
  assert.equal(receipt(p).items.find(i => i.kind === 'slice').planRevision, plan.revision);
});
test('12. a crash before the link plans the clear line', async t => {
  const p = await project(t), input = slice(p, 'wiki'), plan = await planCreate(input);
  await assert.rejects(withProjectLock(p.dir, signal(), async held => {
    const link = fs.linkSync;
    fs.linkSync = function (from, to) { if (String(to).endsWith('slices/wiki.yaml')) throw Object.assign(new Error('crash'), { code: 'EIO' }); return link.call(this, from, to); };
    try { return await applyCreate(input, plan.revision, held); } finally { fs.linkSync = link; }
  }), /crash/);
  assert.equal(fs.existsSync(join(p.bowerloom, 'slices', 'wiki.yaml')), false);
  const next = await planCreate(input); assert.equal(next.discard.id, 'wiki'); assert.equal(next.discard.kind, 'slice'); assert.equal(next.item.id, 'wiki');
  await withProjectLock(p.dir, signal(), held => applyCreate(input, next.revision, held)); assert.equal(fs.existsSync(join(p.bowerloom, 'slices', 'wiki.yaml')), true);
});
test('13. skill create slice-x refuses SKILL_NAME_RESERVED, and prompt create slice-x refuses PROMPT_NAME_INVALID', async t => {
  const p = await project(t);
  await assert.rejects(planCreate({ kind: 'skill', project: p.dir, name: 'slice-x', teams: [] }), code('SKILL_NAME_RESERVED'));
  await assert.rejects(planCreate({ kind: 'prompt', project: p.dir, name: 'slice-x', teams: [] }), code('PROMPT_NAME_INVALID'));
  assert.equal((await planCreate({ kind: 'skill', project: p.dir, name: 'slicer', teams: [] })).item.id, 'slicer');
});
test('14. an old receipt with a skill slice-old still parses', async t => {
  const p = await project(t); await create(p, { kind: 'skill', project: p.dir, name: 'house-style', teams: [] });
  const file = join(p.bowerloom, 'authoring', 'receipt.json'), r = JSON.parse(fs.readFileSync(file, 'utf8'));
  // A receipt made before the prefix was reserved: rename the skill in the receipt, its folder, and its record.
  const old = JSON.stringify(r, null, 2).replaceAll('house-style', 'slice-old') + '\n';
  const parsed = JSON.parse(old); delete parsed.revision;
  const { canonicalJson } = await import('../../../dist/packages/contracts/src/index.js'); parsed.revision = sha(canonicalJson({ format: parsed.format, items: parsed.items }));
  fs.writeFileSync(file, JSON.stringify(parsed, null, 2) + '\n'); fs.renameSync(join(p.bowerloom, 'skills', 'house-style'), join(p.bowerloom, 'skills', 'slice-old'));
  const { readAuthoringState } = await import('../../../dist/packages/project-authoring/src/state.js');
  assert.deepEqual(readAuthoringState(p.bowerloom).receipt.value.items.map(i => i.id), ['slice-old']);
});
test('15. skills add whose derived id is slice-x refuses MANIFEST_INVALID', async t => {
  const p = await project(t);
  assert.throws(() => addLocalEntry(null, 'slice-x', [], MANIFEST_LIMITS), code('MANIFEST_INVALID'));
  assert.equal(addLocalEntry(null, 'slicer', [], MANIFEST_LIMITS).skills[0].id, 'slicer');
  const pinned = { id: 'slice-x', source: { kind: 'npm', registry: 'https://registry.npmjs.org', package: '@x/y', version: '1.0.0', integrity: 'sha512-' + 'a'.repeat(86) + '==', metadataSha256: 'a'.repeat(64), publisher: 'x' }, skill: { name: 'n', sourceRoot: 'skills/n' }, license: { spdx: 'MIT', files: ['LICENSE'] }, files: [{ path: 'SKILL.md', sourcePath: 'skills/n/SKILL.md', sha256: 'a'.repeat(64), bytes: 1 }, { path: 'LICENSE', sourcePath: 'LICENSE', sha256: 'b'.repeat(64), bytes: 1 }], references: [] };
  assert.throws(() => planManifestChange(p.dir, { add: pinned }), e => e.code === 'MANIFEST_INVALID' || e.code === 'SKILLS_ADD_SPEC_INVALID' || e.code?.startsWith('MANIFEST_'));
});
test('a slice id and the refusal codes of section 5 are in the authoring list', () => {
  for (const c of ['SLICE_INVALID', 'SLICE_KEY_UNKNOWN', 'SLICE_NAME_INVALID', 'SLICE_EXISTS']) assert.ok(AUTHORING_REFUSAL_CODES.includes(c), c);
});
test('plans are deterministic and read-only', async t => {
  const p = await project(t), before = fs.readdirSync(p.bowerloom, { recursive: true }).map(String).sort();
  const a = await planCreate(slice(p, 'wiki')), b = await planCreate(slice(p, 'wiki')); assert.deepEqual(a, b); assert.deepEqual(fs.readdirSync(p.bowerloom, { recursive: true }).map(String).sort(), before);
  assert.notEqual((await planCreate(slice(p, 'wiki', { includes: ['x.md'] }))).revision, a.revision);
});
