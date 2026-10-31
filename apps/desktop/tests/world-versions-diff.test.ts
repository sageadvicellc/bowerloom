// The difference between two versions, worked out from their snapshot texts, in the names of what changed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { diffCount, diffVersions } from '../shared/world/versions-diff.js';
import { createStore, snapshotOf } from '../shared/world/store.js';
import { CASE_IDS, generateWorld } from '../shared/world/sample.js';
import type { Version } from '../shared/world/types.js';

const world = generateWorld(1);
const store = () => createStore(world);
const versions = (s: ReturnType<typeof store>): readonly Version[] => s.getState().committed.versions;

test('identical snapshots differ in nothing', () => {
  const d = diffVersions(snapshotOf(world), snapshotOf(world));
  assert.deepEqual([d.added, d.removed, d.changed, d.unreadable], [[], [], [], false]);
  assert.equal(diffCount(d), 0);
});

test('an agent that gets a new skill is one changed item, found by its name', () => {
  const s = store();
  const agent = world.items.find(i => i.kind === 'agent' && i.library === null)!;
  const skillId = world.items.find(i => i.kind === 'skill' && i.library === null && !(agent.kind === 'agent' && agent.definition.skillIds.includes(i.id)))!.id;
  s.dispatch({ type: 'attachSkill', agentId: agent.id, skillId });
  s.dispatch({ type: 'apply', label: 'one' });
  const [v] = versions(s);
  const d = diffVersions(snapshotOf(world), v!.snapshotJson);
  assert.deepEqual(d.changed, [agent.name]);
  assert.deepEqual([d.added, d.removed], [[], []]);
  assert.equal(diffCount(d), 1);
  assert.deepEqual(d.entries, [{ change: 'changed', kind: 'agent', name: agent.name }]);
});

test('added and removed items are told apart, and the order of the two texts matters', () => {
  const s = store();
  s.dispatch({ type: 'installItem', itemId: CASE_IDS.newerLibraryItem, targetScopeId: 'global' });
  s.dispatch({ type: 'apply', label: 'copy' });
  const copyName = s.getState().committed.items.find(i => i.id === `${CASE_IDS.newerLibraryItem}-copy`)!.name;
  const forward = diffVersions(snapshotOf(world), versions(s)[0]!.snapshotJson);
  assert.deepEqual(forward.added, [copyName]);
  assert.deepEqual(forward.removed, []);
  const back = diffVersions(versions(s)[0]!.snapshotJson, snapshotOf(world));
  assert.deepEqual(back.removed, [copyName]);
  assert.deepEqual(back.added, []);
});

test('a hidden skill in a project shows as a change in words', () => {
  const s = store();
  s.dispatch({ type: 'setOverride', scopeId: 'scope-tallowbrook', itemId: CASE_IDS.hiddenSkill, mode: 'hide' });
  s.dispatch({ type: 'apply', label: 'hide' });
  const d = diffVersions(snapshotOf(world), versions(s)[0]!.snapshotJson);
  assert.equal(d.added.length, 1);
  assert.match(d.added[0]!, /Tallowbrook hides /);
  assert.equal(d.entries[0]!.kind, 'override');
  const skillName = world.items.find(i => i.id === CASE_IDS.hiddenSkill)!.name;
  assert.ok(d.added[0]!.endsWith(skillName));
});

test('a changed slice rule counts as a change to that slice', () => {
  const s = store();
  const slice = world.slices[0]!;
  s.dispatch({ type: 'updateSliceRule', sliceId: slice.id, rule: { ...slice.rule, linksFromSeeds: { hops: 1 } } });
  s.dispatch({ type: 'apply', label: 'rule' });
  const d = diffVersions(snapshotOf(world), versions(s)[0]!.snapshotJson);
  assert.deepEqual(d.changed, [slice.name]);
  assert.equal(d.entries[0]!.kind, 'slice');
});

test('names come out sorted, and the same pair always gives the same answer', () => {
  const s = store();
  const owned = world.items.filter(i => i.kind === 'skill' && i.library === null).slice(0, 3);
  for (const o of owned) s.dispatch({ type: 'installItem', itemId: o.id, targetScopeId: 'scope-copperfen' });
  s.dispatch({ type: 'apply', label: 'three' });
  const text = versions(s)[0]!.snapshotJson, one = diffVersions(snapshotOf(world), text), two = diffVersions(snapshotOf(world), text);
  assert.deepEqual(one, two);
  assert.deepEqual([...one.added], [...one.added].sort());
  assert.equal(one.added.length, 3);
});

test('a version object works as well as its text, and bad text is reported not thrown', () => {
  const s = store();
  s.dispatch({ type: 'discard' });
  assert.equal(diffCount(diffVersions({ snapshotJson: snapshotOf(world) }, { snapshotJson: snapshotOf(world) })), 0);
  for (const bad of ['', 'not json', '[]', 'null', '{"items":5}', '{}']) {
    const d = diffVersions(snapshotOf(world), bad);
    assert.equal(d.unreadable, true, bad);
    assert.deepEqual([d.added, d.removed, d.changed], [[], [], []]);
  }
  assert.equal(diffVersions('{"items":[]}', '{"items":[]}').unreadable, false, 'a snapshot with no items is readable');
});

test('restoring leaves an identical snapshot, so the difference is nothing', () => {
  const s = store();
  s.dispatch({ type: 'attachSkill', agentId: world.items.find(i => i.kind === 'agent' && i.library === null)!.id, skillId: CASE_IDS.tripleSkill });
  s.dispatch({ type: 'apply', label: 'edit' });
  s.dispatch({ type: 'restore', versionId: versions(s)[0]!.id });
  const [a, b] = versions(s);
  assert.equal(diffCount(diffVersions(a!, b!)), 0);
});
