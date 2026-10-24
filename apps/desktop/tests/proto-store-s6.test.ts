// The two store actions added for the skills and agents screens: addLibrary (one invented library from a catalog) and moveSkill (reorder one skill of one agent).
import test from 'node:test';
import assert from 'node:assert/strict';
import { catalogItemId, FOLDER_CANDIDATES, LIBRARY_CATALOG } from '../shared/proto/library-catalog.js';
import { CASE_IDS, generateWorld, validateWorld } from '../shared/proto/sample.js';
import { createStore, isDirty, reduceStore, snapshotOf } from '../shared/proto/store.js';
import type { StoreAction, StoreState } from '../shared/proto/store.js';
import type { AgentItem, SkillItem, World } from '../shared/proto/types.js';
import { agent, copy, makeWorld, skill } from './proto-testworld.js';

const sample = generateWorld(1);
const works = LIBRARY_CATALOG.find(l => l.id === 'lantern-works')!;
const stateOf = (world: World): StoreState => createStore(world).getState();
const agentOf = (w: World, id: string): AgentItem => w.items.find(i => i.id === id && i.kind === 'agent') as AgentItem;
const run = (state: StoreState, ...actions: StoreAction[]): StoreState => actions.reduce(reduceStore, state);

// ---- The catalog

test('the catalog holds Lantern Works with 6 skills and 3 agents, and none of its names, ids or paths is in the sample world', () => {
  assert.equal(works.name, 'Lantern Works'); assert.equal(works.skills.length, 6); assert.equal(works.agents.length, 3);
  const names = new Set(sample.items.map(i => i.name)), ids = new Set(sample.items.map(i => i.id));
  const paths = new Set(sample.items.flatMap(i => i.foundAt.map(f => f.path)));
  for (const item of [...works.skills, ...works.agents]) {
    assert.equal(names.has(item.name), false, item.name);
    assert.equal(ids.has(catalogItemId(works.id, item.key)), false, item.key);
  }
  const added = reduceStore(stateOf(sample), { type: 'addLibrary', libraryId: works.id }).draft;
  for (const item of added.items.filter(i => i.library?.library === works.id)) for (const f of item.foundAt) assert.equal(paths.has(f.path), false, f.path);
  assert.equal(sample.libraries.some(l => l.id === works.id || l.name === works.name), false);
});

test('every agent of the catalog names only skills of its own library, and every folder has a few skills with fresh names', () => {
  const keys = new Set(works.skills.map(s => s.key));
  for (const g of works.agents) for (const k of g.skillKeys) assert.ok(keys.has(k), `${g.key} -> ${k}`);
  assert.ok(FOLDER_CANDIDATES.length >= 3);
  const names = new Set(sample.items.map(i => i.name));
  for (const f of FOLDER_CANDIDATES) { assert.ok(f.skills.length >= 2, f.id); for (const s of f.skills) assert.equal(names.has(s.name), false, s.name); }
});

// ---- addLibrary

test('addLibrary adds the source and its items to the draft only, read only, pinned, in the global harness', () => {
  const before = JSON.stringify(sample), store = createStore(sample);
  store.dispatch({ type: 'addLibrary', libraryId: works.id });
  const { draft, committed } = store.getState();
  assert.equal(JSON.stringify(sample), before, 'the input world is left alone');
  assert.equal(committed.libraries.length, sample.libraries.length, 'committed has not changed'); assert.equal(committed.items.length, sample.items.length);
  assert.equal(draft.libraries.length, sample.libraries.length + 1);
  assert.deepEqual(draft.libraries.find(l => l.id === works.id), { id: works.id, name: 'Lantern Works', installedVersion: works.version });
  const added = draft.items.filter(i => i.library?.library === works.id);
  assert.equal(added.length, 9); assert.equal(added.filter(i => i.kind === 'skill').length, 6); assert.equal(added.filter(i => i.kind === 'agent').length, 3);
  for (const item of added) { assert.equal(item.scopeId, 'global'); assert.equal(item.library!.pinnedVersion, works.version); assert.equal(item.library!.newerVersion, undefined); assert.ok(item.foundAt.length >= 1); }
  assert.equal(draft.items.length, sample.items.length + 9);
  assert.equal(isDirty(store.getState()), true);
  assert.deepEqual(validateWorld(draft), [], 'the new world still passes the reference check');
});

test('addLibrary: the agents use the skills of their library, in order, and a library agent is read only', () => {
  const s = run(stateOf(sample), { type: 'addLibrary', libraryId: works.id });
  const lamp = agentOf(s.draft, catalogItemId(works.id, 'dusk-lamplighter'));
  assert.deepEqual(lamp.definition.skillIds, ['wick-trimming', 'oil-topping', 'flame-guarding'].map(k => catalogItemId(works.id, k)));
  const again = reduceStore(s, { type: 'attachSkill', agentId: lamp.id, skillId: 'skill-010' });
  assert.equal(again, s, 'a library agent is not changed in place');
});

test('addLibrary twice is refused: the very same state comes back, with no step to undo', () => {
  const once = run(stateOf(sample), { type: 'addLibrary', libraryId: works.id });
  const twice = reduceStore(once, { type: 'addLibrary', libraryId: works.id });
  assert.equal(twice, once); assert.equal(twice.undoStack.length, 1);
});

test('addLibrary refuses an unknown library, a library the world already has, a world with no global harness, and a taken item id', () => {
  const s = stateOf(sample);
  assert.equal(reduceStore(s, { type: 'addLibrary', libraryId: 'no-such-library' }), s);
  assert.equal(reduceStore(s, { type: 'addLibrary', libraryId: CASE_IDS.newerLibrary }), s, 'Evergreen Kit is not in the catalog');
  const noGlobal = stateOf({ ...sample, scopes: sample.scopes.filter(x => x.kind !== 'global') });
  assert.equal(reduceStore(noGlobal, { type: 'addLibrary', libraryId: works.id }), noGlobal);
  const taken = stateOf({ ...sample, items: [...sample.items, skill(catalogItemId(works.id, 'wick-trimming'), 'Someone else')] });
  assert.equal(reduceStore(taken, { type: 'addLibrary', libraryId: works.id }), taken);
  const owned = stateOf({ ...sample, libraries: [...sample.libraries, { id: works.id, name: 'Lantern Works', installedVersion: '0.1.0' }] });
  assert.equal(reduceStore(owned, { type: 'addLibrary', libraryId: works.id }), owned);
});

test('addLibrary is deterministic: the same actions on the same world give the same JSON, and undo takes the library away again', () => {
  const a = run(stateOf(sample), { type: 'addLibrary', libraryId: works.id }), b = run(stateOf(copy(sample)), { type: 'addLibrary', libraryId: works.id });
  assert.equal(snapshotOf(a.draft), snapshotOf(b.draft));
  const undone = reduceStore(a, { type: 'undo' });
  assert.equal(undone.draft.libraries.length, sample.libraries.length); assert.equal(isDirty(undone), false);
  assert.equal(reduceStore(undone, { type: 'redo' }).draft.libraries.length, sample.libraries.length + 1);
});

test('addLibrary: apply commits the library and makes a version; the copy a person installs is a plain owned item', () => {
  let s = run(stateOf(sample), { type: 'addLibrary', libraryId: works.id }, { type: 'apply', label: 'Add Lantern Works' });
  assert.equal(s.committed.libraries.some(l => l.id === works.id), true); assert.equal(isDirty(s), false); assert.equal(s.committed.versions.length, 1);
  const id = catalogItemId(works.id, 'wick-trimming');
  s = run(s, { type: 'installItem', itemId: id, targetScopeId: 'global' });
  const copyItem = s.draft.items.find(i => i.name === 'wick-trimming copy') as SkillItem;
  assert.ok(copyItem); assert.equal(copyItem.library, null); assert.equal(copyItem.scopeId, 'global');
});

test('addLibrary can be undone back to a restored version: restore brings back a world that has the library', () => {
  let s = run(stateOf(sample), { type: 'addLibrary', libraryId: works.id }, { type: 'apply', label: 'one' });
  const v1 = s.committed.versions[0]!.id;
  s = run(s, { type: 'installItem', itemId: catalogItemId(works.id, 'oil-topping'), targetScopeId: 'global' }, { type: 'apply', label: 'two' }, { type: 'restore', versionId: v1 });
  assert.equal(s.committed.libraries.some(l => l.id === works.id), true);
  assert.equal(s.committed.items.some(i => i.name === 'oil-topping copy'), false);
});

// ---- moveSkill

const base = (): World => ({ ...makeWorld(), items: [...makeWorld().items, skill('s4', 'Fourth'), agent('a3', 'Third', ['s1', 's2', 's4'])] });

test('moveSkill reorders one skill inside one agent, in the draft only', () => {
  const world = base(), before = JSON.stringify(world), store = createStore(world);
  store.dispatch({ type: 'moveSkill', agentId: 'a3', skillId: 's4', toIndex: 0 });
  assert.deepEqual(agentOf(store.getState().draft, 'a3').definition.skillIds, ['s4', 's1', 's2']);
  assert.deepEqual(agentOf(store.getState().committed, 'a3').definition.skillIds, ['s1', 's2', 's4']);
  assert.equal(JSON.stringify(world), before); assert.equal(isDirty(store.getState()), true);
  store.dispatch({ type: 'moveSkill', agentId: 'a3', skillId: 's4', toIndex: 2 });
  assert.deepEqual(agentOf(store.getState().draft, 'a3').definition.skillIds, ['s1', 's2', 's4']);
  assert.equal(isDirty(store.getState()), false, 'back in the first order, nothing waits');
});

test('moveSkill moves down and into the middle, keeps every skill once, and leaves other agents alone', () => {
  const s = run(stateOf(base()), { type: 'moveSkill', agentId: 'a3', skillId: 's1', toIndex: 1 });
  assert.deepEqual(agentOf(s.draft, 'a3').definition.skillIds, ['s2', 's1', 's4']);
  assert.deepEqual(agentOf(s.draft, 'a1').definition.skillIds, ['s1']);
  const t = run(s, { type: 'moveSkill', agentId: 'a3', skillId: 's2', toIndex: 2 });
  assert.deepEqual(agentOf(t.draft, 'a3').definition.skillIds, ['s1', 's4', 's2']);
});

test('moveSkill is refused, with the same state back, for a place it already has, a place outside the list, a fraction, an unknown skill or agent, a library agent', () => {
  const s = stateOf(base());
  const same = (a: StoreAction): void => assert.equal(reduceStore(s, a), s, JSON.stringify(a));
  same({ type: 'moveSkill', agentId: 'a3', skillId: 's2', toIndex: 1 });
  same({ type: 'moveSkill', agentId: 'a3', skillId: 's2', toIndex: -1 });
  same({ type: 'moveSkill', agentId: 'a3', skillId: 's2', toIndex: 3 });
  same({ type: 'moveSkill', agentId: 'a3', skillId: 's2', toIndex: 0.5 });
  same({ type: 'moveSkill', agentId: 'a3', skillId: 's2', toIndex: Number.NaN });
  same({ type: 'moveSkill', agentId: 'a3', skillId: 's-none', toIndex: 0 });
  same({ type: 'moveSkill', agentId: 'a-none', skillId: 's2', toIndex: 0 });
  same({ type: 'moveSkill', agentId: 's1', skillId: 's2', toIndex: 0 });
  const lib = { ...agent('al', 'Library agent', ['s1', 's2']), library: { library: 'example-lib', pinnedVersion: '1.0.0' } };
  const withLib = stateOf({ ...base(), items: [...base().items, lib] });
  assert.equal(reduceStore(withLib, { type: 'moveSkill', agentId: 'al', skillId: 's2', toIndex: 0 }), withLib);
});

test('moveSkill commits with apply, is one step to undo, and the same actions give the same JSON', () => {
  const a = run(stateOf(base()), { type: 'moveSkill', agentId: 'a3', skillId: 's4', toIndex: 0 }), b = run(stateOf(copy(base())), { type: 'moveSkill', agentId: 'a3', skillId: 's4', toIndex: 0 });
  assert.equal(snapshotOf(a.draft), snapshotOf(b.draft));
  assert.equal(a.undoStack.length, 1);
  const done = reduceStore(a, { type: 'apply', label: 'Reorder' });
  assert.deepEqual(agentOf(done.committed, 'a3').definition.skillIds, ['s4', 's1', 's2']); assert.equal(isDirty(done), false);
  assert.deepEqual(agentOf(reduceStore(a, { type: 'undo' }).draft, 'a3').definition.skillIds, ['s1', 's2', 's4']);
});

test('moveSkill works on an owned agent of the sample world and the world stays valid', () => {
  const owned = sample.items.find((i): i is AgentItem => i.kind === 'agent' && i.library === null && i.definition.skillIds.length >= 2)!;
  const [first, second] = owned.definition.skillIds;
  const s = run(stateOf(sample), { type: 'moveSkill', agentId: owned.id, skillId: second!, toIndex: 0 });
  assert.equal(agentOf(s.draft, owned.id).definition.skillIds[0], second); assert.equal(agentOf(s.draft, owned.id).definition.skillIds[1], first);
  assert.deepEqual(validateWorld(s.draft), []);
});
