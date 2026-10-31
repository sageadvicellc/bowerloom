// The drafts of the folders' harnesses, held once for the window (renderer/harness/folder-draft.tsx): the Builder and the save sheet read and change the same
// draft of a folder. Each folder keeps its own base, save points, undo stack of drafts and node places. The reducer is plain data, so it is tested here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { EMPTY_FOLDER, FolderDraftProvider, folderDraftsReduce, useFolderDraft } from '../renderer/harness/folder-draft.js';
import type { FolderDrafts } from '../renderer/harness/folder-draft.js';
import { EMPTY_DRAFT, linkSkill, removeSkill } from '../shared/harness/save-draft.js';
import { UNDO_LIMIT, canRedo, canUndo, undoCount } from '../shared/harness/draft-undo.js';
import type { Answer, DefinitionView, VersionView } from '../shared/engine/types.js';

const BASE: DefinitionView = {
  id: 'weekly-report', description: 'Drafts the weekly report.', engines: ['claude-code', 'codex'], instructions: true,
  skills: [{ id: 'check-facts', name: 'check-facts', description: 'Checks each figure.' }, { id: 'draft-outline', name: 'draft-outline', description: 'Outlines it.' }],
  agents: [{ id: 'editor', name: 'editor', description: 'Edits.', skills: [], notes: [] }, { id: 'writer', name: 'writer', description: 'Writes.', skills: ['draft-outline'], notes: [] }],
  sources: [], kits: [],
};
const NONE: Answer<readonly VersionView[]> = { ok: true, value: [] };
const A = 'folder-1', B = 'folder-2';
const link = (d = EMPTY_DRAFT) => linkSkill(BASE, d, 'editor', 'check-facts', true);
const loaded = (s: FolderDrafts, folder: string, base: DefinitionView = BASE, versions = NONE): FolderDrafts => folderDraftsReduce(s, { kind: 'loaded', folder, base, versions });

test('a folder not read yet has no base, no save points, and an empty draft with nothing to undo', () => {
  assert.equal(EMPTY_FOLDER.base, null);
  assert.equal(EMPTY_FOLDER.versions, null);
  assert.equal(EMPTY_FOLDER.stack.present, EMPTY_DRAFT);
  assert.equal(EMPTY_FOLDER.stack.limit, UNDO_LIMIT);
  assert.deepEqual(EMPTY_FOLDER.positions, {});
  assert.equal(Object.isFrozen(EMPTY_FOLDER), true);
});

test('a change of one folder goes onto its own undo stack, and never touches another folder', () => {
  let s = loaded(loaded({}, A), B);
  s = folderDraftsReduce(s, { kind: 'change', folder: A, next: d => link(d) });
  assert.deepEqual(s[A]!.stack.present, link());
  assert.equal(undoCount(s[A]!.stack), 1);
  assert.equal(s[B]!.stack.present, EMPTY_DRAFT);
  assert.equal(canUndo(s[B]!.stack), false);
});

test('undo and redo step through the drafts of one folder', () => {
  let s = loaded({}, A);
  s = folderDraftsReduce(s, { kind: 'change', folder: A, next: d => link(d) });
  s = folderDraftsReduce(s, { kind: 'change', folder: A, next: d => removeSkill(BASE, d, 'draft-outline', true) });
  assert.equal(undoCount(s[A]!.stack), 2);
  s = folderDraftsReduce(s, { kind: 'undo', folder: A });
  assert.deepEqual(s[A]!.stack.present, link());
  assert.equal(canRedo(s[A]!.stack), true);
  s = folderDraftsReduce(s, { kind: 'redo', folder: A });
  assert.deepEqual(s[A]!.stack.present.removed, ['draft-outline']);
  // An undo with nothing to undo hands the same state back.
  const fresh = loaded({}, B);
  assert.equal(folderDraftsReduce(fresh, { kind: 'undo', folder: B }), fresh);
});

test('a push records the draft a Builder gesture made, and a change or push that makes no change hands the same state back', () => {
  let s = loaded({}, A);
  s = folderDraftsReduce(s, { kind: 'push', folder: A, draft: link() });
  assert.equal(undoCount(s[A]!.stack), 1);
  assert.equal(folderDraftsReduce(s, { kind: 'push', folder: A, draft: s[A]!.stack.present }), s);
  assert.equal(folderDraftsReduce(s, { kind: 'change', folder: A, next: d => d }), s);
});

test('reading the same harness again keeps the draft; a harness that changed starts the draft again, and node places stay', () => {
  let s = loaded({}, A);
  s = folderDraftsReduce(s, { kind: 'change', folder: A, next: d => link(d) });
  s = folderDraftsReduce(s, { kind: 'move', folder: A, node: 'agent:editor', at: { x: 10, y: 20 } });
  const versions: Answer<readonly VersionView[]> = { ok: true, value: [{ id: 'v1', created: '2026-10-31T12:00:00Z', label: 'As it was', files: 3, current: true }] };
  s = loaded(s, A, { ...BASE }, versions);
  assert.deepEqual(s[A]!.stack.present, link(), 'the same harness, read again: the draft stays');
  assert.equal(s[A]!.versions, versions, 'the save points are the new read');
  const changed: DefinitionView = { ...BASE, agents: BASE.agents.map(a => (a.id === 'editor' ? { ...a, skills: ['check-facts'] } : a)) };
  s = loaded(s, A, changed);
  assert.equal(s[A]!.stack.present, EMPTY_DRAFT, 'a draft is never kept on a harness it was not made on');
  assert.equal(canUndo(s[A]!.stack), false);
  assert.deepEqual(s[A]!.positions, { 'agent:editor': { x: 10, y: 20 } });
});

test('after a save the draft starts again and the base is read again; a discard starts the draft again and keeps the base', () => {
  let s = loaded({}, A);
  s = folderDraftsReduce(s, { kind: 'change', folder: A, next: d => link(d) });
  const saved = folderDraftsReduce(s, { kind: 'saved', folder: A });
  assert.equal(saved[A]!.base, null);
  assert.equal(saved[A]!.stack.present, EMPTY_DRAFT);
  const discarded = folderDraftsReduce(s, { kind: 'discard', folder: A });
  assert.equal(discarded[A]!.base, BASE);
  assert.equal(discarded[A]!.stack.present, EMPTY_DRAFT);
  assert.equal(canUndo(discarded[A]!.stack), false);
});

test('a change, an undo or a discard of a folder not read yet changes nothing', () => {
  const s: FolderDrafts = {};
  assert.equal(folderDraftsReduce(s, { kind: 'change', folder: A, next: d => link(d) }), s);
  assert.equal(folderDraftsReduce(s, { kind: 'discard', folder: A }), s);
});

test('the save points of a folder can be read again alone', () => {
  let s = loaded({}, A);
  s = folderDraftsReduce(s, { kind: 'change', folder: A, next: d => link(d) });
  const damaged: Answer<readonly VersionView[]> = { ok: false, refusal: { code: 'VERSION_CORRUPT', message: 'Damaged.', paths: [] } };
  s = folderDraftsReduce(s, { kind: 'versions', folder: A, versions: damaged });
  assert.equal(s[A]!.versions, damaged);
  assert.deepEqual(s[A]!.stack.present, link());
});

test('the provider hands each folder its own entry to the screens below it', () => {
  const initial = folderDraftsReduce(loaded({}, A), { kind: 'change', folder: A, next: d => link(d) });
  function Show({ folder }: { folder: string }) {
    const d = useFolderDraft(folder);
    return createElement('span', { 'data-folder': folder, 'data-undo': String(d.canUndo), 'data-base': d.entry.base === null ? 'none' : d.entry.base.id }, String(d.count));
  }
  const html = renderToStaticMarkup(createElement(FolderDraftProvider, { initial }, createElement(Show, { folder: A }), createElement(Show, { folder: B })));
  assert.match(html, /data-folder="folder-1" data-undo="true" data-base="weekly-report">1</);
  assert.match(html, /data-folder="folder-2" data-undo="false" data-base="none">0</);
});
