// Spec 05, section 10.15: `context measure`. It reads only, and every test runs with the network denied.
import test from '../../../dist/tests/support/lock-slot-retry.js';
import { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { denyNetwork } from './sync-fixture.mjs';
import { measureContext, showSlice, ASSUMPTIONS } from '../../../dist/packages/project-sync/src/context-measure.js';
import { estimateTokens, ratioPpm } from '../../../dist/packages/context-slices/src/estimate.js';
import { wikiProject, put, sliceAgent, applied, rewriteSlice, exactTree, measureInput, createSlice, agentText, agentSource } from './slices-fixture.mjs';

const network = denyNetwork();
after(() => assert.deepEqual(network, []));
const size = (f, rel) => fs.statSync(path.join(f.projectDir, rel)).size;
const lead = r => r.agents.find(a => a.role === 'lead');

/** wiki of two pages (15 and 14 bytes), a project CLAUDE.md (15), a skill house (13), and the agent lead (body 13). */
async function fixture(t, { agentExtra = '', skills = ['slice-wiki', 'house'], install = true } = {}) {
  const f = await wikiProject(t);
  put(f, 'CLAUDE.md', 'Project rules.\n'); put(f, '.claude/skills/house/SKILL.md', 'House skill.\n');
  sliceAgent(f, 'lead', skills, agentExtra); if (install) await applied(f, ['claude-code']);
  return f;
}

test('1. the fixture gives the exact byte counts of each column', async t => {
  const f = await fixture(t), r = await measureContext(measureInput(f)), a = lead(r), index = size(f, '.claude/skills/slice-wiki/SKILL.md');
  assert.equal(r.format, 'bowerloom/context-measure/v1beta1'); assert.equal(r.executionAuthorized, false);
  assert.equal(a.start.prompt, 13); assert.equal(a.start.instructions.bytes, 15); assert.deepEqual(a.start.instructions.files, [{ path: 'CLAUDE.md', bytes: 15, via: 'claude' }]);
  assert.deepEqual(a.start.skills.files, [{ name: 'house', path: '.claude/skills/house/SKILL.md', bytes: 13 }]); assert.deepEqual(a.start.skills.unresolved, []);
  assert.deepEqual(a.start.slices, [{ id: 'wiki', indexBytes: index, source: 'installed', memberBytes: 29, indexToMembersPpm: ratioPpm(index, 29), installed: true, hold: null }]);
  assert.equal(a.start.bytes, 13 + 15 + 13 + index); assert.equal(a.start.tokens, estimateTokens(a.start.bytes, 4000));
  assert.deepEqual(a.onDemand.members, { files: 2, bytes: 29 }); assert.equal(a.onDemand.bytes, 29); assert.deepEqual(a.onDemand.instructions, []);
  assert.deepEqual(r.baseline, { folder: 'wiki', chosenBy: 'slice-roots', include: '**/*.md', files: 2, bytes: 29, skipped: { hidden: 0, links: 0, notRegular: 0 } });
  assert.equal(a.baseline.bytes, 13 + 15 + 13 + 29); assert.equal(a.discovered, true); assert.equal(a.team, 'first-team'); assert.equal(a.omitClaudeMd, false);
  assert.deepEqual(r.estimator, { id: 'bytes-per-token/v1', bytesPerToken: '4', band: ['3.0', '4.5'], calibrated: false }); assert.deepEqual(a.listing, { descriptionBytes: Buffer.byteLength('Describe what this slice holds and which agents use it.') });
});
test('2. omitClaudeMd makes Instructions zero and leaves Baseline unchanged', async t => {
  const f = await fixture(t), keep = lead(await measureContext(measureInput(f)));
  sliceAgent(f, 'lead', ['slice-wiki', 'house'], 'omitClaudeMd: true'); await applied(f, ['claude-code']);
  const a = lead(await measureContext(measureInput(f)));
  assert.equal(a.omitClaudeMd, true); assert.equal(a.start.instructions.bytes, 0); assert.deepEqual(a.start.instructions.files, []);
  assert.equal(a.baseline.bytes, keep.baseline.bytes); assert.equal(a.start.bytes, keep.start.bytes - 15);
});
test('3. a preload beyond 32 is not counted', async t => {
  const names = Array.from({ length: 32 }, (_, i) => 'skill-' + String(i).padStart(2, '0'));
  const f = await fixture(t, { skills: [...names, 'slice-wiki'] }), a = lead(await measureContext(measureInput(f)));
  assert.deepEqual(a.start.slices, []); assert.deepEqual(a.start.skills.beyondPreloadLimit, ['slice-wiki']); assert.equal(a.start.skills.unresolved.length, 32);
});
test('4. a missing skill is listed and not counted', async t => {
  const f = await fixture(t, { skills: ['slice-wiki', 'house', 'ghost'] }), r = await measureContext(measureInput(f)), a = lead(r);
  assert.deepEqual(a.start.skills.unresolved, ['ghost']); assert.equal(a.start.skills.files.length, 1); assert.ok(a.notes.includes('skills not found, so not counted: ghost.'));
});
test('5. the baseline folder default is the deepest common folder of the measured agents slice roots, and chosenBy says so', async t => {
  const f = await fixture(t); await createSlice(f, 'inner', { root: 'wiki/sub' }); sliceAgent(f, 'second', ['slice-inner']); await applied(f, ['claude-code']);
  const both = await measureContext(measureInput(f)); assert.deepEqual([both.baseline.folder, both.baseline.chosenBy], ['wiki', 'slice-roots']);
  const only = await measureContext(measureInput(f, { agents: ['second'] })); assert.deepEqual([only.baseline.folder, only.baseline.chosenBy, only.baseline.files], ['wiki/sub', 'slice-roots', 1]);
  const flag = await measureContext(measureInput(f, { baseline: f.projectDir })); assert.equal(flag.baseline.chosenBy, 'flag'); assert.equal(flag.baseline.folder, '.');
  const none = await wikiProject(t, { slice: false }); agentSource(none, 'first-team', 'plain.md', agentText('plain'));
  const project = await measureContext(measureInput(none)); assert.deepEqual([project.baseline.folder, project.baseline.chosenBy], ['.', 'project']);
  await assert.rejects(measureContext(measureInput(f, { baseline: path.join(f.base, 'nope') })), e => e.code === 'CONTEXT_BASELINE_INVALID');
  await assert.rejects(measureContext(measureInput(f, { agents: ['nobody'] })), e => e.code === 'CONTEXT_AGENT_NOT_FOUND');
});
test('6. the baseline skips hidden entries and links and counts them', async t => {
  const f = await fixture(t); put(f, 'wiki/.obsidian/x.md', '# hidden\n'); put(f, 'wiki/.hidden.md', '# hidden\n'); fs.symlinkSync(path.join(f.projectDir, 'wiki/a.md'), path.join(f.projectDir, 'wiki/ln.md'));
  fs.symlinkSync(path.join(f.projectDir, 'wiki/sub'), path.join(f.projectDir, 'wiki/dirln')); put(f, 'wiki/note.txt', 'not markdown\n');
  const r = await measureContext(measureInput(f)); assert.deepEqual(r.baseline.skipped, { hidden: 2, links: 2, notRegular: 0 }); assert.equal(r.baseline.files, 2); assert.equal(r.baseline.bytes, 29);
});
test('7. ratios are integer parts per million', async t => {
  const f = await fixture(t), a = lead(await measureContext(measureInput(f)));
  assert.equal(a.ratios.startToBaselinePpm, Math.floor(a.start.bytes * 1000000 / a.baseline.bytes)); assert.equal(a.ratios.onDemandToBaselinePpm, Math.floor(a.onDemand.bytes * 1000000 / a.baseline.bytes));
  for (const n of Object.values(a.ratios)) assert.ok(Number.isInteger(n));
});
test('8. reference.unslicedStartBytes equals the start without slice indexes', async t => {
  const f = await fixture(t), a = lead(await measureContext(measureInput(f)));
  assert.equal(a.reference.unslicedStartBytes, 13 + 15 + 13); assert.equal(a.start.bytes - a.reference.unslicedStartBytes, a.start.slices[0].indexBytes);
});
test('9. mentioned lists backtick paths that exist and adds them to no sum', async t => {
  const f = await fixture(t); put(f, 'docs/guide.md', 'x'.repeat(100));
  fs.writeFileSync(path.join(f.bowerloom, 'teams/first-team/agents/lead.md'), agentText('lead', 'skills: [slice-wiki, house]', 'Read `docs/guide.md` and `missing.md` and `a b` first.\n')); await applied(f, ['claude-code']);
  const before = lead(await measureContext(measureInput(f)));
  assert.deepEqual(before.mentioned, [{ path: 'docs/guide.md', bytes: 100 }]); assert.ok(before.notes.includes('names docs/guide.md in its prompt (100 bytes). An agent that follows that line reads it on demand.'));
  assert.equal(before.start.bytes, before.start.prompt + 15 + 13 + before.start.slices[0].indexBytes); assert.equal(before.onDemand.bytes, 29);
});
test('10. two runs give equal JSON bytes', async t => {
  const f = await fixture(t), a = JSON.stringify(await measureContext(measureInput(f))), b = JSON.stringify(await measureContext(measureInput(f))); assert.equal(a, b);
  assert.doesNotMatch(a, /"(time|date|timestamp)"/i);
});
test('11. a held slice is reported and not counted', async t => {
  const f = await fixture(t, { install: false }); rewriteSlice(f, 'wiki', s => s.replace('"**/*.md"', '"missing.md"'));
  const a = lead(await measureContext(measureInput(f))); assert.deepEqual(a.start.slices.map(s => [s.id, s.indexBytes, s.hold]), [['wiki', 0, 'SLICE_PATH_MISSING']]); assert.ok(a.notes.includes('slice wiki is held (SLICE_PATH_MISSING), so it is not counted.'));
  assert.deepEqual(a.onDemand.members, { files: 0, bytes: 0 });
});
test('12. an out-of-date installed index counts the live render and prints the note', async t => {
  const f = await fixture(t); const installed = size(f, '.claude/skills/slice-wiki/SKILL.md'); put(f, 'wiki/c.md', '# Gamma\nbody\n');
  const a = lead(await measureContext(measureInput(f))); assert.equal(a.start.slices[0].source, 'live'); assert.ok(a.start.slices[0].indexBytes > installed);
  assert.ok(a.notes.includes('the index of slice wiki is out of date, so the live render is counted. Run bowerloom apply.')); assert.equal(a.onDemand.members.files, 3);
});
test('13. a current installed index counts the installed bytes', async t => {
  const f = await fixture(t), a = lead(await measureContext(measureInput(f))); assert.equal(a.start.slices[0].source, 'installed'); assert.equal(a.start.slices[0].indexBytes, size(f, '.claude/skills/slice-wiki/SKILL.md'));
  assert.deepEqual(a.notes, ['starts with 15 bytes of CLAUDE.md or AGENTS.md files. Set omitClaudeMd: true to start it with its slices only.']);
});
test('14. a hard link reached twice counts once', async t => {
  const f = await fixture(t); fs.mkdirSync(path.join(f.projectDir, '.claude'), { recursive: true }); fs.linkSync(path.join(f.projectDir, 'CLAUDE.md'), path.join(f.projectDir, '.claude/CLAUDE.md'));
  const a = lead(await measureContext(measureInput(f))); assert.equal(a.start.instructions.files.length, 1); assert.equal(a.start.instructions.bytes, 15);
  // Two slices over the same files count each member once on demand.
  await createSlice(f, 'twin', { root: 'wiki' }); sliceAgent(f, 'lead', ['slice-wiki', 'slice-twin', 'house']); await applied(f, ['claude-code']);
  assert.deepEqual(lead(await measureContext(measureInput(f))).onDemand.members, { files: 2, bytes: 29 });
});
test('15. assumptions holds the eight strings of section 4.10', async t => {
  const f = await fixture(t), r = await measureContext(measureInput(f));
  assert.equal(r.assumptions.length, 8); assert.deepEqual(r.assumptions, [...ASSUMPTIONS]);
  assert.equal(r.assumptions[7], 'tokens: bytes divided by bytesPerToken. The error against Claude\'s tokenizer is not measured.'); assert.ok(r.notCounted.includes('model output'));
});
test('--from above the project adds the discovery note; the measure writes nothing', async t => {
  const f = await fixture(t), before = exactTree(f.projectDir), state = exactTree(f.stateRoot);
  const a = lead(await measureContext(measureInput(f, { from: f.base }))); assert.equal(a.discovered, false);
  assert.equal(a.notes[0], `Claude Code started in ${f.base} does not find this agent. It finds agents only in the folders above where it starts. Start it inside ${f.projectDir}, or pass --add-dir ${f.projectDir}.`);
  assert.equal(exactTree(f.projectDir), before); assert.equal(exactTree(f.stateRoot), state);
});
test('--bytes-per-token calibrates the estimate; --user counts the user files; omitClaudeMd removes them', async t => {
  const f = await fixture(t); fs.mkdirSync(path.join(f.home, '.claude'), { recursive: true }); fs.writeFileSync(path.join(f.home, '.claude/CLAUDE.md'), 'U'.repeat(40));
  const plain = lead(await measureContext(measureInput(f))), user = lead(await measureContext(measureInput(f, { user: true })));
  assert.equal(user.start.instructions.bytes, plain.start.instructions.bytes + 40); assert.equal(plain.start.instructions.bytes, 15);
  const cal = await measureContext(measureInput(f, { bytesPerTokenMilli: 3500 })); assert.equal(cal.estimator.calibrated, 'user'); assert.equal(cal.estimator.bytesPerToken, '3.5'); assert.equal(lead(cal).start.tokens, estimateTokens(lead(cal).start.bytes, 3500));
  sliceAgent(f, 'lead', ['slice-wiki', 'house'], 'omitClaudeMd: true'); await applied(f, ['claude-code']); assert.equal(lead(await measureContext(measureInput(f, { user: true }))).start.instructions.bytes, 0);
});
test('a skill that lives in a plugin is listed as not found', async t => {
  const f = await fixture(t, { skills: ['slice-wiki', 'plugin-skill'] }); const a = lead(await measureContext(measureInput(f))); assert.deepEqual(a.start.skills.unresolved, ['plugin-skill']);
});
test('showSlice names the index, the installed state, the agents, and holds nothing back', async t => {
  const f = await fixture(t), s = await showSlice({ project: f.project(), stateRoot: f.stateRoot, slice: 'wiki' });
  assert.equal(s.format, 'bowerloom/context-slice-show/v1beta1'); assert.equal(s.installed, 'installed and the same'); assert.deepEqual(s.agents, ['lead']); assert.equal(s.guard, 'root'); assert.equal(s.index.text, fs.readFileSync(path.join(f.projectDir, '.claude/skills/slice-wiki/SKILL.md'), 'utf8'));
  put(f, 'wiki/c.md', '# Gamma\n'); assert.equal((await showSlice({ project: f.project(), stateRoot: f.stateRoot, slice: 'wiki' })).installed, 'installed and out of date');
  await assert.rejects(showSlice({ project: f.project(), stateRoot: f.stateRoot, slice: 'ghost' }), e => e.code === 'CONTEXT_SLICE_NOT_FOUND');
  const held = await wikiProject(t); rewriteSlice(held, 'wiki', x => x.replace('"**/*.md"', '"missing.md"')); const h = await showSlice({ project: held.project(), stateRoot: held.stateRoot, slice: 'wiki' });
  assert.equal(h.index, null); assert.equal(h.hold.code, 'SLICE_PATH_MISSING'); assert.equal(h.installed, 'not installed');
});

test('C3. a file counts once per column: a baseline file that is also in the instruction chain is not added again', async t => {
  const f = await fixture(t), r = await measureContext(measureInput(f, { baseline: f.projectDir })), a = lead(r);
  assert.equal(r.baseline.files, 3); assert.equal(r.baseline.bytes, 15 + 29, 'the folder total is every .md file once');
  assert.equal(a.baseline.bytes, 13 + 15 + 13 + 29, 'CLAUDE.md is in the chain, so the baseline files do not count it again');
  fs.mkdirSync(path.join(f.projectDir, 'docs'), { mode: 0o755 }); fs.linkSync(path.join(f.projectDir, 'CLAUDE.md'), path.join(f.projectDir, 'docs/same.md'));
  const linked = await measureContext(measureInput(f, { baseline: f.projectDir })); assert.equal(lead(linked).baseline.bytes, 13 + 15 + 13 + 29, 'a hard link to a chain file is the same file');
});
test('S4. an unreadable, oversize, or non-regular file is named in the notes and the JSON, and an oversize SKILL.md is not "not found"', async t => {
  const f = await fixture(t); const skill = path.join(f.projectDir, '.claude/skills/house/SKILL.md');
  fs.writeFileSync(skill, 'x'.repeat(8 * 1024 * 1024 + 1));
  let a = lead(await measureContext(measureInput(f)));
  assert.deepEqual(a.start.skills.unreadable, [{ path: '.claude/skills/house/SKILL.md', reason: 'too large' }]); assert.deepEqual(a.start.skills.unresolved, []);
  assert.ok(a.notes.includes('skill house cannot be counted: .claude/skills/house/SKILL.md is too large.'), a.notes.join('|'));
  fs.writeFileSync(skill, 'House skill.\n'); if (process.getuid?.() !== 0) {
    fs.chmodSync(path.join(f.projectDir, 'CLAUDE.md'), 0o000);
    try { a = lead(await measureContext(measureInput(f))); } finally { fs.chmodSync(path.join(f.projectDir, 'CLAUDE.md'), 0o644); }
    assert.deepEqual(a.start.instructions.unreadable, [{ path: 'CLAUDE.md', reason: 'EACCES' }]); assert.ok(a.notes.includes('CLAUDE.md cannot be counted: it cannot be read (EACCES).'), a.notes.join('|'));
  }
  fs.rmSync(path.join(f.projectDir, 'CLAUDE.md')); fs.mkdirSync(path.join(f.projectDir, 'CLAUDE.md'));
  a = lead(await measureContext(measureInput(f))); assert.deepEqual(a.start.instructions.unreadable, [{ path: 'CLAUDE.md', reason: 'not a regular file' }]);
});
test('S6. a held agent is reported with its hold code, not as unknown, and a chosen agent with no planned item throws', async t => {
  const f = await fixture(t); agentSource(f, 'first-team', 'broken.md', '---\nname: broken\nbogus: 1\n---\nx\n');
  const r = await measureContext(measureInput(f, { agents: ['broken'] }));
  assert.deepEqual(r.agents, []); assert.equal(r.held.length, 1); assert.equal(r.held[0].role, 'broken'); assert.equal(r.held[0].code, 'AGENT_KEY_UNKNOWN'); assert.match(r.held[0].next, /^Remove the key bogus from \.bowerloom\/teams\/first-team\/agents\/broken\.md/);
  const all = await measureContext(measureInput(f)); assert.deepEqual(all.held.map(h => h.role), ['broken']); assert.deepEqual(all.agents.map(a => a.role), ['lead']);
  await assert.rejects(measureContext(measureInput(f, { agents: ['nobody'] })), e => e.code === 'CONTEXT_AGENT_NOT_FOUND');
});
