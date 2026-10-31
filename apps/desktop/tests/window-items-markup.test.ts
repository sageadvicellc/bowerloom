// The window items as markup: the Notes panel's "Stop using these notes" and its report line as a button (items 1 and 2), the review's marks for files that
// can run, copied files and an execute bit alone, the notes a save stops using, and the acknowledgement Save waits for (items 1 and 4), and the edit's
// "Skills from another folder" (item 5).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { NotesPanel } from '../renderer/harness/notes/NotesPanel.js';
import { notesCards } from '../renderer/harness/notes/notes-logic.js';
import { SaveReview } from '../renderer/harness/sheets/SaveSheet.js';
import type { Shown } from '../renderer/harness/sheets/SaveSheet.js';
import { EditStep } from '../renderer/harness/FolderEditor.js';
import type { CopyParts } from '../renderer/harness/FolderEditor.js';
import { ENGINE_WORDS } from '../renderer/harness/words-engine.js';
import { NOTES } from '../renderer/harness/words-notes.js';
import { EMPTY_DRAFT, copySkill, definitionWorld, draftCount, draftView, stopSource, stoppedSources } from '../shared/harness/save-draft.js';
import type { DefinitionView, NotesView, SaveView, SourceView } from '../shared/engine/types.js';

const noop = (): void => undefined;
const NOTES_SRC: SourceView = { name: 'notes', kind: 'wiki-folder', label: '~/Documents/notes', notesId: 'notes-1' };
const BASE: DefinitionView = {
  id: 'team', description: 'A team.', engines: ['claude-code', 'codex'], instructions: true,
  skills: [{ id: 'outline', name: 'outline', description: 'Outlines.' }],
  agents: [{ id: 'reader', name: 'reader', description: 'Reads.', skills: [], notes: ['notes'] }, { id: 'writer', name: 'writer', description: 'Writes.', skills: [], notes: ['notes'] }],
  sources: [NOTES_SRC], kits: [],
};
const READ: NotesView = {
  id: 'notes-1', label: '~/Documents/notes', name: 'notes', suggestedName: 'notes', pages: 4, complete: true, history: 'git', lastCommitAt: '2026-10-28T09:00:00Z',
  latestReport: { date: '2026-10-27', path: 'reports/2026-10-27-refine.md' }, reportsComplete: true,
};
const VIEW = (over: Partial<SaveView> = {}): SaveView => ({
  folder: '~/Projects/team', changes: [], definition: BASE, noop: false, revision: 'a'.repeat(64), removedSources: [], copiedExecutables: [], acknowledge: null, ...over,
});
const review = (shown: Shown, acknowledged = false): string => renderToStaticMarkup(createElement(SaveReview, { shown, approved: true, held: false, onApprove: noop, acknowledged, onAcknowledge: noop }));

// ---- the Notes panel

test('a saved source offers "Stop using these notes"; the report line is a button that opens the report, named by its date', () => {
  const cards = notesCards(BASE, [], { 'notes-1': { ok: true, value: READ } }, [], ['notes']);
  const html = renderToStaticMarkup(createElement(NotesPanel, { cards, held: false, hasKeeper: true, onUse: noop, onFresh: noop, onAddKeeper: noop, onStop: noop, onOpenReport: noop }));
  assert.match(html, /data-stop-notes="notes-1"/);
  assert.ok(html.includes(NOTES.label.stopUsing));
  assert.match(html, /<button[^>]*data-open-report="notes-1"[^>]*>/);
  assert.ok(html.includes('Tidy-up report 2026-10-27'));
  assert.match(html, /aria-label="Open the tidy-up report of 2026-10-27"/);
});

test('a source the draft only adds has no Stop button: taking it off the shelf is enough; with no report, the line stays words', () => {
  const cards = notesCards(BASE, [], { 'notes-1': { ok: true, value: { ...READ, latestReport: null } } }, [], []);
  const html = renderToStaticMarkup(createElement(NotesPanel, { cards, held: false, hasKeeper: true, onUse: noop, onFresh: noop, onAddKeeper: noop, onStop: noop, onOpenReport: noop }));
  assert.doesNotMatch(html, /data-stop-notes/);
  assert.doesNotMatch(html, /data-open-report/);
  assert.ok(html.includes('No tidy-up report yet.'));
});

test('a stopped source keeps its card, says it stops when you save, names who loses it, and offers to keep using it', () => {
  const d = stopSource(BASE, EMPTY_DRAFT, 'notes', true);
  const cards = notesCards(draftView(BASE, d), [], { 'notes-1': { ok: true, value: READ } }, stoppedSources(BASE, d), ['notes']);
  const html = renderToStaticMarkup(createElement(NotesPanel, { cards, held: false, hasKeeper: true, onUse: noop, onFresh: noop, onAddKeeper: noop, onStop: noop, onOpenReport: noop }));
  assert.match(html, /data-card="notes-1"[^>]*data-stopped=""/);
  assert.ok(html.includes(NOTES.hint.stopsOnSave));
  assert.match(html, /data-keep-notes="notes-1"/);
  assert.ok(html.includes(NOTES.label.keepUsing));
  assert.doesNotMatch(html, /data-stop-notes/);
});

// ---- the review

test('the review marks each file that can run, names the folder a copied file comes from, and says when only the execute bit changes', () => {
  const html = review({
    kind: 'save', edits: [], view: VIEW({
      changes: [
        { path: '.bowerloom/skills/summarize/SKILL.md', action: 'create', from: '~/Projects/source' },
        { path: '.bowerloom/skills/summarize/scripts/count.sh', action: 'create', executable: true, from: '~/Projects/source' },
        { path: '.bowerloom/skills/outline/run.sh', action: 'update', executable: true, modeOnly: true },
      ],
      copiedExecutables: [{ path: '.bowerloom/skills/summarize/scripts/count.sh', from: '~/Projects/source' }], acknowledge: 'c'.repeat(64),
    }),
  });
  assert.match(html, /data-file="\.bowerloom\/skills\/summarize\/scripts\/count\.sh"[^>]*data-executable=""/);
  assert.doesNotMatch(html, /data-file="\.bowerloom\/skills\/summarize\/SKILL\.md"[^>]*data-executable/);
  assert.equal((html.match(/data-from="~\/Projects\/source"/g) ?? []).length, 2);
  assert.ok(html.includes(ENGINE_WORDS.hint.canRun));
  assert.ok(html.includes('From ~/Projects/source'));
  assert.match(html, /data-file="\.bowerloom\/skills\/outline\/run\.sh"[^>]*data-mode-only=""/);
  assert.ok(html.includes(ENGINE_WORDS.hint.modeOnly));
  // The acknowledgement: one tick, apart from the plan's own tick.
  assert.match(html, /data-tick="executables"/);
  assert.ok(html.includes(ENGINE_WORDS.hint.ackExecutables));
});

test('with no copied file that can run, the review asks no acknowledgement', () => {
  const html = review({ kind: 'save', edits: [], view: VIEW({ changes: [{ path: '.bowerloom/agents/reader.md', action: 'update' }] }) });
  assert.doesNotMatch(html, /data-tick="executables"/);
  assert.doesNotMatch(html, /data-executable/);
});

test('the review of a stop names the notes and the agents that lose them, and says the notes folder does not change', () => {
  const html = review({
    kind: 'save', edits: [{ kind: 'remove-source', name: 'notes' }],
    view: VIEW({ changes: [{ path: '.bowerloom/knowledge.json', action: 'delete' }], removedSources: [{ name: 'notes', label: '~/Documents/notes', agents: ['reader', 'writer'] }] }),
  });
  assert.match(html, /data-section="save-stopped-notes"/);
  assert.match(html, /data-stopped-notes="notes"/);
  assert.ok(html.includes('reader and writer lose these notes.'));
  assert.ok(html.includes(NOTES.hint.folderStays));
});

test('a go-back that only flips an execute bit says so at the top of the review', () => {
  const html = review({
    kind: 'restore', view: { ...VIEW({ changes: [{ path: '.bowerloom/skills/outline/run.sh', action: 'update', executable: true, modeOnly: true }] }), version: { id: 'v2', created: '2026-10-30T12:00:00Z', label: 'Saved 1 change', files: 5, current: false } },
  });
  assert.match(html, /data-mode-only-plan=""/);
  assert.ok(html.includes(ENGINE_WORDS.hint.onlyModes));
});

// ---- the edit: skills from another folder

test('the edit offers skills from another folder: each folder by its label, its skills with Add, one held already marked, and a copy taken out again', () => {
  const draft = copySkill(BASE, EMPTY_DRAFT, { id: 'summarize', from: 'folder-2', fromLabel: '~/Projects/source', name: 'summarize', description: 'Summarizes.' }, true);
  const now = draftView(BASE, draft);
  const copy: CopyParts = {
    folders: [{ id: 'folder-2', label: '~/Projects/source' }], picked: 'folder-2',
    skills: { ok: true, value: [{ id: 'outline', name: 'outline', description: 'Outlines.' }, { id: 'summarize', name: 'summarize', description: 'Summarizes.' }, { id: 'count', name: 'count', description: 'Counts.' }] },
    draft, base: BASE, onPick: noop, onChoose: noop, onCopy: noop,
  };
  const html = renderToStaticMarkup(createElement(EditStep, {
    base: BASE, now, draft, count: draftCount(BASE, draft), held: false, versions: { ok: true, value: [] }, world: definitionWorld(now), linkingId: null, selectedId: null,
    onAction: noop, onLinkStart: noop, onLinkTarget: noop, onLinkCancel: noop, onSelect: noop, onMove: noop, onGoBack: noop, copy,
  }));
  assert.match(html, /data-section="copy-skills"/);
  assert.match(html, /data-copy-from="folder-2"[^>]*aria-pressed="true"/);
  assert.match(html, /data-copy-choose=""/);
  assert.match(html, /aria-label="Add count from ~\/Projects\/source"/);
  assert.match(html, /data-copy-skill="outline"[^>]*data-held=""/, 'a skill this harness holds is not copied over it');
  assert.match(html, /aria-label="Take summarize out"/);
  // The copy is listed among the skills, with where it comes from.
  assert.match(html, /data-skill-row="summarize"[^>]*data-copied=""/);
  assert.ok(html.includes('From ~/Projects/source'));
  assert.match(html, /data-draft="1"/);
});
