// Spec 05, section 10.12: planning context slices in `bowerloom apply`. Every test runs with the network denied.
import test from '../../../dist/tests/support/lock-slot-retry.js';
import { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { denyNetwork, localSkill, localEntry, writeManifest } from './sync-fixture.mjs';
import { APPLY_PLAN_FORMAT } from '../../../dist/packages/project-sync/src/index.js';
import { wikiProject, createSlice, put, sliceFile, rewriteSlice, plan, applied, review, code, exists, read, createPrompt } from './slices-fixture.mjs';

const network = denyNetwork();
after(() => assert.deepEqual(network, []));
const slice = p => p.slices[0];

test('1. a new slice plans the exact install line with the file count', async t => {
  const f = await wikiProject(t), p = await plan(f, ['claude-code']);
  assert.equal(p.format, APPLY_PLAN_FORMAT); assert.equal(p.slices.length, 1); assert.equal(p.actionable, true);
  const s = slice(p);
  assert.deepEqual([s.id, s.itemId, s.state, s.action, s.engines, s.guard, s.installed], ['wiki', 'slice_wiki', 'new', 'install', ['claude-code'], 'root', false]);
  assert.deepEqual(s.members, ['a.md', 'sub/b.md']); assert.deepEqual(s.covered, ['./', 'sub/']); assert.equal(s.hold, null);
  assert.deepEqual(s.expected.surfaces, [{ id: 'projection-claude', path: '.claude/skills/slice-wiki' }, { id: 'catalog', path: '.bowerloom/managed/catalog/slice_wiki.json' }]);
  assert.deepEqual(s.expected.source, { kind: 'slice', path: 'slices/wiki.yaml', root: { kind: 'project', path: 'wiki' }, guard: 'root' });
  assert.equal(s.expected.files.length, 1); assert.equal(s.expected.files[0].path, 'SKILL.md'); assert.equal(s.root.kind, 'project'); assert.equal(s.root.path, 'wiki');
  assert.match(review(p), /^ {2}wiki +install slice: \.claude\/skills\/slice-wiki\/SKILL\.md \(2 files from wiki\)$/m);
  assert.match(review(p), /^Apply skills, prompts, agents, and context slices for Claude Code$/m);
  assert.equal(p.writesAuthorized, false);
});
test('2. after apply, the plan says slice up to date and Nothing to change', async t => {
  const f = await wikiProject(t); await applied(f, ['claude-code']);
  const p = await plan(f, ['claude-code']);
  assert.equal(p.actionable, false); assert.deepEqual([slice(p).state, slice(p).action, slice(p).installed], ['up-to-date', 'none', true]);
  assert.match(review(p), /^ {2}wiki +slice up to date$/m); assert.doesNotMatch(review(p), /Warning:|Note:/);
});
test('3. a body-only edit keeps the revision', async t => {
  const f = await wikiProject(t); await applied(f, ['claude-code']); const before = await plan(f, ['claude-code']);
  put(f, 'wiki/a.md', '# Alpha\nbody a, much longer now\nand more\n');
  const after = await plan(f, ['claude-code']); assert.equal(after.revision, before.revision); assert.equal(slice(after).action, 'none');
});
test('4. a heading edit plans update slice with 1 summaries changed, and a new revision', async t => {
  const f = await wikiProject(t); await applied(f, ['claude-code']); const before = await plan(f, ['claude-code']);
  put(f, 'wiki/a.md', '# Alpha, renamed\nbody a\n'); const p = await plan(f, ['claude-code']);
  assert.deepEqual([slice(p).state, slice(p).action], ['edited', 'update']); assert.notEqual(p.revision, before.revision);
  assert.deepEqual(slice(p).changes, { added: 0, gone: 0, summaries: 1, rootChanged: false, guardChanged: false });
  assert.match(review(p), /^ {2}wiki +update slice: \.claude\/skills\/slice-wiki\/SKILL\.md \(0 added, 0 gone, 1 summaries changed\)$/m);
});
test('5. a glob rename plans 1 added, 1 gone', async t => {
  const f = await wikiProject(t); await applied(f, ['claude-code']);
  fs.renameSync(path.join(f.projectDir, 'wiki/a.md'), path.join(f.projectDir, 'wiki/a2.md')); const p = await plan(f, ['claude-code']);
  assert.deepEqual(slice(p).changes, { added: 1, gone: 1, summaries: 0, rootChanged: false, guardChanged: false });
  assert.match(review(p), /\(1 added, 1 gone, 0 summaries changed\)$/m);
});
test('6. a literal rename holds SLICE_PATH_MISSING, and a prompt in the same plan installs', async t => {
  const f = await wikiProject(t, { slice: false }); put(f, 'wiki/index.md', '# Index\n');
  await createSlice(f, 'wiki', { root: 'wiki', includes: ['index.md', 'sub/*.md'] }); await createPrompt(f, 'weekly', 'Weekly.\n'); await applied(f, ['claude-code']);
  fs.renameSync(path.join(f.projectDir, 'wiki/index.md'), path.join(f.projectDir, 'wiki/home.md')); await createPrompt(f, 'daily', 'Daily.\n');
  const p = await plan(f, ['claude-code']);
  assert.deepEqual([slice(p).state, slice(p).action, slice(p).hold.code], ['held', 'hold', 'SLICE_PATH_MISSING']);
  assert.equal(slice(p).hold.next, 'wiki/index.md is gone. Fix the path in .bowerloom/slices/wiki.yaml, or restore the file, then run bowerloom apply.');
  assert.equal(p.prompts.find(x => x.id === 'daily').action, 'install'); assert.equal(slice(p).installed, true, 'the installed index stays');
  assert.match(review(p), /^ {2}wiki +slice held \(SLICE_PATH_MISSING\)\n {2} +Next: wiki\/index\.md is gone\./m);
  const r = await applied(f, ['claude-code']); assert.equal(r.result.held.find(h => h.kind === 'slice').code, 'SLICE_PATH_MISSING'); assert.equal(exists(f, '.claude/commands/daily.md'), true);
});
test('7. a root change plans root changed', async t => {
  const f = await wikiProject(t); await applied(f, ['claude-code']); rewriteSlice(f, 'wiki', s => s.replace('root: "wiki"', 'root: "wiki/sub"'));
  const p = await plan(f, ['claude-code']); assert.equal(slice(p).changes.rootChanged, true); assert.equal(slice(p).action, 'update');
  assert.match(review(p), /\(0 added, 1 gone, 0 summaries changed, root changed\)$/m);
});
test('8. a guard change plans guard changed', async t => {
  const f = await wikiProject(t); await applied(f, ['claude-code']); rewriteSlice(f, 'wiki', s => s.replace('guard: root', 'guard: none'));
  const p = await plan(f, ['claude-code']); assert.equal(slice(p).changes.guardChanged, true); assert.match(review(p), /\(0 added, 0 gone, 0 summaries changed, guard changed\)$/m);
});
test('9. an unregistered file prints the skip note, and the plan lists it in unregisteredSlices', async t => {
  const f = await wikiProject(t); fs.copyFileSync(sliceFile(f, 'wiki'), path.join(f.bowerloom, 'slices', 'extra.yaml'));
  const p = await plan(f, ['claude-code']); assert.deepEqual(p.unregisteredSlices, ['extra.yaml']);
  assert.match(review(p), /^ {2}Note: \.bowerloom\/slices\/extra\.yaml is not registered, so apply skips it\. Run bowerloom slice create extra to register it\.$/m);
});
test('10. a deleted registration plans slice kept', async t => {
  const f = await wikiProject(t); await applied(f, ['claude-code']);
  const receiptFile = path.join(f.bowerloom, 'authoring/receipt.json'), receipt = JSON.parse(fs.readFileSync(receiptFile, 'utf8'));
  // Drop the item from the record, as a person who removes a slice and its record does; the file goes too.
  const { receiptOf, recordText } = await import('../../../dist/packages/project-authoring/src/state.js');
  fs.writeFileSync(receiptFile, recordText(receiptOf(receipt.items.filter(i => i.kind !== 'slice')))); fs.rmSync(sliceFile(f, 'wiki'));
  const p = await plan(f, ['claude-code']); assert.deepEqual([slice(p).state, slice(p).action], ['orphaned', 'none']);
  assert.match(review(p), /^ {2}wiki +slice kept: no longer a slice of this project, and apply removes nothing$/m);
  const r = await applied(f, ['claude-code']); assert.deepEqual(r.result.orphaned, [{ kind: 'slice', id: 'wiki', origin: null, resolvedFrom: 'project' }]); assert.equal(exists(f, '.claude/skills/slice-wiki/SKILL.md'), true);
});
test('11. 65 registered slices refuse SLICE_LIMIT', async t => {
  const f = await wikiProject(t, { slice: false });
  for (let i = 0; i < 65; i++) await createSlice(f, 'wiki' + String(i).padStart(2, '0'), { root: 'wiki' });
  await assert.rejects(plan(f, ['claude-code']), code('SLICE_LIMIT'));
  await assert.rejects(plan(f, ['codex']), code('SLICE_LIMIT'));
});
test('12. an unsafe slices folder refuses AUTHORING_UNSAFE_PATH', async t => {
  const f = await wikiProject(t); fs.chmodSync(path.join(f.bowerloom, 'slices'), 0o777); await assert.rejects(plan(f, ['claude-code']), code('AUTHORING_UNSAFE_PATH'));
  fs.chmodSync(path.join(f.bowerloom, 'slices'), 0o755); fs.renameSync(path.join(f.bowerloom, 'slices'), path.join(f.base, 'real-slices')); fs.symlinkSync(path.join(f.base, 'real-slices'), path.join(f.bowerloom, 'slices'));
  await assert.rejects(plan(f, ['claude-code']), code('AUTHORING_UNSAFE_PATH'));
});
test('13. SLICE_TARGET_OCCUPIED holds with the exact next step', async t => {
  const f = await wikiProject(t); put(f, '.claude/skills/slice-wiki/SKILL.md', 'mine\n');
  const p = await plan(f, ['claude-code']); assert.deepEqual([slice(p).action, slice(p).hold.code, slice(p).hold.next], ['hold', 'SLICE_TARGET_OCCUPIED', 'Move .claude/skills/slice-wiki aside, then run bowerloom apply.']);
  await applied(f, ['claude-code']); assert.equal(read(f, '.claude/skills/slice-wiki/SKILL.md'), 'mine\n');
});
test('14. APPLY_NAME_COLLISION for a skill slice-x and a slice x', async t => {
  const f = await wikiProject(t, { slice: false }); await createSlice(f, 'x', { root: 'wiki' });
  localSkill(f, 'slice-x'); writeManifest(f, [localEntry('slice-x')]);
  await assert.rejects(plan(f, ['claude-code']), e => { assert.equal(e.code, 'APPLY_NAME_COLLISION'); assert.match(e.message, /\.claude\/skills\/slice-x/); return true; });
});
test('15. a catalog without a state folder holds MANAGED_SKILL_PATH_OCCUPIED, and the plan is not refused', async t => {
  const f = await wikiProject(t); fs.mkdirSync(path.join(f.bowerloom, 'managed/catalog'), { recursive: true }); fs.writeFileSync(path.join(f.bowerloom, 'managed/catalog/slice_wiki.json'), '{}\n');
  const p = await plan(f, ['claude-code']); assert.deepEqual([slice(p).action, slice(p).hold.code, slice(p).hold.next], ['hold', 'MANAGED_SKILL_PATH_OCCUPIED', 'Move .bowerloom/managed/catalog/slice_wiki.json aside, then run bowerloom apply.']);
});
test('16. --team plans only the slices the team agents name, and shows no kept line for others', async t => {
  const f = await wikiProject(t); await createSlice(f, 'other', { root: 'wiki' });
  const { sliceAgent } = await import('./slices-fixture.mjs'); sliceAgent(f, 'lead', ['slice-wiki']);
  const p = await plan(f, ['claude-code'], { team: 'first-team' }); assert.deepEqual(p.slices.map(s => s.id), ['wiki']); assert.doesNotMatch(review(p), /other|kept/);
  const all = await plan(f, ['claude-code']); assert.deepEqual(all.slices.map(s => s.id), ['other', 'wiki']);
});
test('17. --harness codex gives no slice line, the combined Codex line, and codexSlicesSkipped: true', async t => {
  const f = await wikiProject(t), p = await plan(f, ['codex']);
  assert.deepEqual(p.slices, []); assert.equal(p.codexSlicesSkipped, true); assert.doesNotMatch(review(p), /install slice|slice up to date|slice kept/);
  assert.match(review(p), /^Codex agents and context slices are not projected in this beta\. See the capability model design\.$/m); assert.equal((await plan(f, ['claude-code'])).codexSlicesSkipped, false);
  const none = await wikiProject(t, { slice: false }); assert.equal((await plan(none, ['claude-code', 'codex'])).codexSlicesSkipped, false);
});
test('18. the notes of section 3.7.3 render exactly, each in its case', async t => {
  const f = await wikiProject(t); put(f, 'wiki/bad.md', '---\nx: [oops\n---\n# Bad\n'); put(f, 'wiki/pic.png', 'x'); put(f, 'wiki/c.md', 'see [[nowhere]] and [[a]]\n');
  rewriteSlice(f, 'wiki', s => s.replace('summary: heading', 'summary: heading\nwhere:\n  status: current\nlinks:\n  follow: [wikilink]\nexclude: ["zz/**"]').replace('- "**/*.md"', '- "**/*.md"\n  - "none/*.txt"\n  - "**/*.png"'));
  put(f, 'wiki/ok.md', '---\nstatus: current\n---\n# Ok\n[[missing-link]]\n');
  const text = review(await plan(f, ['claude-code']));
  assert.match(text, /^ {2}Note: slice wiki left out 4 files whose frontmatter does not parse: a\.md, bad\.md and c\.md, and 1 more\.$/m);
  assert.match(text, /^ {2}Note: slice wiki has 1 links that point to no file and 0 links that point to more than one file\.$/m);
  assert.match(text, /^ {2}Note: slice wiki: the pattern none\/\*\.txt matches no file\.$/m);
  assert.doesNotMatch(text, /Note: slice wiki guards the whole project folder/);
  put(f, 'wiki/big.md', '# Big\n' + 'x'.repeat(1048576)); rewriteSlice(f, 'wiki', s => s.replace(/where:\n {2}status: current\n/, ''));
  assert.match(review(await plan(f, ['claude-code'])), /^ {2}Note: slice wiki lists 1 files over 1 MiB without a summary\.$/m);
  const root = await wikiProject(t, { slice: false }); await createSlice(root, 'all'); put(root, 'wiki/a.md');
  assert.match(review(await plan(root, ['claude-code'])), /^ {2}Note: slice all guards the whole project folder\. An agent that names it reads only the slice's files there with Read, Grep, and Glob\.$/m);
});
test('19. the three titles and the empty text', async t => {
  const f = await wikiProject(t, { slice: false });
  assert.match(review(await plan(f, ['claude-code'])), /^Apply skills, prompts, agents, and context slices for Claude Code$/m);
  assert.match(review(await plan(f, ['claude-code', 'codex'])), /^Apply skills, prompts, and agents for Claude Code and Codex, and context slices for Claude Code$/m);
  assert.match(review(await plan(f, ['codex'])), /^Apply skills and prompts for Codex$/m);
  assert.match(review(await plan(f, ['claude-code'], { team: 'first-team' })), /^Apply skills, prompts, agents, and context slices for Claude Code, team first-team$/m);
  assert.match(review(await plan(f, ['claude-code'])), /^ {2}Nothing in \.bowerloom\/skills\.json, \.bowerloom\/prompts, \.bowerloom\/teams\/\*\/agents, or \.bowerloom\/slices to apply yet\.$/m);
});
test('20. a sliceTree hook that changes a file during the read makes the plan refuse STALE_APPROVAL with the slice text', async t => {
  const f = await wikiProject(t);
  const stale = () => { throw Object.assign(new Error('changed'), { code: 'MANAGED_SKILL_STALE_APPROVAL' }); };
  await assert.rejects(plan(f, ['claude-code'], { sliceTree: stale }), e => { assert.equal(e.code, 'STALE_APPROVAL'); assert.match(e.message, /A file of slice wiki changed while Bowerloom read it\. Run bowerloom apply again\.$/); return true; });
});
test('21. JSON keeps format v1beta2 and holds slices, codexSlicesSkipped, unregisteredSlices, and agentsMayBeTracked', async t => {
  const f = await wikiProject(t), p = await plan(f, ['claude-code']), json = JSON.parse(JSON.stringify(p));
  assert.equal(json.format, 'bowerloom/project-apply-plan/v1beta3'); for (const k of ['slices', 'codexSlicesSkipped', 'unregisteredSlices', 'agentsMayBeTracked']) assert.ok(k in json, k);
  assert.equal(json.agentsMayBeTracked, false);
});
test('22. a registered folder that the store does not record holds SLICE_ROOT_MISSING with the folder steps', async t => {
  const f = await wikiProject(t); rewriteSlice(f, 'wiki', s => s.replace('root: "wiki"', 'root:\n  registered: kb\n  path: "wiki"'));
  const p = await plan(f, ['claude-code']); assert.deepEqual([slice(p).action, slice(p).hold.code, slice(p).hold.next], ['hold', 'SLICE_ROOT_MISSING', 'Run bowerloom folder list, or register the folder with bowerloom folder add <folder-name> <path>, then run bowerloom apply.']);
});
test('23. with no .bowerloom/managed/.gitignore and nothing else to do, a slice carries the ignore file when no prompt can', async t => {
  const f = await wikiProject(t); await applied(f, ['claude-code']); fs.rmSync(path.join(f.bowerloom, 'managed/.gitignore'));
  const p = await plan(f, ['claude-code']); assert.equal(p.actionable, true); assert.equal(slice(p).action, 'update'); assert.match(review(p), /^ {2}wiki +slice up to date \(puts back \.bowerloom\/managed\/\.gitignore\)$/m);
  await applied(f, ['claude-code']); assert.equal(exists(f, '.bowerloom/managed/.gitignore'), true);
});
test('24. Summaries changed counts only paths present in both indexes', async t => {
  const f = await wikiProject(t); await applied(f, ['claude-code']);
  put(f, 'wiki/a.md', '# Alpha two\n'); fs.rmSync(path.join(f.projectDir, 'wiki/sub/b.md')); put(f, 'wiki/new.md', '# Fresh\n');
  assert.deepEqual(slice(await plan(f, ['claude-code'])).changes, { added: 1, gone: 1, summaries: 1, rootChanged: false, guardChanged: false });
});
test('a slice whose file is gone is held with AUTHORING_ITEM_MISSING and the installed index stays', async t => {
  const f = await wikiProject(t); await applied(f, ['claude-code']); fs.rmSync(sliceFile(f, 'wiki'));
  const p = await plan(f, ['claude-code']); assert.deepEqual([slice(p).action, slice(p).hold.code, slice(p).installed], ['hold', 'AUTHORING_ITEM_MISSING', true]);
  assert.equal(slice(p).hold.next, '.bowerloom/slices/wiki.yaml is gone. Restore it from version control, then run bowerloom apply.');
});
test('a user edit of the installed index holds MANAGED_SKILL_LOCAL_DRIFT and nothing is overwritten', async t => {
  const f = await wikiProject(t); await applied(f, ['claude-code']); fs.appendFileSync(path.join(f.projectDir, '.claude/skills/slice-wiki/SKILL.md'), 'edited\n');
  const p = await plan(f, ['claude-code']); assert.deepEqual([slice(p).state, slice(p).action, slice(p).hold.code], ['drift', 'hold', 'MANAGED_SKILL_LOCAL_DRIFT']);
  const before = read(f, '.claude/skills/slice-wiki/SKILL.md'); await applied(f, ['claude-code']); assert.equal(read(f, '.claude/skills/slice-wiki/SKILL.md'), before);
});
test('C5. a change of the covered folders alone plans an update', async t => {
  const f = await wikiProject(t); await applied(f, ['claude-code']); const before = await plan(f, ['claude-code']);
  put(f, 'wiki/sub/note.txt', 'not a member\n'); const p = await plan(f, ['claude-code']);
  assert.deepEqual(slice(before).covered, ['./', 'sub/']); assert.deepEqual(slice(p).covered, []);
  assert.deepEqual([slice(p).state, slice(p).action], ['edited', 'update']); assert.deepEqual(slice(p).changes, { added: 0, gone: 0, summaries: 0, rootChanged: false, guardChanged: false });
});
test('S1. a reader error with another code holds the slice and names that code, and an error with no code is not hidden', async t => {
  const f = await wikiProject(t);
  const odd = () => { throw Object.assign(new Error('x'), { code: 'MANAGED_SKILL_REFUSED' }); };
  const p = await plan(f, ['claude-code'], { sliceTree: odd });
  assert.equal(slice(p).state, 'held'); assert.equal(slice(p).hold.code, 'SLICE_SOURCE_UNSAFE'); assert.match(slice(p).hold.next, /\(MANAGED_SKILL_REFUSED\)/);
  const bug = () => { throw new TypeError('a bug'); };
  await assert.rejects(plan(f, ['claude-code'], { sliceTree: bug }), Error);
});
test('S9. rawReferences gives null, not an empty list, for a catalog it cannot read as a list of text', async t => {
  const { rawReferences } = await import('../../../dist/packages/project-sync/src/slices.js');
  const f = await wikiProject(t); await applied(f, ['claude-code']); const file = path.join(f.projectDir, '.bowerloom/managed/catalog/slice_wiki.json');
  assert.deepEqual(rawReferences(file), ['a.md', 'sub/b.md', './', 'sub/']);
  const write = text => { fs.writeFileSync(file, text); return rawReferences(file); };
  assert.equal(write('{not json'), null); assert.equal(write('{"a":1}'), null); assert.equal(write('{"references":[1]}'), null);
  assert.deepEqual(write('{"references":["a.md","sub/"]}'), ['a.md', 'sub/']); assert.equal(rawReferences(file + '.missing'), null);
});
test('R6. a slice whose references pass 4095 is held SLICE_TOO_LARGE in the plan, 255 members deep are installed, 256 are held', async t => {
  const deep = Array.from({ length: 14 }, (_, k) => 'd' + k).join('/');
  const make = async count => {
    const f = await wikiProject(t, { slice: false });
    for (let i = 0; i < count; i++) put(f, `wiki/p${String(i).padStart(3, '0')}/${deep}/f.md`, '# F\n');
    fs.rmSync(path.join(f.projectDir, 'wiki/a.md')); fs.rmSync(path.join(f.projectDir, 'wiki/sub'), { recursive: true });
    await createSlice(f, 'wiki', { root: 'wiki', includes: ['p*/**/*.md'] }); return f;
  };
  const ok = await make(255), planOk = await plan(ok, ['claude-code']);
  assert.deepEqual([slice(planOk).state, slice(planOk).action, slice(planOk).members.length, slice(planOk).members.length + slice(planOk).covered.length], ['new', 'install', 255, 4081]);
  await applied(ok, ['claude-code']);
  const big = await make(256), planBig = await plan(big, ['claude-code']);
  assert.deepEqual([slice(planBig).state, slice(planBig).action, slice(planBig).hold.code], ['held', 'hold', 'SLICE_TOO_LARGE']);
});
