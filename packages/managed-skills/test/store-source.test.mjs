// Spec 06, section 3.12: the managed engine installs a skill or a prompt from a folder laid out like a store: the live
// store, ~/.bowerloom, or a store cache folder <stateRoot>/store-cache/<kind>-<id>-<hash>. The catalog names the source
// kind and path only, never the folder.
import test from '../../../dist/tests/support/lock-slot-retry.js';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { syncBuiltinESMExports } from 'node:module';
import { readLocalSkill, readLocalPrompt } from '../../../dist/packages/managed-skills/src/local-source.js';
import { planManagedItem } from '../../../dist/packages/managed-skills/src/v2-observed.js';
import { applyManagedItem } from '../../../dist/packages/managed-skills/src/v2-transaction.js';
import { project, localSkill, request, local, inventory, hash, code } from './v2-fixture.mjs';

const live = () => {};
const refused = code('MANAGED_SKILL_REFUSED');
const SKILL = id => `---\nname: ${id}\ndescription: A store skill.\n---\nUse the house style.\n`;
/** A folder laid out like a store, with one skill and one prompt. */
function storeFolder(f, name = 'store', files = { 'skills/house-style/SKILL.md': SKILL('house-style'), 'skills/house-style/references/notes.md': '# Notes\nOne.\n', 'prompts/weekly-update.md': 'Summarize the week.\n' }) {
  const dir = path.join(f.base, name); fs.mkdirSync(dir, { mode: 0o700, recursive: true });
  for (const [rel, text] of Object.entries(files)) { const file = path.join(dir, rel); fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 }); fs.writeFileSync(file, text, { mode: 0o600 }); }
  return dir;
}
const store = (id, storeDir) => ({ kind: 'store', path: 'skills/' + id, storeDir });
const storePrompt = (name, storeDir) => ({ kind: 'store-prompt', name, storeDir });
const catalogText = (f, name) => fs.readFileSync(path.join(f.projectDir, '.bowerloom/managed/catalog', name + '.json'), 'utf8');
async function install(req) { const plan = await planManagedItem(req); return { plan, receipt: await applyManagedItem(null, req, plan.revision) }; }
function restore(t) { t.mock.restoreAll(); syncBuiltinESMExports(); }

test('1. a skill installs from a store folder; the catalog source is { kind: store, path } and names no folder', async t => {
  const f = project(t), dir = storeFolder(f);
  const closure = readLocalSkill(f.projectDir, 'skills/house-style', live, { bowerloom: dir, origin: 'store' });
  assert.deepEqual(closure.source, { kind: 'store', path: 'skills/house-style' });
  assert.deepEqual(closure.inventory.map(r => r.path), ['SKILL.md', 'references/notes.md']);
  const { plan, receipt } = await install(request(f, { id: 'house-style', source: store('house-style', dir) }));
  assert.deepEqual(plan.core.closure.source, { kind: 'store', path: 'skills/house-style' });
  assert.equal(receipt.state, 'committed');
  const catalog = catalogText(f, 'house-style');
  assert.deepEqual(JSON.parse(catalog).source, { kind: 'store', path: 'skills/house-style' });
  assert.ok(!catalog.includes(dir) && !catalog.includes(f.base), 'the catalog names no folder');
  assert.equal(fs.readFileSync(path.join(f.projectDir, '.claude/skills/house-style/SKILL.md'), 'utf8'), SKILL('house-style'));
  assert.equal(fs.readFileSync(path.join(f.projectDir, '.agents/skills/house-style/references/notes.md'), 'utf8'), '# Notes\nOne.\n');
});

test('2. a prompt installs from a store folder: the command is the file bytes, and the Codex wrapper says it comes from the store', async t => {
  const f = project(t), dir = storeFolder(f);
  const closure = readLocalPrompt(f.projectDir, 'weekly-update', live, { bowerloom: dir, origin: 'store' });
  assert.deepEqual(closure.source, { kind: 'store-prompt', path: 'prompts/weekly-update.md' });
  const { receipt } = await install(request(f, { kind: 'prompt', id: 'weekly-update', source: storePrompt('weekly-update', dir) }));
  assert.equal(receipt.state, 'committed');
  assert.equal(fs.readFileSync(path.join(f.projectDir, '.claude/commands/weekly-update.md'), 'utf8'), 'Summarize the week.\n');
  assert.equal(fs.readFileSync(path.join(f.projectDir, '.agents/skills/prompt-weekly-update/SKILL.md'), 'utf8'),
    '---\nname: prompt-weekly-update\ndescription: Bowerloom prompt weekly-update, wrapped as a skill for Codex. It comes from your Bowerloom store. Edit it there, not this file.\n---\nSummarize the week.\n');
  assert.deepEqual(JSON.parse(catalogText(f, 'prompt-weekly-update')).source, { kind: 'store-prompt', path: 'prompts/weekly-update.md' });
});

test('3. the same bytes from the live store and from a store cache folder give the same material and catalog; only the operation key differs', async t => {
  const f = project(t), liveDir = storeFolder(f), cacheDir = storeFolder(f, 'state-cache/store-cache/skill-house-style-' + 'a'.repeat(64));
  const fromLive = await planManagedItem(request(f, { id: 'house-style', source: store('house-style', liveDir) }));
  const fromCache = await planManagedItem(request(f, { id: 'house-style', source: store('house-style', cacheDir) }));
  assert.deepEqual(fromLive.material, fromCache.material);
  assert.deepEqual(fromLive.core.closure, fromCache.core.closure);
  assert.notEqual(fromLive.operationKey, fromCache.operationKey);
  const receipt = await applyManagedItem(null, request(f, { id: 'house-style', source: store('house-style', liveDir) }), fromLive.revision);
  const catalog = catalogText(f, 'house-style');
  // An update from the cache folder with the same bytes is up to date: its catalog text equals the installed one.
  const again = await planManagedItem(request(f, { id: 'house-style', source: store('house-style', cacheDir), operation: 'update', previous: receipt.revision }));
  assert.equal(again.status, 'up-to-date');
  assert.equal(catalogText(f, 'house-style'), catalog);
});

test('4. a local skill moved from the project to the store with changed bytes updates, and the catalog source becomes store', async t => {
  const f = project(t); localSkill(f, 'house-style');
  const first = await install(request(f, { id: 'house-style', source: local('house-style') }));
  assert.deepEqual(JSON.parse(catalogText(f, 'house-style')).source, { kind: 'local', path: 'skills/house-style' });
  const dir = storeFolder(f, 'store', { 'skills/house-style/SKILL.md': SKILL('house-style'), 'skills/house-style/references/notes.md': '# Notes\nTwo.\n' });
  const update = await install(request(f, { id: 'house-style', source: store('house-style', dir), operation: 'update', previous: first.receipt.revision }));
  assert.equal(update.receipt.state, 'committed');
  assert.deepEqual(JSON.parse(catalogText(f, 'house-style')).source, { kind: 'store', path: 'skills/house-style' });
  assert.equal(fs.readFileSync(path.join(f.projectDir, '.claude/skills/house-style/references/notes.md'), 'utf8'), '# Notes\nTwo.\n');
  // A prompt and a store skill are different families: a store prompt never updates a skill's source.
  await assert.rejects(planManagedItem(request(f, { id: 'house-style', source: storePrompt('house-style', dir), operation: 'update', previous: update.receipt.revision })), refused);
});

test('5. a store folder inside the project folder or inside the state folder is refused by the non-nesting check', async t => {
  const f = project(t);
  // The item's own private state folder is the state folder a request names. A store cache folder sits beside it, under the state root.
  const inside = storeFolder(f, 'project/store-inside'), inState = storeFolder(f, 'state/items/house-style/store-inside');
  for (const dir of [inside, inState]) {
    const before = inventory(f.projectDir);
    await assert.rejects(planManagedItem(request(f, { id: 'house-style', source: store('house-style', dir) })), refused, dir);
    assert.deepEqual(inventory(f.projectDir), before);
  }
  // A relative folder, a path that does not match the id, a prompt source for a skill and an extra key are refused too.
  const dir = storeFolder(f);
  for (const source of [{ kind: 'store', path: 'skills/house-style', storeDir: 'relative/store' }, { kind: 'store', path: 'skills/other', storeDir: dir }, { kind: 'store-prompt', name: 'house-style', storeDir: dir }, { kind: 'store', path: 'skills/house-style', storeDir: dir, extra: 1 }, { kind: 'store', path: 'skills/house-style' }]) {
    await assert.rejects(planManagedItem(request(f, { id: 'house-style', source })), refused, JSON.stringify(source));
  }
});

for (const [name, mutate] of [
  ['a symlinked file', (f, root) => { fs.rmSync(path.join(root, 'references/notes.md')); fs.writeFileSync(path.join(f.base, 'outside.md'), 'outside\n'); fs.symlinkSync(path.join(f.base, 'outside.md'), path.join(root, 'references/notes.md')); }],
  ['a symlinked skill folder', (f, root) => { fs.renameSync(root, path.join(f.base, 'moved')); fs.symlinkSync(path.join(f.base, 'moved'), root); }],
  ['a second hard link', (f, root) => { fs.linkSync(path.join(root, 'SKILL.md'), path.join(f.base, 'second-link')); }],
  ['a group-writable file', (f, root) => { fs.chmodSync(path.join(root, 'SKILL.md'), 0o620); }],
  ['a group-writable folder', (f, root) => { fs.chmodSync(path.join(root, 'references'), 0o770); }],
  ['an executable file', (f, root) => { fs.chmodSync(path.join(root, 'SKILL.md'), 0o700); }],
  ['a file type a lock cannot record', (f, root) => { fs.writeFileSync(path.join(root, 'references/logo.png'), 'x', { mode: 0o600 }); }],
  ['an empty file', (f, root) => { fs.writeFileSync(path.join(root, 'references/empty.md'), '', { mode: 0o600 }); }],
  ['a byte order mark', (f, root) => { fs.writeFileSync(path.join(root, 'references/bom.md'), Buffer.from([0xef, 0xbb, 0xbf, 0x41]), { mode: 0o600 }); }],
  ['a file over 65536 bytes', (f, root) => { fs.writeFileSync(path.join(root, 'references/big.md'), 'x'.repeat(65537), { mode: 0o600 }); }],
  ['127 files', (f, root) => { for (let i = 0; i < 125; i++) fs.writeFileSync(path.join(root, `references/n${String(i).padStart(3, '0')}.md`), 'x\n', { mode: 0o600 }); }],
]) test(`6. the store reader refuses ${name}, and planning writes nothing`, async t => {
  const f = project(t), dir = storeFolder(f), root = path.join(dir, 'skills/house-style');
  // The clean folder reads, so the refusal below is the mutation's.
  assert.equal(readLocalSkill(f.projectDir, 'skills/house-style', live, { bowerloom: dir, origin: 'store' }).files.length, 2);
  mutate(f, root);
  assert.throws(() => readLocalSkill(f.projectDir, 'skills/house-style', live, { bowerloom: dir, origin: 'store' }), refused);
  const before = inventory(f.projectDir);
  await assert.rejects(planManagedItem(request(f, { id: 'house-style', source: store('house-style', dir) })));
  assert.deepEqual(inventory(f.projectDir), before);
});

test('6. 126 store files pass, and a project skill keeps its own rules: an executable or a .png file is still read there', t => {
  const f = project(t), dir = storeFolder(f), root = path.join(dir, 'skills/house-style');
  for (let i = 0; i < 124; i++) fs.writeFileSync(path.join(root, `references/n${String(i).padStart(3, '0')}.md`), 'x\n', { mode: 0o600 });
  assert.equal(readLocalSkill(f.projectDir, 'skills/house-style', live, { bowerloom: dir, origin: 'store' }).files.length, 126);
  const projectRoot = localSkill(f, 'house-style'); fs.chmodSync(path.join(projectRoot, 'SKILL.md'), 0o755);
  assert.equal(readLocalSkill(f.projectDir, 'skills/house-style', live).files.length, 2);
});

test('6. a foreign owner and a change during the read are refused for a store folder', t => {
  const f = project(t), dir = storeFolder(f), target = path.join(dir, 'skills/house-style/SKILL.md');
  const lstat = fs.lstatSync;
  t.mock.method(fs, 'lstatSync', (p, ...args) => { const s = lstat(p, ...args); if (String(p) !== path.join(dir, 'skills')) return s; const copy = Object.create(Object.getPrototypeOf(s)); Object.assign(copy, s, { uid: typeof s.uid === 'bigint' ? s.uid + 1n : s.uid + 1 }); return copy; });
  syncBuiltinESMExports();
  try { assert.throws(() => readLocalSkill(f.projectDir, 'skills/house-style', live, { bowerloom: dir, origin: 'store' }), refused); } finally { restore(t); }
  const open = fs.openSync, readSync = fs.readSync; let fd = -1, changed = false;
  t.mock.method(fs, 'openSync', (p, ...args) => { const r = open(p, ...args); if (String(p) === target) fd = r; return r; });
  t.mock.method(fs, 'readSync', (d, ...args) => { const n = readSync(d, ...args); if (d === fd && !changed) { changed = true; fs.appendFileSync(target, 'more\n'); } return n; });
  syncBuiltinESMExports();
  try { assert.throws(() => readLocalSkill(f.projectDir, 'skills/house-style', live, { bowerloom: dir, origin: 'store' }), refused); } finally { restore(t); }
  assert.equal(hash(fs.readFileSync(target)) !== hash(SKILL('house-style')), true);
});
