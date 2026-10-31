// The prototype's in-memory store: every edit changes only the draft, apply makes versions with a logical counter, restore appends.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createStore, isDirty, reduceStore } from '../shared/world/store.js';
import type { StoreAction } from '../shared/world/store.js';
import { liveMatch } from '../shared/world/slicematch.js';
import type { AgentItem, SkillItem, World } from '../shared/world/types.js';
import { DESKTOP } from './support.js';
import { agent, copy, found, makeWorld, skill } from './testworld.js';

const RULE = { folders: ['notes'], pageTypesAndTags: { types: [], tags: [] }, linksFromSeeds: null } as const;
const agentOf = (w: World, id: string): AgentItem => w.items.find(i => i.id === id && i.kind === 'agent') as AgentItem;

test('a new store starts clean: draft equals committed, no stacks, no head version', () => {
  const world = makeWorld(), store = createStore(world), s = store.getState();
  assert.equal(s.committed, world); assert.equal(s.draft, world);
  assert.deepEqual(s.undoStack, []); assert.deepEqual(s.redoStack, []); assert.equal(s.headVersionId, null); assert.equal(isDirty(s), false);
});

test('the head version of a world that has versions is the one with the highest counter', () => {
  const world: World = { ...makeWorld(), versions: [{ id: 'va', parentId: null, counter: 1, label: 'a', snapshotJson: '{}' }, { id: 'vb', parentId: 'va', counter: 2, label: 'b', snapshotJson: '{}' }] };
  assert.equal(createStore(world).getState().headVersionId, 'vb');
});

test('the draft never leaks into committed until apply, and the input world is never changed', () => {
  const world = makeWorld(), before = JSON.stringify(world), store = createStore(world);
  store.dispatch({ type: 'attachSkill', agentId: 'a2', skillId: 's2' });
  assert.deepEqual(agentOf(store.getState().draft, 'a2').definition.skillIds, ['s2']);
  assert.deepEqual(agentOf(store.getState().committed, 'a2').definition.skillIds, []);
  assert.equal(isDirty(store.getState()), true);
  assert.equal(JSON.stringify(world), before);
  store.dispatch({ type: 'apply', label: 'one' });
  assert.deepEqual(agentOf(store.getState().committed, 'a2').definition.skillIds, ['s2']);
  assert.equal(isDirty(store.getState()), false); assert.equal(JSON.stringify(world), before);
});

test('attachSkill and detachSkill: add once, remove, ignore unknown ids and library agents', () => {
  const store = createStore(makeWorld());
  store.dispatch({ type: 'attachSkill', agentId: 'a1', skillId: 's2' });
  store.dispatch({ type: 'attachSkill', agentId: 'a1', skillId: 's2' });
  assert.deepEqual(agentOf(store.getState().draft, 'a1').definition.skillIds, ['s1', 's2']);
  assert.equal(store.getState().undoStack.length, 1, 'the second attach changed nothing, so it left no step to undo');
  store.dispatch({ type: 'attachSkill', agentId: 'a1', skillId: 'nope' }); store.dispatch({ type: 'attachSkill', agentId: 'nope', skillId: 's1' });
  store.dispatch({ type: 'attachSkill', agentId: 'a1', skillId: 't1' });
  assert.equal(store.getState().undoStack.length, 1, 'an unknown agent, an unknown skill, and a tool given as a skill are all refused');
  store.dispatch({ type: 'detachSkill', agentId: 'a1', skillId: 's1' });
  assert.deepEqual(agentOf(store.getState().draft, 'a1').definition.skillIds, ['s2']);
  store.dispatch({ type: 'detachSkill', agentId: 'a1', skillId: 's1' });
  assert.equal(store.getState().undoStack.length, 2);
  const base = makeWorld(), lib: World = { ...base, items: [...base.items, { ...agent('al', 'Lib agent'), library: { library: 'example-lib', pinnedVersion: '1.0.0' } }] };
  const s2 = createStore(lib); s2.dispatch({ type: 'attachSkill', agentId: 'al', skillId: 's1' });
  assert.equal(isDirty(s2.getState()), false, 'a library agent is read-only until it is copied');
});

test('attachTool sets the access class, changes it on a second attach, and detachTool removes it', () => {
  const store = createStore(makeWorld());
  store.dispatch({ type: 'attachTool', agentId: 'a1', toolId: 't1', access: 'read-only' });
  assert.deepEqual(agentOf(store.getState().draft, 'a1').definition.toolAttachments, [{ toolId: 't1', access: 'read-only' }]);
  store.dispatch({ type: 'attachTool', agentId: 'a1', toolId: 't1', access: 'read-only' });
  assert.equal(store.getState().undoStack.length, 1);
  store.dispatch({ type: 'attachTool', agentId: 'a1', toolId: 't1', access: 'read-write' });
  assert.deepEqual(agentOf(store.getState().draft, 'a1').definition.toolAttachments, [{ toolId: 't1', access: 'read-write' }]);
  store.dispatch({ type: 'attachTool', agentId: 'a1', toolId: 's1', access: 'read-only' });
  assert.equal(agentOf(store.getState().draft, 'a1').definition.toolAttachments.length, 1, 'a skill is not a tool');
  store.dispatch({ type: 'detachTool', agentId: 'a1', toolId: 't1' });
  assert.deepEqual(agentOf(store.getState().draft, 'a1').definition.toolAttachments, []);
});

test('setOverride: hide, replace, and back to inherit; only a project can override an item it inherits', () => {
  const store = createStore(makeWorld()), overrides = () => store.getState().draft.overrides;
  store.dispatch({ type: 'setOverride', scopeId: 'proj', itemId: 's1', mode: 'hide' });
  assert.deepEqual(overrides(), [{ scopeId: 'proj', itemId: 's1', mode: 'hide' }]);
  store.dispatch({ type: 'setOverride', scopeId: 'proj', itemId: 's1', mode: 'replace', replacementItemId: 's3' });
  assert.deepEqual(overrides(), [{ scopeId: 'proj', itemId: 's1', mode: 'replace', replacementItemId: 's3' }], 'one choice per scope per item');
  store.dispatch({ type: 'setOverride', scopeId: 'proj', itemId: 's2', mode: 'replace' });
  store.dispatch({ type: 'setOverride', scopeId: 'proj', itemId: 's2', mode: 'replace', replacementItemId: 's2' });
  store.dispatch({ type: 'setOverride', scopeId: 'proj', itemId: 's2', mode: 'replace', replacementItemId: 'nope' });
  store.dispatch({ type: 'setOverride', scopeId: 'global', itemId: 's2', mode: 'hide' });
  store.dispatch({ type: 'setOverride', scopeId: 'proj', itemId: 'nope', mode: 'hide' });
  store.dispatch({ type: 'setOverride', scopeId: 'proj', itemId: 's3', mode: 'hide' });
  assert.equal(overrides().length, 1, 'a replace with no usable replacement, a global scope, an unknown item and an own item are all refused');
  store.dispatch({ type: 'setOverride', scopeId: 'proj', itemId: 's1', mode: 'inherit' });
  assert.deepEqual(overrides(), []);
  store.dispatch({ type: 'setOverride', scopeId: 'proj', itemId: 's2', mode: 'inherit' });
  assert.equal(store.getState().undoStack.length, 3, 'inherit on an item that was never overridden changes nothing');
});

test('installItem copies an item into a scope with a new id, as an editable copy that is not from a library', () => {
  const world = makeWorld(), store = createStore(world);
  store.dispatch({ type: 'installItem', itemId: 's1', targetScopeId: 'proj' });
  const copied = store.getState().draft.items.filter(i => i.name === 'Review');
  assert.equal(copied.length, 2); const fresh = copied.find(i => i.id !== 's1') as SkillItem;
  assert.equal(fresh.scopeId, 'proj'); assert.equal(fresh.id, 's1-copy'); assert.deepEqual(fresh.foundAt, (copied.find(i => i.id === 's1') as SkillItem).foundAt);
  store.dispatch({ type: 'installItem', itemId: 's1', targetScopeId: 'proj' });
  const names = store.getState().draft.items.filter(i => i.scopeId === 'proj' && i.kind === 'skill').map(i => i.name);
  assert.equal(new Set(names).size, names.length, 'two copies in one scope get distinct names');
  assert.equal(new Set(store.getState().draft.items.map(i => i.id)).size, store.getState().draft.items.length, 'and distinct ids');
  store.dispatch({ type: 'installItem', itemId: 'l1', targetScopeId: 'proj' });
  const fromLibrary = store.getState().draft.items.find(i => i.scopeId === 'proj' && i.name === 'Library skill')!;
  assert.equal(fromLibrary.library, null); assert.notEqual(fromLibrary.id, 'l1');
  const before = store.getState().draft;
  store.dispatch({ type: 'installItem', itemId: 'nope', targetScopeId: 'proj' }); store.dispatch({ type: 'installItem', itemId: 's1', targetScopeId: 'nope' });
  assert.equal(store.getState().draft, before);
  assert.equal(JSON.stringify(world), JSON.stringify(makeWorld()));
});

function conflictWorld(): World {
  const w = makeWorld();
  const c: SkillItem = { ...skill('c1', 'Triage'), foundAt: [found('claude-code', '/sample/c/a', 'one', 'h1'), found('codex', '/sample/c/b', 'two', 'h2'), found('opencode', '/sample/c/c', 'one again', 'h3'), found('opencode', '/sample/c/d', 'two', 'h2')] };
  return { ...w, items: [...w.items, c] };
}

test('resolveConflict keeps the copy at the index chosen, with every place that holds the same text', () => {
  const store = createStore(conflictWorld());
  store.dispatch({ type: 'resolveConflict', itemId: 'c1', keep: 1 });
  const kept = store.getState().draft.items.find(i => i.id === 'c1') as SkillItem;
  assert.deepEqual(kept.foundAt.map(f => f.path), ['/sample/c/b', '/sample/c/d']);
  store.dispatch({ type: 'resolveConflict', itemId: 'c1', keep: 0 });
  assert.equal(store.getState().undoStack.length, 1, 'one text is no conflict, so nothing more happens');
  const other = createStore(conflictWorld()); other.dispatch({ type: 'resolveConflict', itemId: 'c1', keep: 9 }); other.dispatch({ type: 'resolveConflict', itemId: 'c1', keep: -1 });
  assert.equal(isDirty(other.getState()), false);
});

test('resolveConflict keep-both splits the item in one item per text, under distinct names', () => {
  const store = createStore(conflictWorld());
  store.dispatch({ type: 'resolveConflict', itemId: 'c1', keep: 'keep-both', names: ['Triage', 'Triage'] });
  store.dispatch({ type: 'resolveConflict', itemId: 'c1', keep: 'keep-both', names: ['Triage a', 'Triage b'] });
  store.dispatch({ type: 'resolveConflict', itemId: 'c1', keep: 'keep-both', names: ['Review', 'Triage b', 'Triage c'] });
  assert.equal(isDirty(store.getState()), false, 'equal names, a wrong count, and a name that is taken are refused');
  store.dispatch({ type: 'resolveConflict', itemId: 'c1', keep: 'keep-both', names: ['Triage a', 'Triage b', 'Triage c'] });
  const parts = store.getState().draft.items.filter(i => i.name.startsWith('Triage')) as SkillItem[];
  assert.deepEqual(parts.map(p => p.name), ['Triage a', 'Triage b', 'Triage c']);
  assert.deepEqual(parts.map(p => p.foundAt.map(f => f.contentHash)), [['h1'], ['h2', 'h2'], ['h3']]);
  assert.equal(parts[0]!.id, 'c1'); assert.equal(new Set(parts.map(p => p.id)).size, 3);
});

test('createSlice, updateSliceRule, pinSlice and unpinSlice', () => {
  const store = createStore(makeWorld()), d = () => store.getState().draft;
  store.dispatch({ type: 'createSlice', name: '   ', rule: RULE });
  assert.equal(d().slices.length, 0, 'a slice needs a name');
  store.dispatch({ type: 'createSlice', name: 'Notes', rule: RULE, seeds: ['p3'] });
  assert.deepEqual(d().slices.map(s => ({ id: s.id, name: s.name, seeds: s.seeds, pinned: s.pinned })), [{ id: 'slice-1', name: 'Notes', seeds: ['p3'], pinned: false }]);
  const shown = d().items.find(i => i.kind === 'context-slice');
  assert.ok(shown && shown.kind === 'context-slice' && shown.sliceId === 'slice-1' && shown.scopeId === 'global', 'the slice also shows as an item of the harness');
  store.dispatch({ type: 'createSlice', name: 'Second', rule: RULE });
  assert.deepEqual(d().slices.map(s => s.id), ['slice-1', 'slice-2']);
  store.dispatch({ type: 'pinSlice', sliceId: 'slice-1' });
  const pinned = d().slices[0]!;
  assert.equal(pinned.pinned, true);
  assert.deepEqual(pinned.pinnedPageIds, liveMatch(d(), pinned).map(p => p.id));
  assert.deepEqual(pinned.pinnedPageIds, ['p1', 'p2', 'p3']);
  // The page list stays frozen when the rule changes; unpin makes it live again and drops the frozen list.
  store.dispatch({ type: 'updateSliceRule', sliceId: 'slice-1', rule: { ...RULE, folders: ['misc'] } });
  assert.deepEqual(d().slices[0]!.pinnedPageIds, ['p1', 'p2', 'p3']); assert.deepEqual(d().slices[0]!.rule.folders, ['misc']);
  store.dispatch({ type: 'unpinSlice', sliceId: 'slice-1' });
  assert.equal(d().slices[0]!.pinned, false); assert.equal('pinnedPageIds' in d().slices[0]!, false);
  const steps = store.getState().undoStack.length;
  store.dispatch({ type: 'unpinSlice', sliceId: 'slice-1' }); store.dispatch({ type: 'pinSlice', sliceId: 'nope' }); store.dispatch({ type: 'updateSliceRule', sliceId: 'nope', rule: RULE });
  store.dispatch({ type: 'updateSliceRule', sliceId: 'slice-1', rule: copy(d().slices[0]!.rule) });
  assert.equal(store.getState().undoStack.length, steps);
});

test('the slice match: folders (and subfolders), types, tags, and links from the seeds, by hops', () => {
  const w = makeWorld(), ids = (rule: Parameters<typeof liveMatch>[1]['rule'], seeds: string[] = []) => liveMatch(w, { seeds, rule }).map(p => p.id);
  const empty = { folders: [], pageTypesAndTags: { types: [], tags: [] }, linksFromSeeds: null } as const;
  assert.deepEqual(ids(empty), []);
  assert.deepEqual(ids({ ...empty, folders: ['ideas'] }), ['p3', 'p4']);
  assert.deepEqual(ids({ ...empty, pageTypesAndTags: { types: ['log'], tags: [] } }), ['p5', 'p6']);
  assert.deepEqual(ids({ ...empty, pageTypesAndTags: { types: [], tags: ['a'] } }), ['p1', 'p3']);
  assert.deepEqual(ids(empty, ['p1']), ['p1']);
  assert.deepEqual(ids({ ...empty, linksFromSeeds: { hops: 1 } }, ['p1']), ['p1', 'p2']);
  assert.deepEqual(ids({ ...empty, linksFromSeeds: { hops: 2 } }, ['p1']), ['p1', 'p2', 'p3']);
  assert.deepEqual(ids({ ...empty, linksFromSeeds: { hops: 2 } }, ['nope']), []);
});

test('assignSlice sets and clears the slice of an agent, and refuses an unknown slice', () => {
  const store = createStore(makeWorld());
  store.dispatch({ type: 'createSlice', name: 'Notes', rule: RULE });
  store.dispatch({ type: 'assignSlice', agentId: 'a1', sliceId: 'slice-1' });
  assert.equal(agentOf(store.getState().draft, 'a1').definition.sliceId, 'slice-1');
  store.dispatch({ type: 'assignSlice', agentId: 'a1', sliceId: 'nope' });
  assert.equal(agentOf(store.getState().draft, 'a1').definition.sliceId, 'slice-1');
  store.dispatch({ type: 'assignSlice', agentId: 'a1', sliceId: null });
  assert.equal('sliceId' in agentOf(store.getState().draft, 'a1').definition, false);
});

test('undo and redo walk the draft; a new edit clears redo; empty stacks do nothing', () => {
  const store = createStore(makeWorld()), skillIds = () => agentOf(store.getState().draft, 'a2').definition.skillIds;
  store.dispatch({ type: 'undo' }); store.dispatch({ type: 'redo' });
  assert.equal(isDirty(store.getState()), false);
  store.dispatch({ type: 'attachSkill', agentId: 'a2', skillId: 's1' }); store.dispatch({ type: 'attachSkill', agentId: 'a2', skillId: 's2' });
  assert.deepEqual(skillIds(), ['s1', 's2']);
  store.dispatch({ type: 'undo' }); assert.deepEqual(skillIds(), ['s1']);
  store.dispatch({ type: 'undo' }); assert.deepEqual(skillIds(), []); assert.equal(isDirty(store.getState()), false);
  assert.equal(store.getState().redoStack.length, 2);
  store.dispatch({ type: 'redo' }); assert.deepEqual(skillIds(), ['s1']);
  store.dispatch({ type: 'redo' }); assert.deepEqual(skillIds(), ['s1', 's2']);
  store.dispatch({ type: 'undo' }); store.dispatch({ type: 'attachSkill', agentId: 'a2', skillId: 's3' });
  assert.deepEqual(store.getState().redoStack, []); assert.deepEqual(skillIds(), ['s1', 's3']);
  assert.deepEqual(store.getState().committed.items, makeWorld().items, 'undo and redo never touch committed');
});

test('discard puts the draft back to committed, and an undo brings the draft back', () => {
  const store = createStore(makeWorld());
  store.dispatch({ type: 'attachSkill', agentId: 'a2', skillId: 's1' });
  store.dispatch({ type: 'discard' });
  assert.equal(isDirty(store.getState()), false); assert.equal(store.getState().draft, store.getState().committed);
  store.dispatch({ type: 'undo' });
  assert.deepEqual(agentOf(store.getState().draft, 'a2').definition.skillIds, ['s1']);
  const clean = createStore(makeWorld()); clean.dispatch({ type: 'discard' });
  assert.deepEqual(clean.getState().undoStack, [], 'discard with nothing to discard leaves no step');
});

test('apply makes versions with counters 1, 2, 3 and parent links, and snapshotJson is the committed world without its versions', () => {
  const store = createStore(makeWorld());
  store.dispatch({ type: 'apply', label: 'nothing' });
  assert.deepEqual(store.getState().committed.versions, [], 'apply with no change makes no version');
  for (const [i, id] of ['s1', 's2', 's3'].entries()) { store.dispatch({ type: 'attachSkill', agentId: 'a2', skillId: id }); store.dispatch({ type: 'apply', label: `step ${i + 1}` }); }
  const versions = store.getState().committed.versions;
  assert.deepEqual(versions.map(v => v.counter), [1, 2, 3]);
  assert.deepEqual(versions.map(v => v.label), ['step 1', 'step 2', 'step 3']);
  assert.deepEqual(versions.map(v => v.parentId), [null, versions[0]!.id, versions[1]!.id]);
  assert.equal(new Set(versions.map(v => v.id)).size, 3); assert.equal(store.getState().headVersionId, versions[2]!.id);
  const { versions: _drop, ...rest } = store.getState().committed;
  assert.equal(versions[2]!.snapshotJson, JSON.stringify(rest));
  assert.equal('versions' in JSON.parse(versions[2]!.snapshotJson), false);
  assert.deepEqual(JSON.parse(versions[0]!.snapshotJson).items.find((i: { id: string }) => i.id === 'a2').definition.skillIds, ['s1']);
  assert.equal(isDirty(store.getState()), false); assert.equal(store.getState().draft.versions, store.getState().committed.versions);
});

test('restore adds a NEW version equal to the old one and deletes no history', () => {
  const store = createStore(makeWorld());
  store.dispatch({ type: 'attachSkill', agentId: 'a2', skillId: 's1' }); store.dispatch({ type: 'apply', label: 'good' });
  store.dispatch({ type: 'attachSkill', agentId: 'a2', skillId: 's2' }); store.dispatch({ type: 'apply', label: 'bad edit' });
  const v1 = store.getState().committed.versions[0]!, v2 = store.getState().committed.versions[1]!;
  store.dispatch({ type: 'restore', versionId: v1.id });
  const s = store.getState(), versions = s.committed.versions;
  assert.equal(versions.length, 3); assert.deepEqual(versions.map(v => v.counter), [1, 2, 3]);
  assert.equal(versions[0]!.snapshotJson, v1.snapshotJson); assert.equal(versions[1]!.snapshotJson, v2.snapshotJson);
  assert.equal(versions[2]!.snapshotJson, v1.snapshotJson); assert.equal(versions[2]!.parentId, v2.id); assert.equal(s.headVersionId, versions[2]!.id);
  assert.deepEqual(agentOf(s.committed, 'a2').definition.skillIds, ['s1']); assert.equal(isDirty(s), false);
  store.dispatch({ type: 'restore', versionId: 'nope' });
  assert.equal(store.getState().committed.versions.length, 3);
  store.dispatch({ type: 'restore', versionId: v2.id });
  assert.deepEqual(agentOf(store.getState().committed, 'a2').definition.skillIds, ['s1', 's2']); assert.equal(store.getState().committed.versions.length, 4);
});

test('restore starts a clean undo history, and a damaged snapshot is refused', () => {
  const store = createStore(makeWorld());
  store.dispatch({ type: 'attachSkill', agentId: 'a2', skillId: 's1' }); store.dispatch({ type: 'apply', label: 'one' });
  store.dispatch({ type: 'attachSkill', agentId: 'a2', skillId: 's2' });
  store.dispatch({ type: 'restore', versionId: store.getState().committed.versions[0]!.id });
  assert.deepEqual(agentOf(store.getState().draft, 'a2').definition.skillIds, ['s1']);
  store.dispatch({ type: 'undo' });
  assert.deepEqual(agentOf(store.getState().draft, 'a2').definition.skillIds, ['s1'], 'a restore starts a new version, so undo does not go back past it');
  assert.equal(store.getState().draft.versions, store.getState().committed.versions);
  const broken: World = { ...makeWorld(), versions: [{ id: 'vx', parentId: null, counter: 1, label: 'x', snapshotJson: '{not json' }] };
  const s2 = createStore(broken); s2.dispatch({ type: 'restore', versionId: 'vx' });
  assert.equal(s2.getState().committed.versions.length, 1);
  const wrong: World = { ...makeWorld(), versions: [{ id: 'vy', parentId: null, counter: 1, label: 'y', snapshotJson: '{"items": 5}' }] };
  const s3 = createStore(wrong); s3.dispatch({ type: 'restore', versionId: 'vy' });
  assert.equal(s3.getState().committed.versions.length, 1);
});

test('subscribe is told after each real change, can stop, and a no-op tells nobody', () => {
  const store = createStore(makeWorld()); const seen: number[] = [];
  const stop = store.subscribe(() => { seen.push(store.getState().undoStack.length); });
  store.dispatch({ type: 'attachSkill', agentId: 'a2', skillId: 's1' }); store.dispatch({ type: 'attachSkill', agentId: 'a2', skillId: 's1' });
  assert.deepEqual(seen, [1]);
  stop(); store.dispatch({ type: 'attachSkill', agentId: 'a2', skillId: 's2' });
  assert.deepEqual(seen, [1]);
});

test('the reducer is pure and deterministic: the same actions on two stores give the same JSON, and the reducer changes no input', () => {
  const actions: StoreAction[] = [
    { type: 'attachSkill', agentId: 'a2', skillId: 's1' }, { type: 'attachTool', agentId: 'a2', toolId: 't1', access: 'read-write' },
    { type: 'setOverride', scopeId: 'proj', itemId: 's2', mode: 'hide' }, { type: 'installItem', itemId: 's1', targetScopeId: 'proj' },
    { type: 'createSlice', name: 'Notes', rule: RULE, seeds: ['p1'] }, { type: 'pinSlice', sliceId: 'slice-1' }, { type: 'apply', label: 'a' },
    { type: 'undo' }, { type: 'redo' }, { type: 'restore', versionId: 'v1' },
  ];
  const a = createStore(makeWorld()), b = createStore(makeWorld());
  for (const action of actions) { a.dispatch(action); b.dispatch(action); }
  assert.equal(JSON.stringify(a.getState()), JSON.stringify(b.getState()));
  const state = a.getState(), frozen = JSON.stringify(state);
  const next = reduceStore(state, { type: 'attachSkill', agentId: 'a2', skillId: 's2' });
  assert.notEqual(next, state); assert.equal(JSON.stringify(state), frozen);
  assert.equal(reduceStore(next, { type: 'undo' }) === next, false); assert.equal(JSON.stringify(state), frozen);
});

test('a large world stays quick: 10,000 pages, 2,000 edits', () => {
  const w = makeWorld();
  const pages = Array.from({ length: 10000 }, (_, i) => ({ ...w.wikiPages[0]!, id: `x${i}`, links: [`x${(i + 1) % 10000}`] }));
  const store = createStore({ ...w, wikiPages: pages });
  const started = performance.now();
  for (let i = 0; i < 2000; i += 1) store.dispatch({ type: i % 2 === 0 ? 'attachSkill' : 'detachSkill', agentId: 'a2', skillId: 's1' });
  store.dispatch({ type: 'createSlice', name: 'Big', rule: { folders: ['notes'], pageTypesAndTags: { types: [], tags: [] }, linksFromSeeds: null } });
  store.dispatch({ type: 'pinSlice', sliceId: 'slice-1' });
  assert.equal(store.getState().draft.slices[0]!.pinnedPageIds!.length, 10000);
  assert.ok(performance.now() - started < 5000, 'under five seconds');
});

test('special characters in names survive unchanged', () => {
  const store = createStore(makeWorld());
  store.dispatch({ type: 'createSlice', name: "Réseau \u{1F33F} '; DROP TABLE slices; --", rule: RULE });
  assert.equal(store.getState().draft.slices[0]!.name, "Réseau \u{1F33F} '; DROP TABLE slices; --");
});

test('the store source reads no clock and no random number, and touches no window or file', () => {
  for (const f of ['store.ts', 'common.ts', 'slicematch.ts']) {
    const text = readFileSync(join(DESKTOP, 'shared', 'world', f), 'utf8');
    for (const word of ['Date.', 'new Date', 'Math.random', 'window.bowerloom', 'node:fs', 'innerHTML', 'performance.now', 'crypto']) assert.equal(text.includes(word), false, `${f} contains ${word}`);
    assert.doesNotMatch(text, /from ['"]node:/, f);
  }
});
