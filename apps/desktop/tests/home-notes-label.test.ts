// A set of notes that a person chose is named by what it holds ("Meetings and Travel notes", "169 notes it can read."), not by the agent that reads it (fix list item 6).
// The card on the shelf and the sentence on the Save bar use the same name. The set keeps its stored name; only the words on screen change.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore, reduceStore } from '../shared/world/store.js';
import type { StoreState } from '../shared/world/store.js';
import { generateWorld } from '../shared/world/sample.js';
import type { AgentItem, Slice, World } from '../shared/world/types.js';
import { matchPages } from '../shared/world/slicerule.js';
import { chooseNotesAction } from '../shared/home/notes-actions.js';
import { EMPTY_SELECTION, makeBasis, toChoice, toggleHand, toggleTopic } from '../shared/home/notes-model.js';
import type { Selection } from '../shared/home/notes-model.js';
import { notesLabel } from '../shared/home/notes-label.js';
import { barSentence, listChanges } from '../shared/home/changes.js';
import { agentCard, shelvesOf } from '../shared/home/cards.js';
import { withStartPoint } from '../shared/home/savebar.js';
import { assertTextBudget, countWords } from '../shared/home/textbudget.js';

const base = withStartPoint(generateWorld(1));
const basis = makeBasis(base.wikiPages, undefined);
const topic = (name: string) => basis.topics.find(t => t.name === name)!;
const on = (...names: string[]): Selection => names.reduce((s, n) => toggleTopic(s, topic(n)), EMPTY_SELECTION);
const agent = (w: World, id: string): AgentItem => w.items.find((i): i is AgentItem => i.id === id)!;
const choose = (state: StoreState, id: string, sel: Selection): StoreState => reduceStore(state, chooseNotesAction(id, agentCard(agent(state.draft, id)).name, toChoice(sel, basis)));
const fresh = (): StoreState => createStore(base).getState();
const sliceOf = (w: World, id: string): Slice => w.slices.find(s => s.id === agent(w, id).definition.sliceId)!;
const countOf = (s: Slice, w: World): number => matchPages(s.rule, s.seeds, w.wikiPages).size;

test('one topic: "Travel notes", and the hint counts what the agent can read', () => {
  const s = choose(fresh(), 'agent-05', on('Travel'));
  const label = notesLabel(sliceOf(s.draft, 'agent-05'), s.draft.wikiPages)!;
  assert.equal(label.name, 'Travel notes');
  assert.equal(label.hint, `${topic('Travel').count} notes it can read.`);
});

test('two topics are joined with "and", the biggest first: "Meetings and Travel notes", with the number of notes they hold together', () => {
  const s = choose(fresh(), 'agent-05', on('Travel', 'Meetings'));
  const slice = sliceOf(s.draft, 'agent-05');
  const label = notesLabel(slice, s.draft.wikiPages)!;
  assert.equal(label.name, 'Meetings and Travel notes');
  assert.equal(label.hint, `${countOf(slice, s.draft)} notes it can read.`);
  assert.equal(countOf(slice, s.draft), topic('Meetings').count + topic('Travel').count);
});

test('up to three topics are listed, biggest first: "Meetings, Money and Travel notes"; more than three: the first and a count, "Meetings and 3 more notes"', () => {
  const s = choose(fresh(), 'agent-05', on('Travel', 'Meetings', 'Money'));
  assert.equal(notesLabel(sliceOf(s.draft, 'agent-05'), s.draft.wikiPages)!.name, 'Meetings, Money and Travel notes');
  const four = choose(fresh(), 'agent-05', on('Travel', 'Meetings', 'Money', 'Clients'));
  assert.equal(notesLabel(sliceOf(four.draft, 'agent-05'), four.draft.wikiPages)!.name, 'Meetings and 3 more notes');
  const five = choose(fresh(), 'agent-05', on('Travel', 'Meetings', 'Money', 'Clients', 'Work'));
  assert.equal(notesLabel(sliceOf(five.draft, 'agent-05'), five.draft.wikiPages)!.name, 'Work and 4 more notes');
});

test('a name is never more than five words, and a hint never more than twelve', () => {
  const names = ['Clients', 'Company', 'Work', 'Meetings', 'Research', 'Writing', 'Money', 'Travel'];
  for (let n = 1; n <= names.length; n += 1) {
    const s = choose(fresh(), 'agent-05', on(...names.slice(0, n)));
    const label = notesLabel(sliceOf(s.draft, 'agent-05'), s.draft.wikiPages)!;
    assert.ok(countWords(label.name) <= 5, label.name); assert.ok(countWords(label.hint) <= 12, label.hint);
    assert.deepEqual(assertTextBudget(`<h3>${label.name}</h3><p>${label.hint}</p>`), [], label.name);
  }
  // A long topic name falls back to a count rather than running past five words.
  const long = { ...sliceOf(choose(fresh(), 'agent-05', on('Travel', 'Meetings')).draft, 'agent-05') };
  const pages = base.wikiPages.map(p => (p.folder.startsWith('marrowdeep') ? { ...p, folder: p.folder.replace('marrowdeep', 'one-two-three-four-five-six') } : p));
  const fallback = notesLabel({ ...long, rule: { ...long.rule, folders: ['sedgefield', 'one-two-three-four-five-six'] } }, pages)!;
  assert.ok(countWords(fallback.name) <= 5, fallback.name);
});

test('one note is "1 note it can read."; notes picked by hand alone are "Notes you picked"', () => {
  const only = toggleHand(EMPTY_SELECTION, base.wikiPages[0]!.id);
  const s = choose(fresh(), 'agent-05', only);
  const label = notesLabel(sliceOf(s.draft, 'agent-05'), s.draft.wikiPages)!;
  assert.equal(label.name, 'Notes you picked'); assert.equal(label.hint, '1 note it can read.');
});

test('the shelf card and the Save bar sentence say the same name, and the stored name is untouched', () => {
  const s = choose(fresh(), 'agent-05', on('Travel', 'Meetings'));
  const slice = sliceOf(s.draft, 'agent-05');
  assert.equal(slice.name, 'Report builder notes', 'the set keeps the name the store gave it');
  const [note] = shelvesOf(s.draft, agent(s.draft, 'agent-05')).notes;
  assert.deepEqual({ name: note!.name, hint: note!.hint }, { name: 'Meetings and Travel notes', hint: `${countOf(slice, s.draft)} notes it can read.` });
  assert.equal(barSentence(listChanges(s.committed, s.draft), 1), 'Added Meetings and Travel notes to Report builder');
});

test('a sample set that nobody edited keeps its own plain words, and an edited one stops using them', () => {
  const [before] = shelvesOf(base, agent(base, 'agent-01')).notes;
  assert.equal(before!.name, 'Client list');
  const edited = choose(fresh(), 'agent-01', on('Travel'));
  const [after] = shelvesOf(edited.draft, agent(edited.draft, 'agent-01')).notes;
  assert.equal(after!.name, 'Travel notes');
});

test('a set chosen by kind, tag or link has no short honest name, so it keeps the one it has', () => {
  const kinds: Slice = { id: 's1', name: 'Reading list', seeds: [], pinned: false, rule: { folders: [], pageTypesAndTags: { types: ['guide'], tags: [] }, linksFromSeeds: null } };
  assert.equal(notesLabel(kinds, base.wikiPages), null);
  const mixed: Slice = { ...kinds, seeds: [base.wikiPages[0]!.id] };
  assert.equal(notesLabel(mixed, base.wikiPages), null, 'a hand pick next to a kind rule is not "notes you picked"');
  const empty: Slice = { ...kinds, rule: { folders: [], pageTypesAndTags: { types: [], tags: [] }, linksFromSeeds: null } };
  assert.equal(notesLabel(empty, base.wikiPages), null);
});
