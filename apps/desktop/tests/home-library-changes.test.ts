// What the Save bar says about changes made on the Library page: one change for one press, the names a row shows, and one sentence for a long run.
import test from 'node:test';
import assert from 'node:assert/strict';
import { reduceStore } from '../shared/proto/store.js';
import type { StoreAction, StoreState } from '../shared/proto/store.js';
import { changeCount } from '../shared/home/savebar.js';
import { listChanges } from '../shared/home/changes.js';
import { libraryChangeCount, libraryChangeList, librarySentence } from '../shared/home/library-changes.js';
import { addToAgentAction, makeOwnCopyAction, removeFromLibraryAction, planAdd, useUpdateAction } from '../shared/home/library-actions.js';
import { SAMPLE_SOURCES, defaultTicked } from '../shared/home/library-sources.js';
import { libraryDetails } from '../shared/home/library-model.js';
import { UPDATE_ITEM_ID } from '../shared/home/library-sample.js';
import { savePointRows } from '../shared/home/points.js';
import { plainNameOf } from '../shared/home/plain-names.js';
import { withStartPoint } from '../shared/home/savebar.js';
import { countWords } from '../shared/home/textbudget.js';
import { libraryWorld } from './home-library-world.js';

const start = (): StoreState => { const w = withStartPoint(libraryWorld()); return { committed: w, draft: w, undoStack: [], redoStack: [], headVersionId: w.versions[0]!.id }; };
const act = (s: StoreState, a: StoreAction | null): StoreState => { assert.ok(a !== null); return reduceStore(s, a); };
const said = (s: StoreState): { count: number; sentence: string | null; list: string[] } => {
  const list = libraryChangeList(s.committed, s.draft), count = libraryChangeCount(s.committed, s.draft);
  return { count, sentence: librarySentence(list, count), list: list.map(c => `${c.verb} ${c.what}${c.to === undefined ? '' : ` to ${c.to}`}`) };
};

test('removing a skill that three agents hold is one change, named as the row named it', () => {
  const s = act(start(), removeFromLibraryAction('skill-010'));
  assert.ok(changeCount(s.committed, s.draft) >= 4, 'the shared count counts the item and each agent');
  assert.deepEqual(said(s), { count: 1, sentence: 'Removed Compare two options', list: ['removed Compare two options'] });
});

test('removing a set of notes reads as its plain name, not the made-up name of its list item', () => {
  const s = act(start(), removeFromLibraryAction('slice-folders'));
  assert.equal(said(s).sentence, 'Removed Client list');
  assert.equal(said(s).count, 1);
});

test('removing a hook reads as its plain name', () => {
  const s = act(start(), removeFromLibraryAction('tool-hook-guard'));
  assert.equal(said(s).sentence, 'Removed Check files after editing');
});

test('adding to an agent reads "Added <name> to <agent>"', () => {
  const w = start().draft;
  const s = act(start(), addToAgentAction(w, 'skill', 'skill-003', 'agent-05'));
  assert.deepEqual(said(s), { count: 1, sentence: 'Added Translate a text to Report builder', list: ['added Translate a text to Report builder'] });
  const t = act(start(), addToAgentAction(w, 'tool', 'tool-mcp-01', 'agent-05'));
  assert.equal(said(t).count, 1);
  assert.equal(addToAgentAction(w, 'agent', 'agent-01', 'agent-05'), null);
});

test('adding seven items is seven changes in one sentence', () => {
  const w = start().draft;
  const office = SAMPLE_SOURCES[0]!;
  const s = act(start(), planAdd(w, office, defaultTicked(office)).action);
  const r = said(s);
  assert.equal(r.count, 7);
  assert.equal(r.sentence, null, 'the seventh is a change of the item that has a second copy, so the run is not all additions');
  const money = SAMPLE_SOURCES[2]!;
  const t = act(start(), planAdd(w, money, defaultTicked(money)).action);
  assert.deepEqual([said(t).count, said(t).sentence], [4, 'Added 4 items']);
  assert.ok(said(t).list.includes('added Track a bill'), 'a new item is named with its own capital letters');
});

test('an own copy and an update each read as one change', () => {
  const w = start().draft;
  const c = act(start(), makeOwnCopyAction(w, 'skill', 'skill-024'));
  assert.deepEqual(said(c), { count: 1, sentence: 'Added Find good sources (mine)', list: ['added Find good sources (mine)'] });
  const info = libraryDetails(w, 'skill', UPDATE_ITEM_ID)!.update!;
  const u = act(start(), useUpdateAction(w, 'skill', UPDATE_ITEM_ID, info));
  assert.deepEqual(said(u), { count: 1, sentence: 'Changed Tidy my meeting notes', list: ['changed Tidy my meeting notes'] });
});

test('nothing waiting counts as nothing, and a sentence never passes twelve words', () => {
  const s = start();
  assert.deepEqual(said(s), { count: 0, sentence: null, list: [] });
  const long = act(act(start(), removeFromLibraryAction('skill-010')), removeFromLibraryAction('skill-036'));
  const r = said(long);
  assert.equal(r.count, 2);
  assert.ok(r.sentence === null || countWords(r.sentence) <= 12);
  assert.equal(listChanges(s.committed, s.draft).length, 0);
});

test('the version history names a removal by what the row showed', () => {
  let s = act(start(), removeFromLibraryAction('tool-hook-guard'));
  s = reduceStore(s, { type: 'apply', label: 'Removed Check files after editing' });
  const rows = savePointRows(s.committed, plainNameOf(s.committed));
  assert.equal(rows[0]!.name, 'Removed Check files after editing');
  assert.equal(rows[0]!.changes, 'Removed Check files after editing');
});
