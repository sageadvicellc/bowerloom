// The mapping from what the real-setup reader found to the state of the harness-first preview (--prototype-v3-real). It runs on the made-up home folder of
// tests/fixtures-real and on small homes made here. It never reads the real HOME. Nothing is written outside a temporary folder.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { TestContext } from 'node:test';
import { createScanner } from '../main/real-scan.js';
import { buildRealResult } from '../shared/real/map-world.js';
import type { RealPlace, RealResult } from '../shared/real/types.js';
import { FILE_CUT_LINE, FILE_LINES, compareVersions, firstLines, partOfItem, pluginOf, realToHarnessState, sourceIdFor } from '../shared/harness/real-map.js';
import { createSampleWorld } from '../shared/harness/sample.js';
import { blankRealState } from '../renderer/harness/real/blank.js';
import { createHarnessFromSource, createHarnessStore } from '../shared/harness/store.js';
import type { Schedule } from '../shared/harness/store.js';
import { harnessById, routeGone } from '../shared/harness/status.js';
import { LIMITS, bannedHere, countWords } from '../shared/harness/words.js';
import { INTERFACE_IDS } from '../shared/harness/types.js';
import type { HarnessState, Part, Stamp } from '../shared/harness/types.js';
import type { HarnessItem } from '../shared/proto/types.js';
import { FAKE_SECRET, FAKE_TOKEN_IN_TEXT, buildFixture } from './fixtures-real/build.js';
import type { Fixture } from './fixtures-real/build.js';
import { tempDir } from './support.js';

const NOW_MS = Date.UTC(2026, 9, 26);
const STAMP: Stamp = { daysAgo: 0, time: '11:00' };

interface Read { readonly result: RealResult; readonly places: readonly RealPlace[] }

/** The reader as the main process runs it for the page: discover the home, add a folder, read every place, fold in the extra programs. */
async function readHome(home: string, pickedFolders: readonly string[] = []): Promise<Read> {
  const scanner = createScanner({ home });
  const found = await scanner.discover();
  const places: RealPlace[] = [...found.places];
  for (const dir of pickedFolders) places.push(...(await scanner.addFolder(dir)).places);
  const batch = await scanner.read(places.map(p => p.id));
  return { result: buildRealResult(batch.reads, batch.tally, { nowMs: NOW_MS, foldExtraApps: true }), places };
}
function fixture(t: TestContext): Fixture { const f = buildFixture(); t.after(() => f.cleanup()); return f; }
const put = (file: string, text: string): void => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, text); };
const skillFile = (name: string, description: string): string => `---\nname: ${name}\ndescription: ${description}\n---\nBody of ${name}.\n`;

async function fixtureState(t: TestContext): Promise<{ f: Fixture; read: Read; state: HarnessState }> {
  const f = fixture(t), read = await readHome(f.home, [f.work]);
  return { f, read, state: realToHarnessState(read.result, read.places) };
}
/** The part of that kind and name. The same name can be in more than one folder: the one in the home folder comes first. */
const partNamed = (state: HarnessState, kind: Part['kind'], name: string): Part => {
  const named = state.parts.filter(p => p.kind === kind && p.name === name);
  const part = named.find(p => p.source.startsWith('Your ')) ?? named[0];
  assert.ok(part, `${kind} ${name}: ${state.parts.filter(p => p.kind === kind).map(p => p.name).join(', ')}`);
  return part;
};

// ---- Shape

test('the state starts from nothing the person made: no harness, install, run or history, and new ids start at 100', async t => {
  const { state } = await fixtureState(t);
  assert.deepEqual(state.harnesses, []); assert.deepEqual(state.installs, []); assert.deepEqual(state.runs, []); assert.deepEqual(state.history, []);
  assert.equal(state.nextId, 100);
  assert.deepEqual(state.chosenSourceIds, state.sources.map(s => s.id), 'every source starts ticked');
});

test('every item the reader found is one part with the same id, and the kinds follow the item', async t => {
  const { read, state } = await fixtureState(t);
  // Hermes is no engine of 0.8, so what only a Hermes or a Bowerloom folder holds is not a part. The notes count exactly what is left out, so nothing goes missing without a word.
  const all = read.result.world.items, items = all.filter(i => state.parts.some(p => p.id === i.id)), left = all.filter(i => !items.includes(i));
  for (const item of left) assert.ok(item.foundAt.every(f => (f.interface as string) === 'hermes' || (f.interface as string) === 'bowerloom'), item.name);
  const noted = state.real!.notes.reduce((sum, n) => sum + Number(/^(\d+) things? in (?:a Bowerloom folder|a Hermes folder|a program Bowerloom does not know) (?:is|are) not shown\.$/.exec(n)?.[1] ?? 0), 0);
  assert.equal(noted, left.length, state.real!.notes.join(' | '));
  assert.equal(state.parts.length, all.length - noted);
  assert.deepEqual([...state.parts.map(p => p.id)].sort(), items.map(i => i.id).sort(), 'the part ids are the item ids, so they are stable');
  assert.equal(new Set(state.parts.map(p => p.id)).size, state.parts.length);
  const kindOf = { skill: 'skill', agent: 'agent', tool: 'tool', 'context-slice': 'context' } as const;
  for (const item of items) assert.equal(state.parts.find(p => p.id === item.id)!.kind, kindOf[item.kind], item.name);
  const leftOf = (kind: HarnessItem['kind']): number => left.filter(i => i.kind === kind).length;
  assert.equal(state.parts.filter(p => p.kind === 'agent').length, read.result.counts.agents - leftOf('agent'));
  assert.equal(state.parts.filter(p => p.kind === 'skill').length, read.result.counts.skills - leftOf('skill'));
  assert.equal(state.parts.filter(p => p.kind === 'tool').length, read.result.counts.tools + read.result.counts.hooks - leftOf('tool'));
  assert.ok(state.parts.filter(p => p.kind === 'context').length > 0, 'notes give context parts');
  assert.ok(state.parts.every(p => p.inLibrary));
});

test('the same state comes from the same read, so a second read gives the same ids', async t => {
  const f = fixture(t);
  const a = await readHome(f.home, [f.work]), b = await readHome(f.home, [f.work]);
  assert.deepEqual(realToHarnessState(a.result, a.places), realToHarnessState(b.result, b.places));
});

test('a part has plain words: a short summary, a description, a path with ~, and a source that is never "Made by you"', async t => {
  const { f, state } = await fixtureState(t);
  const reply = partNamed(state, 'skill', 'Write a reply');
  assert.equal(reply.description, 'Drafts a reply in your voice for you to check.');
  assert.ok(reply.summary.length <= 41, reply.summary); assert.equal(reply.summary, 'Drafts a reply in your voice for you to…');
  assert.match(reply.path, /^~\/\.claude\/skills\/write-reply\/SKILL\.md$/);
  assert.equal(reply.source, 'Your Claude Code folder');
  assert.match(reply.fileText, /Read the message\. Write a reply\./);
  for (const p of state.parts) {
    assert.notEqual(p.source, 'Made by you', p.name); assert.ok(p.description.length > 0, p.name); assert.ok(p.summary.length > 0, p.name);
    assert.ok(p.summary.length <= 41, `${p.name}: ${p.summary}`); assert.equal(p.path.includes(f.root), false, `${p.name} path ${p.path}`);
    assert.equal(p.origin, state.sources.find(s => s.partIds.includes(p.id))!.id, p.name);
  }
});

test('a tool with no description gets a plain line, and a hook says it runs on its own', async t => {
  const { state } = await fixtureState(t);
  const tracker = partNamed(state, 'tool', 'tracker');
  assert.match(tracker.description, /^A connection to another program/); assert.match(tracker.description, /Claude Code folder/);
  const hooks = state.parts.filter(p => p.kind === 'tool' && /runs/.test(p.description));
  assert.equal(hooks.length, 1);
});

// ---- Sources and links

test('parts are grouped into sources by scope and program, with plain names', async t => {
  const { state } = await fixtureState(t);
  const names = state.sources.map(s => s.name);
  assert.ok(names.includes('Your Claude Code folder')); assert.ok(names.includes('Your Codex folder'));
  assert.ok(names.includes('alpha (Claude Code)'), names.join(' | '));
  for (const source of state.sources) { assert.ok(source.partIds.length > 0, source.name); assert.ok(source.interfaceName.length > 0); assert.ok(source.harnessName.length > 0); }
  assert.equal(new Set(state.sources.map(s => s.id)).size, state.sources.length);
  const inSources = state.sources.flatMap(s => s.partIds);
  assert.deepEqual([...inSources].sort(), state.parts.map(p => p.id).sort(), 'every part is in exactly one source');
  const totals = partNamed(state, 'skill', 'Check the totals');
  assert.equal(state.sources.find(s => s.id === totals.origin)!.name, 'Your Claude Code folder', 'a thing found in three programs sits with the first');
});

test('the links of an agent come from the skills and connections it names, and are kept on its source', async t => {
  const { state } = await fixtureState(t);
  const reviewer = partNamed(state, 'agent', 'reviewer'), source = state.sources.find(s => s.id === reviewer.origin)!;
  const links = (source.links ?? []).filter(l => l.from === reviewer.id).map(l => l.to).sort();
  assert.deepEqual(links, [partNamed(state, 'skill', 'Write a reply').id, partNamed(state, 'skill', 'Check the totals').id, partNamed(state, 'tool', 'tracker').id].sort());
  for (const s of state.sources) for (const l of s.links ?? []) {
    assert.equal(state.parts.find(p => p.id === l.from)?.kind, 'agent'); assert.notEqual(state.parts.find(p => p.id === l.to)?.kind, 'agent');
    assert.ok(state.parts.some(p => p.id === l.to), 'a link goes to a part the state holds');
  }
  assert.equal(partNamed(state, 'agent', 'tidier').origin, reviewer.origin);
  assert.deepEqual((source.links ?? []).filter(l => l.from === partNamed(state, 'agent', 'tidier').id), [], 'an agent that names nothing has no link');
});

test('a harness made from a real source uses the real links, and pulls in a linked part from another source', async t => {
  const { state } = await fixtureState(t);
  const reviewer = partNamed(state, 'agent', 'reviewer'), source = state.sources.find(s => s.id === reviewer.origin)!;
  const r = createHarnessFromSource(state, source.id, STAMP);
  const harness = harnessById(r.state, r.harnessId!)!;
  assert.deepEqual(harness.links.filter(l => l.from === reviewer.id).map(l => l.to).sort(), (source.links ?? []).filter(l => l.from === reviewer.id).map(l => l.to).sort());
  assert.equal(harness.links.length, (source.links ?? []).length, 'no automatic link is added in real mode');
  for (const l of harness.links) assert.ok(harness.partIds.includes(l.to) && harness.partIds.includes(l.from), 'both ends are in the harness');
});

test('a link to a part outside the source adds that part to the harness; a source with no links field still gets the automatic links', () => {
  const base = createSampleWorld();
  const outside = base.parts.find(p => p.id === 'skill-translate')!, agent = base.parts.find(p => p.id === 'agent-translator')!, inside = base.parts.find(p => p.id === 'skill-schedule-a-call')!;
  const withLinks: HarnessState = { ...base, sources: [{ id: 'src-x', name: 'X', interfaceName: 'Codex', harnessName: 'X pack', partIds: [agent.id, inside.id], links: [{ from: agent.id, to: outside.id }] }] };
  const made = createHarnessFromSource(withLinks, 'src-x', STAMP), h = harnessById(made.state, made.harnessId!)!;
  assert.deepEqual(h.links, [{ from: agent.id, to: outside.id }]);
  assert.deepEqual(h.partIds, [agent.id, inside.id, outside.id]);
  const ghost: HarnessState = { ...withLinks, sources: [{ ...withLinks.sources[0]!, links: [{ from: agent.id, to: 'skill-not-here' }] }] };
  const noGhost = harnessById(createHarnessFromSource(ghost, 'src-x', STAMP).state, 'harness-100')!;
  assert.deepEqual(noGhost.links, [], 'a link to an unknown part is dropped'); assert.deepEqual(noGhost.partIds, [agent.id, inside.id]);
  const auto: HarnessState = { ...withLinks, sources: [{ id: 'src-x', name: 'X', interfaceName: 'Codex', harnessName: 'X pack', partIds: [agent.id, inside.id] }] };
  assert.deepEqual(harnessById(createHarnessFromSource(auto, 'src-x', STAMP).state, 'harness-100')!.links, [{ from: agent.id, to: inside.id }]);
});

// ---- Plug-ins

test('an agent from a plug-in is its own source, named for the plug-in, with the version from the path', async t => {
  const home = tempDir(t, 'bowerloom-v3-map-');
  put(join(home, '.claude', 'agents', 'mine.md'), skillFile('mine', 'My own agent.'));
  put(join(home, '.claude', 'plugins', 'cache', 'src', 'caveman', '1.2.0', 'agents', 'brief-reviewer.md'), skillFile('brief-reviewer', 'Reviews a change and keeps the reply short.'));
  const read = await readHome(home), state = realToHarnessState(read.result, read.places);
  const mine = partNamed(state, 'agent', 'mine'), plug = partNamed(state, 'agent', 'brief-reviewer');
  assert.equal(mine.source, 'Your Claude Code folder'); assert.equal(mine.version, undefined);
  assert.equal(plug.source, 'Caveman plug-in'); assert.equal(plug.version, '1.2.0');
  assert.notEqual(mine.origin, plug.origin);
  assert.deepEqual(state.sources.map(s => s.name).sort(), ['Caveman (plug-in)', 'Your Claude Code folder']);
  assert.equal(state.sources.find(s => s.id === plug.origin)!.harnessName, 'Caveman plug-in');
  assert.equal(plug.path, '~/.claude/plugins/cache/src/caveman/1.2.0/agents/brief-reviewer.md');
});

// ---- What works where

test('the reader cannot prove where a part works, so no real part claims a limit, and the interfaces say they are not checked', async t => {
  const { state } = await fixtureState(t);
  for (const p of state.parts) assert.deepEqual(p.cannotUse, [], `${p.name} (${p.kind})`);
  for (const i of state.interfaces) {
    assert.equal(i.cannotUseNote, 'Bowerloom has not checked which parts this program can use.', i.id);
    assert.doesNotMatch(i.cannotUseNote, /only Claude Code|Nothing\. It uses every kind/);
  }
  for (const i of blankRealState(STAMP).interfaces) assert.equal(i.cannotUseNote, 'Bowerloom has not checked which parts this program can use.', `before the first read: ${i.id}`);
});

test('an agent carries the model badge the reader gave it, and a part with none has no badge', async t => {
  const { state } = await fixtureState(t);
  assert.equal(partNamed(state, 'agent', 'reviewer').badge, 'Claude Code only');
  assert.equal(partNamed(state, 'agent', 'tidier').badge, undefined);
  assert.equal(partNamed(state, 'skill', 'Write a reply').badge, undefined);
});

// ---- Context

test('notes become context parts that list their page titles, and the number of them is capped', async t => {
  const { state } = await fixtureState(t);
  const context = state.parts.filter(p => p.kind === 'context');
  assert.ok(context.length >= 2);
  const alpha = context.find(p => /alpha/i.test(p.name))!;
  assert.ok(alpha, context.map(p => p.name).join(', '));
  assert.match(alpha.fileText, /Alpha plan/); assert.match(alpha.fileText, /An idea/);
  assert.match(alpha.description, /\d+ (page|pages)/);
  assert.ok(context.every(p => p.fileText.split('\n').length <= 60));
  assert.ok(context.length <= 30);
});

test('more than 30 sets of notes keep the 30 largest and say how many were left out', () => {
  const pages = Array.from({ length: 40 }, (_, i) => ({ id: `page-${i}`, title: `Page ${i}`, folder: `Notes/f${i}`, type: 'note', tags: [], summary: '', bytes: 1, links: [], joinedSinceVisit: false }));
  const slices = Array.from({ length: 40 }, (_, i) => ({ id: `s${i}`, name: `Set ${i} notes`, seeds: [], rule: { folders: [`Notes/f${i}`], pageTypesAndTags: { types: [], tags: [] }, linksFromSeeds: null }, pinned: false }));
  const items = slices.map(s => ({ id: `item-${s.id}`, kind: 'context-slice' as const, name: s.name, scopeId: 'global', foundAt: [], library: null, sliceId: s.id }));
  const result = { ...emptyResult(), world: { ...emptyResult().world, items, wikiPages: pages, slices } };
  const state = realToHarnessState(result, []);
  assert.equal(state.parts.length, 30); assert.ok(state.real!.notes.some(n => /10/.test(n)), state.real!.notes.join(' | '));
});

function emptyResult(): RealResult {
  return {
    world: { interfaces: [], items: [], scopes: [{ id: 'global', kind: 'global', name: 'Your home folder', parentId: null, path: '~' }], overrides: [], wikiPages: [], slices: [], versions: [], libraries: [] },
    others: [], counts: { agents: 0, skills: 0, tools: 0, hooks: 0, notes: 0 }, ages: {}, stoppedEarly: false, couldNotRead: 0, partlyRead: 0, textsCut: 0, notes: [], readOnly: true,
  };
}

// ---- Interfaces, projects, the real field

/** The notes the reader writes for facts the Read screen counts itself. */
const COUNTED_NOTE = [/^Could not read \d+ things?\.$/, /^\d+ long texts? (?:was|were) shortened\.$/, /^It stopped early to stay within its (?:size|time) limit\.$/];

test('interfaces follow what was found; Bowerloom is not one of them', async t => {
  const { state } = await fixtureState(t);
  assert.deepEqual(state.interfaces.map(i => i.id), ['claude-code', 'codex', 'opencode']);
  for (const i of state.interfaces) { assert.equal(i.health, 'ready', i.id); assert.equal(i.healthWords, 'Ready'); assert.equal(i.on, true); assert.ok(i.writes.length > 0); }
  assert.equal(state.interfaces.find(i => i.id === 'claude-code')!.foundAt, 'Found at ~/.claude');
  assert.equal(state.interfaces.find(i => i.id === 'codex')!.foundAt, 'Found at ~/.codex', 'only the folders that are there are named');
  assert.equal(state.interfaces.find(i => i.id === 'opencode')!.foundAt, 'Found at ~/.config/opencode');
});

test('a program that was not found says so and is off', async t => {
  const home = tempDir(t, 'bowerloom-v3-map-');
  put(join(home, '.claude', 'agents', 'mine.md'), skillFile('mine', 'My own agent.'));
  const read = await readHome(home), state = realToHarnessState(read.result, read.places);
  const byId = Object.fromEntries(state.interfaces.map(i => [i.id, i]));
  assert.equal(byId['claude-code']!.health, 'ready');
  for (const id of ['codex', 'opencode'] as const) {
    assert.equal(byId[id]!.health, 'not-found', id); assert.equal(byId[id]!.healthWords, 'Not found'); assert.equal(byId[id]!.on, false); assert.equal(byId[id]!.foundAt, 'Not found on this computer');
  }
});

test('projects come from the places of the work folders and picked folders, not from the home folder', async t => {
  const { read, state } = await fixtureState(t);
  const expected = read.places.filter(p => p.kind === 'project' || p.kind === 'picked');
  assert.ok(expected.length >= 2);
  assert.deepEqual(state.projects.map(p => p.id), expected.map(p => p.id));
  assert.deepEqual(state.projects.map(p => p.name), expected.map(p => p.label));
  assert.deepEqual(state.projects.map(p => p.path), expected.map(p => p.details.path));
});

test('the real field carries what the reader counted and said', async t => {
  const { read, state } = await fixtureState(t);
  assert.equal(state.real!.couldNotRead, read.result.couldNotRead); assert.ok(state.real!.couldNotRead > 0, 'the fixture has files that cannot be read');
  assert.equal(state.real!.stoppedEarly, read.result.stoppedEarly); assert.equal(state.real!.textsCut, read.result.textsCut);
  const partly = 'This folder is big, so only part of it was looked at.';
  for (const note of read.result.notes.filter(n => n !== partly && !COUNTED_NOTE.some(r => r.test(n)))) assert.ok(state.real!.notes.includes(note), note);
  assert.equal(state.real!.onlyPartRead === true, read.result.notes.includes(partly), 'the big-folder sentence became a flag, not a repeated note');
  assert.ok(!state.real!.notes.includes(partly));
});

test('nothing found gives an empty state that the screens can draw', () => {
  const state = realToHarnessState(emptyResult(), []);
  assert.deepEqual(state.parts, []); assert.deepEqual(state.sources, []); assert.deepEqual(state.projects, []); assert.deepEqual(state.chosenSourceIds, []);
  assert.equal(state.interfaces.length, 3); assert.ok(state.interfaces.every(i => i.health === 'not-found'));
  assert.deepEqual(state.real, { couldNotRead: 0, stoppedEarly: false, notes: [], textsCut: 0 });
});

test('things found only in a Bowerloom folder are left out of the harness state, and the notes say how many', async t => {
  const home = tempDir(t, 'bowerloom-v3-map-');
  put(join(home, 'work', 'proj', '.bowerloom', 'skills', 'inner', 'SKILL.md'), skillFile('Inner', 'Only Bowerloom has this.'));
  put(join(home, 'work', 'proj', '.claude', 'skills', 'outer', 'SKILL.md'), skillFile('Outer', 'Claude Code has this.'));
  const read = await readHome(home, [join(home, 'work')]);
  assert.ok(read.result.world.items.some(i => i.name === 'Inner'), 'the reader found it');
  const state = realToHarnessState(read.result, read.places);
  assert.equal(state.parts.some(p => p.name === 'Inner'), false); assert.ok(state.parts.some(p => p.name === 'Outer'));
  assert.ok(state.real!.notes.some(n => /1 /.test(n) && /Bowerloom/.test(n)), state.real!.notes.join(' | '));
  assert.equal(state.interfaces.some(i => (i.id as string) === 'bowerloom'), false);
});

test('what only a Hermes folder holds is left out of the harness state, and the notes say how many', async t => {
  const { read, state } = await fixtureState(t);
  const known = INTERFACE_IDS as readonly string[], only = read.result.world.items.filter(i => !i.foundAt.some(f => known.includes(f.interface)) && i.foundAt.some(f => (f.interface as string) === 'hermes'));
  assert.ok(only.length > 0, 'the fixture holds a Hermes folder');
  for (const item of only) assert.equal(state.parts.some(p => p.id === item.id), false, item.name);
  assert.equal(state.interfaces.some(i => (i.id as string) === 'hermes'), false, 'Hermes is not an engine of the preview');
  assert.ok(state.real!.notes.some(n => /^3 things in a Hermes folder are not shown\.$/.test(n)), state.real!.notes.join(' | '));
});

test('M3. a copy in a Hermes folder of a part that is shown is counted and named; a Hermes folder with nothing to show gets a note', async t => {
  const home = tempDir(t, 'bowerloom-v3-map-');
  put(join(home, '.claude', 'skills', 'shared', 'SKILL.md'), skillFile('Shared', 'Both programs have this.'));
  put(join(home, '.hermes', 'skills', 'general', 'shared', 'SKILL.md'), skillFile('Shared', 'Both programs have this.'));
  put(join(home, '.hermes', 'skills', 'general', 'only-here', 'SKILL.md'), skillFile('Only here', 'Only Hermes has this.'));
  const state = realToHarnessState((await readHome(home)).result, (await readHome(home)).places);
  assert.ok(state.parts.some(p => p.name === 'Shared')); assert.equal(state.parts.some(p => p.name === 'Only here'), false);
  const notes = state.real!.notes.join(' | ');
  assert.match(notes, /1 thing in a Hermes folder is not shown\./, notes);
  assert.match(notes, /1 cop(?:y|ies) in a Hermes folder (?:is|are) not shown\./, notes);
  assert.equal(state.parts.find(p => p.name === 'Shared')!.fileText.length > 0, true);

  const empty = tempDir(t, 'bowerloom-v3-map-');
  put(join(empty, '.claude', 'agents', 'mine.md'), skillFile('mine', 'My own agent.'));
  put(join(empty, '.hermes', 'sessions', 's1.json'), '{}');
  const quiet = realToHarnessState((await readHome(empty)).result, (await readHome(empty)).places);
  assert.ok(quiet.real!.notes.some(n => /Hermes folder/.test(n) && /nothing/.test(n)), quiet.real!.notes.join(' | '));
  const none = tempDir(t, 'bowerloom-v3-map-');
  put(join(none, '.claude', 'agents', 'mine.md'), skillFile('mine', 'My own agent.'));
  assert.equal(realToHarnessState((await readHome(none)).result, (await readHome(none)).places).real!.notes.some(n => /Hermes/.test(n)), false, 'no Hermes folder, no note');
});

// ---- Secrets and plain text

test('no secret and no real folder name is anywhere in the state', async t => {
  const { f, state } = await fixtureState(t);
  const json = JSON.stringify(state);
  assert.equal(json.includes(FAKE_SECRET), false, 'a key value from a config file is in the state');
  assert.equal(json.includes(FAKE_TOKEN_IN_TEXT), false, 'a token in the text of a skill is in the state');
  assert.equal(json.includes(f.root), false, 'a full path is in the state');
  const hostile = partNamed(state, 'skill', 'Tidy notes');
  assert.match(hostile.fileText, /\[hidden key\]/, 'the hidden mark is kept');
});

test('text from a file stays text: markup is kept as characters, and control marks are gone from names and summaries', async t => {
  const { state } = await fixtureState(t);
  const hostile = partNamed(state, 'skill', 'Tidy notes');
  assert.match(hostile.description, /<img src=x/); assert.match(hostile.fileText, /<script>/);
  for (const p of state.parts) for (const text of [p.name, p.summary, p.description, p.path, p.source]) assert.doesNotMatch(text, /[\p{Cc}\p{Cf}]/u, `${p.id}: ${JSON.stringify(text)}`);
});

test('firstLines keeps the first n lines, and partOfItem caps the file text at 60 lines and scrubs it again', () => {
  assert.equal(firstLines('a\nb\nc', 2), 'a\nb'); assert.equal(firstLines('a\nb', 5), 'a\nb'); assert.equal(firstLines('', 3), ''); assert.equal(firstLines('a\r\nb\r\nc', 2), 'a\nb');
  assert.equal(firstLines(Array.from({ length: 200 }, (_, i) => `line ${i}`).join('\n'), 60).split('\n').length, 60);
  const text = `${FAKE_TOKEN_IN_TEXT}\n${Array.from({ length: 200 }, (_, i) => `line ${i}`).join('\n')}`;
  const item: HarnessItem = { id: 'real-skill-x', kind: 'skill', name: 'Long', scopeId: 'global', library: null, description: 'A long one. It has a second sentence.', foundAt: [{ interface: 'claude-code', path: '~/.claude/skills/long/SKILL.md', contentHash: 'h', text }] };
  const part = partOfItem(item, 'src-x', 'Your Claude Code folder');
  assert.equal(part.fileText.split('\n').length, 61, '60 lines and the plain last line'); assert.equal(part.fileText.split('\n').at(-1), 'Only the first 60 lines are shown.'); assert.equal(part.fileText.includes(FAKE_TOKEN_IN_TEXT), false);
  assert.equal(part.summary, 'A long one.'); assert.equal(part.origin, 'src-x'); assert.equal(part.id, 'real-skill-x');
});

test('a very long description is cut to one line for the node and one sentence-sized line for the details', () => {
  const long = `${'word '.repeat(80)}end.`;
  const item: HarnessItem = { id: 'real-skill-y', kind: 'skill', name: 'Wordy', scopeId: 'global', library: null, description: long, foundAt: [{ interface: 'codex', path: '~/.codex/skills/wordy/SKILL.md', contentHash: 'h', text: 'x' }] };
  const part = partOfItem(item, 'src-y', 'Your Codex folder');
  assert.ok(part.summary.length <= 41, part.summary); assert.ok(part.description.length <= 201, String(part.description.length));
});

// ---- The store

test('loadWorld replaces the whole state, clears the history, cancels the run timers and tells the subscribers', async t => {
  const { state } = await fixtureState(t);
  const cancelled: number[] = [];
  let n = 0;
  const schedule: Schedule = () => { const id = n++; return () => { cancelled.push(id); }; };
  const store = createHarnessStore({ initial: createSampleWorld(), now: () => STAMP, schedule });
  const sample = store.getState();
  store.startRuns({ harnessId: sample.harnesses[0]!.id, projectId: sample.projects[0]!.id, interfaceIds: ['claude-code'], instruction: 'Go.' });
  assert.ok(store.getState().history.length > 0 && store.getState().runs.length > 0);
  let heard = 0; store.subscribe(() => { heard += 1; });
  const loaded = { ...state, nextId: 500 };
  store.loadWorld(loaded);
  assert.equal(store.getState(), loaded, 'a state whose counter is high enough is kept as it is'); assert.equal(heard, 1); assert.deepEqual(cancelled, [0]);
  assert.deepEqual(store.getState().history, []); assert.deepEqual(store.getState().runs, []);
  store.loadWorld(createSampleWorld());
  assert.equal(heard, 2); assert.equal(store.getState().harnesses.length, 4, 'the sample can be loaded again');
  const made = store.createHarnessFromSource(state.sources[0]!.id);
  assert.equal(made, null, 'the old sources are gone after a load');
});

test('loadWorld keeps the counter of new ids climbing: a lower counter never brings an old id back', () => {
  const store = createHarnessStore({ initial: { ...createSampleWorld(), nextId: 250 }, now: () => STAMP });
  const first = store.createHarness();
  assert.equal(first, 'harness-250');
  const afterFirst = store.getState().nextId;
  const lower = realToHarnessState(emptyResult(), []);
  assert.equal(lower.nextId, 100);
  store.loadWorld(lower);
  assert.ok(store.getState().nextId >= afterFirst, `the counter went back to ${store.getState().nextId}`);
  assert.deepEqual(store.getState().parts, lower.parts, 'everything else is the new state');
  const second = store.createHarness();
  assert.notEqual(second, first, 'an id that an old undo note may still name is not used again');
  const higher = { ...lower, nextId: 900 };
  store.loadWorld(higher);
  assert.equal(store.getState(), higher, 'a higher counter is kept as it is');
});

test('routeGone says when an address names something the loaded state does not hold', () => {
  const state = createSampleWorld();
  const some = { harness: state.harnesses[0]!.id, part: state.parts[0]!.id, project: state.projects[0]!.id, run: state.runs.find(r => r.groupId !== null)!, iface: state.interfaces[0]!.id };
  for (const route of [{ name: 'welcome' }, { name: 'choose' }, { name: 'read' }, { name: 'harnesses' }, { name: 'history' }, { name: 'help' }, { name: 'runs' }, { name: 'projects' }, { name: 'interfaces' }] as const) assert.equal(routeGone(state, route), false, route.name);
  assert.equal(routeGone(state, { name: 'harnesses', id: some.harness }), false); assert.equal(routeGone(state, { name: 'harnesses', id: 'harness-999' }), true);
  // The Builder names a folder, which the world of parts does not hold: the Builder itself sends an unknown folder to the folder list.
  assert.equal(routeGone(state, { name: 'builder', id: some.harness }), false); assert.equal(routeGone(state, { name: 'builder', id: 'folder-999' }), false);
  assert.equal(routeGone(state, { name: 'file', partId: some.part }), false); assert.equal(routeGone(state, { name: 'file', partId: 'part-999' }), true);
  assert.equal(routeGone(state, { name: 'library', kind: 'skill' }), false); assert.equal(routeGone(state, { name: 'library', kind: 'skill', partId: some.part }), false); assert.equal(routeGone(state, { name: 'library', kind: 'skill', partId: 'part-999' }), true);
  assert.equal(routeGone(state, { name: 'projects', id: some.project }), false); assert.equal(routeGone(state, { name: 'projects', id: 'project-999' }), true);
  assert.equal(routeGone(state, { name: 'runs', id: some.run.id }), false); assert.equal(routeGone(state, { name: 'runs', id: 'run-999' }), true);
  assert.equal(routeGone(state, { name: 'compare', group: some.run.groupId! }), false); assert.equal(routeGone(state, { name: 'compare', group: 'group-999' }), true);
  assert.equal(routeGone(state, { name: 'interfaces', id: some.iface }), false); assert.equal(routeGone(state, { name: 'interfaces', id: 'nope' }), true);
  const real = realToHarnessState(emptyResult(), []);
  assert.equal(routeGone(real, { name: 'harnesses', id: some.harness }), true, 'a harness of the old state is gone after a real read');
  assert.equal(routeGone(real, { name: 'builder', id: 'folder-1' }), false, 'a folder is not part of the read, so a real read keeps the Builder open');
  assert.equal(routeGone(real, { name: 'harnesses' }), false);
});

test('a world loaded into a store that finishes runs by itself gets its running runs finished too', () => {
  const finished: (() => void)[] = [];
  const schedule: Schedule = run => { finished.push(run); return () => undefined; };
  const store = createHarnessStore({ initial: { ...createSampleWorld(), runs: [] }, now: () => STAMP, schedule, finishRunning: true });
  assert.equal(finished.length, 0);
  store.loadWorld(createSampleWorld());
  assert.equal(finished.length, 1, 'the sample has one run that is running');
  finished[0]!();
  assert.equal(store.getState().runs.find(r => r.id === 'run-1')!.status, 'done');
});

// ---- The words this file makes

test('the fixed words of the mapping obey the preview\'s rules: no banned word, short lines', async t => {
  const empty = (kind: 'skill' | 'agent'): HarnessItem => (kind === 'skill'
    ? { id: 'real-skill-e', kind, name: 'Empty', scopeId: 'global', library: null, description: '', foundAt: [{ interface: 'claude-code', path: '~/.claude/skills/e/SKILL.md', contentHash: 'h', text: '' }] }
    : { id: 'real-agent-e', kind, name: 'Empty', scopeId: 'global', library: null, extras: [], definition: { name: 'Empty', role: '', instructions: '', skillIds: [], toolAttachments: [] }, foundAt: [{ interface: 'codex', path: '~/.codex/agents/e.toml', contentHash: 'h', text: '' }] });
  const tool = (toolKind: 'mcp' | 'prompt' | 'hook'): HarnessItem => ({ id: `real-tool-${toolKind}`, kind: 'tool', name: toolKind, scopeId: 'global', library: null, toolKind, ...(toolKind === 'hook' ? { runsCode: true } : {}), ...(toolKind === 'mcp' ? { secret: null } : {}), foundAt: [{ interface: 'opencode', path: '~/.config/opencode/x', contentHash: 'h', text: '' }] } as HarnessItem);
  const parts = [empty('skill'), empty('agent'), tool('mcp'), tool('prompt'), tool('hook')].map(item => partOfItem(item, 'src-e', 'Your OpenCode folder'));
  const { state } = await fixtureState(t);
  const texts = [
    ...parts.flatMap(p => [p.summary, p.description, p.source]), ...state.sources.flatMap(s => [s.name, s.harnessName, s.interfaceName]), ...state.parts.map(p => p.source),
    ...state.real!.notes.filter(n => /not shown/.test(n)), ...state.interfaces.flatMap(i => [i.foundAt, i.healthWords]),
    ...realToHarnessState(emptyResult(), []).interfaces.map(i => i.foundAt),
  ];
  for (const text of texts) { assert.equal(bannedHere(text), null, text); assert.ok(countWords(text) <= LIMITS.paragraph, text); }
  for (const p of parts) { assert.ok(countWords(p.summary) <= LIMITS.hint, p.summary); assert.equal(p.fileText, ''); }
  assert.equal(parts[3]!.description, 'A saved prompt, found in an OpenCode folder.'); assert.equal(parts[1]!.description, 'An agent found in a Codex folder.');
});

// ---- Notes the Read screen counts itself

test('the three facts the Read screen counts itself (things it could not read, texts cut, stopped early) are not also notes, and every other note stays', () => {
  const kept = ['2 files are not text and were skipped.', 'Keep me.'];
  for (const [n, limit] of [[1, 'size'], [3, 'time']] as const) {
    const cutLine = n === 1 ? '1 long text was shortened.' : '3 long texts were shortened.', readLine = n === 1 ? 'Could not read 1 thing.' : 'Could not read 3 things.';
    const result = { ...emptyResult(), couldNotRead: n, textsCut: n, stoppedEarly: true, notes: [readLine, kept[0]!, cutLine, `It stopped early to stay within its ${limit} limit.`, kept[1]!] };
    assert.deepEqual(realToHarnessState(result, []).real!.notes, kept, `${n}`);
  }
  const quiet = realToHarnessState({ ...emptyResult(), notes: kept }, []);
  assert.deepEqual(quiet.real!.notes, kept);
});

test('on a real read each counted fact is in the counts and in no note', async t => {
  const { read, state } = await fixtureState(t);
  assert.ok(read.result.notes.some(n => /^Could not read \d+ things?\.$/.test(n)), 'the reader wrote the line the screen would have repeated');
  for (const note of state.real!.notes) for (const r of COUNTED_NOTE) assert.doesNotMatch(note, r, note);
  assert.ok(state.real!.couldNotRead > 0);
});

// ---- Versions of a plug-in

test('pluginOf takes a version only from a dotted number: a git hash, a date or a word is not one', () => {
  const at = (v: string): ReturnType<typeof pluginOf> => pluginOf(`~/.claude/plugins/cache/src/caveman/${v}/agents/a.md`);
  for (const v of ['1.2.0', 'v2.0.1', '1.2.0-beta.1', '10.20', '3.1.4+build.7']) assert.equal(at(v)!.version, v, v);
  for (const v of ['3f2a1b9c', 'abc1234', 'latest', '12345678', '1', '2026-10-01', 'unknown']) assert.equal(at(v)!.version, undefined, v);
  assert.equal(at('3f2a1b9c')!.name, 'caveman');
  assert.equal(pluginOf('~/.claude/agents/mine.md'), null);
});

test('versions are compared as numbers: 1.10.0 is newer than 1.9.0, and a release is newer than its own beta', () => {
  assert.ok(compareVersions('1.10.0', '1.9.0') > 0); assert.ok(compareVersions('1.9.0', '1.10.0') < 0); assert.equal(compareVersions('2.0', '2.0.0'), 0);
  assert.ok(compareVersions('v2.0.0', '1.99.9') > 0); assert.ok(compareVersions('1.2.0', '1.2.0-beta.1') > 0); assert.ok(compareVersions('1.2.0-beta.2', '1.2.0-beta.10') < 0);
  assert.deepEqual(['1.10.0', '1.2.0', '1.9.0', 'v1.9.1'].sort(compareVersions), ['1.2.0', '1.9.0', 'v1.9.1', '1.10.0']);
});

test('a part found in several versions of one plug-in shows the newest one, however the files were listed', () => {
  const file = (v: string): { interface: 'claude-code'; path: string; contentHash: string; text: string } => ({ interface: 'claude-code', path: `~/.claude/plugins/cache/src/caveman/${v}/agents/brief.md`, contentHash: v, text: `version ${v}` });
  const agent = (...versions: string[]): HarnessItem => ({ id: 'real-agent-v', kind: 'agent', name: 'brief', scopeId: 'global', library: null, extras: [], definition: { name: 'brief', role: 'Keeps it short.', instructions: '', skillIds: [], toolAttachments: [] }, foundAt: versions.map(file) });
  for (const order of [['1.9.0', '1.10.0'], ['1.10.0', '1.9.0'], ['1.2.0', '1.10.0', '1.9.0']]) {
    const part = partOfItem(agent(...order), 'src-v', 'Caveman plug-in');
    assert.equal(part.version, '1.10.0', order.join(' ')); assert.match(part.path, /\/1\.10\.0\/agents\/brief\.md$/); assert.equal(part.fileText, 'version 1.10.0');
  }
  const hashOnly = partOfItem(agent('3f2a1b9c'), 'src-v', 'Caveman plug-in');
  assert.equal(hashOnly.version, undefined);
});

test('several versions of one plug-in stay one source, each part with its own version, and a git hash folder has none', async t => {
  const home = tempDir(t, 'bowerloom-v3-map-');
  const cache = (v: string, name: string): string => join(home, '.claude', 'plugins', 'cache', 'src', 'caveman', v, 'agents', `${name}.md`);
  put(cache('1.9.0', 'old-one'), skillFile('old-one', 'From the older one.'));
  put(cache('1.10.0', 'new-one'), skillFile('new-one', 'From the newer one.'));
  put(cache('3f2a1b9c', 'hash-one'), skillFile('hash-one', 'From a folder named by a git hash.'));
  const read = await readHome(home), state = realToHarnessState(read.result, read.places);
  assert.deepEqual(state.sources.map(s => s.name), ['Caveman (plug-in)']);
  assert.equal(partNamed(state, 'agent', 'old-one').version, '1.9.0'); assert.equal(partNamed(state, 'agent', 'new-one').version, '1.10.0'); assert.equal(partNamed(state, 'agent', 'hash-one').version, undefined);
});

// ---- Two folders with one name

test('notes are counted for each folder: two folders with the same name do not count each other\'s pages', async t => {
  const home = tempDir(t, 'bowerloom-v3-map-');
  const page = (dir: string, n: number): void => put(join(dir, `page-${n}.md`), `# Page ${n} of ${dir.slice(-8)}\n\nText.\n`);
  const a = join(home, 'a', 'notes'), b = join(home, 'b', 'notes');
  for (let n = 1; n <= 3; n += 1) page(a, n);
  for (let n = 1; n <= 5; n += 1) page(b, n);
  const read = await readHome(home, [a, b]), state = realToHarnessState(read.result, read.places);
  const sets = state.parts.filter(p => p.kind === 'context' && p.name === 'notes notes');
  assert.equal(sets.length, 2, state.parts.map(p => p.name).join(' | '));
  assert.deepEqual(sets.map(p => p.description).sort(), ['A set of 3 pages of notes.', 'A set of 5 pages of notes.']);
  for (const set of sets) assert.equal(set.fileText.split('\n').length, /3 pages/.test(set.description) ? 3 : 5);
});

// ---- Ids of sources

test('a source id is the whole hash of its key, and a second source with the same id gets a number after it', () => {
  const used = new Set<string>();
  const first = sourceIdFor('global|claude-code|', used);
  assert.match(first, /^src-real-[0-9a-f]{16}$/); assert.equal(sourceIdFor('global|claude-code|', new Set()), first, 'the same key gives the same id on every read');
  used.add(first);
  assert.equal(sourceIdFor('global|claude-code|', used), `${first}-2`);
  used.add(`${first}-2`);
  assert.equal(sourceIdFor('global|claude-code|', used), `${first}-3`);
  const state = realToHarnessState(emptyResult(), []);
  assert.deepEqual(state.sources, []);
});

test('every source of a real read has a full-width id and no two ids are alike', async t => {
  const { state } = await fixtureState(t);
  assert.ok(state.sources.length >= 4);
  for (const s of state.sources) assert.match(s.id, /^src-real-[0-9a-f]{16}$/, s.name);
  assert.equal(new Set(state.sources.map(s => s.id)).size, state.sources.length);
});

// ---- Hostile names

const HOSTILE_NAMES = ['__proto__', 'constructor', 'toString', 'hasOwnProperty', '<img src=x onerror=alert(1)>', '../../etc/passwd', 'a/b/../c', `${'long '.repeat(100)}end`, 'x'.repeat(500), '<script>alert(1)</script>', 'name\u202Ewith mark', '__proto__'];

test('hostile names (__proto__, constructor, markup, slashes, dots, 500 characters) break nothing: ids stay unique, names are cut and plain, no object key is touched', () => {
  const items: HarnessItem[] = [];
  HOSTILE_NAMES.forEach((name, i) => {
    const where = (iface: 'claude-code' | 'codex'): { interface: 'claude-code' | 'codex'; path: string; contentHash: string; text: string } => ({ interface: iface, path: `~/.${iface === 'codex' ? 'codex' : 'claude'}/skills/${name}/SKILL.md`, contentHash: 'h', text: `---\nname: ${name}\n---\n${name}` });
    items.push({ id: `real-skill-${i}`, kind: 'skill', name, scopeId: i % 2 === 0 ? 'global' : name, library: null, description: `${name}. Second sentence.`, foundAt: [where('claude-code')] });
    items.push({ id: `real-agent-${i}`, kind: 'agent', name, scopeId: 'global', library: null, extras: [], definition: { name, role: name, instructions: name, skillIds: [`real-skill-${i}`, name, '__proto__'], toolAttachments: [] }, foundAt: [where('codex')] });
    items.push({ id: `real-tool-${i}`, kind: 'tool', name, scopeId: 'global', library: null, toolKind: 'prompt', foundAt: [where('claude-code')] });
  });
  const scopes = [{ id: 'global', kind: 'global' as const, name: 'Your home folder', parentId: null, path: '~' }, ...HOSTILE_NAMES.filter((_, i) => i % 2 === 1).map(name => ({ id: name, kind: 'project' as const, name, parentId: 'global', path: `~/${name}` }))];
  const result: RealResult = { ...emptyResult(), world: { ...emptyResult().world, items, scopes }, counts: { agents: 12, skills: 12, tools: 12, hooks: 0, notes: 0 } };
  const places: RealPlace[] = HOSTILE_NAMES.map((name, i) => ({ id: `place-${i}`, label: name, kind: i % 2 === 0 ? 'project' as const : 'picked' as const, apps: [], appLabel: '', counts: { agents: 0, skills: 0, tools: 0, hooks: 0, notes: 0 }, empty: true, details: { path: `~/${name}`, folders: [], topics: [], notes: [] } }));
  const state = realToHarnessState(result, places);
  assert.equal(state.parts.length, items.length);
  assert.equal(new Set(state.parts.map(p => p.id)).size, state.parts.length, 'part ids are unique');
  assert.equal(new Set(state.sources.map(s => s.id)).size, state.sources.length, 'source ids are unique');
  assert.equal(new Set(state.projects.map(p => p.id)).size, state.projects.length);
  for (const p of state.parts) {
    assert.ok(p.name.length <= 81, `${p.id}: ${p.name.length}`); assert.ok(p.summary.length <= 41, p.summary); assert.ok(p.description.length <= 201, String(p.description.length));
    for (const text of [p.name, p.summary, p.description, p.path, p.source]) assert.doesNotMatch(text, /[\p{Cc}\p{Cf}]/u, `${p.id}: ${JSON.stringify(text)}`);
    assert.ok(state.sources.some(s => s.partIds.includes(p.id)), `${p.id} is in a source`);
  }
  for (const s of state.sources) { assert.ok(s.name.length <= 200); for (const l of s.links ?? []) assert.ok(state.parts.some(p => p.id === l.from) && state.parts.some(p => p.id === l.to)); }
  assert.equal(state.parts.find(p => p.name === '<script>alert(1)</script>')?.name, '<script>alert(1)</script>', 'markup is kept as characters');
  assert.equal(({} as Record<string, unknown>)['polluted'], undefined); assert.equal(Object.getPrototypeOf(Object.fromEntries([['__proto__', 1]])), Object.prototype);
  assert.equal(JSON.parse(JSON.stringify(state)).parts.length, state.parts.length);
  const made = createHarnessFromSource(state, state.sources[0]!.id, STAMP);
  assert.notEqual(made.harnessId, null);
});

test('hostile names on disk go through the reader and the mapping the same way', async t => {
  const home = tempDir(t, 'bowerloom-v3-map-');
  for (const name of ['__proto__', 'constructor', 'toString', 'hasOwnProperty', '__defineGetter__']) {
    put(join(home, '.claude', 'skills', name, 'SKILL.md'), skillFile(name, `The skill called ${name}.`));
    put(join(home, '.claude', 'agents', `${name}.md`), skillFile(name, `The agent called ${name}.`));
  }
  put(join(home, '.claude', 'skills', 'long', 'SKILL.md'), skillFile('x'.repeat(500), 'A name of 500 characters.'));
  put(join(home, '.claude', 'skills', 'markup', 'SKILL.md'), skillFile('<b onmouseover=alert(1)>bold</b>', 'Markup in a name.'));
  put(join(home, '.claude', 'skills', 'slashes', 'SKILL.md'), skillFile('../../etc/passwd', 'Dots and slashes in a name.'));
  const read = await readHome(home), state = realToHarnessState(read.result, read.places);
  assert.equal(new Set(state.parts.map(p => p.id)).size, state.parts.length);
  assert.ok(state.parts.length >= 13, String(state.parts.length));
  for (const name of ['__proto__', 'constructor', 'toString']) { assert.ok(state.parts.some(p => p.kind === 'skill' && p.name === name), name); assert.ok(state.parts.some(p => p.kind === 'agent' && p.name === name), name); }
  assert.ok(state.parts.every(p => p.name.length <= 81));
  assert.equal(state.parts.find(p => p.name.startsWith('<b onmouseover'))?.name, '<b onmouseover=alert(1)>bold</b>');
  assert.equal(({} as Record<string, unknown>)['polluted'], undefined);
});

// ---- Silent-failure fixes

const skillItem = (over: Partial<HarnessItem> & { foundAt: HarnessItem['foundAt'] }): HarnessItem => ({ id: 'real-skill-z', kind: 'skill', name: 'Zed', scopeId: 'global', library: null, description: 'A skill.', ...over } as HarnessItem);
const found = (face: string, text = 'x'): HarnessItem['foundAt'][number] => ({ interface: face as never, path: `~/.${face}/skills/z/SKILL.md`, contentHash: 'h', text });

test('a text cut to 60 lines ends with a plain line that says so; a text of 60 lines or fewer has none', () => {
  const lines = (n: number): string => Array.from({ length: n }, (_, i) => `line ${i}`).join('\n');
  assert.equal(FILE_CUT_LINE, `Only the first ${FILE_LINES} lines are shown.`);
  assert.equal(partOfItem(skillItem({ foundAt: [found('claude-code', lines(61))] }), 's', 'Your Claude Code folder').fileText.split('\n').at(-1), FILE_CUT_LINE);
  const exact = partOfItem(skillItem({ foundAt: [found('claude-code', lines(60))] }), 's', 'Your Claude Code folder').fileText;
  assert.equal(exact.split('\n').length, 60); assert.doesNotMatch(exact, /Only the first/);
});

test('a text cut to 60 lines for the preview is not counted in textsCut: only a cut the reader made is', async t => {
  const home = tempDir(t, 'bowerloom-v3-lines-');
  const body = (n: number): string => Array.from({ length: n }, (_, i) => `line ${i}`).join('\n');
  put(join(home, '.claude', 'skills', 'long', 'SKILL.md'), `---\nname: Long\ndescription: Long one.\n---\n${body(100)}\n`);
  put(join(home, '.claude', 'skills', 'short', 'SKILL.md'), skillFile('Short', 'Short one.'));
  put(join(home, '.claude', 'skills', 'huge', 'SKILL.md'), `---\nname: Huge\ndescription: Huge one.\n---\n${body(6000)}\n`);
  const read = await readHome(home);
  assert.equal(read.result.textsCut, 1, 'the reader cut the huge text at 20000 characters');
  const state = realToHarnessState(read.result, read.places);
  assert.equal(state.real!.textsCut, 1, 'the 60-line preview cut is a display choice, not a problem');
  assert.match(partNamed(state, 'skill', 'Long').fileText, /Only the first 60 lines are shown\.$/, 'the file page still says it');
  assert.doesNotMatch(partNamed(state, 'skill', 'Short').fileText, /Only the first/);
  const quiet = realToHarnessState({ ...emptyResult(), textsCut: 0 }, []);
  assert.equal(quiet.real!.textsCut, 0);
});

test('the per-place notes of the folders that were read reach the Read screen, once, with the place name', () => {
  const big = 'This folder is big, so only part of it was looked at.';
  const place = (id: string, label: string, notes: string[]): RealPlace => ({ id, label, kind: 'project', apps: [], appLabel: 'Notes', counts: { agents: 0, skills: 0, tools: 0, hooks: 0, notes: 1 }, empty: false, details: { path: `~/${label}`, folders: [], topics: [], notes } });
  const places = [place('a', 'Alpha', ['2 files over 2 MB were skipped.', big, 'It stopped early to stay within its time limit.']), place('b', 'Beta', []), place('c', 'Gamma', ['1 thing could not be opened.'])];
  const state = realToHarnessState({ ...emptyResult(), couldNotRead: 3, notes: ['Could not read 3 things.', big, 'It stopped early to stay within its time limit.', 'Keep me.'] }, places);
  assert.deepEqual(state.real!.places, [
    { name: 'Alpha', notes: ['2 files over 2 MB were skipped.', big] },
    { name: 'Gamma', notes: ['1 thing could not be opened.'] },
  ], 'places with no note are left out, and a stopped-early line is the summary\'s, not a place\'s');
  assert.equal(state.real!.onlyPartRead, true);
  assert.deepEqual(state.real!.notes, ['Keep me.'], 'the "big folder" sentence is said by the summary and the place, not again as a note');
  const none = realToHarnessState(emptyResult(), places.slice(1, 2));
  assert.equal(none.real!.places, undefined); assert.equal(none.real!.onlyPartRead, undefined);
});

test('an item found only in a program the preview does not know is counted and worded apart from a Bowerloom folder', () => {
  const odd = skillItem({ id: 'real-skill-odd', foundAt: [found('zed')] }), mine = skillItem({ id: 'real-skill-mine', foundAt: [found('bowerloom')] });
  const base = emptyResult(), only = (items: HarnessItem[]): readonly string[] => realToHarnessState({ ...base, world: { ...base.world, items } }, []).real!.notes;
  const unknown = only([odd, odd, mine].map((x, i) => ({ ...x, id: `${x.id}-${i}` }) as HarnessItem));
  assert.ok(unknown.some(n => /^2 things in a program Bowerloom does not know are not shown\.$/.test(n)), unknown.join(' | '));
  assert.ok(unknown.some(n => /^1 thing in a Bowerloom folder is not shown\.$/.test(n)), unknown.join(' | '));
  assert.deepEqual(only([odd]), ['1 thing in a program Bowerloom does not know is not shown.']);
  assert.deepEqual(only([mine]), ['1 thing in a Bowerloom folder is not shown.']);
});

test('an item found in two programs says the other one on its description', () => {
  const both = partOfItem(skillItem({ foundAt: [found('claude-code'), found('codex'), found('opencode')] }), 's', 'Your Claude Code folder');
  assert.match(both.description, / Also found in Codex and OpenCode\.$/); assert.equal(bannedHere(both.description), null);
  const one = partOfItem(skillItem({ foundAt: [found('claude-code')] }), 's', 'Your Claude Code folder');
  assert.doesNotMatch(one.description, /Also found/);
  const twice = partOfItem(skillItem({ foundAt: [found('codex'), found('codex'), found('bowerloom')] }), 's', 'Your Codex folder');
  assert.doesNotMatch(twice.description, /Also found/, 'the same program twice, or Bowerloom\'s own folder, is not another program');
});

test('the notes this file writes come first, so the screen never hides them behind the reader\'s own', () => {
  const base = emptyResult(), mine = skillItem({ id: 'real-skill-mine', foundAt: [found('bowerloom')] });
  const state = realToHarnessState({ ...base, world: { ...base.world, items: [mine] }, notes: ['One.', 'Two.', 'Three.', 'Four.', 'Five.', 'Six.', 'Seven.'] }, []);
  assert.deepEqual(state.real!.notes, ['1 thing in a Bowerloom folder is not shown.', 'One.', 'Two.', 'Three.', 'Four.', 'Five.', 'Six.', 'Seven.']);
});
