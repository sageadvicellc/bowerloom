// The Agents tab of the Add drawer offers six hand-written starter agents, each with a real one-line job and two or three real skills, in place of the 120
// generated library agents ("Amber Cartographer", "A cartographer with nothing added yet.") (fix list item 7). Adding one makes an agent that is not empty.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../shared/world/store.js';
import { generateWorld } from '../shared/world/sample.js';
import type { AgentItem, World } from '../shared/world/types.js';
import { entriesFor, installAction, newAgentId, stageInstall } from '../shared/home/add-model.js';
import { plainHintOf, plainNameOf } from '../shared/home/plain-names.js';
import { STARTERS, starterOf, withStarterAgents } from '../shared/home/starters.js';
import { PLAIN_AGENTS, plainOf, skillDoes } from '../shared/home/plain.js';
import { agentCard, ownedAgents } from '../shared/home/cards.js';
import { barSentence, listChanges } from '../shared/home/changes.js';
import { changeCount, withStartPoint } from '../shared/home/savebar.js';
import { BANNED_PATTERN, assertTextBudget, countWords } from '../shared/home/textbudget.js';
import { withSampleCopies } from '../shared/home/sample-copies.js';

const base = (): World => withStartPoint(withStarterAgents(withSampleCopies(generateWorld(1))));
const NAMES = ['Budget checker', 'Email drafter', 'Note taker', 'Reading coach', 'Research reader', 'Trip planner'];

test('there are six starters with plain names, a one-line job and two or three skills each', () => {
  assert.deepEqual(STARTERS.map(s => s.name).sort(), NAMES);
  for (const s of STARTERS) {
    assert.ok(countWords(s.name) <= 5, s.name); assert.ok(countWords(s.job) <= 12 && /\.$/.test(s.job), s.job);
    assert.ok(s.skills.length >= 2 && s.skills.length <= 3, `${s.name} has ${s.skills.length} skills`);
    assert.doesNotMatch(`${s.name} ${s.job}`, BANNED_PATTERN, s.name);
    assert.doesNotMatch(s.name, /meeting helper/i);
    assert.deepEqual(assertTextBudget(`<h3>${s.name}</h3><p>${s.job}</p>`), [], s.name);
  }
  assert.equal(new Set(STARTERS.map(s => s.id)).size, 6);
});

test('every starter skill is a real skill of the world, owned, in the plain layer, and says what it does', () => {
  const world = generateWorld(1);
  for (const s of STARTERS) for (const id of s.skills) {
    const item = world.items.find(i => i.id === id);
    assert.ok(item !== undefined && item.kind === 'skill' && item.library === null, `${s.name}: ${id}`);
    assert.notEqual(plainOf('skill', id), null, id); assert.notEqual(skillDoes(id), null, id);
  }
});

test('the world of the home app has the six starters as its ready-made agents, and the generated ones are gone', () => {
  const world = base();
  const ready = world.items.filter((i): i is AgentItem => i.kind === 'agent' && i.library !== null);
  assert.deepEqual(ready.map(a => a.name).sort(), NAMES);
  assert.equal(world.items.some(i => i.id.startsWith('agent-lib-')), false);
  assert.equal(ownedAgents(world).length, 10, 'the ten agents of the person are not touched');
  assert.equal(withStarterAgents(world), world, 'asking again changes nothing');
  assert.equal(generateWorld(1).items.filter(i => i.kind === 'agent' && i.library !== null).length, 120, 'the sample itself is not changed');
  for (const a of ready) { assert.ok(a.definition.skillIds.length >= 2, a.name); assert.deepEqual(a.definition.skillIds, starterOf(a.id)!.skills); }
});

test('the Agents tab lists the six by name with their job, in name order, and nothing generated', () => {
  const world = base();
  const entries = entriesFor(world, 'agents', plainNameOf(world), plainHintOf);
  assert.deepEqual(entries.map(e => e.name), NAMES);
  assert.deepEqual(entries.map(e => e.hint), NAMES.map(n => STARTERS.find(s => s.name === n)!.job));
  assert.doesNotMatch(entries.map(e => `${e.name} ${e.hint}`).join(' '), /cartographer|with nothing added yet/i);
});

test('adding a starter makes an agent with its skills, named as the card was, and the Save bar says so', () => {
  const world = base(), state = createStore(world).getState();
  const entry = entriesFor(world, 'agents', plainNameOf(world), plainHintOf).find(e => e.name === 'Note taker')!;
  const result = stageInstall(state, entry);
  assert.equal(result.status, 'added');
  const id = newAgentId(world, result.state.draft)!;
  const made = result.state.draft.items.find((i): i is AgentItem => i.id === id)!;
  assert.equal(made.library, null, 'it is the person\'s own agent');
  assert.deepEqual(made.definition.skillIds, ['skill-042', 'skill-009', 'skill-026']);
  const card = agentCard(made);
  assert.equal(card.name, 'Note taker');
  assert.equal(card.hint, 'Summarizes meetings and lists action items.');
  assert.deepEqual(assertTextBudget(`<h3>${card.name}</h3><p>${card.hint}</p>`), []);
  assert.equal(changeCount(result.state.committed, result.state.draft), 1);
  assert.equal(barSentence(listChanges(result.state.committed, result.state.draft), 1), 'Added Note taker');
  assert.notEqual(installAction(world, entry), null);
});

test('a second copy of a starter still reads as the starter on the map, and a starter with every skill taken off waits for a skill', () => {
  const world = base();
  let state = createStore(world).getState();
  const entry = entriesFor(world, 'agents', plainNameOf(world), plainHintOf).find(e => e.name === 'Trip planner')!;
  state = stageInstall(state, entry).state;
  state = stageInstall(state, entry).state;
  const mine = state.draft.items.filter((i): i is AgentItem => i.kind === 'agent' && i.library === null && starterOf(i.id) !== undefined);
  assert.equal(mine.length, 2);
  assert.deepEqual(mine.map(a => agentCard(a).name), ['Trip planner', 'Trip planner']);
  assert.equal(agentCard({ ...mine[0]!, definition: { ...mine[0]!.definition, skillIds: [] } }).hint, 'Waits for a skill to be added.');
});

test('the plain layer of the ten agents is untouched by the starters', () => {
  assert.equal(Object.keys(PLAIN_AGENTS).length, 10);
  assert.equal(plainOf('agent', 'agent-note-taker-nope'), null);
  assert.equal(plainOf('agent', 'agent-starter-note-taker')?.name, 'Note taker');
  assert.equal(plainOf('agent', 'agent-starter-note-taker-copy-2')?.name, 'Note taker');
});
