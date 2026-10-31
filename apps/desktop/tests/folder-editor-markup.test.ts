// The editor of one folder's harness (renderer/harness/FolderEditor.tsx) is one component for two places: the Builder draws it in the window and the save sheet
// draws it in its edit step. The sheet keeps its folder, review and done steps, and holds no editor of its own.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CopySkills, EditStep, SavePoints, SetAsideBlock } from '../renderer/harness/FolderEditor.js';
import { EMPTY_DRAFT, definitionWorld, draftView, linkSkill } from '../shared/harness/save-draft.js';
import type { DefinitionView } from '../shared/engine/types.js';
import { ENGINE_WORDS } from '../renderer/harness/words-engine.js';
import { DESKTOP } from './support.js';

const BASE: DefinitionView = {
  id: 'weekly-report', description: 'Drafts the weekly report.', engines: ['claude-code', 'codex'], instructions: true,
  skills: [{ id: 'check-facts', name: 'check-facts', description: 'Checks each figure.' }],
  agents: [{ id: 'editor', name: 'editor', description: 'Edits.', skills: [], notes: [] }],
  sources: [], kits: [],
};
const noop = (): void => undefined;
const props = (over: Record<string, unknown> = {}) => {
  const draft = linkSkill(BASE, EMPTY_DRAFT, 'editor', 'check-facts', true), now = draftView(BASE, draft);
  return {
    base: BASE, now, draft, count: 1, held: false, versions: { ok: true as const, value: [] }, world: definitionWorld(now), linkingId: null, selectedId: null,
    onAction: noop, onLinkStart: noop, onLinkTarget: noop, onLinkCancel: noop, onSelect: noop, onMove: noop, onGoBack: noop, ...over,
  };
};

test('the editor draws the graph, the ticks, the skills, the interfaces and the save points', () => {
  const html = renderToStaticMarkup(createElement(EditStep, props()));
  for (const slot of ['graph', 'agent-skills', 'skills', 'engines', 'save-points']) assert.match(html, new RegExp(`data-section="${slot}"`), slot);
  assert.match(html, /aria-label="check-facts: editor" checked=""/);
});

test('the Builder draws the editor without its save points, which it keeps in a drawer', () => {
  const html = renderToStaticMarkup(createElement(EditStep, props({ savePoints: false })));
  assert.doesNotMatch(html, /data-section="save-points"/);
  assert.match(html, /data-section="graph"/);
});

test('SavePoints and CopySkills come from the editor too', () => {
  assert.ok(renderToStaticMarkup(createElement(SavePoints, { versions: { ok: true, value: [] }, held: false, onGoBack: noop })).includes(ENGINE_WORDS.hint.noSavePoints));
  const copy = { folders: [], picked: null, skills: null, draft: EMPTY_DRAFT, base: BASE, onPick: noop, onChoose: noop, onCopy: noop };
  assert.ok(renderToStaticMarkup(createElement(CopySkills, { copy, held: false })).includes(ENGINE_WORDS.hint.noOtherFolders));
});

test('the save sheet holds no editor of its own: it draws the one from FolderEditor and reads the shared draft', () => {
  const sheet = readFileSync(join(DESKTOP, 'renderer/harness/sheets/SaveSheet.tsx'), 'utf8');
  for (const name of ['EditStep', 'SavePoints', 'CopySkills']) assert.doesNotMatch(sheet, new RegExp(`function ${name}\\(`), name);
  assert.match(sheet, /from '\.\.\/FolderEditor\.js'/);
  assert.match(sheet, /useFolderDraft\(/);
  // The draft is never held as the sheet's own state.
  assert.doesNotMatch(sheet, /useState<SaveDraft>/);
});

test('set-aside is one block for the sheet and the Builder: the button for a record it can clear, the plan with its one button, and the dated name', () => {
  const base = { view: null, done: null, plan: noop, run: noop };
  const corrupt = { code: 'VERSION_CORRUPT', message: 'Damaged.', paths: [] }, other = { code: 'SAVE_STALE', message: 'Stale.', paths: [] };
  const button = renderToStaticMarkup(createElement(SetAsideBlock, { refusal: corrupt, held: false, setAside: base }));
  assert.match(button, /data-set-aside=""/);
  assert.ok(button.includes(ENGINE_WORDS.label.planSetAside));
  assert.doesNotMatch(renderToStaticMarkup(createElement(SetAsideBlock, { refusal: other, held: false, setAside: base })), /data-set-aside/, 'a refusal set-aside cannot clear offers nothing');
  assert.doesNotMatch(renderToStaticMarkup(createElement(SetAsideBlock, { refusal: null, held: false, setAside: base })), /data-set-aside/);
  const plan = renderToStaticMarkup(createElement(SetAsideBlock, { refusal: null, held: true, setAside: { ...base, view: { revision: 'abcdef0123456789', folder: '~/x' } as never } }));
  assert.match(plan, /data-set-aside-plan="abcdef01"/);
  assert.match(plan, /<button[^>]*disabled=""[^>]*data-run-set-aside=""|<button[^>]*data-run-set-aside=""[^>]*disabled=""/, 'held while a write runs');
  assert.match(renderToStaticMarkup(createElement(SetAsideBlock, { refusal: null, held: false, setAside: { ...base, done: 'v-old-2026' } })), /data-set-aside-done="v-old-2026"/);
});

test('no gesture of the editor skips builderAction: it holds no direct call of a save-draft reducer, so a refusal always reaches the person', () => {
  const editor = readFileSync(join(DESKTOP, 'renderer/harness/FolderEditor.tsx'), 'utf8');
  for (const name of ['linkSkill(', 'attachNotes(', 'removeSkill(', 'copySkill(', 'setDraftEngines(', 'stopSource(', 'removeKit(', 'keeperAdded(']) assert.equal(editor.includes(name), false, name);
  assert.doesNotMatch(editor, /onDraft/);
  // The editor's two plans have a lane each, so neither can drop the other.
  assert.match(editor, /keeperCall\.plan\(/);
  assert.match(editor, /copyCall\.plan\(/);
  const sheet = readFileSync(join(DESKTOP, 'renderer/harness/sheets/SaveSheet.tsx'), 'utf8');
  assert.doesNotMatch(sheet, /fd\.change|onDraft/);
});
