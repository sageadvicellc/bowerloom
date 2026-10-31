// Notes lane D: projection of knowledge sources. An agent that lists sources in `notes` gets one short notes section at the
// end of its instructions, for Claude Code and Codex. It names each source and its path, and says to read the AGENTS.md
// file there first. Nothing else changes. The export bundle carries each source's kind and name, never its path.
// Synthetic values only: every source path is relative or in ~ form.
import test from 'node:test';
import { loadDefinition } from '../../../dist/packages/harness-definition/src/index.js';
import { DEFINITION_BUNDLE_FORMAT, NOTES_HEADING, exportDefinitionBundle, notesSection, planPortable } from '../../../dist/packages/project-sync/src/index.js';
import { assert, json, projectNow, snapshot } from './portable-fixture.mjs';
import { PINNED, agentFile, lockedProject, read } from './locked-fixture.mjs';

const TWO = PINNED.filter(e => e.id === 'claude-code' || e.id === 'codex');
const WIKI = { kind: 'wiki-folder', name: 'wiki', path: 'notes' };
const TEAM = { kind: 'wiki-folder', name: 'team-notes', path: '~/notes/team' };
const SECTION = [
  '',
  '## Notes',
  '',
  '- wiki: the wiki folder at `notes`. Read `notes/AGENTS.md` first.',
  '- team-notes: the wiki folder at `~/notes/team`. Read `~/notes/team/AGENTS.md` first.',
  '',
].join('\n');

/** A project with two agents: `keeper` lists both sources, `helper` lists none. `linked: false` drops the sources and notes. */
function notesProject(t, { linked = true, parts = {}, engines = TWO, keeperNotes = ['wiki', 'team-notes'] } = {}) {
  return lockedProject(t, {
    engines, mcp: null, hooks: null,
    parts: { mcp: undefined, hooks: undefined, ...parts },
    agents: {
      keeper: agentFile('keeper', linked ? `notes:\n${keeperNotes.map(n => `  - ${n}\n`).join('')}` : ''),
      helper: agentFile('helper'),
    },
    files: linked ? { 'knowledge.json': json({ sources: [WIKI, TEAM] }) } : {},
  });
}
const definitionOf = p => { const r = loadDefinition(p.def); assert.equal(r.ok, true, JSON.stringify(r.ok ? null : r.problems)); return r.definition; };

test('the notes section is short fixed text: each source by name and path, and its AGENTS.md first', () => {
  assert.equal(NOTES_HEADING, '## Notes');
  assert.equal(notesSection([WIKI, TEAM]), SECTION.slice(1));
  assert.equal(notesSection([{ kind: 'wiki-folder', name: 'here', path: '.' }]), '## Notes\n\n- here: the wiki folder at `./`. Read `./AGENTS.md` first.\n');
  assert.equal(notesSection([]), '');
});

test('Claude Code: only the agent that lists sources gets the notes section, at the end of its instructions', async t => {
  const p = notesProject(t);
  await projectNow(p.input());
  assert.equal(read(p, '.claude/agents/keeper.md'), `---\nname: "keeper"\ndescription: "The keeper subagent."\n---\n\nAct as keeper.\n${SECTION}`);
  assert.equal(read(p, '.claude/agents/helper.md').includes(NOTES_HEADING), false);
  assert.equal(read(p, 'AGENTS.md').includes(NOTES_HEADING), false, 'the project instructions get no notes section');
});

test('Codex: the notes section ends the developer instructions of the agent that lists sources', async t => {
  const p = notesProject(t);
  await projectNow(p.input());
  const instructions = `Act as keeper.\n${SECTION}`;
  assert.ok(read(p, '.codex/agents/keeper.toml').includes(`developer_instructions = ${JSON.stringify(instructions)}\n`), read(p, '.codex/agents/keeper.toml'));
  assert.equal(read(p, '.codex/agents/helper.toml').includes(NOTES_HEADING), false);
});

test('the sources come in the order the agent lists them', async t => {
  const p = notesProject(t, { keeperNotes: ['team-notes', 'wiki'] });
  await projectNow(p.input());
  const text = read(p, '.claude/agents/keeper.md');
  assert.ok(text.indexOf('- team-notes:') < text.indexOf('- wiki:'));
});

test('untouched projections stay byte-identical: only the files of the agent that lists sources differ', async t => {
  const plain = notesProject(t, { linked: false });
  const linked = notesProject(t);
  await projectNow(plain.input());
  await projectNow(linked.input());
  const a = snapshot(plain.dir), b = snapshot(linked.dir);
  const differ = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter(k => a[k] !== b[k]).sort();
  assert.deepEqual(differ, ['.claude/agents/keeper.md', '.codex/agents/keeper.toml']);
});

test('the loss report says the notes are translated into the instructions, for each engine', t => {
  const p = notesProject(t);
  const plan = planPortable(p.input());
  for (const engine of ['claude-code', 'codex']) {
    const line = plan.loss.find(l => l.part === 'subagents' && l.entry === 'keeper' && l.engine === engine && l.field === 'notes');
    assert.ok(line, engine);
    assert.equal(line.result, 'translated');
    assert.match(line.reason, /notes section/);
    assert.equal(plan.loss.some(l => l.entry === 'helper' && l.field === 'notes'), false);
  }
  const plain = planPortable(notesProject(t, { linked: false }).input());
  assert.equal(plain.loss.some(l => l.field === 'notes'), false);
});

test('the memory line names the notes section only when the harness has a knowledge source', t => {
  const linked = planPortable(notesProject(t, { parts: { memory: 'instructions/AGENTS.md' } }).input());
  const plain = planPortable(notesProject(t, { linked: false, parts: { memory: 'instructions/AGENTS.md' } }).input());
  for (const engine of ['claude-code', 'codex']) {
    const was = plain.loss.find(l => l.part === 'memory' && l.engine === engine);
    const now = linked.loss.find(l => l.part === 'memory' && l.engine === engine);
    assert.equal(was.reason, 'Standing facts project as instructions in AGENTS.md. Engine-written memory is runtime state and is not projected.');
    assert.equal(now.result, 'translated');
    assert.ok(now.reason.startsWith(was.reason), engine);
    assert.match(now.reason, /notes section/);
  }
});

test('a second projection of the same definition writes nothing new', async t => {
  const p = notesProject(t);
  await projectNow(p.input());
  const before = snapshot(p.dir);
  const plan = planPortable(p.input());
  assert.equal(plan.changes.filter(c => c.action !== 'unchanged').length, 0, JSON.stringify(plan.changes.filter(c => c.action !== 'unchanged')));
  await projectNow(p.input());
  assert.deepEqual(snapshot(p.dir), before);
});

// ---- the export bundle (spec 6.7) -----------------------------------------------------------------------------------------

test('the export bundle carries each source by kind and name only, and never its path', t => {
  const p = notesProject(t);
  const def = definitionOf(p);
  const bundle = exportDefinitionBundle(def);
  assert.equal(bundle.format, DEFINITION_BUNDLE_FORMAT);
  assert.equal(bundle.harness, 'demo');
  assert.deepEqual(bundle.knowledge.map(k => ({ ...k })), [{ kind: 'wiki-folder', name: 'wiki' }, { kind: 'wiki-folder', name: 'team-notes' }]);
  for (const k of bundle.knowledge) assert.deepEqual(Object.keys(k).sort(), ['kind', 'name']);
  assert.equal(bundle.files.some(f => f.path === 'knowledge.json'), false, 'the source record with its paths stays home');
  assert.deepEqual(bundle.files.map(f => f.path), def.files.filter(f => f.path !== 'knowledge.json').map(f => f.path));
  // The agents keep their notes by name, so an import can link each name to a source the person picks.
  assert.match(Buffer.from(bundle.files.find(f => f.path === 'agents/keeper.md').bytes).toString('utf8'), /notes:\n {2}- wiki\n {2}- team-notes\n/);
  const flat = JSON.stringify({ ...bundle, files: bundle.files.map(f => ({ ...f, bytes: Buffer.from(f.bytes).toString('utf8') })) });
  assert.equal(flat.includes('~/notes/team'), false);
  assert.equal(flat.includes('"path":"notes"'), false);
});

test('the export bundle of a harness with no source has no knowledge and every file', t => {
  const p = notesProject(t, { linked: false });
  const def = definitionOf(p);
  const bundle = exportDefinitionBundle(def);
  assert.deepEqual(bundle.knowledge, []);
  assert.deepEqual(bundle.files.map(f => f.path), def.files.map(f => f.path));
  for (const [i, f] of bundle.files.entries()) assert.ok(Buffer.from(f.bytes).equals(Buffer.from(def.files[i].bytes)));
});
