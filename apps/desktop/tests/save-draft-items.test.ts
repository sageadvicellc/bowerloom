// The draft of the save sheet for two window items: "Stop using these notes" (a remove-source edit of a saved source) and a skill copied from another
// folder (an add-skill edit by folder id). Plain data: the draft becomes closed edits by id, and the editor draws the harness as the draft would make it.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EMPTY_DRAFT, attachNotes, canCopy, copySkill, draftCount, draftEdits, draftView, linkSkill, removeSkill, stopSource, stoppedSources,
} from '../shared/harness/save-draft.js';
import type { SkillCopy } from '../shared/harness/save-draft.js';
import { notesCards } from '../renderer/harness/notes/notes-logic.js';
import type { DefinitionView, SourceView } from '../shared/engine/types.js';

const NOTES: SourceView = { name: 'notes', kind: 'wiki-folder', label: '~/Documents/notes', notesId: 'notes-1' };
const BOOKS: SourceView = { name: 'books', kind: 'wiki-folder', label: '~/Documents/books', notesId: 'notes-2' };
const BASE: DefinitionView = {
  id: 'team', description: 'A team.', engines: ['claude-code', 'codex'], instructions: true,
  skills: [{ id: 'outline', name: 'outline', description: 'Outlines.' }, { id: 'review', name: 'review', description: 'Reviews.' }],
  agents: [
    { id: 'reader', name: 'reader', description: 'Reads.', skills: [], notes: ['notes'] },
    { id: 'writer', name: 'writer', description: 'Writes.', skills: ['review'], notes: ['notes', 'books'] },
  ],
  sources: [NOTES, BOOKS], kits: [],
};
const SUMMARIZE: SkillCopy = { id: 'summarize', from: 'folder-2', fromLabel: '~/Projects/source', name: 'summarize', description: 'Summarizes a page.' };

// ---- stop using notes

test('stopping a saved source is one remove-source edit; the agents that read it drop it in the draft view, with no set-agent edit of their own', () => {
  const d = stopSource(BASE, EMPTY_DRAFT, 'notes', true);
  assert.deepEqual(draftEdits(BASE, d), [{ kind: 'remove-source', name: 'notes' }]);
  assert.equal(draftCount(BASE, d), 1);
  const now = draftView(BASE, d);
  assert.deepEqual(now.sources.map(s => s.name), ['books']);
  assert.deepEqual(now.agents.map(a => [a.id, a.notes]), [['reader', []], ['writer', ['books']]]);
  assert.deepEqual(stoppedSources(BASE, d), [{ source: NOTES, agents: ['reader', 'writer'] }]);
  // Keeping it again is no change.
  assert.deepEqual(stopSource(BASE, d, 'notes', false), { ...EMPTY_DRAFT });
  assert.equal(draftCount(BASE, stopSource(BASE, d, 'notes', false)), 0);
});

test('stopping a source the harness does not hold, or one twice, changes nothing; a stopped source takes no tick, and its earlier ticks go', () => {
  assert.equal(stopSource(BASE, EMPTY_DRAFT, 'ghost', true), EMPTY_DRAFT);
  const d = stopSource(BASE, EMPTY_DRAFT, 'books', true);
  assert.equal(stopSource(BASE, d, 'books', true), d);
  assert.equal(attachNotes(BASE, d, 'reader', BOOKS, true), d, 'a stopped source is not put back on a shelf');
  // A tick made before the stop goes with it: the reader read books in the draft, and the stop takes that out too.
  const ticked = attachNotes(BASE, EMPTY_DRAFT, 'reader', BOOKS, true);
  const stopped = stopSource(BASE, ticked, 'books', true);
  assert.deepEqual(draftEdits(BASE, stopped), [{ kind: 'remove-source', name: 'books' }]);
});

test('a stop comes after the agents\' own edits, so a changed agent never names a source that is gone', () => {
  const d = stopSource(BASE, linkSkill(BASE, EMPTY_DRAFT, 'reader', 'outline', true), 'notes', true);
  assert.deepEqual(draftEdits(BASE, d), [{ kind: 'set-agent', id: 'reader', skills: ['outline'] }, { kind: 'remove-source', name: 'notes' }]);
});

test('the Notes panel keeps a stopped source\'s card, marked, so the person can keep using it again', () => {
  const d = stopSource(BASE, EMPTY_DRAFT, 'notes', true);
  const cards = notesCards(draftView(BASE, d), [], {}, stoppedSources(BASE, d));
  assert.deepEqual(cards.map(c => [c.key, c.attached, c.stopped === true]), [['notes-2', true, false], ['notes-1', true, true]]);
  assert.deepEqual(cards.find(c => c.key === 'notes-1')!.readers, ['reader', 'writer'], 'the card names who loses the notes');
});

// ---- a skill copied from another folder

test('copying a skill from another folder is one add-skill edit by folder id, before the agents that link it', () => {
  const d = linkSkill(BASE, copySkill(BASE, EMPTY_DRAFT, SUMMARIZE, true), 'reader', 'summarize', true);
  assert.deepEqual(draftEdits(BASE, d), [{ kind: 'add-skill', id: 'summarize', from: 'folder-2' }, { kind: 'set-agent', id: 'reader', skills: ['summarize'] }]);
  const now = draftView(BASE, d);
  assert.deepEqual(now.skills.map(s => s.id), ['outline', 'review', 'summarize']);
  assert.deepEqual(now.agents.find(a => a.id === 'reader')!.skills, ['summarize']);
});

test('a copy is offered only for a skill id this harness does not hold or copy already; taking a copy out takes its links too', () => {
  assert.equal(canCopy(BASE, EMPTY_DRAFT, 'review'), false);
  assert.equal(canCopy(BASE, EMPTY_DRAFT, 'summarize'), true);
  const d = copySkill(BASE, EMPTY_DRAFT, SUMMARIZE, true);
  assert.equal(canCopy(BASE, d, 'summarize'), false);
  assert.equal(copySkill(BASE, d, { ...SUMMARIZE, from: 'folder-3' }, true), d, 'one id once, from one folder');
  assert.equal(copySkill(BASE, EMPTY_DRAFT, { ...SUMMARIZE, id: 'review' }, true), EMPTY_DRAFT, 'an id the harness holds is not copied over it');
  const linked = linkSkill(BASE, d, 'writer', 'summarize', true);
  const out = copySkill(BASE, linked, SUMMARIZE, false);
  assert.deepEqual(draftEdits(BASE, out), []);
  // Remove on a copied skill takes the copy out, rather than a remove-skill of a skill the harness never held.
  assert.deepEqual(draftEdits(BASE, removeSkill(BASE, linked, 'summarize', true)), []);
});

test('at most 16 copies in one draft, as main takes', () => {
  let d = EMPTY_DRAFT;
  for (let i = 0; i < 20; i += 1) d = copySkill(BASE, d, { ...SUMMARIZE, id: `copy-${i}` }, true);
  assert.equal(d.copies.length, 16);
  assert.equal(canCopy(BASE, d, 'copy-17'), false);
});
