// The order of the map and the agent the tour opens.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SORT_MODES, agentForTour, sortAgents, touch } from '../shared/home/order.js';
import { agentCard, ownedAgents } from '../shared/home/cards.js';
import { generateWorld } from '../shared/proto/sample.js';
import type { AgentItem } from '../shared/proto/types.js';
import { agent, makeWorld } from './proto-testworld.js';

const world = generateWorld(1);
const agents = ownedAgents(world);
const names = (list: readonly AgentItem[]): string[] => list.map(a => agentCard(a).name);

test('the toggle has two orders: by name, then by recent change', () => {
  assert.deepEqual([...SORT_MODES], ['name', 'recent']);
});

test('by name, the agents are in the order of the names a person reads, not the file-style names', () => {
  const sorted = names(sortAgents(agents, 'name'));
  assert.deepEqual(sorted, ['Inbox sorter', 'Interview notetaker', 'Meeting assistant', 'Money tracker', 'Report builder', 'Research assistant', 'Schedule keeper', 'Support writer', 'Trip organizer', 'Writing coach']);
  assert.deepEqual(names(sortAgents([...agents].reverse(), 'name')), sorted, 'the input order does not matter');
});

test('by recent change, the sample\'s own rank decides, and the order is not the name order', () => {
  const recent = names(sortAgents(agents, 'recent'));
  assert.deepEqual(recent.slice(0, 3), ['Inbox sorter', 'Research assistant', 'Money tracker']);
  assert.notDeepEqual(recent, names(sortAgents(agents, 'name')));
  assert.equal(recent.length, 10);
});

test('an agent the person changed this session comes first, the newest change before the older one', () => {
  const touched = touch(touch([], 'agent-08'), 'agent-03');
  assert.deepEqual(touched, ['agent-03', 'agent-08']);
  assert.deepEqual(names(sortAgents(agents, 'recent', touched)).slice(0, 4), ['Writing coach', 'Interview notetaker', 'Inbox sorter', 'Research assistant']);
  assert.deepEqual(touch(['a', 'b', 'c'], 'b'), ['b', 'a', 'c'], 'no id twice');
  assert.deepEqual(names(sortAgents(agents, 'name', touched)), names(sortAgents(agents, 'name')), 'by name ignores what was touched');
});

test('sorting never changes its input, and agents the sample does not know come last, by name', () => {
  const copy = [...agents];
  sortAgents(agents, 'recent', ['agent-02']);
  assert.deepEqual(agents, copy);
  const extra = [agent('z1', 'zed'), agent('b1', 'bee'), ...agents];
  assert.deepEqual(sortAgents(extra, 'recent').slice(-2).map(a => a.id), ['b1', 'z1']);
  assert.deepEqual(sortAgents([], 'recent'), []);
});

test('the tour opens the first agent that has skills, tools and notes', () => {
  const byName = sortAgents(agents, 'name');
  assert.equal(byName[0]!.id, 'agent-04', 'Inbox sorter has no tool, so it is not the one');
  assert.equal(agentForTour(world, byName)?.id, 'agent-01', 'Meeting assistant is the first with skills, a tool and a note');
  assert.equal(agentForTour(world, [])?.id, undefined);
  const w = makeWorld();
  const list = ownedAgents(w);
  assert.equal(agentForTour(w, list)?.id, 'a1', 'without a full agent, the first with a skill');
  assert.equal(agentForTour(w, [list.find(a => a.id === 'a2')!])?.id, 'a2', 'without a skill, the first');
});
