// The pure helpers behind the cards of the home app: names, hints, badges, the shelves of one agent, and the Save bar.
import test from 'node:test';
import assert from 'node:assert/strict';
import { agentHint, agentTitle, itemBadge, itemTitle, ownedAgents, saveBarModel, shelvesOf, visibleCount, SHELF_LIMIT } from '../shared/home/cards.js';
import { CASE_IDS, generateWorld } from '../shared/proto/sample.js';
import type { AgentItem, HarnessItem, World } from '../shared/proto/types.js';
import { agent, found, makeWorld, mcp, skill } from './proto-testworld.js';
import { assertTextBudget, countWords } from '../shared/home/textbudget.js';

const world = generateWorld(1);

test('agentTitle turns a file-style name into words with capitals, at most 5', () => {
  assert.equal(agentTitle('velvet-weaver'), 'Velvet Weaver');
  assert.equal(agentTitle('quiet_warden'), 'Quiet Warden');
  assert.equal(agentTitle('  spaced   out '), 'Spaced Out');
  assert.equal(agentTitle('a-b-c-d-e-f-g'), 'A B C D E');
  assert.equal(agentTitle(''), '');
  assert.equal(itemTitle('weekly-review'), 'Weekly Review');
  assert.equal(itemTitle('Already Fine'), 'Already Fine');
});

test('agentHint is one plain line of at most 12 words and says what the agent has', () => {
  const a = world.items.find((i): i is AgentItem => i.id === 'agent-01')!;
  assert.equal(agentHint(a), 'A weaver with 3 skills and 1 tool.');
  const none = agent('x', 'Solo');
  assert.equal(agentHint({ ...none, definition: { ...none.definition, role: 'archivist' } }), 'An archivist with nothing added yet.');
  const one = { ...none, definition: { ...none.definition, role: 'scribe', skillIds: ['s1'] } };
  assert.equal(agentHint(one), 'A scribe with 1 skill.');
  for (const i of world.items) if (i.kind === 'agent') { assert.ok(countWords(agentHint(i)) <= 12, i.id); assert.deepEqual(assertTextBudget(`<p>${agentHint(i)}</p>`), [], i.id); }
});

test('itemBadge: two or more different copies first, then a missing key, then new, else none', () => {
  const triple = world.items.find(i => i.id === CASE_IDS.tripleSkill)!;
  assert.deepEqual(itemBadge(triple), { label: '3 different copies', tone: 'warn' });
  const two: HarnessItem = { ...skill('s', 'S'), foundAt: [found('claude-code', '/a', 'one'), found('codex', '/b', 'two')] };
  assert.deepEqual(itemBadge(two), { label: '2 different copies', tone: 'warn' });
  const same: HarnessItem = { ...skill('s', 'S'), foundAt: [found('claude-code', '/a', 'same'), found('codex', '/b', 'same')] };
  assert.equal(itemBadge(same), null, 'the same text in two places is one copy');
  assert.deepEqual(itemBadge(mcp('t', 'T')), { label: 'needs a key', tone: 'warn' });
  assert.equal(itemBadge(mcp('t', 'T', null)), null);
  const keyed = world.items.find(i => i.id === CASE_IDS.mcpMissing)!;
  assert.equal(itemBadge(keyed)?.label, 'needs a key');
  const fresh = { ...skill('s', 'S'), library: { library: 'l', pinnedVersion: '1', newerVersion: '2' } };
  assert.deepEqual(itemBadge(fresh), { label: 'new', tone: 'new' });
  assert.equal(itemBadge({ ...fresh, library: { library: 'l', pinnedVersion: '1' } }), null);
  assert.equal(itemBadge({ ...two, library: { library: 'l', pinnedVersion: '1', newerVersion: '2' } })?.label, '2 different copies');
});

test('ownedAgents lists the agents the person owns, by name, and leaves out library agents', () => {
  const list = ownedAgents(world);
  assert.equal(list.length, 10); assert.ok(list.every(a => a.library === null));
  const names = list.map(a => agentTitle(a.name));
  assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b)));
  assert.deepEqual(ownedAgents({ ...makeWorld(), items: [] }), []);
});

test('shelvesOf gives the skills, the tools and the notes of one agent, with hooks left for Advanced', () => {
  const w: World = makeWorld();
  const a1: AgentItem = { ...(w.items.find(i => i.id === 'a1') as AgentItem), definition: { ...(w.items.find(i => i.id === 'a1') as AgentItem).definition, skillIds: ['s1', 's2', 'gone'], toolAttachments: [{ toolId: 't1', access: 'read-only' }, { toolId: 't3', access: 'read-only' }, { toolId: 't2', access: 'read-write' }], sliceId: 'sl' } };
  const shelves = shelvesOf({ ...w, slices: [{ id: 'sl', name: 'Daily notes', seeds: [], rule: { folders: [], pageTypesAndTags: { types: [], tags: [] }, linksFromSeeds: null }, pinned: false }] }, a1);
  assert.deepEqual(shelves.skills.map(e => e.name), ['Review', 'Plan']);
  assert.deepEqual(shelves.tools.map(e => [e.name, e.badge?.label ?? null]), [['Search', 'needs a key'], ['Summarize', null]], 'the hook is not shown, an unknown skill is left out');
  assert.deepEqual(shelves.notes.map(e => e.name), ['Daily notes']);
  assert.ok(shelves.skills.every(e => e.kind === 'skill') && shelves.tools.every(e => e.kind === 'tool') && shelves.notes.every(e => e.kind === 'note'));
  const bare = shelvesOf(w, { ...a1, definition: { ...a1.definition, skillIds: [], toolAttachments: [], sliceId: undefined as never } });
  assert.deepEqual([bare.skills, bare.tools, bare.notes], [[], [], []]);
});

test('visibleCount shows 8 cards and then Show more reveals the rest', () => {
  assert.equal(SHELF_LIMIT, 8);
  assert.equal(visibleCount(0, false), 0); assert.equal(visibleCount(5, false), 5); assert.equal(visibleCount(8, false), 8);
  assert.equal(visibleCount(9, false), 8); assert.equal(visibleCount(40, false), 8); assert.equal(visibleCount(40, true), 40);
  assert.equal(visibleCount(20, false, 3), 3);
});

test('saveBarModel: nothing to save, or changes to save', () => {
  assert.deepEqual(saveBarModel(false), { text: 'Nothing to save yet', canSave: false });
  assert.deepEqual(saveBarModel(true), { text: 'You have changes to save', canSave: true });
});

test('a sample set of notes that was edited in place no longer wears the sample hint (review item 3)', () => {
  const agentTwo = world.items.find((i): i is AgentItem => i.id === 'agent-02')!;
  const sample = shelvesOf(world, agentTwo).notes[0]!;
  assert.deepEqual([sample.name, sample.hint], ['Reading list', 'Articles and guides you saved to read later.']);
  const edited: World = { ...world, slices: world.slices.map(s => (s.id === 'slice-kinds' ? { ...s, rule: { ...s.rule, folders: ['cinderlow'], pageTypesAndTags: { types: [], tags: [] } } } : s)) };
  const after = shelvesOf(edited, agentTwo).notes[0]!;
  assert.equal(after.id, 'slice-kinds');
  assert.equal(after.hint, 'Notes this agent can read.');
  assert.notEqual(after.name, 'Reading list');
  const seeded: World = { ...world, slices: world.slices.map(s => (s.id === 'slice-kinds' ? { ...s, seeds: world.wikiPages.slice(0, 1).map(p => p.id) } : s)) };
  assert.equal(shelvesOf(seeded, agentTwo).notes[0]!.hint, 'Notes this agent can read.');
});
