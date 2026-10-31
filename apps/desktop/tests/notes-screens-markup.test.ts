// The notes screens of the harness-first window drawn as markup: the notes step in each of its phases, the Notes panel (the dashboard inside My agents), and
// the keeper build with its two shelves. One card layout serves skills and notes, a path is never a label (it sits behind "Show details"), and every drag has a
// button that does the same.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { NotesStepView } from '../renderer/harness/notes/NotesStep.js';
import { NotesPanel } from '../renderer/harness/notes/NotesPanel.js';
import { KeeperBuild } from '../renderer/harness/notes/KeeperBuild.js';
import { notesCards } from '../renderer/harness/notes/notes-logic.js';
import { NOTES } from '../renderer/harness/words-notes.js';
import { NOTES_PARTIAL_WORDS, NOTES_REFUSAL_WORDS } from '../renderer/harness/words-engine.js';
import type { DefinitionView, NotesHistoryPlanView, NotesStarterView, NotesView } from '../shared/engine/types.js';
import { KEEPER_AGENT } from '../shared/harness/save-draft.js';

const noop = (): void => undefined;
const READING: NotesView = { id: 'n1', label: '~/Documents/Reading list', name: 'Reading list', suggestedName: 'reading-list', pages: 14, complete: true, history: 'git', lastCommitAt: '2026-10-28T09:30:00Z', latestReport: { date: '2026-10-29', path: 'reports/2026-10-29-refine.md' }, reportsComplete: true };
const step = (phase: Parameters<typeof NotesStepView>[0]['phase'], over: Partial<Parameters<typeof NotesStepView>[0]> = {}): string => renderToStaticMarkup(createElement(NotesStepView, {
  phase, busy: null, refusal: null, refusalId: 0, held: false, onUse: noop, onFresh: noop, onStartHistory: noop, onDecline: noop, onCreate: noop, onAgain: noop, ...over,
}));
const DEF: DefinitionView = {
  id: 'team', description: 'A team.', engines: ['claude-code', 'codex'], instructions: true,
  skills: ['add-source', 'file-page', 'check-notes'].map(id => ({ id, name: id, description: `${id} words.` })),
  agents: [{ id: KEEPER_AGENT, name: KEEPER_AGENT, description: 'Keeps notes.', skills: ['add-source'], notes: ['reading-list'] }, { id: 'editor', name: 'editor', description: 'Edits.', skills: [], notes: [] }],
  sources: [{ name: 'reading-list', kind: 'wiki-folder', label: '~/Documents/Reading list', notesId: 'n1' }], kits: [{ id: 'wiki-keeper', version: '0.1.0', skills: ['add-source', 'check-notes', 'file-page'] }],
};

test('the notes step asks one question with two buttons', () => {
  const html = step({ kind: 'ask' });
  assert.ok(html.includes(NOTES.hint.question));
  assert.match(html, /data-notes-use=""/); assert.match(html, /data-notes-fresh=""/);
  assert.ok(html.includes('>Use my notes<')); assert.ok(html.includes('>Start fresh<'));
});

test('"Use my notes" on a folder with no history offers to start one, shows what it records, and lets the person say no', () => {
  const plan: NotesHistoryPlanView = { notes: '~/Documents/Reading list', files: [{ path: 'index.md', kind: 'file' }, { path: 'books/essays.md', kind: 'file' }], count: 2, hidden: 1, revision: 'r'.repeat(64) };
  const html = step({ kind: 'offer', view: { ...READING, history: 'none' }, plan });
  assert.ok(html.includes(NOTES.hint.offerHistory));
  assert.match(html, /data-history-file="index.md"/); assert.match(html, /data-history-file="books\/essays.md"/);
  assert.ok(html.includes('1 hidden name stays out.'));
  assert.match(html, /data-start-history=""/); assert.ok(html.includes(`>${NOTES.label.declineHistory}<`));
  // The folder is named by its name; its path is not a label.
  assert.ok(html.includes('Reading list'));
  assert.ok(!html.includes('~/Documents'));
});

test('"Start fresh" shows the starter files, then one button: Create', () => {
  const plan: NotesStarterView = { notes: '~/Documents/Notes', createsFolder: false, folders: ['pages', 'reports', 'sources'], files: [{ path: 'AGENTS.md', bytes: 2809 }, { path: 'index.md', bytes: 302 }], kit: { id: 'wiki-keeper', version: '0.1.0' }, revision: 's'.repeat(64) };
  const html = step({ kind: 'starter', view: { ...READING, id: 'n2', name: 'Notes', pages: 0, history: 'none' }, plan });
  assert.match(html, /data-starter-file="AGENTS.md"/); assert.match(html, /data-starter-file="index.md"/);
  assert.ok(html.includes(NOTES.hint.starterNote));
  assert.match(html, /data-notes-create=""/); assert.ok(html.includes('>Create<'));
});

test('each ending says where the notes stand, in words', () => {
  assert.ok(step({ kind: 'done', view: READING, how: 'ready' }).includes(NOTES.hint.ready));
  assert.ok(step({ kind: 'done', view: READING, how: 'created' }).includes(NOTES.hint.created));
  assert.ok(step({ kind: 'done', view: { ...READING, history: 'none' }, how: 'report-only' }).includes(NOTES.hint.reportOnly));
  assert.ok(step({ kind: 'done', view: { ...READING, history: 'git-missing' }, how: 'git-missing' }).includes(NOTES.hint.gitMissing));
  // A refusal shows its own words and what to do next.
  const refused = step({ kind: 'ask' }, { refusal: { code: 'NOTES_NOT_EMPTY', message: 'The folder holds files.', paths: [] } });
  assert.match(refused, /data-refusal="NOTES_NOT_EMPTY"/);
  assert.ok(refused.includes('Choose an empty folder, or make a new one.'));
});

test('the Notes panel is a dashboard: name, page count, last change, readers and tidy-up report, with the path behind Show details', () => {
  const cards = notesCards(DEF, [], { n1: { ok: true, value: READING } });
  const html = renderToStaticMarkup(createElement(NotesPanel, { cards, held: false, hasKeeper: true, onUse: noop, onFresh: noop, onAddKeeper: noop }));
  assert.match(html, /data-section="notes"/);
  assert.ok(html.includes('Reading list'));
  assert.ok(html.includes('14 pages')); assert.ok(html.includes('Last change 2026-10-28')); assert.ok(html.includes(`Read by ${KEEPER_AGENT}`)); assert.ok(html.includes('Tidy-up report 2026-10-29'));
  assert.ok(html.includes(NOTES.hint.moreKinds));
  assert.match(html, /aria-expanded="false"[^>]*>Show details</);
  assert.ok(!html.includes('~/Documents'), 'the path is not on screen until Show details');
  assert.ok(!html.includes('reports/2026-10-29-refine.md'));
  // One kind of notes exists, so every card is a notes card: no tile for a kind that does not exist.
  assert.deepEqual([...html.matchAll(/data-kind="([a-z]+)"/g)].map(m => m[1]), ['notes']);
  assert.match(html, /data-tour="notes"/);
  assert.match(html, /data-notes-use=""/);
  assert.doesNotMatch(html, /data-add-keeper/, 'the keeper is here already');
});

test('an empty Notes panel says so, offers both ways in, and offers the Notes keeper', () => {
  const html = renderToStaticMarkup(createElement(NotesPanel, { cards: [], held: false, hasKeeper: false, onUse: noop, onFresh: noop, onAddKeeper: noop }));
  assert.ok(html.includes(NOTES.hint.noNotes));
  assert.match(html, /data-tour="notes"/);
  assert.match(html, /data-add-keeper=""/); assert.ok(html.includes(NOTES.label.addKeeper));
});

test('the keeper build: the keeper card with a Skills shelf and a Notes shelf, the kit skills to drag, each with an Add button, and one button for the rest', () => {
  const cards = notesCards({ ...DEF, sources: [], agents: DEF.agents.map(a => ({ ...a, notes: [] })) }, [READING], {});
  const keeper = { name: KEEPER_AGENT, skills: ['add-source'], notes: [] as string[] };
  const html = renderToStaticMarkup(createElement(KeeperBuild, {
    keeper, offered: DEF.skills, cards, held: false, fromKit: true, onLink: noop, onLinkRest: noop, onAttach: noop,
  }));
  for (const id of ['build', 'keeper', 'shelves']) assert.match(html, new RegExp(`data-tour="${id}"`), id);
  assert.ok(html.includes(NOTES.label.keeper));
  assert.match(html, /data-shelf="skills"/); assert.match(html, /data-shelf="notes"/);
  // On the shelf: add-source, with a way to take it off. In the tray: the other two, draggable, each with its Add button.
  assert.match(html, /data-on-shelf="add-source"/);
  assert.match(html, /aria-label="Take add-source off the Notes keeper"/);
  assert.match(html, /data-card="file-page"[^>]*draggable="true"/);
  assert.match(html, /aria-label="Add check-notes to the Notes keeper"/);
  assert.match(html, /data-link-rest=""/);
  // The chosen notes are a card in the same layout, with its own Add button.
  assert.match(html, /data-card="n1"[^>]*draggable="true"/);
  assert.match(html, /aria-label="Put Reading list on the Notes shelf"/);
  const layouts = new Set([...html.matchAll(/class="(hxn-card[^"]*)" data-card/g)].map(m => m[1]));
  assert.deepEqual([...layouts], ['hxn-card'], 'skills and notes share one card layout');
  assert.ok(html.includes(NOTES.hint.dropNotes));
});

test('a built keeper has nothing left in the tray, and "Add the other skills" is held', () => {
  const cards = notesCards(DEF, [], {});
  const html = renderToStaticMarkup(createElement(KeeperBuild, {
    keeper: { name: KEEPER_AGENT, skills: ['add-source', 'file-page', 'check-notes'], notes: ['reading-list'] }, offered: DEF.skills, cards, held: false, fromKit: false, onLink: noop, onLinkRest: noop, onAttach: noop,
  }));
  assert.match(html, /data-link-rest="" disabled=""|disabled=""[^>]*data-link-rest=""/);
  assert.match(html, /data-on-shelf="reading-list"/);
  assert.doesNotMatch(html, /draggable="true"/);
});

test('a folder whose history has no first commit, or whose git settings were refused, ends in words and is not ready', () => {
  const noCommit = step({ kind: 'done', view: { ...READING, history: 'no-commit', lastCommitAt: null }, how: 'no-commit' });
  assert.ok(noCommit.includes(NOTES.hint.noCommit));
  assert.match(noCommit, /data-notes-done="no-commit"/);
  assert.ok(!noCommit.includes(NOTES.hint.ready));
  const refused = step({ kind: 'done', view: { ...READING, history: 'refused', lastCommitAt: null }, how: 'refused' });
  assert.ok(refused.includes(NOTES.hint.refused));
  const panel = renderToStaticMarkup(createElement(NotesPanel, {
    cards: notesCards({ ...DEF, sources: [], agents: DEF.agents.map(a => ({ ...a, notes: [] })) }, [{ ...READING, history: 'no-commit', lastCommitAt: null }], {}), held: false, hasKeeper: true,
    onUse: noop, onFresh: noop, onAddKeeper: noop,
  }));
  assert.ok(panel.includes(NOTES.hint.noCommit));
});

test('a history start that stopped part way gets its own advice, apart from a starter that stopped part way', () => {
  const partial = { code: 'NOTES_PARTIAL', message: 'The step stopped part way. The paths listed were written and are left as they are. .git.', paths: ['.git'] };
  const plan: NotesHistoryPlanView = { notes: '~/Documents/Reading list', files: [{ path: 'index.md', kind: 'file' }], count: 1, hidden: 0, revision: 'r'.repeat(64) };
  const history = step({ kind: 'offer', view: { ...READING, history: 'none' }, plan }, { refusal: partial, refusalId: 1 });
  const starterPlan: NotesStarterView = { notes: '~/Documents/Notes', createsFolder: false, folders: [], files: [{ path: 'AGENTS.md', bytes: 10 }], kit: { id: 'wiki-keeper', version: '0.1.0' }, revision: 's'.repeat(64) };
  const starter = step({ kind: 'starter', view: { ...READING, id: 'n2', name: 'Notes', pages: 0, history: 'none' }, plan: starterPlan }, { refusal: partial, refusalId: 1 });
  assert.ok(history.includes(NOTES_PARTIAL_WORDS.history), history);
  assert.ok(!history.includes(NOTES_PARTIAL_WORDS.starter));
  assert.ok(starter.includes(NOTES_PARTIAL_WORDS.starter));
  assert.ok(!starter.includes(NOTES_PARTIAL_WORDS.history));
});

test('a write that left the folder unclean says so, and a step that stopped part way names its cause', () => {
  const unclean = step({ kind: 'done', view: READING, how: 'created', clean: false });
  assert.match(unclean, /data-not-clean=""/);
  assert.ok(unclean.includes(NOTES.hint.notClean));
  assert.doesNotMatch(step({ kind: 'done', view: READING, how: 'created', clean: true }), /data-not-clean/);
  const plan: NotesHistoryPlanView = { notes: '~/Documents/Reading list', files: [{ path: 'index.md', kind: 'file' }], count: 1, hidden: 0, revision: 'r'.repeat(64) };
  const partial = { code: 'NOTES_PARTIAL', step: 'NOTES_GIT_MISSING', message: 'The step stopped part way.', paths: ['.git'] };
  const html = step({ kind: 'offer', view: { ...READING, history: 'none' }, plan }, { refusal: partial, refusalId: 1 });
  assert.match(html, /data-next-step-cause="NOTES_GIT_MISSING"/);
  assert.ok(html.includes(NOTES_REFUSAL_WORDS.NOTES_GIT_MISSING!));
});

test('a keeper the draft adds from the kit can be taken out again; a saved keeper has no such button', () => {
  const cards = notesCards(DEF, [], {});
  const draw = (fromKit: boolean): string => renderToStaticMarkup(createElement(KeeperBuild, {
    keeper: { name: KEEPER_AGENT, skills: [], notes: [] }, offered: DEF.skills, cards, held: false, fromKit, onLink: noop, onLinkRest: noop, onAttach: noop, onRemoveKit: noop,
  }));
  assert.match(draw(true), /data-remove-keeper=""/);
  const html = draw(true);
  assert.ok(html.indexOf('data-add-skill=') < html.indexOf('data-remove-keeper'), 'the first control of the build stays a skill\'s Add button');
  assert.ok(draw(true).includes(NOTES.label.removeKeeper));
  assert.doesNotMatch(draw(false), /data-remove-keeper/);
});
