// Spec 05, section 10.8: the managed item kind `slice`, one index skill per item.
import test from '../../../dist/tests/support/lock-slot-retry.js';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
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
  assert.throws(() => requestV2({ ...good, source: { kind: 'slice', name: 'wiki', root: { kind: 'registered', name: 'kb', dir: '/x', identity: {} } } }), 'registered folders arrive with the second part');
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
