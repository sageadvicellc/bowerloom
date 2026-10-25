// The logic behind the Add drawer: the tab model, the cards of each tab, and staging an add through the store's own actions.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore, isDirty, reduceStore } from '../shared/proto/store.js';
import type { StoreState } from '../shared/proto/store.js';
import { generateWorld } from '../shared/proto/sample.js';
import { countWords } from '../shared/home/textbudget.js';
import {
  ADD_TABS, agentChoices, agentHas, changeCount, clampWords, entriesFor, installAction, newAgentId, nextTab, plainName, stageAdd, stageInstall, tabOfKey,
} from '../shared/home/add-model.js';
import type { AddEntry } from '../shared/home/add-model.js';
import { addDemoWorld, DEMO } from '../renderer/home/add/add-demo-world.js';

const start = (): StoreState => { const store = createStore(addDemoWorld()); return store.getState(); };
const entry = (state: StoreState, tab: Parameters<typeof entriesFor>[1], id: string): AddEntry => {
  const found = entriesFor(state.draft, tab).find(e => e.id === id);
  assert.ok(found, `${tab} entry ${id}`);
  return found;
};

test('the tabs are Skills, Tools, Notes, Agents and the shared file, in that order', () => {
  assert.deepEqual([...ADD_TABS], ['skills', 'tools', 'notes', 'agents', 'file']);
});

test('the arrow keys move between tabs and wrap; Home and End jump; other keys do nothing', () => {
  assert.equal(nextTab('skills', 'ArrowRight'), 'tools');
  assert.equal(nextTab('file', 'ArrowRight'), 'skills');
  assert.equal(nextTab('skills', 'ArrowLeft'), 'file');
  assert.equal(nextTab('notes', 'Home'), 'skills');
  assert.equal(nextTab('notes', 'End'), 'file');
  assert.equal(nextTab('notes', 'a'), null);
  assert.equal(nextTab('notes', 'Enter'), null);
});

test('a tab key from the page address or the test is read back, and a stranger falls back to Skills', () => {
  assert.equal(tabOfKey('agents'), 'agents');
  assert.equal(tabOfKey('nonsense'), 'skills');
});

test('plainName keeps a name that already reads as words and turns a file-style name into words', () => {
  assert.equal(plainName('Summarize a meeting'), 'Summarize a meeting');
  assert.equal(plainName('velvet-weaver'), 'Velvet Weaver');
  assert.equal(plainName('Weekly review (imported)'), 'Weekly review (from file)');
  assert.equal(plainName('Weekly review (imported 2)'), 'Weekly review (from file 2)');
  assert.equal(plainName('  one two three four five six seven  ').split(' ').length, 5);
});

test('clampWords keeps a short line, ends a long one at the first sentence, and never passes 12 words', () => {
  assert.equal(clampWords('Short and plain.', 12), 'Short and plain.');
  assert.equal(clampWords('First sentence here. Second one follows after it and keeps going for a while.', 12), 'First sentence here.');
  const long = clampWords('one two three four five six seven eight nine ten eleven twelve thirteen fourteen', 12);
  assert.ok(countWords(long) <= 12, long);
});

test('the Skills tab lists every skill by name, library ones too, with a hint of at most 12 words', () => {
  const state = start();
  const skills = entriesFor(state.draft, 'skills');
  assert.ok(skills.length >= 7);
  assert.deepEqual(skills.map(e => e.name), [...skills.map(e => e.name)].sort((a, b) => a.localeCompare(b)));
  for (const e of skills) { assert.equal(e.kind, 'skill'); assert.ok(countWords(e.hint) <= 12, e.hint); assert.ok(countWords(e.name) <= 5, e.name); }
  assert.ok(skills.some(e => e.ready), 'a library skill is marked ready-made');
});

test('a skill with two different texts carries the "2 different copies" badge; the others carry none', () => {
  const skills = entriesFor(start().draft, 'skills');
  const bad = skills.find(e => e.id === DEMO.copiesSkill);
  assert.equal(bad?.badge?.label, '2 different copies');
  assert.equal(skills.filter(e => e.badge !== undefined).length, 1);
});

test('the Tools tab leaves out a hook, and says which tool needs a key', () => {
  const tools = entriesFor(start().draft, 'tools');
  assert.ok(tools.length >= 3);
  assert.ok(!tools.some(e => e.id === DEMO.hook));
  assert.equal(tools.find(e => e.id === DEMO.missingKeyTool)?.badge?.label, 'needs a key');
  for (const e of tools) assert.ok(countWords(e.hint) <= 12);
});

test('the Notes tab lists the note sets, and the Agents tab lists only ready-made agents', () => {
  const state = start();
  const notes = entriesFor(state.draft, 'notes');
  assert.deepEqual(notes.map(e => e.id).sort(), state.draft.slices.map(s => s.id).sort());
  const agents = entriesFor(state.draft, 'agents');
  assert.ok(agents.length >= 2);
  assert.ok(agents.every(e => e.kind === 'agent' && e.ready));
  assert.ok(!agents.some(e => e.id === DEMO.agents[0]), 'an agent of the person is not offered');
  for (const e of agents) assert.ok(countWords(e.hint) <= 12, e.hint);
});

test('the file tab has no cards', () => {
  assert.deepEqual(entriesFor(start().draft, 'file'), []);
});

test('agent choices list the agents of the person by name, mark who has it, and never offer a ready-made agent', () => {
  const state = start();
  const e = entry(state, 'skills', DEMO.skills[0]!);
  const before = agentChoices(state.draft, e);
  assert.equal(before.length, DEMO.agents.length);
  assert.ok(before.every(c => !c.has || c.id === DEMO.agentWithFirstSkill));
  assert.deepEqual(before.map(c => c.name), [...before.map(c => c.name)].sort((a, b) => a.localeCompare(b)));
});

test('adding a skill to an agent stages one change, and the agent now has the skill', () => {
  const state = start();
  assert.equal(isDirty(state), false);
  const e = entry(state, 'skills', DEMO.skills[3]!);
  const agent = DEMO.agents[1]!;
  assert.equal(agentHas(state.draft, agent, e), false);
  const result = stageAdd(state, agent, e);
  assert.equal(result.status, 'added');
  assert.equal(isDirty(result.state), true);
  assert.equal(changeCount(result.state), 1);
  assert.equal(agentHas(result.state.draft, agent, e), true);
  assert.equal(state.draft === result.state.draft, false, 'the old state is not changed');
  assert.equal(changeCount(state), 0);
});

test('adding the same thing twice changes nothing the second time and says so', () => {
  const state = start();
  const e = entry(state, 'skills', DEMO.skills[3]!);
  const first = stageAdd(state, DEMO.agents[1]!, e);
  const second = stageAdd(first.state, DEMO.agents[1]!, e);
  assert.equal(second.status, 'already');
  assert.equal(second.state, first.state);
});

test('a tool joins with the read-only access, a note set is assigned, and a second note set replaces the first', () => {
  const state = start();
  const tool = entry(state, 'tools', DEMO.tools[0]!);
  const withTool = stageAdd(state, DEMO.agents[2]!, tool);
  assert.equal(withTool.status, 'added');
  const agent = withTool.state.draft.items.find(i => i.id === DEMO.agents[2]);
  assert.equal(agent?.kind === 'agent' && agent.definition.toolAttachments.find(t => t.toolId === tool.id)?.access, 'read-only');
  const notes = entriesFor(state.draft, 'notes');
  const one = stageAdd(withTool.state, DEMO.agents[2]!, notes[0]!);
  assert.equal(one.status, 'added');
  assert.equal(agentHas(one.state.draft, DEMO.agents[2]!, notes[0]!), true);
  const two = stageAdd(one.state, DEMO.agents[2]!, notes[1]!);
  assert.equal(two.status, 'added');
  assert.equal(agentHas(two.state.draft, DEMO.agents[2]!, notes[0]!), false);
  assert.equal(agentHas(two.state.draft, DEMO.agents[2]!, notes[1]!), true);
});

test('an agent that is not there, or a ready-made agent as the target, is refused and the state stays the same', () => {
  const state = start();
  const e = entry(state, 'skills', DEMO.skills[3]!);
  assert.equal(stageAdd(state, 'no-such-agent', e).status, 'refused');
  assert.equal(stageAdd(state, 'no-such-agent', e).state, state);
  const ready = entriesFor(state.draft, 'agents')[0]!;
  assert.equal(stageAdd(state, ready.id, e).status, 'refused');
});

test('a ready-made agent is added to the agents of the person as a copy that is theirs', () => {
  const state = start();
  const ready = entriesFor(state.draft, 'agents')[0]!;
  assert.ok(installAction(state.draft, ready) !== null);
  const result = stageInstall(state, ready);
  assert.equal(result.status, 'added');
  assert.equal(changeCount(result.state), 1);
  const id = newAgentId(state.draft, result.state.draft);
  assert.ok(id !== null);
  const made = result.state.draft.items.find(i => i.id === id);
  assert.equal(made?.kind, 'agent');
  assert.equal(made?.library, null);
  assert.equal(agentChoices(result.state.draft, entry(state, 'skills', DEMO.skills[3]!)).some(c => c.id === id), true);
});

test('a skill entry has no install action, and an agent entry has no add-to action', () => {
  const state = start();
  assert.equal(installAction(state.draft, entry(state, 'skills', DEMO.skills[3]!)), null);
  assert.equal(stageAdd(state, DEMO.agents[0]!, entriesFor(state.draft, 'agents')[0]!).status, 'refused');
});

test('every action goes through the store: a stage and the store itself agree', () => {
  const state = start();
  const e = entry(state, 'skills', DEMO.skills[3]!);
  const viaStage = stageAdd(state, DEMO.agents[1]!, e).state;
  const viaStore = reduceStore(state, { type: 'attachSkill', agentId: DEMO.agents[1]!, skillId: e.id });
  assert.deepEqual(viaStage.draft, viaStore.draft);
});

test('the tabs scale to the real sample world: fifty skills, many ready-made agents, every hint within 12 words', () => {
  const world = generateWorld(1);
  const skills = entriesFor(world, 'skills'), agents = entriesFor(world, 'agents'), tools = entriesFor(world, 'tools'), notes = entriesFor(world, 'notes');
  assert.ok(skills.length >= 40 && agents.length >= 100 && tools.length >= 3);
  assert.equal(notes.length, world.slices.length);
  for (const e of [...skills, ...agents, ...tools, ...notes]) { assert.ok(countWords(e.hint) <= 12, e.hint); assert.ok(countWords(e.name) <= 5, e.name); assert.ok(e.name.trim() !== ''); }
  assert.equal(new Set(skills.map(e => e.id)).size, skills.length);
});
