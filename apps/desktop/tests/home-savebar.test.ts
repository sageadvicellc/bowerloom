// The Save bar model, the change count, the first save point, and the whole round trip through the real store: remove, save, go back.
import test from 'node:test';
import assert from 'node:assert/strict';
import { BAR_WORDS, changeCount, saveBar, withStartPoint } from '../shared/home/savebar.js';
import { CARD_WORDS, shelvesOf } from '../shared/home/cards.js';
import { changesCount, WORDS } from '../renderer/home/words.js';
import { barText } from '../renderer/home/save/SaveBar.js';
import { discardAction, goBackAction, removeAction, saveAction } from '../renderer/home/store-actions.js';
import { createStore, isDirty, snapshotOf } from '../shared/proto/store.js';
import { generateWorld } from '../shared/proto/sample.js';
import type { AgentItem } from '../shared/proto/types.js';
import { assertTextBudget } from '../shared/home/textbudget.js';

const fresh = () => createStore(withStartPoint(generateWorld(1)));
const agentOf = (world: { items: readonly { id: string }[] }, id: string): AgentItem => world.items.find(i => i.id === id) as AgentItem;
const count = (store: ReturnType<typeof fresh>): number => changeCount(store.getState().committed, store.getState().draft);

test('the first save point is the world as found, added once, and a world that has save points is left alone', () => {
  const w = generateWorld(1);
  const start = withStartPoint(w);
  assert.equal(start.versions.length, 1); assert.deepEqual({ ...start.versions[0]!, snapshotJson: '' }, { id: 'v1', parentId: null, counter: 1, label: CARD_WORDS.startPoint, snapshotJson: '' });
  assert.equal(start.versions[0]!.snapshotJson, snapshotOf(w));
  assert.equal(withStartPoint(start), start);
  assert.equal(snapshotOf(start), snapshotOf(w), 'the save point does not change what the world is');
  assert.equal(createStore(start).getState().headVersionId, 'v1');
  assert.equal(w.versions.length, 0, 'the input is not changed');
});

test('nothing waits at first, and removing one skill is one change', () => {
  const store = fresh();
  assert.equal(count(store), 0); assert.equal(isDirty(store.getState()), false);
  store.dispatch(removeAction('agent-01', 'skill', 'skill-042'));
  assert.equal(count(store), 1);
  assert.deepEqual(shelvesOf(store.getState().draft, agentOf(store.getState().draft, 'agent-01')).skills.map(e => e.name), ['Write a reply', 'List action items']);
});

test('each skill, tool or note taken off an agent is one change, on one agent or on several', () => {
  const store = fresh();
  store.dispatch(removeAction('agent-01', 'skill', 'skill-042')); store.dispatch(removeAction('agent-01', 'skill', 'skill-022'));
  assert.equal(count(store), 2, 'two skills off one agent are two changes, not one');
  store.dispatch(removeAction('agent-01', 'tool', 'tool-mcp-missing'));
  store.dispatch(removeAction('agent-01', 'note', 'slice-folders'));
  assert.equal(count(store), 4);
  store.dispatch(removeAction('agent-02', 'skill', 'skill-024'));
  assert.equal(count(store), 5);
  const gone = agentOf(store.getState().draft, 'agent-01').definition;
  assert.deepEqual([gone.skillIds, gone.toolAttachments, gone.sliceId], [['skill-009'], [], undefined]);
});

test('removing what is not there changes nothing, and putting the world back counts zero', () => {
  const store = fresh();
  store.dispatch(removeAction('agent-01', 'skill', 'skill-999')); store.dispatch(removeAction('agent-01', 'skill', 'skill-024')); store.dispatch(removeAction('agent-nope', 'tool', 'tool-mcp-01'));
  assert.equal(count(store), 0);
  store.dispatch(removeAction('agent-01', 'skill', 'skill-042'));
  store.dispatch({ type: 'attachSkill', agentId: 'agent-01', skillId: 'skill-042' });
  assert.equal(agentOf(store.getState().draft, 'agent-01').definition.skillIds.length, 3);
  store.dispatch(removeAction('agent-01', 'skill', 'skill-009'));
  store.dispatch({ type: 'attachSkill', agentId: 'agent-01', skillId: 'skill-009' });
  assert.equal(count(store), 1, 'a skill put back at the end moves in the list, which counts as one change');
});

test('other kinds of change count one each: a skill added to an agent, an item removed, a saved choice of pages edited, and a draft that differs counts at least one', () => {
  const store = fresh();
  store.dispatch({ type: 'attachSkill', agentId: 'agent-04', skillId: 'skill-043' });
  assert.equal(count(store), 1);
  store.dispatch({ type: 'attachTool', agentId: 'agent-04', toolId: 'tool-mcp-01', access: 'read-only' });
  assert.equal(count(store), 2);
  store.dispatch({ type: 'attachTool', agentId: 'agent-04', toolId: 'tool-mcp-01', access: 'read-write' });
  assert.equal(count(store), 2, 'the same tool with another access is still one change');
  store.dispatch({ type: 'pinSlice', sliceId: 'slice-kinds' });
  assert.ok(count(store) >= 3);
  const state = store.getState();
  assert.equal(changeCount(state.committed, state.committed), 0);
  const w = state.committed;
  assert.equal(changeCount(w, { ...w, items: w.items.slice(1) }), 1, 'an item that is gone counts one');
  assert.equal(changeCount(w, { ...w, items: [...w.items, { ...w.items[0]!, id: 'extra-1' }] }), 1, 'an item that is new counts one');
});

test('the bar is clean, dirty, saved or back, and a save or a go-back goes stale as soon as anything else happens', () => {
  assert.deepEqual(saveBar(0, 1, null), { mode: 'clean', changes: 0, canSave: false, canGoBack: false, canDiscard: false });
  assert.deepEqual(saveBar(3, 1, null), { mode: 'dirty', changes: 3, canSave: true, canGoBack: false, canDiscard: true });
  const saved = { kind: 'saved', at: 2, backTo: 'v1' } as const;
  assert.deepEqual(saveBar(0, 2, saved), { mode: 'saved', changes: 0, canSave: false, canGoBack: true, canDiscard: false });
  assert.equal(saveBar(0, 3, saved).mode, 'clean', 'another save point came after: the old "Saved" is stale');
  assert.equal(saveBar(2, 2, saved).mode, 'dirty', 'a change after a save shows the changes');
  assert.equal(saveBar(0, 2, { kind: 'saved', at: 2, backTo: null }).canGoBack, false, 'no earlier save point, no Go back');
  assert.deepEqual(saveBar(0, 3, { kind: 'back', at: 3, backTo: null }), { mode: 'back', changes: 0, canSave: false, canGoBack: false, canDiscard: false });
});

test('the words of the bar are plain, within the text budget, and built from WORDS', () => {
  assert.equal(changesCount(1), '1 change'); assert.equal(changesCount(2), '2 changes'); assert.equal(changesCount(12), '12 changes');
  assert.equal(barText(saveBar(0, 1, null)), 'Nothing to save yet'); assert.equal(barText(saveBar(1, 1, null)), '1 change'); assert.equal(barText(saveBar(4, 1, null)), '4 changes');
  assert.equal(barText(saveBar(0, 2, { kind: 'saved', at: 2, backTo: 'v1' })), 'Saved'); assert.equal(barText(saveBar(0, 3, { kind: 'back', at: 3, backTo: null })), 'Back to how it was');
  assert.equal(WORDS.label.saved, BAR_WORDS.saved); assert.equal(WORDS.label.goBack, 'Go back');
  for (const text of ['Nothing to save yet', '1 change', '25 changes', 'Saved', 'Back to how it was', 'Go back', 'Discard changes', 'Claude Code', 'Codex', 'OpenCode']) assert.deepEqual(assertTextBudget(`<p>${text}</p>`), [], text);
});

test('the round trip: remove two things, save, and the save point holds them; go back, and everything is as it was', () => {
  const store = fresh();
  const before = snapshotOf(store.getState().draft);
  store.dispatch(removeAction('agent-01', 'skill', 'skill-042')); store.dispatch(removeAction('agent-01', 'tool', 'tool-mcp-missing'));
  assert.equal(count(store), 2);
  const backTo = store.getState().headVersionId;
  store.dispatch(saveAction(changesCount(count(store))));
  const saved = store.getState();
  assert.equal(saved.committed.versions.length, 2); assert.equal(saved.committed.versions[1]!.label, '2 changes'); assert.equal(count(store), 0);
  assert.equal(agentOf(saved.draft, 'agent-01').definition.skillIds.includes('skill-042'), false);
  assert.equal(saveBar(0, saved.committed.versions.length, { kind: 'saved', at: 2, backTo }).mode, 'saved');
  store.dispatch(goBackAction(backTo!));
  const back = store.getState();
  assert.equal(back.committed.versions.length, 3, 'going back adds a save point and deletes none'); assert.equal(back.committed.versions[2]!.label, `Restored: ${CARD_WORDS.startPoint}`);
  assert.equal(snapshotOf(back.draft), before); assert.equal(count(store), 0); assert.equal(isDirty(back), false);
  assert.deepEqual(agentOf(back.draft, 'agent-01').definition.skillIds, ['skill-042', 'skill-022', 'skill-009']);
});

test('discard puts the saved world back and leaves nothing waiting', () => {
  const store = fresh();
  store.dispatch(removeAction('agent-03', 'skill', 'skill-041')); store.dispatch(removeAction('agent-03', 'note', 'slice-seeds'));
  assert.equal(count(store), 2);
  store.dispatch(discardAction());
  assert.equal(count(store), 0); assert.equal(isDirty(store.getState()), false);
  assert.equal(store.getState().committed.versions.length, 1);
});

test('a save with nothing to save, and a go-back to a save point that is not there, change nothing', () => {
  const store = fresh();
  const s0 = store.getState();
  store.dispatch(saveAction('0 changes')); store.dispatch(goBackAction('v99'));
  assert.equal(store.getState(), s0);
});
