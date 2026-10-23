// Spec 05, section 10.8: the managed item kind `slice`, one index skill per item.
import test from '../../../dist/tests/support/lock-slot-retry.js';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { syncBuiltinESMExports } from 'node:module';
import { itemId, itemRef, requestV2, locateV2, catalogItem, planManagedItem, inspectManagedProject, currentV2 } from '../../../dist/packages/managed-skills/src/v2-observed.js';
import { applyManagedItem, planManagedItemRecovery, recoverManagedItem } from '../../../dist/packages/managed-skills/src/v2-transaction.js';
import { readLocalSlice, readSliceTree } from '../../../dist/packages/managed-skills/src/local-source.js';
import { project, itemState, inventory, code } from './v2-fixture.mjs';

const live = () => {};
function restore(t) { t.mock.restoreAll(); syncBuiltinESMExports(); }
const SLICE = 'format: bowerloom/context-slice/v1beta1\ndescription: The wiki.\nroot: wiki\ninclude:\n  - "**/*.md"\nsummary: heading\nguard: root\n';
function sliceFile(f, name = 'wiki', text = SLICE, mode = 0o644) {
  const dir = path.join(f.projectDir, '.bowerloom/slices'); fs.mkdirSync(dir, { recursive: true, mode: 0o755 });
  const file = path.join(dir, name + '.yaml'); fs.writeFileSync(file, text, { mode }); fs.chmodSync(file, mode); return file;
}
function wikiFile(f, rel, text = '# Page\n') {
  const file = path.join(f.projectDir, 'wiki', rel); fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o755 });
  for (let p = path.dirname(file); p !== f.projectDir; p = path.dirname(p)) fs.chmodSync(p, 0o755);
  fs.writeFileSync(file, text, { mode: 0o644 }); return file;
}
function sliceRequest(f, id = 'wiki', extra = {}) {
  return { operation: 'install', projectDir: f.projectDir, stateDir: itemState(f, 'slice_' + id), item: { kind: 'slice', id }, harnesses: ['claude'], source: { kind: 'slice', name: id, root: { kind: 'project' } }, expectedPreviousRevision: null, minFreeBytes: 33554432, legacy: null, ...extra };
}
async function install(req) { const plan = await planManagedItem(req); return { plan, receipt: await applyManagedItem(null, req, plan.revision) }; }
const read = (f, rel) => fs.readFileSync(path.join(f.projectDir, rel), 'utf8');
function wiki(t) { const f = project(t); sliceFile(f); wikiFile(f, 'a.md', '# Alpha\n'); wikiFile(f, 'sub/b.md', '# Beta\n'); return f; }

test('1. locateV2 for a slice gives projection-claude at .claude/skills/slice-<id> and the catalog, and nothing else', () => {
  const req = { projectDir: '/tmp/p', item: { kind: 'slice', id: 'wiki' }, harnesses: ['claude'] };
  assert.deepEqual(locateV2(req, { name: 'wiki' }, { ignore: false, legacy: false }), [
    { id: 'projection-claude', kind: 'directory', path: '/tmp/p/.claude/skills/slice-wiki' },
    { id: 'catalog', kind: 'file', path: '/tmp/p/.bowerloom/managed/catalog/slice_wiki.json' },
  ]);
  assert.deepEqual(locateV2({ ...req, harnesses: ['claude', 'codex'] }, { name: 'wiki' }, { ignore: false, legacy: false }).map(s => s.id), ['projection-claude', 'catalog']);
  assert.deepEqual(locateV2(req, { name: 'wiki' }, { ignore: true, legacy: false }).map(s => s.id), ['ignore', 'projection-claude', 'catalog']);
});
test('2. requestV2 refuses a slice request whose harness list is not [claude]', t => {
  const f = project(t), good = sliceRequest(f);
  assert.equal(requestV2(good).item.kind, 'slice');
  for (const harnesses of [['codex'], ['claude', 'codex']]) assert.throws(() => requestV2({ ...good, harnesses }), `harnesses ${harnesses}`);
  assert.throws(() => requestV2({ ...good, source: { kind: 'slice', name: 'other', root: { kind: 'project' } } }));
  assert.throws(() => requestV2({ ...good, source: { kind: 'slice', name: 'wiki' } }));
  assert.throws(() => requestV2({ ...good, source: { kind: 'slice', name: 'wiki', root: { kind: 'project' }, extra: 1 } }));
  assert.throws(() => requestV2({ ...good, source: { kind: 'slice', name: 'wiki', root: { kind: 'registered', name: 'kb', dir: '/x', identity: {} } } }), 'an identity needs its three fields');
  assert.throws(() => requestV2({ ...good, item: { kind: 'skill', id: 'wiki' } }));
  assert.throws(() => requestV2({ ...good, stateDir: itemState(f, 'wiki') }));
  assert.throws(() => requestV2({ ...good, item: { kind: 'slice', id: 'prompt-x' }, source: { kind: 'slice', name: 'prompt-x', root: { kind: 'project' } }, stateDir: itemState(f, 'slice_prompt-x') }));
});
test('4. requestV2 refuses an agent source without the guard key, a guard list of 65 ids, and a repeat', t => {
  const f = project(t);
  const agent = guard => ({ operation: 'install', projectDir: f.projectDir, stateDir: itemState(f, 'agent_lead'), item: { kind: 'agent', id: 'lead' }, harnesses: ['claude'], source: { kind: 'agent', team: 'desk', name: 'lead', ...(guard === undefined ? {} : { guard }) }, expectedPreviousRevision: null, minFreeBytes: 33554432, legacy: null });
  assert.throws(() => requestV2(agent(undefined)));
  assert.equal(requestV2(agent(null)).item.kind, 'agent');
  assert.equal(requestV2(agent({ slices: ['a', 'b'], roots: ['a:' + 'a'.repeat(32)] })).item.kind, 'agent');
  const ids = Array.from({ length: 65 }, (_, i) => 's' + String(i).padStart(2, '0'));
  assert.throws(() => requestV2(agent({ slices: ids, roots: [] })));
  assert.throws(() => requestV2(agent({ slices: ['a', 'a'], roots: [] })));
  assert.throws(() => requestV2(agent({ slices: ['b', 'a'], roots: [] })), 'sorted');
  assert.throws(() => requestV2(agent({ slices: [], roots: [] })));
  assert.throws(() => requestV2(agent({ slices: ['a'], roots: ['b:' + 'a'.repeat(32)] })), 'a root names a listed slice');
  assert.throws(() => requestV2(agent({ slices: ['a'], roots: ['a:xyz'] })));
  const h = c => c.repeat(32); assert.equal(requestV2(agent({ slices: ['wiki', 'wiki-eng'], roots: ['wiki:' + h('a'), 'wiki-eng:' + h('b')] })).item.kind, 'agent');
  assert.throws(() => requestV2(agent({ slices: ['wiki', 'wiki-eng'], roots: ['wiki-eng:' + h('b'), 'wiki:' + h('a')] })), 'roots follow the slice list');
});
test('5. itemId gives slice_wiki, and 6. catalogItem tells a slice from a skill', () => {
  assert.equal(itemId({ kind: 'slice', id: 'wiki' }), 'slice_wiki');
  assert.deepEqual(catalogItem('slice_wiki.json'), { kind: 'slice', id: 'wiki' }); assert.deepEqual(catalogItem('slice-wiki.json'), { kind: 'skill', id: 'slice-wiki' });
  assert.deepEqual(catalogItem('agent_x.json'), { kind: 'agent', id: 'x' });
  assert.throws(() => itemRef({ kind: 'slice', id: 'a'.repeat(58) })); assert.throws(() => itemRef({ kind: 'slice', id: 'Wiki' }));
});
test('7. readClosure for a slice gives one file SKILL.md, skill === null, and the references', async t => {
  const f = wiki(t), plan = await planManagedItem(sliceRequest(f)), c = plan.core.closure;
  assert.equal(c.skill, null); assert.deepEqual(c.files.map(x => x.path), ['SKILL.md']); assert.equal(c.name, 'wiki');
  assert.deepEqual(c.references, ['a.md', 'sub/b.md', './', 'sub/']); assert.deepEqual(c.source, { kind: 'slice', path: 'slices/wiki.yaml', root: { kind: 'project', path: 'wiki' }, guard: 'root' });
  assert.match(c.files[0].text, /^---\nname: slice-wiki\n/); assert.match(c.files[0].text, /- `wiki\/a.md`: Alpha\n- `wiki\/sub\/b.md`: Beta\n$/);
});
test('8. materialV2 writes the index into the projection folder', async t => {
  const f = wiki(t), { plan } = await install(sliceRequest(f));
  assert.equal(read(f, '.claude/skills/slice-wiki/SKILL.md'), plan.core.closure.files[0].text);
  assert.deepEqual(fs.readdirSync(path.join(f.projectDir, '.claude/skills/slice-wiki')), ['SKILL.md']);
  assert.equal(fs.existsSync(path.join(f.projectDir, '.agents')), false);
});
test('9. the catalog holds references and the slice source, and no absolute path', async t => {
  const f = wiki(t); await install(sliceRequest(f));
  const text = read(f, '.bowerloom/managed/catalog/slice_wiki.json'), catalog = JSON.parse(text);
  assert.deepEqual(catalog.item, { kind: 'slice', id: 'wiki' }); assert.deepEqual(catalog.harnesses, ['claude']); assert.deepEqual(catalog.references, ['a.md', 'sub/b.md', './', 'sub/']);
  assert.deepEqual(catalog.source, { kind: 'slice', path: 'slices/wiki.yaml', root: { kind: 'project', path: 'wiki' }, guard: 'root' }); assert.equal(catalog.skill, null);
  assert.deepEqual(catalog.surfaces.map(s => s.id), ['projection-claude', 'catalog']); assert.equal(text.includes(f.projectDir), false);
  assert.equal(text.includes('Alpha'), false, 'the catalog holds paths and hashes, never titles');
});
test('10. sameSource accepts a root or guard change for a slice (an update plans)', async t => {
  const f = wiki(t); const req = sliceRequest(f); const { receipt } = await install(req);
  sliceFile(f, 'wiki', SLICE.replace('guard: root', 'guard: none')); wikiFile(f, 'new/c.md', '# Gamma\n');
  const plan = await planManagedItem({ ...req, operation: 'update', expectedPreviousRevision: receipt.revision });
  assert.equal(plan.format, 'bowerloom/managed-item-plan/v1beta2'); assert.equal(plan.core.closure.source.guard, 'none');
  const second = await applyManagedItem(null, { ...req, operation: 'update', expectedPreviousRevision: receipt.revision }, plan.revision);
  assert.notEqual(second.revision, receipt.revision); assert.doesNotMatch(read(f, '.claude/skills/slice-wiki/SKILL.md'), /guard blocks/);
  // A different root is an update too: the move keeps the item.
  sliceFile(f, 'wiki', SLICE.replace('root: wiki', 'root: wiki/sub'));
  const moved = await planManagedItem({ ...req, operation: 'update', expectedPreviousRevision: second.revision });
  assert.equal(moved.format, 'bowerloom/managed-item-plan/v1beta2'); assert.deepEqual(moved.core.closure.source.root, { kind: 'project', path: 'wiki/sub' });
});
test('up to date: the same tree plans nothing, and a body edit that keeps every heading changes nothing', async t => {
  const f = wiki(t); const req = sliceRequest(f); const { receipt } = await install(req);
  wikiFile(f, 'a.md', '# Alpha\nA new line of body text.\n');
  const again = await planManagedItem({ ...req, operation: 'update', expectedPreviousRevision: receipt.revision });
  assert.equal(again.status, 'up-to-date');
  wikiFile(f, 'a.md', '# Alpha two\n'); const changed = await planManagedItem({ ...req, operation: 'update', expectedPreviousRevision: receipt.revision });
  assert.equal(changed.format, 'bowerloom/managed-item-plan/v1beta2');
});
test('11. a transaction installs, updates, and rolls back a slice, as the prompt tests do', async t => {
  const f = wiki(t); const req = sliceRequest(f), { receipt } = await install(req);
  assert.equal(receipt.state, 'committed'); assert.deepEqual(receipt.item, { kind: 'slice', id: 'wiki' }); assert.deepEqual(receipt.harnesses, ['claude']);
  assert.equal(inspectManagedProject(f.projectDir, f.itemsRoot).items.find(i => i.item.kind === 'slice').status, 'committed');
  assert.equal(currentV2(f.projectDir, req.stateDir, req.item).revision, receipt.revision);
  wikiFile(f, 'z.md', '# Zed\n'); const update = { ...req, operation: 'update', expectedPreviousRevision: receipt.revision }, plan = await planManagedItem(update);
  const before = inventory(f.projectDir), earlier = read(f, '.claude/skills/slice-wiki/SKILL.md'), rename = fs.renameSync, op = path.join(req.stateDir, 'op-' + plan.operationKey);
  t.mock.method(fs, 'renameSync', (from, to) => { rename(from, to); if (String(from) === path.join(op, 'new-catalog')) throw Error('stop after catalog'); }); syncBuiltinESMExports();
  await assert.rejects(applyManagedItem(null, update, plan.revision)); restore(t);
  const p = await planManagedItemRecovery({ projectDir: update.projectDir, stateDir: update.stateDir, operationKey: plan.operationKey, action: 'rollback' }), result = await recoverManagedItem(p, p.revision);
  assert.equal(result.state, 'rolled-back'); assert.equal(read(f, '.claude/skills/slice-wiki/SKILL.md'), earlier); assert.deepEqual(inventory(f.projectDir), before);
});
test('a drifted index is refused, and nothing is overwritten', async t => {
  const f = wiki(t); const req = sliceRequest(f), { receipt } = await install(req);
  fs.appendFileSync(path.join(f.projectDir, '.claude/skills/slice-wiki/SKILL.md'), 'edited\n'); const before = inventory(f.projectDir);
  await assert.rejects(planManagedItem({ ...req, operation: 'update', expectedPreviousRevision: receipt.revision }), code('MANAGED_SKILL_LOCAL_DRIFT')); assert.deepEqual(inventory(f.projectDir), before);
});
test('13. readSliceTree returns a hold and no index for an invalid file, and throws nothing', t => {
  const f = project(t); sliceFile(f, 'wiki', 'format: bowerloom/context-slice/v1beta1\nincludes: [x]\n');
  const r = readSliceTree(f.projectDir, 'wiki', { kind: 'project' }, live); assert.equal(r.index, null); assert.equal(r.definition, null); assert.deepEqual(r.hold, { code: 'SLICE_KEY_UNKNOWN', detail: 'includes' });
  sliceFile(f, 'wiki', SLICE); const missing = readSliceTree(f.projectDir, 'wiki', { kind: 'project' }, live); assert.equal(missing.hold.code, 'SLICE_PATH_MISSING'); assert.equal(missing.hold.detail, 'wiki');
  fs.mkdirSync(path.join(f.projectDir, 'wiki'), { mode: 0o755 }); assert.equal(readSliceTree(f.projectDir, 'wiki', { kind: 'project' }, live).hold.code, 'SLICE_EMPTY');
  fs.chmodSync(path.join(f.projectDir, 'wiki'), 0o775); assert.equal(readSliceTree(f.projectDir, 'wiki', { kind: 'project' }, live).hold.code, 'SLICE_ROOT_UNSAFE');
  sliceFile(f, 'wiki', SLICE, 0o664); assert.equal(readSliceTree(f.projectDir, 'wiki', { kind: 'project' }, live).hold.code, 'SLICE_INVALID');
  assert.equal(readLocalSliceHold(f), 'MANAGED_SKILL_REFUSED');
});
function readLocalSliceHold(f) { try { readLocalSlice(f.projectDir, 'wiki', { kind: 'project' }, live); return 'none'; } catch (e) { return e.code; } }
test('14. readSliceTree throws MANAGED_SKILL_STALE_APPROVAL when a file changes during the read', t => {
  const f = wiki(t); const original = fs.readdirSync; let n = 0;
  t.mock.method(fs, 'readdirSync', (p, ...rest) => { const out = original.call(fs, p, ...rest); if (++n === 1) wikiFile(f, 'late.md', '# Late\n'); return out; }); syncBuiltinESMExports();
  assert.throws(() => readSliceTree(f.projectDir, 'wiki', { kind: 'project' }, live), code('MANAGED_SKILL_STALE_APPROVAL')); restore(t);
  // A member that changes after it was read is stale as well.
  const g = wiki(t); const realRead = fs.readSync; let reads = 0;
  t.mock.method(fs, 'readSync', (...args) => { const r = realRead.apply(fs, args); if (++reads === 3) fs.appendFileSync(path.join(g.projectDir, 'wiki/a.md'), 'x'); return r; }); syncBuiltinESMExports();
  assert.throws(() => readSliceTree(g.projectDir, 'wiki', { kind: 'project' }, live), e => ['MANAGED_SKILL_STALE_APPROVAL'].includes(e.code)); restore(t);
});
test('a slice index and its catalog carry no member text', async t => {
  const f = project(t); sliceFile(f); wikiFile(f, 'a.md', '# Alpha\nSECRET-BODY-SENTENCE\n'); await install(sliceRequest(f));
  for (const rel of ['.claude/skills/slice-wiki/SKILL.md', '.bowerloom/managed/catalog/slice_wiki.json']) assert.equal(read(f, rel).includes('SECRET-BODY-SENTENCE'), false, rel);
  const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
  for (const file of [...walk(f.stateRoot)]) assert.equal(fs.readFileSync(file, 'utf8').includes('SECRET-BODY-SENTENCE'), false, file);
});

// Review fixes S2 and C5, through the real tree reader.
const asRoot = process.getuid?.() === 0;
const tree = f => readSliceTree(f.projectDir, 'wiki', { kind: 'project' }, live);
test('S2. a folder or member that cannot be read holds SLICE_SOURCE_UNSAFE with the path and the errno, and is not stale', { skip: asRoot ? 'root can read a mode 000 folder' : false }, t => {
  const f = wiki(t); wikiFile(f, 'locked/c.md', '# C\n'); const locked = path.join(f.projectDir, 'wiki/locked'), file = path.join(f.projectDir, 'wiki/a.md');
  try {
    fs.chmodSync(locked, 0o000);
    const r = tree(f); assert.equal(r.hold.code, 'SLICE_SOURCE_UNSAFE'); assert.equal(r.hold.detail, 'wiki/locked'); assert.equal(r.hold.errno, 'EACCES'); assert.equal(r.index, null);
    fs.chmodSync(locked, 0o755); fs.chmodSync(file, 0o000);
    const m = tree(f); assert.equal(m.hold.code, 'SLICE_SOURCE_UNSAFE'); assert.equal(m.hold.detail, 'wiki/a.md'); assert.equal(m.hold.errno, 'EACCES');
  } finally { fs.chmodSync(locked, 0o755); fs.chmodSync(file, 0o644); }
});
test('S2. a member that vanishes during the read is still stale', t => {
  const f = wiki(t); const original = fs.openSync; let hit = false;
  t.mock.method(fs, 'openSync', (p, ...rest) => { if (!hit && String(p).endsWith('wiki/a.md')) { hit = true; fs.unlinkSync(p); } return original.call(fs, p, ...rest); }); syncBuiltinESMExports();
  assert.throws(() => tree(f), code('MANAGED_SKILL_STALE_APPROVAL')); restore(t);
});
test('C5. a folder with 1024 names is read, and one with 1025 holds SLICE_TOO_LARGE', t => {
  const f = project(t); sliceFile(f); const dir = path.join(f.projectDir, 'wiki'); fs.mkdirSync(dir, { mode: 0o755 }); fs.chmodSync(dir, 0o755);
  for (let i = 0; i < 1024; i++) fs.writeFileSync(path.join(dir, `n${i}.txt`), 'x', { mode: 0o644 });
  assert.equal(tree(f).hold.code, 'SLICE_EMPTY', 'no name is refused at the limit');
  fs.writeFileSync(path.join(dir, 'one-more.txt'), 'x', { mode: 0o644 });
  const r = tree(f); assert.equal(r.hold.code, 'SLICE_TOO_LARGE'); assert.equal(r.index, null);
});
test('C5. an index over 64 KiB holds SLICE_TOO_LARGE, and summary: none fits the same files', t => {
  const f = project(t); sliceFile(f);
  for (let i = 0; i < 250; i++) wikiFile(f, `${'d'.repeat(100)}/${String(i).padStart(3, '0')}${'x'.repeat(80)}.md`, `# ${'h'.repeat(200)}\n`);
  const big = tree(f); assert.equal(big.hold.code, 'SLICE_TOO_LARGE'); assert.equal(big.hold.detail, 'the index'); assert.equal(big.index, null);
  sliceFile(f, 'wiki', SLICE.replace('summary: heading', 'summary: none'));
  const small = tree(f); assert.equal(small.hold, null); assert.ok(Buffer.byteLength(small.index) <= 65536 && Buffer.byteLength(small.index) > 40000);
});

// ---------------------------------------------------------------------------------------------------- Part B: registered roots
// The lookup that project-sync passes in stands for the store; here it is a function over a real folder next to the project.
const REGISTERED = 'format: bowerloom/context-slice/v1beta1\ndescription: The wiki.\nroot:\n  registered: kb\n  path: wiki\ninclude:\n  - "**/*.md"\nsummary: heading\nguard: root\n';
const idOf = dir => { try { const s = fs.statSync(dir, { bigint: true }); return { device: String(s.dev), inode: String(s.ino), birthtimeNs: String(s.birthtimeNs) }; } catch { return { device: '0', inode: '0', birthtimeNs: '0' }; } };
function kb(f, rel = 'wiki') {
  const root = path.join(f.base, 'kb'); fs.mkdirSync(path.join(root, rel, 'sub'), { recursive: true, mode: 0o755 });
  for (const p of [root, path.join(root, rel), path.join(root, rel, 'sub')]) fs.chmodSync(p, 0o755);
  fs.writeFileSync(path.join(root, rel, 'a.md'), '# Alpha\n', { mode: 0o644 }); fs.writeFileSync(path.join(root, rel, 'sub/b.md'), '# Beta\n', { mode: 0o644 });
  return root;
}
const lookup = (root, record = 'a'.repeat(64)) => (name, sub) => {
  if (name !== 'kb') return { ok: false, code: 'SLICE_ROOT_MISSING', detail: name };
  const dir = sub === '.' ? root : path.join(root, sub); return { ok: true, dir, identity: idOf(dir), recordSha256: record };
};
const regRoot = (root, sub = 'wiki') => ({ kind: 'registered', name: 'kb', dir: path.join(root, sub), identity: idOf(path.join(root, sub)) });
const registeredRequest = (f, root, extra = {}) => sliceRequest(f, 'wiki', { source: { kind: 'slice', name: 'wiki', root: regRoot(root) }, ...extra });
function registeredWiki(t) { const f = project(t); sliceFile(f, 'wiki', REGISTERED); const root = kb(f); return { f, root }; }

test('B1. requestV2 takes a registered root with an absolute dir outside the project and the state folder', t => {
  const { f, root } = registeredWiki(t), good = registeredRequest(f, root);
  assert.equal(requestV2(good).source.root.kind, 'registered');
  const withRoot = r => ({ ...good, source: { kind: 'slice', name: 'wiki', root: r } }), reg = regRoot(root);
  for (const [why, bad] of [
    ['a relative dir', { ...reg, dir: 'kb/wiki' }], ['a dir with a NUL', { ...reg, dir: reg.dir + '\0' }], ['the project folder itself', { ...reg, dir: f.projectDir }], ['a folder in the project', { ...reg, dir: path.join(f.projectDir, 'wiki') }],
    ['the state folder', { ...reg, dir: good.stateDir }], ['a folder in the state folder', { ...reg, dir: path.join(good.stateDir, 'x') }], ['a bad name', { ...reg, name: 'KB' }], ['no name', { ...reg, name: '' }],
    ['an extra key', { ...reg, extra: 1 }], ['a missing identity key', { ...reg, identity: { device: '1', inode: '2' } }], ['an extra identity key', { ...reg, identity: { ...reg.identity, uid: 1 } }],
    ['a non-decimal inode', { ...reg, identity: { ...reg.identity, inode: 'abc' } }], ['a number for the device', { ...reg, identity: { ...reg.identity, device: 1 } }], ['an unknown kind', { ...reg, kind: 'other' }],
  ]) assert.throws(() => requestV2(withRoot(bad)), why);
  // A registered dir is not one of the roots the other paths are compared with: a folder that holds the project is allowed.
  assert.equal(requestV2(withRoot({ ...reg, dir: f.base })).source.root.dir, f.base);
});
test('B2. readSliceTree reads a registered root outside the project and names its paths from the project folder', t => {
  const { f, root } = registeredWiki(t), r = readSliceTree(f.projectDir, 'wiki', { kind: 'project' }, live, lookup(root));
  assert.equal(r.hold, null, JSON.stringify(r.hold)); assert.deepEqual(r.resolution.members.map(m => m.path), ['a.md', 'sub/b.md']); assert.equal(r.rootDir, path.join(root, 'wiki')); assert.equal(r.recordSha256, 'a'.repeat(64));
  assert.match(r.index, /\nSource folder: \.\.\/kb\/wiki \(registered folder kb\)\nFiles: 2\n/);
  assert.match(r.index, /- `\.\.\/kb\/wiki\/a\.md`: Alpha\n- `\.\.\/kb\/wiki\/sub\/b\.md`: Beta\n$/);
  assert.equal(r.index.includes(f.base), false, 'no absolute path in the index');
});
test('B3. without a lookup, or with a request root that is a project root, a registered root holds SLICE_ROOT_MISSING', t => {
  const { f } = registeredWiki(t), r = readSliceTree(f.projectDir, 'wiki', { kind: 'project' }, live);
  assert.deepEqual([r.index, r.hold.code], [null, 'SLICE_ROOT_MISSING']);
});
test('B4. a hold of the lookup is the hold of the slice, with its detail', t => {
  const { f, root } = registeredWiki(t);
  for (const hold of [{ ok: false, code: 'SLICE_ROOT_MISSING', detail: 'kb' }, { ok: false, code: 'SLICE_ROOT_UNSAFE', detail: '~/kb/wiki' }]) {
    const r = readSliceTree(f.projectDir, 'wiki', { kind: 'project' }, live, () => hold);
    assert.deepEqual([r.index, r.definition?.root.kind, r.hold], [null, 'registered', { code: hold.code, detail: hold.detail }]);
  }
  fs.rmSync(path.join(root, 'wiki'), { recursive: true });
  assert.equal(readSliceTree(f.projectDir, 'wiki', { kind: 'project' }, live, lookup(root)).hold.code, 'SLICE_ROOT_MISSING', 'a lookup that finds a gone folder is not enough: the tree read decides');
});
test('B5. a registered root inside the project holds SLICE_ROOT_UNSAFE and names the project root to use', t => {
  const f = project(t); sliceFile(f, 'wiki', REGISTERED); wikiFile(f, 'a.md', '# Alpha\n');
  const here = path.join(f.projectDir, 'wiki'), r = readSliceTree(f.projectDir, 'wiki', { kind: 'project' }, live, () => ({ ok: true, dir: here, identity: idOf(here), recordSha256: 'b'.repeat(64) }));
  assert.deepEqual([r.index, r.hold], [null, { code: 'SLICE_ROOT_UNSAFE', detail: 'wiki', inside: true }]);
  const same = readSliceTree(f.projectDir, 'wiki', { kind: 'project' }, live, () => ({ ok: true, dir: f.projectDir, identity: idOf(f.projectDir), recordSha256: 'b'.repeat(64) }));
  assert.equal(same.hold.code, 'SLICE_ROOT_UNSAFE'); assert.equal(same.hold.detail, '.'); assert.equal(same.hold.inside, true);
});
test('B6. a registered folder that holds the project is allowed, and hidden folders are skipped', t => {
  const f = project(t); sliceFile(f, 'wiki', REGISTERED.replace('path: wiki', 'path: "."').replace('"**/*.md"', '"*/*.md"'));
  const r = readSliceTree(f.projectDir, 'wiki', { kind: 'project' }, live, lookup(f.base));
  assert.equal(r.hold, null, JSON.stringify(r.hold)); assert.ok(r.resolution.members.some(m => m.path === 'project/AGENTS.md'));
  assert.equal(r.resolution.members.some(m => m.path.includes('.bowerloom')), false);
  assert.match(r.index, /Source folder: \.\. \(registered folder kb\)/);
});
test('B7. a request root that names the folder is checked against the live folder: identity, name, and kind', t => {
  const { f, root } = registeredWiki(t), good = regRoot(root);
  const ok = readLocalSlice(f.projectDir, 'wiki', good, live);
  assert.deepEqual({ ...ok.source, root: { ...ok.source.root, id: 'ID' } }, { kind: 'slice', path: 'slices/wiki.yaml', root: { kind: 'registered', name: 'kb', path: 'wiki', id: 'ID' }, guard: 'root' }); assert.match(ok.source.root.id, /^[a-f0-9]{32}$/); assert.deepEqual(ok.references, ['a.md', 'sub/b.md', './', 'sub/']);
  assert.match(ok.files[0].text, /Source folder: \.\.\/kb\/wiki \(registered folder kb\)/);
  assert.throws(() => readSliceTree(f.projectDir, 'wiki', { ...good, name: 'other' }, live), code('MANAGED_SKILL_STALE_APPROVAL'));
  assert.throws(() => readSliceTree(f.projectDir, 'wiki', { ...good, identity: { ...good.identity, inode: String(BigInt(good.identity.inode) + 1n) } }, live), code('MANAGED_SKILL_STALE_APPROVAL'));
  assert.throws(() => readSliceTree(f.projectDir, 'wiki', { ...good, identity: { ...good.identity, birthtimeNs: '1' } }, live), code('MANAGED_SKILL_STALE_APPROVAL'));
  assert.throws(() => readSliceTree(f.projectDir, 'wiki', { ...good, dir: path.join(root, 'nope') }, live), code('MANAGED_SKILL_STALE_APPROVAL'));
  // The folder replaced by a new one at the same path has another identity.
  const planned = regRoot(root); fs.rmSync(path.join(root, 'wiki'), { recursive: true }); kb(f);
  assert.throws(() => readLocalSlice(f.projectDir, 'wiki', planned, live), e => ['MANAGED_SKILL_STALE_APPROVAL', 'MANAGED_SKILL_REFUSED'].includes(e.code));
  // A slice file that says project while the request says registered is a change since the plan.
  sliceFile(f, 'wiki', SLICE); assert.throws(() => readSliceTree(f.projectDir, 'wiki', good, live), code('MANAGED_SKILL_STALE_APPROVAL'));
});
test('B8. a registered folder that is now a link, or group-writable, is refused in the child as it is in the plan', t => {
  const { f, root } = registeredWiki(t), good = regRoot(root);
  fs.chmodSync(path.join(root, 'wiki'), 0o775);
  const unsafe = readSliceTree(f.projectDir, 'wiki', good, live); assert.equal(unsafe.hold.code, 'SLICE_ROOT_UNSAFE'); assert.equal(unsafe.index, null);
  fs.chmodSync(path.join(root, 'wiki'), 0o755); fs.renameSync(path.join(root, 'wiki'), path.join(root, 'real')); fs.symlinkSync(path.join(root, 'real'), path.join(root, 'wiki'));
  const linked = readSliceTree(f.projectDir, 'wiki', good, live); assert.ok(linked.hold !== null || linked.index === null); assert.equal(linked.index, null);
});
test('B9. a transaction installs a slice of a registered folder; the catalog holds the name and the path, never the absolute path', async t => {
  const { f, root } = registeredWiki(t), req = registeredRequest(f, root), { plan, receipt } = await install(req);
  assert.equal(receipt.state, 'committed'); assert.equal(plan.core.closure.source.root.kind, 'registered');
  const text = read(f, '.bowerloom/managed/catalog/slice_wiki.json'), catalog = JSON.parse(text);
  assert.deepEqual({ ...catalog.source, root: { ...catalog.source.root, id: 'ID' } }, { kind: 'slice', path: 'slices/wiki.yaml', root: { kind: 'registered', name: 'kb', path: 'wiki', id: 'ID' }, guard: 'root' });
  assert.deepEqual(catalog.references, ['a.md', 'sub/b.md', './', 'sub/']); assert.equal(text.includes(root), false); assert.equal(text.includes(f.base), false);
  assert.match(read(f, '.claude/skills/slice-wiki/SKILL.md'), /- `\.\.\/kb\/wiki\/a\.md`: Alpha\n/);
  assert.equal(read(f, '.claude/skills/slice-wiki/SKILL.md').includes(f.base), false);
  assert.equal(currentV2(f.projectDir, req.stateDir, req.item).revision, receipt.revision);
});
test('B10. planning refuses when the folder was replaced between the request and the read', async t => {
  const { f, root } = registeredWiki(t), req = registeredRequest(f, root);
  fs.rmSync(path.join(root, 'wiki'), { recursive: true }); kb(f);
  await assert.rejects(planManagedItem(req), e => ['MANAGED_SKILL_STALE_APPROVAL', 'MANAGED_SKILL_REFUSED'].includes(e.code));
});
test('B11. sameSource: a move from a project root to a registered folder is an update of the same item', async t => {
  const f = project(t); sliceFile(f); wikiFile(f, 'a.md', '# Alpha\n'); const req = sliceRequest(f), { receipt } = await install(req);
  const root = kb(f); sliceFile(f, 'wiki', REGISTERED);
  const update = { ...registeredRequest(f, root), operation: 'update', expectedPreviousRevision: receipt.revision }, plan = await planManagedItem(update);
  assert.equal(plan.format, 'bowerloom/managed-item-plan/v1beta2'); assert.deepEqual({ ...plan.core.closure.source.root, id: 'ID' }, { kind: 'registered', name: 'kb', path: 'wiki', id: 'ID' });
  const second = await applyManagedItem(null, update, plan.revision); assert.notEqual(second.revision, receipt.revision);
});

// ------------------------------------------------------------------------------------------- Part B security round
test('S3. a registered dir is inside the project by identity, not by text: a project reached by a link is still the project', t => {
  const { f, root } = registeredWiki(t), alias = path.join(f.base, 'project-alias'); fs.symlinkSync(f.projectDir, alias);
  const inside = path.join(f.projectDir, 'wiki'); fs.mkdirSync(inside, { mode: 0o755 });
  const req = registeredRequest(f, root), withDir = (projectDir, dir) => ({ ...req, projectDir, source: { kind: 'slice', name: 'wiki', root: { ...regRoot(root), dir, identity: idOf(dir) } } });
  assert.throws(() => requestV2(withDir(alias, inside)), 'the project named through a link');
  assert.throws(() => requestV2(withDir(alias, f.projectDir)), 'the project itself, named through a link');
  assert.equal(requestV2(withDir(f.projectDir, path.join(root, 'wiki'))).source.root.kind, 'registered');
});
test('S3. readSliceTree holds a registered root that is the project under another spelling of its case', { skip: (() => { const d = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'c-')); try { fs.writeFileSync(path.join(d, 'a'), ''); return !fs.existsSync(path.join(d, 'A')) ? 'this disk is case-sensitive' : false; } finally { fs.rmSync(d, { recursive: true }); } })() }, t => {
  const f = project(t); sliceFile(f, 'wiki', REGISTERED); wikiFile(f, 'a.md', '# Alpha\n');
  const here = path.join(f.projectDir, 'wiki'), shouty = f.projectDir.slice(0, -'project'.length) + 'PROJECT/wiki';
  const r = readSliceTree(f.projectDir, 'wiki', { kind: 'project' }, live, () => ({ ok: true, dir: shouty, identity: idOf(here), recordSha256: 'b'.repeat(64) }));
  assert.deepEqual([r.index, r.hold?.code, r.hold?.inside], [null, 'SLICE_ROOT_UNSAFE', true]);
});
test('S2. a registered root that the managed path rule rejects is a SLICE_ROOT_UNSAFE hold, and the request is refused', t => {
  const { f, root } = registeredWiki(t); fs.mkdirSync(path.join(root, 'node_modules/wiki'), { recursive: true, mode: 0o755 }); for (const p of ['node_modules', 'node_modules/wiki']) fs.chmodSync(path.join(root, p), 0o755);
  fs.writeFileSync(path.join(root, 'node_modules/wiki/a.md'), '# A\n');
  const bad = path.join(root, 'node_modules/wiki'), r = readSliceTree(f.projectDir, 'wiki', { kind: 'project' }, live, () => ({ ok: true, dir: bad, identity: idOf(bad), recordSha256: 'b'.repeat(64) }));
  assert.deepEqual([r.index, r.hold?.code], [null, 'SLICE_ROOT_UNSAFE']);
  assert.throws(() => requestV2(registeredRequest(f, root, { source: { kind: 'slice', name: 'wiki', root: { kind: 'registered', name: 'kb', dir: bad, identity: idOf(bad) } } })));
});
test('S6. the catalog root carries the id of the root folder: a folder replaced at the same path is another root', async t => {
  const { f, root } = registeredWiki(t), first = readLocalSlice(f.projectDir, 'wiki', regRoot(root), live).source.root.id;
  const again = readLocalSlice(f.projectDir, 'wiki', regRoot(root), live).source.root.id; assert.equal(again, first);
  const copy = path.join(f.base, 'wiki-copy'); fs.cpSync(path.join(root, 'wiki'), copy, { recursive: true }); fs.rmSync(path.join(root, 'wiki'), { recursive: true }); fs.cpSync(copy, path.join(root, 'wiki'), { recursive: true });
  const next = readLocalSlice(f.projectDir, 'wiki', regRoot(root), live).source.root.id; assert.match(next, /^[a-f0-9]{32}$/); assert.notEqual(next, first);
});
test('S1b. the lookup is asked for the summary kind of the slice (decision 5, option B)', t => {
  const { f } = registeredWiki(t), asked = [], look = (name, rootPath, kind) => { asked.push(kind); return { ok: false, code: 'FOLDER_NOT_ALLOWED', detail: name }; };
  const details = [];
  for (const summary of ['heading', 'frontmatter:title', 'none']) {
    sliceFile(f, 'wiki', REGISTERED.replace('summary: heading', `summary: ${summary}`)); details.push(readSliceTree(f.projectDir, 'wiki', { kind: 'project' }, live, look).hold.detail);
  }
  assert.deepEqual(asked, ['heading', 'frontmatter:title', 'none']);
  assert.deepEqual(details, ['kb heading', 'kb frontmatter:title', 'kb heading'], 'the next step names the kind to allow; none asks for heading');
});
test('S1. a hold of the lookup keeps its code and cause; FOLDER_NOT_ALLOWED passes through', t => {
  const { f } = registeredWiki(t);
  const r = readSliceTree(f.projectDir, 'wiki', { kind: 'project' }, live, () => ({ ok: false, code: 'FOLDER_NOT_ALLOWED', detail: 'kb' }));
  assert.deepEqual([r.index, r.hold], [null, { code: 'FOLDER_NOT_ALLOWED', detail: 'kb heading' }], 'the hold carries the summary kind the slice asks for');
  const c = readSliceTree(f.projectDir, 'wiki', { kind: 'project' }, live, () => ({ ok: false, code: 'SLICE_ROOT_UNSAFE', detail: '~/kb', cause: 'STORE_UNREADABLE' }));
  assert.deepEqual([c.hold.code, c.hold.errno], ['SLICE_ROOT_UNSAFE', 'STORE_UNREADABLE']);
});
