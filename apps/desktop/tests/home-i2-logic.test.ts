// Slice I2: the pure logic that joins the Add drawer, the copies dialog and the save points to the real shell.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore, reduceStore } from '../shared/proto/store.js';
import type { StoreState } from '../shared/proto/store.js';
import { distinctTexts } from '../shared/proto/conflicts.js';
import type { Bundle, World } from '../shared/proto/types.js';
import { buildBundle } from '../shared/proto/bundle.js';
import { generateWorld } from '../shared/proto/sample.js';
import { ownedAgents, shelvesOf } from '../shared/home/cards.js';
import { hasCopies } from '../shared/home/add-copies.js';
import { changeCount, withStartPoint } from '../shared/home/savebar.js';
import { SAMPLE_COPY_SKILL, withSampleCopies } from '../shared/home/sample-copies.js';
import { entriesFor } from '../shared/home/add-model.js';
import { plainHintOf, plainNameOf } from '../shared/home/plain-names.js';
import { BAR_LIMIT, barSentence, listChanges } from '../shared/home/changes.js';
import { POINT_WORDS, describeChanges, manyChanged, pointName, savePointRows, whenOf } from '../shared/home/points.js';
import { WORDS } from '../renderer/home/words.js';
import { assertTextBudget, bannedIn, countWords } from '../shared/home/textbudget.js';
import { goBackAction, importFileAction, removeAction, saveAction } from '../renderer/home/store-actions.js';
import { addAction } from '../shared/home/add-model.js';
import { libraryChangeList } from '../shared/home/library-changes.js';

const home = (): World => withStartPoint(withSampleCopies(generateWorld(1)));
const start = (): StoreState => createStore(home()).getState();
const agentByPlain = (world: World, plain: string) => ownedAgents(world).find(a => plainNameOf(world)(a.name) === plain)!;

// ---- importFileAction: the store's own action for a shared file.
test('importFileAction adds the bundle to the draft as one change, saves nothing, and an empty import returns the very same state', () => {
  const world = generateWorld(1);
  const bundle: Bundle = buildBundle(world, ['global']);
  const small: World = { ...world, items: world.items.filter(i => i.id !== 'skill-005'), slices: world.slices };
  const state = createStore(small).getState();
  const next = reduceStore(state, importFileAction(bundle));
  assert.notEqual(next, state);
  assert.equal(next.committed, state.committed);
  assert.equal(next.undoStack.length, state.undoStack.length + 1);
  assert.ok(next.draft.items.length >= state.draft.items.length);
  const again = reduceStore(next, importFileAction(bundle));
  assert.equal(again.draft.items.length, next.draft.items.length, 'the same file twice adds nothing more');
  const empty: Bundle = { scopeIds: [], items: [], toolRefs: [], sliceRules: [] };
  assert.equal(reduceStore(state, importFileAction(empty)), state);
});

// ---- The sample world of the home view.
test('seed 1 has one real conflict, on a skill no agent holds; the home world adds one more, on a skill an agent holds, and leaves sample.ts alone', () => {
  const plain = generateWorld(1);
  const real = plain.items.filter(i => distinctTexts(i) >= 2).map(i => i.id);
  assert.deepEqual(real, ['skill-triple']);
  assert.equal(ownedAgents(plain).some(a => a.definition.skillIds.includes('skill-triple')), false);
  const world = withSampleCopies(plain);
  assert.deepEqual(world.items.filter(i => distinctTexts(i) >= 2).map(i => i.id).sort(), ['skill-triple', SAMPLE_COPY_SKILL].sort());
  assert.equal(distinctTexts(world.items.find(i => i.id === SAMPLE_COPY_SKILL)!), 2);
  assert.ok(ownedAgents(world).some(a => a.definition.skillIds.includes(SAMPLE_COPY_SKILL)));
  assert.equal(plain.items.find(i => i.id === SAMPLE_COPY_SKILL)!.foundAt.length, 1, 'the input is not changed');
  assert.deepEqual(withSampleCopies(world), world, 'a second pass changes nothing');
  assert.equal(JSON.stringify(withSampleCopies(generateWorld(1))), JSON.stringify(world), 'deterministic');
});

test('the conflicted skill shows its badge on the shelf of the agent that holds it, and Keep this copy clears it and counts as a change', () => {
  const world = home();
  const holder = ownedAgents(world).find(a => a.definition.skillIds.includes(SAMPLE_COPY_SKILL))!;
  const entry = shelvesOf(world, holder).skills.find(s => s.id === SAMPLE_COPY_SKILL)!;
  assert.equal(entry.badge?.label, '2 different copies');
  assert.equal(hasCopies(world.items.find(i => i.id === SAMPLE_COPY_SKILL)!), true);
  const state = start();
  assert.equal(changeCount(state.committed, state.draft), 0);
  const kept = reduceStore(state, { type: 'resolveConflict', itemId: SAMPLE_COPY_SKILL, keep: 0 });
  assert.equal(shelvesOf(kept.draft, holder).skills.find(s => s.id === SAMPLE_COPY_SKILL)!.badge, undefined);
  assert.equal(changeCount(kept.committed, kept.draft), 1);
});

// ---- The plain layer on the drawer.
test('plainNameOf turns every sample name into the plain one and falls back to words for a name it does not know', () => {
  const world = home();
  const nameOf = plainNameOf(world);
  const meeting = world.items.find(i => i.id === 'agent-01')!;
  assert.equal(nameOf(meeting.name), 'Meeting assistant');
  assert.equal(nameOf(world.items.find(i => i.id === 'skill-022')!.name), 'Write a reply');
  assert.equal(nameOf(world.slices.find(s => s.id === 'slice-folders')!.name), 'Client list');
  assert.equal(nameOf('study-buddy'), 'Study Buddy');
  assert.equal(nameOf('Summarize a meeting'), 'Summarize a meeting');
});

test('the drawer lists plain names and hints for skills, tools and notes, with the real copies badge', () => {
  const world = home();
  const nameOf = plainNameOf(world);
  for (const tab of ['skills', 'tools', 'notes'] as const) {
    const entries = entriesFor(world, tab, nameOf, plainHintOf);
    assert.ok(entries.length > 0, tab);
    for (const e of entries) {
      assert.doesNotMatch(e.name, /^[a-z]+-[a-z]+$/, `${tab}: ${e.name}`);
      assert.ok(countWords(e.name) <= 5 && countWords(e.hint) <= 12, `${e.name}: ${e.hint}`);
    }
  }
  const skills = entriesFor(world, 'skills', nameOf, plainHintOf);
  assert.equal(skills.find(e => e.id === 'skill-022')!.hint, 'Drafts a reply in your voice for you to check.');
  assert.equal(skills.find(e => e.id === SAMPLE_COPY_SKILL)!.badge?.label, '2 different copies');
  assert.equal(skills.find(e => e.id === 'skill-triple')!.badge?.label, '3 different copies');
  assert.equal(entriesFor(world, 'notes', nameOf, plainHintOf).find(e => e.id === 'slice-seeds')!.hint, 'How you like your writing to sound and look.');
});

// ---- The Save bar says what changed.
const sentence = (state: StoreState): string | null => barSentence(listChanges(state.committed, state.draft), changeCount(state.committed, state.draft));
const act = (state: StoreState, ...actions: Parameters<typeof reduceStore>[1][]): StoreState => actions.reduce(reduceStore, state);

test('one change: "Removed Write a reply"; one add: "Added Sort mail by topic to Inbox sorter"; one kept copy: "Kept one copy of Sort mail by topic"', () => {
  const s = start();
  const inbox = agentByPlain(s.draft, 'Inbox sorter');
  assert.equal(sentence(act(s, removeAction(inbox.id, 'skill', 'skill-022'))), 'Removed Write a reply');
  assert.equal(sentence(act(s, addAction(inbox.id, { id: 'skill-005', kind: 'skill', name: '', hint: '', ready: false })!)), 'Added Find a file to Inbox sorter');
  assert.equal(sentence(act(s, { type: 'resolveConflict', itemId: SAMPLE_COPY_SKILL, keep: 0 })), 'Kept one copy of Sort mail by topic');
  assert.equal(sentence(s), null);
});

test('two changes are joined in one short sentence; three or more say "N changes"; the sentence never passes 12 words', () => {
  const s = start();
  const inbox = agentByPlain(s.draft, 'Inbox sorter');
  const two = act(s, removeAction(inbox.id, 'skill', 'skill-022'), addAction(inbox.id, { id: 'skill-005', kind: 'skill', name: '', hint: '', ready: false })!);
  assert.equal(sentence(two), 'Removed Write a reply and added Find a file to Inbox sorter');
  const same = act(s, removeAction(inbox.id, 'skill', 'skill-022'), removeAction(inbox.id, 'skill', 'skill-006'));
  assert.equal(sentence(same), 'Removed Flag urgent mail and Write a reply');
  const bothAdded = act(s, addAction(inbox.id, { id: 'skill-005', kind: 'skill', name: '', hint: '', ready: false })!, addAction(inbox.id, { id: 'skill-008', kind: 'skill', name: '', hint: '', ready: false })!);
  assert.equal(sentence(bothAdded), 'Added Find a file and Rename my files to Inbox sorter');
  const meeting = agentByPlain(s.draft, 'Meeting assistant');
  const apart = act(s, addAction(inbox.id, { id: 'skill-017', kind: 'skill', name: '', hint: '', ready: false })!, addAction(meeting.id, { id: 'skill-019', kind: 'skill', name: '', hint: '', ready: false })!);
  assert.equal(sentence(apart), 'Added Check a link and Answer a common question to 2 agents', 'two adds to two agents: the long form passes 12 words, so the short one is said, and it still says where (Wave E: it used to drop the agents)');
  const three = act(two, removeAction(inbox.id, 'skill', 'skill-006'));
  assert.equal(sentence(three), null, 'from three on the bar says "3 changes"');
  const long = act(s, removeAction(inbox.id, 'skill', 'skill-036'), addAction(inbox.id, { id: 'skill-012', kind: 'skill', name: '', hint: '', ready: false })!);
  const text = sentence(long)!;
  assert.ok(countWords(text) <= BAR_LIMIT, text);
  assert.equal(bannedIn(text), null);
});

test('a tool and a note: removing and adding read the same way', () => {
  const s = start();
  const meeting = agentByPlain(s.draft, 'Meeting assistant');
  assert.equal(sentence(act(s, removeAction(meeting.id, 'tool', 'tool-mcp-missing'))), 'Removed Read my calendar');
  assert.equal(sentence(act(s, removeAction(meeting.id, 'note', 'slice-folders'))), 'Removed Client list');
  assert.equal(sentence(act(s, { type: 'assignSlice', agentId: meeting.id, sliceId: 'slice-seeds' })), 'Added Style guide to Meeting assistant');
});

test('the list of changes is as long as the count, so the sentence and the number never disagree', () => {
  const s = start();
  const inbox = agentByPlain(s.draft, 'Inbox sorter');
  const state = act(s, removeAction(inbox.id, 'skill', 'skill-022'), removeAction(inbox.id, 'skill', 'skill-006'), { type: 'resolveConflict', itemId: SAMPLE_COPY_SKILL, keep: 0 });
  assert.equal(listChanges(state.committed, state.draft).length, changeCount(state.committed, state.draft));
});

// ---- The save points.
test('the save points list the first point, then one per save, newest first, with "just now" on the newest', () => {
  let s = start();
  const inbox = agentByPlain(s.draft, 'Inbox sorter');
  const nameOf = plainNameOf(s.draft);
  assert.deepEqual(savePointRows(s.committed, nameOf).map(r => [r.name, r.when, r.current]), [['How it started', 'just now', true]]);
  s = act(s, removeAction(inbox.id, 'skill', 'skill-022'));
  s = act(s, saveAction('Removed Write a reply'));
  s = act(s, addAction(inbox.id, { id: 'skill-005', kind: 'skill', name: '', hint: '', ready: false })!);
  s = act(s, saveAction('Added Find a file to Inbox sorter'));
  const rows = savePointRows(s.committed, nameOf);
  assert.deepEqual(rows.map(r => r.name), ['Added Find a file to Inbox sorter', 'Removed Write a reply', 'How it started']);
  assert.deepEqual(rows.map(r => r.when), ['just now', '1 save ago', 'when you began']);
  assert.deepEqual(rows.map(r => r.current), [true, false, false]);
  assert.equal(rows[0]!.changes, 'Changed Inbox sorter');
  assert.equal(rows[2]!.changes, 'Your agents as Bowerloom found them.');
});

test('going back adds a point named for the one it returns to, and the change line reads in plain words', () => {
  let s = start();
  const inbox = agentByPlain(s.draft, 'Inbox sorter');
  const nameOf = plainNameOf(s.draft);
  s = act(s, removeAction(inbox.id, 'skill', 'skill-022'), saveAction('Removed Write a reply'));
  s = act(s, goBackAction(s.committed.versions[0]!.id));
  const rows = savePointRows(s.committed, nameOf);
  assert.equal(rows[0]!.name, 'Went back to How it started');
  assert.equal(rows[0]!.current, true);
  assert.equal(rows[0]!.changes, 'Changed Inbox sorter');
  for (const r of rows) {
    assert.ok(countWords(r.name) <= 8 && countWords(r.changes) <= 12 && countWords(r.when) <= 5, JSON.stringify(r));
    assert.equal(bannedIn(`${r.name} ${r.when} ${r.changes}`), null, JSON.stringify(r));
  }
});

test('a point with many changes says how many; a point that added or removed things names them', () => {
  const s = start();
  const nameOf = plainNameOf(s.draft);
  const meeting = agentByPlain(s.draft, 'Meeting assistant');
  const research = agentByPlain(s.draft, 'Research assistant');
  const inbox = agentByPlain(s.draft, 'Inbox sorter');
  const saved = act(s, removeAction(meeting.id, 'skill', 'skill-042'), removeAction(research.id, 'skill', 'skill-024'), removeAction(inbox.id, 'skill', 'skill-006'), saveAction('3 changes'));
  assert.equal(savePointRows(saved.committed, nameOf)[0]!.changes, '3 things changed');
});

// ---- The words of the new parts obey the text budget.
test('the save point words, the drawer words and the bar sentences stay within the budget', () => {
  const said = [
    'Removed Write a reply', 'Added Find a file to Inbox sorter', 'Kept one copy of Sort mail by topic', 'Removed Write a reply and Flag urgent mail',
  ];
  const built = [...Object.values(POINT_WORDS), whenOf(0), whenOf(1), whenOf(9), manyChanged(3), manyChanged(12), WORDS.label.goBackToThis, WORDS.hint.pointsDirty, WORDS.hint.pointHere, ...said];
  for (const text of built) { assert.ok(countWords(text) <= 12, text); assert.equal(bannedIn(text), null, text); assert.deepEqual(assertTextBudget(`<p>${text}</p>`), [], text); }
  assert.ok(countWords(WORDS.label.goBackToThis) <= 5);
  assert.equal(whenOf(1), '1 save ago');
  assert.equal(whenOf(3), '3 saves ago');
  assert.equal(pointName('Restored: Restored: How it started'), 'Went back to Went back to How it started');
});

// ---- Wave E, group J: the changes are named, never only counted.
test('describeChanges names what changed in one line of at most twelve words, for one change, two, and a run of many', () => {
  const removed = (what: string) => ({ verb: 'removed', what }) as const, added = (what: string, to?: string) => ({ verb: 'added', what, ...(to === undefined ? {} : { to }) }) as const;
  assert.equal(describeChanges([]), null);
  assert.equal(describeChanges([removed('List action items')]), 'Removed List action items');
  assert.equal(describeChanges([removed('Write a reply'), removed('List action items')]), 'Removed Write a reply and List action items');
  assert.equal(describeChanges([removed('A'), removed('B'), removed('C')]), 'Removed A, B and 1 more');
  assert.equal(describeChanges([removed('A'), removed('B'), removed('C'), removed('D'), removed('E')]), 'Removed A, B and 3 more');
  assert.equal(describeChanges([removed('A'), added('B', 'Inbox sorter'), removed('C')]), 'Removed A, added B and 1 more');
  // A name so long that two names do not fit in twelve words leaves one name and a count, and never passes the limit.
  const long = 'One two three four five';
  const text = describeChanges([removed(long), removed(long), removed(long)])!;
  assert.ok(countWords(text) <= 12, text); assert.equal(text, `Removed ${long} and 2 more`);
  for (const n of [1, 2, 3, 4, 9, 40]) {
    const line = describeChanges(Array.from({ length: n }, (_, i) => removed(`Thing number ${i + 1}`)));
    if (line === null) continue;
    assert.ok(countWords(line) <= 12, line); assert.deepEqual(assertTextBudget(`<p>${line}</p>`), [], line); assert.equal(bannedIn(line), null, line);
  }
});

test('a save of three changes is named for them, so the history does not list "3 changes"', () => {
  const s = start(), nameOf = plainNameOf(s.draft);
  const meeting = agentByPlain(s.draft, 'Meeting assistant'), research = agentByPlain(s.draft, 'Research assistant'), inbox = agentByPlain(s.draft, 'Inbox sorter');
  let next = act(s, removeAction(meeting.id, 'skill', 'skill-042'), removeAction(research.id, 'skill', 'skill-024'), removeAction(inbox.id, 'skill', 'skill-006'));
  const label = describeChanges(libraryChangeList(next.committed, next.draft))!;
  assert.match(label, /^Removed .+, .+ and 1 more$/);
  next = act(next, saveAction(label, 'Today, 8:42 AM'));
  const row = savePointRows(next.committed, nameOf)[0]!;
  assert.equal(row.name, label);
  assert.equal(row.madeAt, 'Today, 8:42 AM');
});
