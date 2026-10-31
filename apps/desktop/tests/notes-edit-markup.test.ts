// My agents for one folder (the save sheet's edit) with notes: the map with the notes card beside the agents, the Help button, the Notes panel, the Notes
// keeper with its shelves once the draft adds it from the kit, the notes each agent reads as tick boxes (the keyboard path of every drag), the save bar, and
// the review that lists the notes each agent will read. Every place the tour lights carries its id.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { EditStep, SaveBar, SaveReview } from '../renderer/harness/sheets/SaveSheet.js';
import type { EditNotes } from '../renderer/harness/sheets/SaveSheet.js';
import { notesCards } from '../renderer/harness/notes/notes-logic.js';
import { NOTES } from '../renderer/harness/words-notes.js';
import { EMPTY_DRAFT, KEEPER_AGENT, KEEPER_KIT, addKit, definitionWorld, draftCount, draftView, keeperOf, keeperSkills } from '../shared/harness/save-draft.js';
import type { DefinitionView, NotesView } from '../shared/engine/types.js';

const noop = (): void => undefined;
const KIT = ['add-source', 'file-page', 'answer-from-notes', 'check-notes', 'log-change', 'refine-report'];
const BASE: DefinitionView = {
  id: 'weekly-report', description: 'Drafts the weekly report.', engines: ['claude-code', 'codex'], instructions: true,
  skills: [{ id: 'check-facts', name: 'check-facts', description: 'Checks each figure.' }],
  agents: [{ id: 'editor', name: 'editor', description: 'Edits.', skills: [], notes: [] }], sources: [], kits: [],
};
const WITH_KIT: DefinitionView = {
  ...BASE, skills: [...BASE.skills, ...KIT.map(id => ({ id, name: id, description: id }))],
  agents: [...BASE.agents, { id: KEEPER_AGENT, name: KEEPER_AGENT, description: 'Keeps notes.', skills: KIT, notes: [] }], kits: [{ id: KEEPER_KIT, version: '0.1.0', skills: [...KIT] }],
};
const READING: NotesView = { id: 'n1', label: '~/Documents/Reading list', name: 'Reading list', suggestedName: 'reading-list', pages: 14, complete: true, history: 'none', lastCommitAt: null, latestReport: null, reportsComplete: true };

function draw(withKit: boolean): string {
  const draft = withKit ? addKit(BASE, EMPTY_DRAFT, WITH_KIT) : EMPTY_DRAFT;
  const now = draftView(BASE, draft), cards = notesCards(now, [READING], {});
  const notes: EditNotes = {
    cards, keeper: keeperOf(now), offered: keeperSkills(BASE, draft).map(id => now.skills.find(s => s.id === id)!), fromKit: withKit, way: null,
    onWay: noop, onAddKeeper: noop, onLink: noop, onLinkRest: noop, onAttach: noop, onRemoveKit: noop, onHelp: noop,
  };
  return renderToStaticMarkup(createElement(EditStep, {
    base: BASE, now, draft, count: draftCount(BASE, draft), held: false, versions: { ok: true, value: [] }, world: definitionWorld(now, cards.filter(c => !c.attached).map(c => c.source)),
    linkingId: null, selectedId: null, onDraft: noop, onLinkStart: noop, onLinkTarget: noop, onLinkCancel: noop, onSelect: noop, onMove: noop, onGoBack: noop, notes,
  }));
}

test('before the keeper: the map holds the notes card, Help replays the tour, and the Notes panel offers the keeper', () => {
  const html = draw(false);
  assert.match(html, /data-tour="map"/); assert.match(html, /data-tour="help"/); assert.match(html, /data-tour="notes"/);
  assert.match(html, /data-node="notes:reading-list"/);
  assert.match(html, /aria-label="Help: replay the tour"/, 'the visible word Help is part of its name');
  assert.match(html, /data-section="notes"/);
  assert.match(html, /data-add-keeper=""/);
  assert.doesNotMatch(html, /data-tour="keeper"/);
  // The notes each agent reads, as tick boxes: the keyboard path of the drag onto a Notes shelf.
  assert.match(html, /data-section="agent-notes"/);
  assert.match(html, /aria-label="Reading list: editor"/);
  assert.ok(!html.includes('~/Documents'), 'no path is a label');
});

test('with the keeper from the kit: its card and shelves are lit for the tour, its skills are offered, and the change count says so', () => {
  const html = draw(true);
  for (const id of ['map', 'notes', 'keeper', 'shelves', 'build', 'help']) assert.match(html, new RegExp(`data-tour="${id}"`), id);
  assert.match(html, /data-keeper="notes-keeper"/);
  assert.ok(html.includes(NOTES.hint.keeperDraft));
  assert.match(html, /data-add-skill="add-source"/);
  assert.match(html, /data-skill-row="refine-report"/, 'the kit skills are listed among the skills, so each can be removed');
  assert.match(html, /aria-label="refine-report: notes-keeper"/, 'and ticked for any agent');
  assert.doesNotMatch(html, /data-add-keeper/);
  assert.match(html, /data-draft="2"/);
});

test('the save bar holds the count and the one button, and the tour lights it', () => {
  const html = renderToStaticMarkup(createElement(SaveBar, { count: 3 }, createElement('button', null, 'Review the save')));
  assert.match(html, /data-tour="save"/);
  assert.ok(html.includes('3 changes, not saved yet.'));
  assert.ok(html.includes('Review the save'));
});

test('the review lists the notes each agent will read', () => {
  const definition: DefinitionView = { ...WITH_KIT, sources: [{ name: 'reading-list', kind: 'wiki-folder', label: '~/Documents/Reading list', notesId: 'n1' }], agents: WITH_KIT.agents.map(a => (a.id === KEEPER_AGENT ? { ...a, notes: ['reading-list'] } : a)) };
  const html = renderToStaticMarkup(createElement(SaveReview, {
    shown: { kind: 'save', view: { folder: '~/Projects/weekly-report', changes: [{ path: '.bowerloom/knowledge.json', action: 'create' }], definition, noop: false, revision: 'a'.repeat(64), removedSources: [], copiedExecutables: [], acknowledge: null }, edits: [] },
    approved: false, held: false, onApprove: noop,
  }));
  assert.match(html, /data-agent-notes-after="notes-keeper"/);
  assert.ok(html.includes('Notes: reading-list'));
});

test('the review warns when the keeper is saved with no skills', () => {
  const review = (skills: string[]): string => renderToStaticMarkup(createElement(SaveReview, {
    shown: { kind: 'save', view: { folder: '~/Projects/weekly-report', changes: [{ path: '.bowerloom/agents/notes-keeper.md', action: 'create' }], definition: { ...WITH_KIT, agents: WITH_KIT.agents.map(a => (a.id === KEEPER_AGENT ? { ...a, skills } : a)) }, noop: false, revision: 'a'.repeat(64), removedSources: [], copiedExecutables: [], acknowledge: null }, edits: [] },
    approved: false, held: false, onApprove: noop,
  }));
  const none = review([]);
  assert.match(none, /data-keeper-no-skills=""/);
  assert.ok(none.includes(NOTES.hint.keeperNoSkills));
  assert.doesNotMatch(review(['add-source']), /data-keeper-no-skills/);
});
