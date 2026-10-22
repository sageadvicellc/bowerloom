// Spec 05, Part B, sections 10.3, 10.12 and 10.14 for registered folders: `bowerloom apply` plans a slice whose root is a
// folder outside the project, found through the store. Every test runs with the network denied, in its own HOME.
import test from '../../../dist/tests/support/lock-slot-retry.js';
import { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { denyNetwork } from './sync-fixture.mjs';
import { wikiProject, createSlice, put, plan, applied, review, code, exists, read, rewriteSlice, sliceAgent, registeredFolder, agentProject, measureInput, signal } from './slices-fixture.mjs';
import { planFolderRemove, applyFolderRemove, planFolderAdd, applyFolderAdd } from '../../../dist/packages/project-context/src/index.js';
import { applyProjectApply } from '../../../dist/packages/project-sync/src/index.js';
import { measureContext, showSlice } from '../../../dist/packages/project-sync/src/index.js';
import { parse } from 'yaml';

const network = denyNetwork();
after(() => assert.deepEqual(network, []));
const slice = p => p.slices[0];
const esc = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const front = text => parse(text.split('\n---\n')[0].replace(/^---\n/, ''));
const guardArgs = (f, role = 'lead') => front(read(f, `.claude/agents/${role}.md`)).hooks.PreToolUse.at(-1).hooks[0].args;
const sha = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');

/** A project with the slice `wiki` over the registered folder `kb`, root `wiki`. */
async function registeredProject(t, options = {}) {
  const f = await wikiProject(t, { slice: false }), kb = await registeredFolder(f, t, options);
  await createSlice(f, 'wiki', { registered: kb.name, root: 'wiki' });
  return { f, kb };
}

test('R1. a slice of a registered folder plans the exact install line, the outside note, and the root of the plan item', async t => {
  const { f, kb } = await registeredProject(t), p = await plan(f, ['claude']), s = slice(p);
  assert.deepEqual([s.id, s.state, s.action, s.guard, s.hold], ['wiki', 'new', 'install', 'root', null]);
  assert.deepEqual(s.members, ['a.md', 'sub/b.md']); assert.deepEqual(s.covered, ['./', 'sub/']);
  assert.deepEqual([s.root.kind, s.root.name, s.root.path, s.root.dir, s.root.recordSha256], ['registered', kb.name, 'wiki', kb.wiki, sha(kb.record)]);
  const st = fs.statSync(kb.wiki, { bigint: true }); assert.deepEqual([s.root.identity.device, s.root.identity.inode, s.root.identity.birthtimeNs], [String(st.dev), String(st.ino), String(st.birthtimeNs)]);
  assert.deepEqual(s.expected.source, { kind: 'slice', path: 'slices/wiki.yaml', root: { kind: 'registered', name: kb.name, path: 'wiki' }, guard: 'root' });
  assert.equal(s.notes.outsideProject, true);
  const text = review(p);
  assert.match(text, new RegExp(`^ {2}wiki +install slice: \\.claude/skills/slice-wiki/SKILL\\.md \\(2 files from registered folder ${kb.name} \\(${esc(kb.display)}\\)\\)$`, 'm'));
  assert.match(text, new RegExp(`^ {2}Note: slice wiki reads ${esc(kb.display)}, outside this project\\. Claude Code may ask before it reads there\\. Start Claude Code with --add-dir ${esc(kb.display)}, or add the folder to permissions\\.additionalDirectories\\.$`, 'm'));
  assert.doesNotMatch(text, /guards the whole project folder/);
});
test('R2. apply writes an index that names the folder from the project, with no absolute path, and a catalog with the name and the path', async t => {
  const { f, kb } = await registeredProject(t); await applied(f, ['claude']);
  const index = read(f, '.claude/skills/slice-wiki/SKILL.md');
  assert.match(index, new RegExp(`\\nSource folder: ${esc(kb.display)} \\(registered folder ${kb.name}\\)\\nFiles: 2\\n`));
  assert.match(index, new RegExp(`- \`${esc(kb.display)}/a\\.md\`: Alpha\\n- \`${esc(kb.display)}/sub/b\\.md\`: Beta\\n$`));
  const catalogText = read(f, '.bowerloom/managed/catalog/slice_wiki.json'), catalog = JSON.parse(catalogText);
  assert.deepEqual(catalog.source.root, { kind: 'registered', name: kb.name, path: 'wiki' }); assert.deepEqual(catalog.references, ['a.md', 'sub/b.md', './', 'sub/']);
  for (const text of [index, catalogText]) { assert.equal(text.includes(f.home), false); assert.equal(text.includes(kb.dir), false); }
  assert.equal(fs.existsSync(path.join(kb.dir, '.claude')), false, 'Bowerloom never writes the registered folder');
  assert.deepEqual(fs.readdirSync(kb.wiki).sort(), ['a.md', 'sub']);
});
test('R3. after apply the plan says up to date, and an edit of a body in the folder changes nothing', async t => {
  const { f, kb } = await registeredProject(t); await applied(f, ['claude']);
  const before = await plan(f, ['claude']); assert.deepEqual([slice(before).state, slice(before).action, slice(before).installed], ['up-to-date', 'none', true]); assert.equal(before.actionable, false);
  fs.writeFileSync(path.join(kb.wiki, 'a.md'), '# Alpha\nbody a, much longer now\n');
  const after = await plan(f, ['claude']); assert.equal(after.revision, before.revision);
  fs.writeFileSync(path.join(kb.wiki, 'a.md'), '# Alpha, renamed\n');
  const changed = await plan(f, ['claude']); assert.deepEqual(slice(changed).changes, { added: 0, gone: 0, summaries: 1, rootChanged: false, guardChanged: false });
});
test('R4. a store that does not record the name holds SLICE_ROOT_MISSING, and an installed index stays', async t => {
  const { f, kb } = await registeredProject(t); await applied(f, ['claude']);
  const removal = planFolderRemove(f.home, kb.name); await applyFolderRemove(f.home, kb.name, removal.revision, signal());
  const p = await plan(f, ['claude']), s = slice(p);
  assert.deepEqual([s.state, s.action, s.hold.code, s.installed], ['held', 'hold', 'SLICE_ROOT_MISSING', true]);
  assert.equal(s.hold.next, 'Run bowerloom folder list, or register the folder with bowerloom folder add <folder-name> <path>, then run bowerloom apply.');
  assert.match(review(p), /^ {2}wiki +slice held \(SLICE_ROOT_MISSING\)\n {2} +Next: Run bowerloom folder list, or register the folder/m);
  assert.equal(exists(f, '.claude/skills/slice-wiki/SKILL.md'), true);
  // Registered again under the same name, the slice is back and up to date.
  const again = planFolderAdd(f.home, f.home, kb.name, kb.dir); await applyFolderAdd(f.home, f.home, kb.name, kb.dir, again.revision, signal());
  assert.equal(slice(await plan(f, ['claude'])).state, 'up-to-date');
});
test('R5. a folder that is gone holds SLICE_ROOT_MISSING, and a path inside it that is gone holds it too', async t => {
  const { f, kb } = await registeredProject(t);
  fs.renameSync(kb.wiki, path.join(kb.dir, 'moved'));
  assert.deepEqual([slice(await plan(f, ['claude'])).hold.code, slice(await plan(f, ['claude'])).action], ['SLICE_ROOT_MISSING', 'hold']);
  fs.renameSync(path.join(kb.dir, 'moved'), kb.wiki); fs.renameSync(kb.dir, kb.dir + '-gone');
  t.after(() => fs.rmSync(kb.dir + '-gone', { recursive: true, force: true }));
  assert.equal(slice(await plan(f, ['claude'])).hold.code, 'SLICE_ROOT_MISSING');
});
test('R6. a link at the recorded path, a group-writable folder, and an invalid record hold SLICE_ROOT_UNSAFE', async t => {
  const { f, kb } = await registeredProject(t);
  fs.chmodSync(kb.wiki, 0o775);
  let s = slice(await plan(f, ['claude'])); assert.deepEqual([s.hold.code, s.hold.next.startsWith('ls -ld ')], ['SLICE_ROOT_UNSAFE', true]);
  fs.chmodSync(kb.wiki, 0o755);
  fs.renameSync(kb.wiki, path.join(kb.dir, 'real')); fs.symlinkSync(path.join(kb.dir, 'real'), kb.wiki);
  assert.equal(slice(await plan(f, ['claude'])).hold.code, 'SLICE_ROOT_UNSAFE', 'a link in place of the root');
  fs.unlinkSync(kb.wiki); fs.renameSync(path.join(kb.dir, 'real'), kb.wiki);
  fs.writeFileSync(kb.record, '{"format":"bowerloom/store-folder/v1beta1","path":"folder","extra":1}\n', { mode: 0o644 });
  assert.equal(slice(await plan(f, ['claude'])).hold.code, 'SLICE_ROOT_UNSAFE', 'a record with an extra key');
});
test('R7. the other items of the plan still apply when a registered slice is held', async t => {
  const { f, kb } = await registeredProject(t); put(f, 'wiki/x.md', '# Local\n'); await createSlice(f, 'local', { root: 'wiki' });
  fs.renameSync(kb.wiki, path.join(kb.dir, 'moved'));
  const p = await plan(f, ['claude']), by = Object.fromEntries(p.slices.map(s => [s.id, s]));
  assert.deepEqual([by.wiki.action, by.local.action], ['hold', 'install']);
  const r = await applied(f, ['claude']); assert.equal(r.result.held.find(h => h.kind === 'slice').code, 'SLICE_ROOT_MISSING'); assert.equal(exists(f, '.claude/skills/slice-local/SKILL.md'), true);
});
test('R8. a registered folder that holds the project is allowed, and one inside the project holds SLICE_ROOT_UNSAFE with the root to use', async t => {
  const f = await agentProject(t, 'proj-');
  // The folder holds the project: its pages are the ones outside .bowerloom and the other hidden folders.
  const holder = await registeredFolderOf(f, t, f.base);
  fs.writeFileSync(path.join(f.projectDir, 'README.md'), '# Readme\n');
  await createSlice(f, 'wiki', { registered: holder.name, root: '.', includes: ['*/*.md'] });
  let s = slice(await plan(f, ['claude'])); assert.equal(s.hold, null, JSON.stringify(s.hold)); assert.deepEqual(s.members, ['project/README.md']);
  assert.match(review(await plan(f, ['claude'])), /\(1 files from registered folder [a-z0-9-]+ \(\.\.\)\)$/m);
  // A record that points into the project.
  put(f, 'inner/a.md', '# Inner\n');
  const inner = await registeredFolderOf(f, t, path.join(f.projectDir, 'inner'));
  rewriteSlice(f, 'wiki', text => text.replace(`registered: ${holder.name}`, `registered: ${inner.name}`).replace('path: "."', 'path: "."').replace('"*/*.md"', '"*.md"'));
  s = slice(await plan(f, ['claude'])); assert.deepEqual([s.hold.code, s.hold.next], ['SLICE_ROOT_UNSAFE', 'Use root: inner instead.']);
});
test('R9. the identity of the folder is in the plan revision: a folder replaced after the plan is a stale approval', async t => {
  const { f, kb } = await registeredProject(t), p = await plan(f, ['claude']);
  const pages = { 'a.md': '# Alpha\n', 'sub/b.md': '# Beta\n' };
  fs.rmSync(kb.wiki, { recursive: true }); for (const [rel, text] of Object.entries(pages)) { const file = path.join(kb.wiki, rel); fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o755 }); fs.chmodSync(path.dirname(file), 0o755); fs.writeFileSync(file, text, { mode: 0o644 }); }
  const q = await plan(f, ['claude']); assert.notEqual(q.revision, p.revision, 'the identity of the root is bound');
  await assert.rejects(applyProjectApply(f.input(['claude']), p.revision, signal()), code('STALE_APPROVAL'));
  assert.equal(exists(f, '.claude/skills/slice-wiki/SKILL.md'), false, 'nothing was written');
});
test('R10. the record of the folder is in the plan revision: a record that points elsewhere changes it', async t => {
  const { f, kb } = await registeredProject(t), p = await plan(f, ['claude']);
  const other = path.join(f.home, 'folder-other'); fs.mkdirSync(path.join(other, 'wiki'), { recursive: true, mode: 0o755 }); fs.chmodSync(other, 0o755); fs.chmodSync(path.join(other, 'wiki'), 0o755);
  t.after(() => fs.rmSync(other, { recursive: true, force: true })); fs.writeFileSync(path.join(other, 'wiki/a.md'), '# Alpha\nbody a\n'); fs.writeFileSync(path.join(other, 'wiki/c.md'), '# Gamma\n');
  fs.writeFileSync(kb.record, `{"format":"bowerloom/store-folder/v1beta1","path":"folder-other"}\n`, { mode: 0o644 });
  const q = await plan(f, ['claude']); assert.notEqual(q.revision, p.revision); assert.deepEqual(slice(q).members, ['a.md', 'c.md']);
  assert.notEqual(slice(q).root.recordSha256, slice(p).root.recordSha256);
});
test('R11. a root change from a project folder to a registered folder plans root changed', async t => {
  const f = await wikiProject(t); await applied(f, ['claude']);
  const kb = await registeredFolder(f, t); rewriteSlice(f, 'wiki', text => text.replace('root: "wiki"', `root:\n  registered: ${kb.name}\n  path: "wiki"`));
  const p = await plan(f, ['claude']); assert.equal(slice(p).changes.rootChanged, true); assert.equal(slice(p).action, 'update');
  assert.match(review(p), /, root changed\)$/m);
  await applied(f, ['claude']); assert.match(read(f, '.claude/skills/slice-wiki/SKILL.md'), /Source folder: .* \(registered folder /);
});
test('R12. an agent that names a guarded registered slice gets the root id of the folder, and a replaced folder plans an update', async t => {
  const { f, kb } = await registeredProject(t); sliceAgent(f, 'lead', ['slice-wiki']);
  const p = await plan(f, ['claude']), lead = p.agents.find(a => a.id === 'lead');
  assert.deepEqual(lead.context.guard, ['wiki']); assert.equal(lead.context.guardRoots.length, 1); assert.match(lead.context.guardRoots[0], /^wiki:[a-f0-9]{32}$/);
  assert.doesNotMatch(review(p), /must pass a path to Grep and Glob/, 'a root outside the project is not a subfolder of it');
  await applied(f, ['claude']);
  const args = guardArgs(f, 'lead'); assert.deepEqual(args.slice(args.indexOf('--slice'), args.indexOf('--slice') + 2), ['--slice', 'wiki']); assert.ok(args.includes(lead.context.guardRoots[0]));
  assert.equal((await plan(f, ['claude'])).agents.find(a => a.id === 'lead').action, 'none');
  const pages = fs.readdirSync(kb.wiki); fs.renameSync(kb.wiki, kb.wiki + '-old'); fs.mkdirSync(kb.wiki, { mode: 0o755 }); fs.chmodSync(kb.wiki, 0o755);
  for (const n of pages) fs.cpSync(path.join(kb.wiki + '-old', n), path.join(kb.wiki, n), { recursive: true });
  const q = await plan(f, ['claude']); assert.equal(q.agents.find(a => a.id === 'lead').action, 'update'); assert.notEqual(q.agents.find(a => a.id === 'lead').context.guardRoots[0], lead.context.guardRoots[0]);
});
test('R13. context show and context measure read a registered slice: the baseline is the root, and nothing is written', async t => {
  const { f, kb } = await registeredProject(t); sliceAgent(f, 'lead', ['slice-wiki']); await applied(f, ['claude']);
  const shown = await showSlice({ project: f.project(), stateRoot: f.stateRoot, slice: 'wiki', home: f.home });
  assert.equal(shown.installed, 'installed and the same'); assert.deepEqual(shown.members, ['a.md', 'sub/b.md']); assert.equal(shown.root, kb.display);
  assert.match(shown.index.text, new RegExp(`Source folder: ${esc(kb.display)} \\(registered folder ${kb.name}\\)`));
  const measured = await measureContext(measureInput(f)), lead = measured.agents.find(a => a.role === 'lead');
  assert.equal(measured.baseline.folder, kb.display); assert.equal(measured.baseline.chosenBy, 'slice-roots'); assert.equal(lead.start.slices[0].installed, true);
  assert.equal(lead.onDemand.members.files, 2);
});
test('R14. a held registered slice that is installed is counted as held by the measure', async t => {
  const { f, kb } = await registeredProject(t); sliceAgent(f, 'lead', ['slice-wiki']); await applied(f, ['claude']);
  fs.renameSync(kb.wiki, path.join(kb.dir, 'moved'));
  const measured = await measureContext(measureInput(f)), lead = measured.agents.find(a => a.role === 'lead');
  assert.equal(lead.start.slices[0].hold, 'SLICE_ROOT_MISSING');
});

/** Registers an existing folder by its path, as `folder add` does. */
async function registeredFolderOf(f, t, dir) {
  const name = 'own' + Math.random().toString(36).slice(2, 8);
  t.after(() => fs.rmSync(path.join(f.home, '.bowerloom/folders', name + '.json'), { force: true }));
  const p = planFolderAdd(f.home, f.home, name, dir); await applyFolderAdd(f.home, f.home, name, dir, p.revision, signal());
  return { name, dir };
}
