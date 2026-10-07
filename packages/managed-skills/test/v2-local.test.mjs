import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { syncBuiltinESMExports } from 'node:module';
import { readLocalSkill, readLocalPrompt } from '../../../dist/packages/managed-skills/src/local-source.js';
import { planManagedItem } from '../../../dist/packages/managed-skills/src/v2-observed.js';
import { ManagedSkillError } from '../../../dist/packages/managed-skills/src/observed.js';
import { project, localSkill, prompt, request, local, inventory, hash, code } from './v2-fixture.mjs';

const live = () => {};
const refused = code('MANAGED_SKILL_REFUSED');
function restore(t) { t.mock.restoreAll(); syncBuiltinESMExports(); }

test('a safe authored skill is read as hashed text with a sorted inventory and no machine data', t => {
  const f = project(t); localSkill(f, 'house-style');
  const closure = readLocalSkill(f.projectDir, 'skills/house-style', live);
  assert.deepEqual(closure.source, { kind: 'local', path: 'skills/house-style' });
  assert.deepEqual(closure.inventory.map(x => x.path), ['SKILL.md', 'references/notes.md']);
  for (const file of closure.files) { assert.equal(file.mode, 420); assert.equal(hash(file.text), file.sha256); }
  assert.ok(!JSON.stringify(closure).includes(f.base)); assert.ok(Object.isFrozen(closure));
  let calls = 0; readLocalSkill(f.projectDir, 'skills/house-style', () => { calls++; }); assert.ok(calls >= 3);
  assert.throws(() => readLocalSkill(f.projectDir, 'skills/house-style', () => { throw new ManagedSkillError('MANAGED_SKILL_ABORTED'); }), code('MANAGED_SKILL_ABORTED'));
});

test('the reader refuses unsafe names, a missing SKILL.md and a path outside skills/<id>', t => {
  const f = project(t); localSkill(f, 'no-skill', { 'README.md': 'x\n' }); localSkill(f, 'hidden', { 'SKILL.md': 'x\n', '.DS_Store': 'x' });
  for (const rel of ['skills/no-skill', 'skills/hidden', 'skills/absent', '../skills/x', 'skills/a/b', 'teams/x', '/skills/x', 'skills/House']) assert.throws(() => readLocalSkill(f.projectDir, rel, live), rel);
});

for (const [name, mutate] of [
  ['a symlinked file', (f, root) => { fs.rmSync(path.join(root, 'references/notes.md')); fs.writeFileSync(path.join(f.base, 'outside.md'), 'outside\n'); fs.symlinkSync(path.join(f.base, 'outside.md'), path.join(root, 'references/notes.md')); }],
  ['a symlinked folder', (f, root) => { fs.rmSync(path.join(root, 'references'), { recursive: true }); fs.mkdirSync(path.join(f.base, 'outside'), { mode: 0o700 }); fs.symlinkSync(path.join(f.base, 'outside'), path.join(root, 'references')); }],
  ['a symlinked skill root', (f, root) => { fs.renameSync(root, path.join(f.base, 'moved')); fs.symlinkSync(path.join(f.base, 'moved'), root); }],
  ['a second hard link', (f, root) => { fs.linkSync(path.join(root, 'SKILL.md'), path.join(f.base, 'second-link')); }],
  ['a group-writable file', (f, root) => { fs.chmodSync(path.join(root, 'SKILL.md'), 0o664); }],
  ['a world-writable folder', (f, root) => { fs.chmodSync(path.join(root, 'references'), 0o777); }],
  ['a setuid file', (f, root) => { fs.chmodSync(path.join(root, 'SKILL.md'), 0o4644); }],
  ['an oversize file', (f, root) => { fs.writeFileSync(path.join(root, 'references/big.md'), 'x'.repeat(65537)); }],
  ['invalid UTF-8', (f, root) => { fs.writeFileSync(path.join(root, 'references/bytes.md'), Buffer.from([0xff, 0xfe, 0x00])); }],
]) test(`the local reader refuses ${name}, and planning writes nothing`, t => {
  const f = project(t), root = localSkill(f, 'house-style'); mutate(f, root);
  assert.throws(() => readLocalSkill(f.projectDir, 'skills/house-style', live), refused);
  const before = inventory(f.projectDir); return assert.rejects(planManagedItem(request(f, { id: 'house-style', source: local('house-style') }))).then(() => assert.deepEqual(inventory(f.projectDir), before));
});

test('a foreign owner is refused', t => {
  const f = project(t), root = localSkill(f, 'house-style'), fstat = fs.fstatSync, target = path.join(root, 'references/notes.md'), open = fs.openSync; let fd = -1;
  t.mock.method(fs, 'openSync', (p, ...args) => { const r = open(p, ...args); if (String(p) === target) fd = r; return r; });
  t.mock.method(fs, 'fstatSync', (d, ...args) => { const s = fstat(d, ...args); if (d !== fd) return s; const copy = Object.create(Object.getPrototypeOf(s)); Object.assign(copy, s, { uid: typeof s.uid === 'bigint' ? s.uid + 1n : s.uid + 1 }); return copy; });
  syncBuiltinESMExports();
  try { assert.throws(() => readLocalSkill(f.projectDir, 'skills/house-style', live), refused); } finally { restore(t); }
  const lstat = fs.lstatSync;
  t.mock.method(fs, 'lstatSync', (p, ...args) => { const s = lstat(p, ...args); if (String(p) !== path.join(root, 'references')) return s; const copy = Object.create(Object.getPrototypeOf(s)); Object.assign(copy, s, { uid: typeof s.uid === 'bigint' ? s.uid + 1n : s.uid + 1 }); return copy; });
  syncBuiltinESMExports();
  try { assert.throws(() => readLocalSkill(f.projectDir, 'skills/house-style', live), refused); } finally { restore(t); }
});

test('a change during the read is refused', t => {
  const f = project(t), root = localSkill(f, 'house-style'), target = path.join(root, 'SKILL.md'), open = fs.openSync, readSync = fs.readSync; let fd = -1, changed = false;
  t.mock.method(fs, 'openSync', (p, ...args) => { const r = open(p, ...args); if (String(p) === target) fd = r; return r; });
  t.mock.method(fs, 'readSync', (d, ...args) => { const n = readSync(d, ...args); if (d === fd && !changed) { changed = true; fs.appendFileSync(target, 'changed\n'); } return n; });
  syncBuiltinESMExports();
  try { assert.throws(() => readLocalSkill(f.projectDir, 'skills/house-style', live), refused); assert.equal(changed, true); } finally { restore(t); }
  // A file replaced between the walk and the closing re-check is refused too.
  let swapped = false; const readdir = fs.readdirSync;
  t.mock.method(fs, 'readdirSync', (p, ...args) => { const r = readdir(p, ...args); if (String(p) === path.join(root, 'references') && !swapped) { swapped = true; fs.rmSync(target); fs.writeFileSync(target, '---\nname: house-style\n---\nReplaced.\n', { mode: 0o644 }); } return r; });
  syncBuiltinESMExports();
  try { assert.throws(() => readLocalSkill(f.projectDir, 'skills/house-style', live), refused); assert.equal(swapped, true); } finally { restore(t); }
});

test('an authored prompt is read with the same guards', t => {
  const f = project(t), file = prompt(f, 'review', 'Summarize.\n');
  const closure = readLocalPrompt(f.projectDir, 'review', live);
  assert.deepEqual(closure.source, { kind: 'prompt', path: 'prompts/review.md' }); assert.deepEqual(closure.inventory, [{ path: 'review.md', sha256: hash('Summarize.\n'), bytes: 11 }]);
  fs.chmodSync(file, 0o666); assert.throws(() => readLocalPrompt(f.projectDir, 'review', live), refused); fs.chmodSync(file, 0o644);
  for (const name of ['../x', 'Review', 'a/b', '']) assert.throws(() => readLocalPrompt(f.projectDir, name, live));
  fs.writeFileSync(file, 'x'.repeat(65537)); assert.throws(() => readLocalPrompt(f.projectDir, 'review', live), refused);
});

test('the reader refuses a hidden or empty folder anywhere in the skill, as it refuses a hidden file', t => {
  for (const [label, add] of [
    ['an empty hidden folder', root => fs.mkdirSync(path.join(root, '.cache'), { mode: 0o755 })],
    ['a hidden folder inside a folder', root => fs.mkdirSync(path.join(root, 'references/.git'), { mode: 0o755 })],
    ['an empty folder', root => fs.mkdirSync(path.join(root, 'empty'), { mode: 0o755 })],
    ['an empty nested folder', root => fs.mkdirSync(path.join(root, 'references/deeper/deepest'), { recursive: true, mode: 0o755 })],
  ]) {
    const f = project(t), root = localSkill(f, 'house-style'); add(root);
    assert.throws(() => readLocalSkill(f.projectDir, 'skills/house-style', live), refused, label);
  }
  // A folder that holds a file is still read.
  const f = project(t), root = localSkill(f, 'house-style'); fs.mkdirSync(path.join(root, 'more'), { mode: 0o755 }); fs.writeFileSync(path.join(root, 'more/notes.md'), 'x\n', { mode: 0o644 });
  assert.deepEqual(readLocalSkill(f.projectDir, 'skills/house-style', live).inventory.map(x => x.path), ['SKILL.md', 'more/notes.md', 'references/notes.md']);
});
