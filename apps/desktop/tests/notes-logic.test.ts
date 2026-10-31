// The logic behind the notes step and the Notes panel: what happens after a folder is chosen (history or not), the cards the panel and the map show (each
// source of the harness, then each chosen folder not attached yet), who reads each one, and how far the keeper build is, for the tour's waiting step.
import test from 'node:test';
import assert from 'node:assert/strict';
import { afterChoose, buildProgress, notesCards } from '../renderer/harness/notes/notes-logic.js';
import { EMPTY_DRAFT, KEEPER_AGENT, attachNotes, draftView } from '../shared/harness/save-draft.js';
import type { DefinitionView, NotesView } from '../shared/engine/types.js';

const view = (over: Partial<NotesView> = {}): NotesView => ({ id: 'n1', label: '~/Documents/Garden notes', name: 'Garden notes', suggestedName: 'garden-notes', pages: 14, complete: true, history: 'git', lastCommitAt: '2026-10-28T09:30:00Z', latestReport: null, ...over });
const KIT = ['add-source', 'file-page', 'answer-from-notes'];
const DEF: DefinitionView = {
  id: 'team', description: 'A team.', engines: ['claude-code'], instructions: true,
  skills: KIT.map(id => ({ id, name: id, description: id })),
  agents: [{ id: KEEPER_AGENT, name: KEEPER_AGENT, description: 'Keeps notes.', skills: [], notes: [] }, { id: 'editor', name: 'editor', description: 'Edits.', skills: [], notes: [] }],
  sources: [{ name: 'old-notes', kind: 'wiki-folder', label: '~/Old', notesId: 'n0' }], kits: [{ id: 'wiki-keeper', version: '0.1.0', skills: KIT }],
};

test('after a folder is chosen: notes with a history are ready; none offers to start one; git missing and an unreadable history say so', () => {
  assert.equal(afterChoose(view()), 'ready');
  assert.equal(afterChoose(view({ history: 'none' })), 'offer-history');
  assert.equal(afterChoose(view({ history: 'git-missing' })), 'git-missing');
  assert.equal(afterChoose(view({ history: 'unreadable' })), 'unreadable');
});

test('after a folder is chosen: a .git with no first commit is never ready, and a refused git config is never ready', () => {
  assert.equal(afterChoose(view({ history: 'no-commit', lastCommitAt: null })), 'no-commit');
  assert.equal(afterChoose(view({ history: 'refused', lastCommitAt: null })), 'refused');
});

test('the cards: each source of the harness first, then each chosen folder that is not one of them, with who reads it', () => {
  const chosen = [view(), view({ id: 'n0', name: 'Old', suggestedName: 'old' })];
  const now = draftView(DEF, attachNotes(DEF, EMPTY_DRAFT, 'editor', DEF.sources[0]!, true));
  const cards = notesCards(now, chosen, { n0: { ok: true, value: view({ id: 'n0', name: 'Old', pages: 3 }) } });
  assert.deepEqual(cards.map(c => [c.key, c.attached, c.name]), [['n0', true, 'Old'], ['n1', false, 'Garden notes']]);
  // The folder chosen in this window is the newest read of it, so it wins over an older read of the panel.
  const pages = (c: (typeof cards)[number]): number | null => (c.summary !== null && c.summary.ok ? c.summary.value.pages : null);
  assert.equal(pages(cards[0]!), 14);
  assert.equal(pages(notesCards(now, [], { n0: { ok: true, value: view({ id: 'n0', name: 'Old', pages: 3 }) } })[0]!), 3);
  assert.deepEqual(cards[0]!.readers, ['editor']);
  assert.deepEqual(cards[1]!.readers, []);
  assert.equal(cards[1]!.source.name, 'garden-notes');
  assert.equal(cards[1]!.summary?.ok, true, 'a chosen folder carries its own summary');
  // A source with no summary read yet is named by its source name, never by its folder path.
  const bare = notesCards(DEF, [], {});
  assert.equal(bare[0]!.name, 'old-notes');
  assert.equal(bare[0]!.summary, null);
});

test('the build progress follows the keeper: first skill, the rest, then the notes on its shelf', () => {
  const cards = notesCards(DEF, [view()], {});
  const p = (skills: string[], notes: string[]) => buildProgress({ ...DEF, agents: DEF.agents.map(a => (a.id === KEEPER_AGENT ? { ...a, skills, notes } : a)) }, KIT, cards);
  assert.deepEqual(p([], []), { first: 'add-source', firstDone: false, restDone: false, notesDone: false, hasNotes: true, done: false });
  assert.equal(p(['add-source'], []).firstDone, true);
  assert.equal(p(KIT, []).restDone, true);
  assert.equal(p(KIT, ['old-notes']).done, true);
  // With no notes at all, the build is done when the skills are.
  assert.equal(buildProgress({ ...DEF, sources: [], agents: DEF.agents.map(a => (a.id === KEEPER_AGENT ? { ...a, skills: KIT } : a)) }, KIT, []).done, true);
  // No keeper: nothing is done.
  assert.equal(buildProgress({ ...DEF, agents: [] }, KIT, cards).done, false);
});
