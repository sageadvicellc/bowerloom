// The save sheet's parts, drawn as markup: the draft in the edit (agent ticks, a removed skill, the count), the save points with "Go back" and a damaged
// record shown as a refusal (never as "no save point yet"), and the review with its change list and the one tick that approves the revision.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { EditStep, SaveReview, SavePoints } from '../renderer/harness/sheets/SaveSheet.js';
import type { Shown } from '../renderer/harness/sheets/SaveSheet.js';
import { EMPTY_DRAFT, definitionWorld, draftView, linkSkill, removeSkill } from '../shared/harness/save-draft.js';
import type { DefinitionView, VersionView } from '../shared/engine/types.js';
import { ENGINE_WORDS } from '../renderer/harness/words-engine.js';

const BASE: DefinitionView = {
  id: 'weekly-report', description: 'Drafts the weekly report.', engines: ['claude-code', 'codex'], instructions: true,
  skills: [{ id: 'check-facts', name: 'check-facts', description: 'Checks each figure.' }, { id: 'draft-outline', name: 'draft-outline', description: 'Outlines it.' }],
  agents: [{ id: 'editor', name: 'editor', description: 'Edits.', skills: [], notes: [] }, { id: 'writer', name: 'writer', description: 'Writes.', skills: ['draft-outline'], notes: [] }],
  sources: [], kits: [],
};
const noop = (): void => undefined;
const V = (id: string, current: boolean): VersionView => ({ id, created: '2026-10-30T12:00:00Z', label: id === 'v1' ? 'As it was before the first save' : 'Saved 1 change', files: 5, current });

test('the edit draws the draft: the agent ticks follow it, a removed skill is marked, and the count says it is not saved yet', () => {
  const draft = removeSkill(BASE, linkSkill(BASE, EMPTY_DRAFT, 'editor', 'check-facts', true), 'draft-outline', true);
  const now = draftView(BASE, draft);
  const html = renderToStaticMarkup(createElement(EditStep, {
    base: BASE, now, draft, count: 2, held: false, versions: { ok: true, value: [] }, world: definitionWorld(now), linkingId: null, selectedId: null,
    onDraft: noop, onLinkStart: noop, onLinkTarget: noop, onLinkCancel: noop, onSelect: noop, onMove: noop, onGoBack: noop,
  }));
  assert.match(html, /data-draft="2"/);
  assert.ok(html.includes('2 changes, not saved yet.'));
  assert.ok(html.includes(ENGINE_WORDS.hint.draftNote));
  assert.match(html, /aria-label="check-facts: editor" checked=""/);
  assert.doesNotMatch(html, /aria-label="check-facts: writer" checked=""/);
  assert.match(html, /data-skill-row="draft-outline" data-removed=""/);
  assert.ok(html.includes(ENGINE_WORDS.hint.removedMark));
  // The graph draws the draft: the editor's new link, and no removed skill.
  assert.match(html, /data-node="agent:editor"/);
  assert.doesNotMatch(html, /data-node="skill:draft-outline"/);
});

test('the save points: newest first, the current one marked Now with no Go back, and an empty list says so in words', () => {
  const html = renderToStaticMarkup(createElement(SavePoints, { versions: { ok: true, value: [V('v2', true), V('v1', false)] }, held: false, onGoBack: noop }));
  assert.ok(html.indexOf('data-version="v2"') < html.indexOf('data-version="v1"'));
  assert.doesNotMatch(html, /data-go-back="v2"/);
  assert.match(html, /data-go-back="v1"/);
  assert.match(html, /aria-label="Go back to v1"/);
  assert.ok(html.includes('2026-10-30 12:00 UTC, 5 files'));
  const empty = renderToStaticMarkup(createElement(SavePoints, { versions: { ok: true, value: [] }, held: false, onGoBack: noop }));
  assert.ok(empty.includes(ENGINE_WORDS.hint.noSavePoints));
});

test('a damaged save point record is a refusal with words and what to do next, never "no save point yet"', () => {
  const html = renderToStaticMarkup(createElement(SavePoints, { versions: { ok: false, refusal: { code: 'VERSION_CORRUPT', message: 'The version store is damaged.', paths: [] } }, held: false, onGoBack: noop }));
  assert.match(html, /data-refusal="VERSION_CORRUPT"/);
  assert.ok(html.includes('The version store is damaged.'));
  assert.ok(html.includes('Set the old save points aside to start a new record.'));
  assert.ok(!html.includes(ENGINE_WORDS.hint.noSavePoints));
});

test('a damaged save point record offers to set the old save points aside: the plan says nothing is deleted, and the result names where they went', () => {
  const damaged = { ok: false as const, refusal: { code: 'VERSION_CORRUPT', message: 'The version store is damaged.', paths: [] } };
  const aside = (over: Partial<{ view: { folder: string; damaged: boolean; revision: string } | null; done: string | null }> = {}) => ({ view: null, done: null, plan: noop, run: noop, ...over });
  const offer = renderToStaticMarkup(createElement(SavePoints, { versions: damaged, held: false, onGoBack: noop, setAside: aside() }));
  assert.match(offer, /data-set-aside=""/);
  assert.ok(offer.includes(ENGINE_WORDS.label.planSetAside));
  // A record that reads offers nothing to set aside.
  const whole = renderToStaticMarkup(createElement(SavePoints, { versions: { ok: true, value: [V('v1', true)] }, held: false, onGoBack: noop, setAside: aside() }));
  assert.doesNotMatch(whole, /data-set-aside/);
  const planned = renderToStaticMarkup(createElement(SavePoints, { versions: damaged, held: false, onGoBack: noop, setAside: aside({ view: { folder: '~/Projects/team', damaged: true, revision: 'abcdef12'.repeat(8) } }) }));
  assert.match(planned, /data-run-set-aside=""/);
  assert.ok(planned.includes(ENGINE_WORDS.hint.setAsideNote));
  assert.ok(planned.includes(ENGINE_WORDS.label.setAside));
  const done = renderToStaticMarkup(createElement(SavePoints, { versions: { ok: true, value: [] }, held: false, onGoBack: noop, setAside: aside({ done: 'versions-set-aside-20261030T120000Z' }) }));
  assert.match(done, /data-set-aside-done="versions-set-aside-20261030T120000Z"/);
  assert.ok(done.includes(ENGINE_WORDS.hint.setAsideDone));
});

test('a save point record the state layer refuses as unsafe offers to set the old save points aside too; another refusal does not', () => {
  const aside = { view: null, done: null, plan: noop, run: noop };
  const unsafe = renderToStaticMarkup(createElement(SavePoints, { versions: { ok: false, refusal: { code: 'PORTABLE_STATE_UNSAFE', message: 'Unsafe.', paths: [] } }, held: false, onGoBack: noop, setAside: aside }));
  assert.match(unsafe, /data-refusal="PORTABLE_STATE_UNSAFE"/);
  assert.match(unsafe, /data-set-aside=""/);
  const other = renderToStaticMarkup(createElement(SavePoints, { versions: { ok: false, refusal: { code: 'VERSION_UNKNOWN', message: 'Unknown.', paths: [] } }, held: false, onGoBack: noop, setAside: aside }));
  assert.doesNotMatch(other, /data-set-aside/);
});

test('the review lists each file with its action, the harness as it will be, and one tick that names the revision; a no-change plan offers no tick', () => {
  const view = { folder: '~/Projects/weekly-report', changes: [{ path: '.bowerloom/agents/editor.md', action: 'update' as const }], definition: draftView(BASE, linkSkill(BASE, EMPTY_DRAFT, 'editor', 'check-facts', true)), noop: false, revision: 'abcdef12'.repeat(8), removedSources: [], copiedExecutables: [], acknowledge: null };
  const shown: Shown = { kind: 'save', view, edits: [{ kind: 'set-agent', id: 'editor', skills: ['check-facts'] }] };
  const html = renderToStaticMarkup(createElement(SaveReview, { shown, approved: false, held: false, onApprove: noop }));
  assert.match(html, /data-file="\.bowerloom\/agents\/editor\.md" data-action="update"/);
  assert.match(html, /data-agent-after="editor"/);
  assert.ok(html.includes('I approve plan abcdef12'));
  const same = renderToStaticMarkup(createElement(SaveReview, { shown: { ...shown, view: { ...view, changes: [], noop: true } }, approved: false, held: false, onApprove: noop }));
  assert.doesNotMatch(same, /data-approve-plan/);
  const back: Shown = { kind: 'restore', view: { ...view, version: V('v1', false) } };
  const restore = renderToStaticMarkup(createElement(SaveReview, { shown: back, approved: true, held: false, onApprove: noop }));
  assert.match(restore, /data-save-review="restore"/);
  assert.match(restore, /data-going-back="v1"/);
});
