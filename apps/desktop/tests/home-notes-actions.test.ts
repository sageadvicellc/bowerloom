// "Use these notes" is one store action and one change on the Save bar: a new saved choice, its item and the agent's pointer count once.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore, isDirty, reduceStore } from '../shared/proto/store.js';
import type { StoreState } from '../shared/proto/store.js';
import { generateWorld } from '../shared/proto/sample.js';
import { validateWorld } from '../shared/proto/sample.js';
import type { AgentItem, World } from '../shared/proto/types.js';
import { matchPages } from '../shared/proto/slicerule.js';
import { absorbedSlices, chooseNotesAction, notesName, notesWouldChange } from '../shared/home/notes-actions.js';
import { EMPTY_SELECTION, makeBasis, selectionFromSlice, toChoice, toggleHand, toggleLeaveOut, toggleTopic } from '../shared/home/notes-model.js';
import type { Selection } from '../shared/home/notes-model.js';
import { barSentence, listChanges } from '../shared/home/changes.js';
import { changeCount, withStartPoint } from '../shared/home/savebar.js';
import { agentCard, shelvesOf } from '../shared/home/cards.js';
import { removeAction, saveAction, discardAction } from '../renderer/home/store-actions.js';
import { itemTitle } from '../shared/home/cards.js';

const base = withStartPoint(generateWorld(1));
const basis = makeBasis(base.wikiPages, undefined);
const topic = (name: string) => basis.topics.find(t => t.name === name)!;
const on = (...names: string[]): Selection => names.reduce((s, n) => toggleTopic(s, topic(n)), EMPTY_SELECTION);
const agent = (w: World, id: string): AgentItem => w.items.find((i): i is AgentItem => i.id === id)!;
const sliceOf = (w: World, id: string) => w.slices.find(s => s.id === agent(w, id).definition.sliceId);
const choose = (state: StoreState, id: string, sel: Selection): StoreState => reduceStore(state, chooseNotesAction(id, agentCard(agent(state.draft, id)).name, toChoice(sel, basis)));
const fresh = (): StoreState => createStore(base).getState();

test('an agent with no notes gets a new set, named after it, and reads it', () => {
  const s = choose(fresh(), 'agent-05', on('Clients'));
  const mine = sliceOf(s.draft, 'agent-05')!;
  assert.equal(mine.name, 'Report builder notes');
  assert.deepEqual(mine.rule.folders, ['alderhythe']);
  assert.equal(matchPages(mine.rule, mine.seeds, s.draft.wikiPages).size, topic('Clients').count);
  assert.equal(s.draft.items.filter(i => i.kind === 'context-slice' && i.sliceId === mine.id).length, 1, 'one item for it');
  assert.deepEqual(validateWorld(s.draft), []);
  assert.equal(isDirty(s), true);
});

test('that is ONE change on the Save bar, and the bar says what it is', () => {
  const s = choose(fresh(), 'agent-05', on('Clients'));
  assert.equal(changeCount(s.committed, s.draft), 1);
  assert.equal(listChanges(s.committed, s.draft).length, 1);
  assert.equal(barSentence(listChanges(s.committed, s.draft), 1), 'Added Report builder notes to Report builder');
  assert.deepEqual([...absorbedSlices(s.committed, s.draft)], [sliceOf(s.draft, 'agent-05')!.id]);
});

test('one press is one step to undo, and discard puts everything back', () => {
  const s = choose(fresh(), 'agent-05', on('Clients'));
  assert.equal(s.undoStack.length, 1);
  const undone = reduceStore(s, { type: 'undo' });
  assert.equal(undone.draft, s.committed);
  assert.equal(isDirty(undone), false);
  const discarded = reduceStore(s, discardAction());
  assert.equal(changeCount(discarded.committed, discarded.draft), 0);
  assert.equal(sliceOf(discarded.draft, 'agent-05'), undefined);
});

test('choosing again before saving changes the same set in place: still one change, no stray set', () => {
  const first = choose(fresh(), 'agent-05', on('Clients'));
  const second = choose(first, 'agent-05', on('Money', 'Travel'));
  assert.equal(second.draft.slices.length, base.slices.length + 1);
  assert.equal(second.draft.items.filter(i => i.kind === 'context-slice').length, base.items.filter(i => i.kind === 'context-slice').length + 1);
  assert.equal(changeCount(second.committed, second.draft), 1);
  assert.deepEqual(sliceOf(second.draft, 'agent-05')!.rule.folders, ['cinderlow', 'marrowdeep']);
  assert.equal(choose(first, 'agent-05', on('Clients')), first, 'the same choice changes nothing');
});

test('an agent that reads a set nobody else reads changes that set in place', () => {
  const before = sliceOf(base, 'agent-02')!;                       // "Reading list", read by one agent
  const s = choose(fresh(), 'agent-02', on('Money'));
  const after = sliceOf(s.draft, 'agent-02')!;
  assert.equal(after.id, before.id);
  assert.equal(after.name, before.name);
  assert.deepEqual(after.rule.folders, ['cinderlow']);
  assert.equal(s.draft.slices.length, base.slices.length);
  assert.equal(changeCount(s.committed, s.draft), 1);
  assert.deepEqual(listChanges(s.committed, s.draft), [{ verb: 'changed', what: 'Reading list' }]);
});

test('an agent that shares its set gets a set of its own; the other agent keeps the old one', () => {
  const shared = agent(base, 'agent-01').definition.sliceId;
  assert.equal(agent(base, 'agent-04').definition.sliceId, shared);
  const s = choose(fresh(), 'agent-01', on('Money'));
  assert.notEqual(agent(s.draft, 'agent-01').definition.sliceId, shared);
  assert.equal(agent(s.draft, 'agent-04').definition.sliceId, shared);
  assert.deepEqual(s.draft.slices.find(x => x.id === shared), base.slices.find(x => x.id === shared), 'the shared set is not touched');
  assert.equal(changeCount(s.committed, s.draft), 1);
  assert.equal(barSentence(listChanges(s.committed, s.draft), 1), 'Added Meeting assistant notes to Meeting assistant');
});

test('hand picks and left-out parts are kept in the set (seeds and folders)', () => {
  const pick = base.wikiPages.find(p => p.folder.startsWith('fennrow/'))!.id;
  const part = topic('Work').parts[0]!.folder;
  const s = choose(fresh(), 'agent-06', toggleHand(toggleLeaveOut(on('Work'), part), pick));
  const mine = sliceOf(s.draft, 'agent-06')!;
  assert.deepEqual(mine.seeds, [pick]);
  assert.ok(!mine.rule.folders.includes(part) && mine.rule.folders.length === topic('Work').parts.length - 1);
});

test('a set saved with Save and chosen again is one change again, and Go back is not needed to tell', () => {
  const a = reduceStore(choose(fresh(), 'agent-05', on('Clients')), saveAction('Added notes'));
  assert.equal(changeCount(a.committed, a.draft), 0);
  const b = choose(a, 'agent-05', on('Money'));
  assert.equal(changeCount(b.committed, b.draft), 1, 'the saved set changes in place');
  assert.deepEqual(listChanges(b.committed, b.draft).map(c => c.verb), ['changed']);
});

test('what is refused leaves the very same state: no choice, a library agent, an unknown agent, unknown pages', () => {
  const s = fresh();
  assert.equal(choose(s, 'agent-05', EMPTY_SELECTION), s, 'an empty choice changes nothing');
  assert.equal(reduceStore(s, { type: 'chooseNotes', agentId: 'nobody', name: 'x', rule: toChoice(on('Clients'), basis).rule, seeds: [] }), s);
  const library = base.items.find(i => i.kind === 'agent' && i.library !== null);
  if (library !== undefined) assert.equal(reduceStore(s, { type: 'chooseNotes', agentId: library.id, name: 'x', rule: toChoice(on('Clients'), basis).rule, seeds: [] }), s);
  assert.equal(reduceStore(s, { type: 'chooseNotes', agentId: 'agent-05', name: '  ', rule: toChoice(on('Clients'), basis).rule, seeds: [] }), s, 'a new set needs a name');
  const onlyGhosts = reduceStore(s, { type: 'chooseNotes', agentId: 'agent-05', name: 'x', rule: toChoice(EMPTY_SELECTION, basis).rule, seeds: ['page-9999'] });
  assert.equal(onlyGhosts, s, 'pages that do not exist are not a choice');
});

test('the Remove button on the shelf still works on a new set, and it is then no change at all', () => {
  const s = choose(fresh(), 'agent-05', on('Clients'));
  const id = sliceOf(s.draft, 'agent-05')!.id;
  assert.equal(shelvesOf(s.draft, agent(s.draft, 'agent-05')).notes.length, 1);
  const removed = reduceStore(s, removeAction('agent-05', 'note', id));
  assert.equal(agent(removed.draft, 'agent-05').definition.sliceId, undefined);
  assert.equal(changeCount(removed.committed, removed.draft) >= 1, true, 'a stray set is still counted, never hidden');
});

test('an old choice comes back as switches and goes out as the same notes', () => {
  const folders = base.slices.find(s => s.id === 'slice-folders')!, b = makeBasis(base.wikiPages, folders), sel = selectionFromSlice(folders, b);
  const st = reduceStore(fresh(), chooseNotesAction('agent-05', 'Report builder', toChoice(sel, b)));
  const mine = sliceOf(st.draft, 'agent-05')!;
  assert.deepEqual([...matchPages(mine.rule, mine.seeds, base.wikiPages)].sort(), [...matchPages(folders.rule, folders.seeds, base.wikiPages)].sort());
});

test('the name of a set is the agent and "notes", at most five words', () => {
  assert.equal(notesName('Meeting assistant'), 'Meeting assistant notes');
  assert.equal(itemTitle(notesName('One two three four five six')).split(' ').length, 5);
});

// ---- Review fixes: the count after Use, Remove, Use again; a choice that changes nothing.
test('Use these notes, Remove, Use these notes again is one change and leaves no stray set (review item 1)', () => {
  const first = choose(fresh(), 'agent-01', on('Clients'));
  const strayId = sliceOf(first.draft, 'agent-01')!.id;
  const removed = reduceStore(first, removeAction('agent-01', 'note', strayId));
  assert.equal(changeCount(removed.committed, removed.draft), 1, 'a set nobody reads is not a change of its own');
  const again = choose(removed, 'agent-01', on('Money'));
  assert.equal(changeCount(again.committed, again.draft), 1);
  assert.equal(listChanges(again.committed, again.draft).length, 1);
  assert.equal(again.draft.slices.length, base.slices.length + 1, 'the unread set was used again, not a second one made');
  assert.equal(again.draft.items.filter(i => i.kind === 'context-slice').length, base.items.filter(i => i.kind === 'context-slice').length + 1);
  assert.equal(sliceOf(again.draft, 'agent-01')!.id, strayId);
  assert.deepEqual(sliceOf(again.draft, 'agent-01')!.rule.folders, ['cinderlow']);
  assert.deepEqual(validateWorld(again.draft), []);
});

test('a set that is already saved is never used again for another agent (review item 1)', () => {
  const saved = reduceStore(choose(fresh(), 'agent-05', on('Clients')), saveAction('x'));
  const savedId = sliceOf(saved.draft, 'agent-05')!.id;
  const removed = reduceStore(saved, removeAction('agent-05', 'note', savedId));
  const other = choose(removed, 'agent-06', on('Money'));
  assert.notEqual(sliceOf(other.draft, 'agent-06')!.id, savedId, 'the saved set keeps its rule');
  assert.deepEqual(other.draft.slices.find(s => s.id === savedId), saved.draft.slices.find(s => s.id === savedId));
});

test('a new set that no agent reads counts as no change of its own, but a differing draft still counts one (review item 1)', () => {
  const first = choose(fresh(), 'agent-05', on('Clients'));
  const removed = reduceStore(first, removeAction('agent-05', 'note', sliceOf(first.draft, 'agent-05')!.id));
  assert.equal(listChanges(removed.committed, removed.draft).length, 0);
  assert.equal(changeCount(removed.committed, removed.draft), 1, 'never hidden');
});

test('"would it change anything" is false for a choice that leaves every part out, and true for a real one (review item 4)', () => {
  const t = topic('Work');
  const leftAll = t.parts.reduce((s, p) => toggleLeaveOut(s, p.folder), on('Work'));
  assert.equal(notesWouldChange(base, 'agent-05', 'Report builder', toChoice(leftAll, basis)), false);
  assert.equal(notesWouldChange(base, 'agent-05', 'Report builder', toChoice(on('Work'), basis)), true);
  const s = choose(fresh(), 'agent-05', on('Clients'));
  assert.equal(notesWouldChange(s.draft, 'agent-05', 'Report builder', toChoice(on('Clients'), basis)), false, 'the same choice again');
  assert.equal(notesWouldChange(base, 'nobody', 'x', toChoice(on('Work'), basis)), false);
});
