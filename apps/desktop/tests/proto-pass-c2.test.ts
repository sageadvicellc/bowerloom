// Fix pass C2: a screen never says "done" for a change that did not happen, and never goes blank without a word.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ACCESS_WORDS, buildHarnessMap } from '../shared/proto/harnessmodel.js';
import { attachToolOutcome, connectOutcome, connectResult } from '../shared/proto/editor-actions.js';
import { REDO_WORDS, UNDO_WORDS, changeBarText } from '../shared/proto/editor-describe.js';
import { editCount, planProjection } from '../shared/proto/plan.js';
import { addLibraryOutcome, waitingSentence, waitingView } from '../shared/proto/library-install.js';
import { generateWorld } from '../shared/proto/sample.js';
import { createStore, isDirty } from '../shared/proto/store.js';
import { startGraph, GRAPH_FAILED_WORDS } from '../renderer/proto/knowledge-graph-view.js';
import { CRASH_TITLE, ErrorBoundary } from '../renderer/proto/error-boundary.js';
import { MISSING_SESSION_MESSAGE, ProtoProvider, isMissingSession, useProtoStore } from '../renderer/proto/session.js';
import { BringIn } from '../renderer/proto/SetupScreen.js';
import { BRING_BLOCKED_WORDS, bringInWords, settledList, unrelatedEdits } from '../shared/proto/setup-flow.js';
import { buildReview } from '../shared/proto/scan-review.js';
import { buildScan } from '../shared/proto/scan-places.js';
import { initialSetup } from '../shared/proto/setup-flow.js';
import type { World } from '../shared/proto/types.js';
import { LIBRARY_CATALOG, catalogItemId } from '../shared/proto/library-catalog.js';
import { makeWorld, skill } from './proto-testworld.js';

const world = generateWorld(1);
const text = (markup: string): string => markup.replace(/<[^>]*>/g, ' ').replace(/&#x27;/g, "'").replace(/\s+/g, ' ').trim();
const ctxOf = (w: World, scopeId = 'global') => ({ world: w, model: buildHarnessMap(w, { scopeId, showInherited: true, expandedGroups: [] }) });

// ---- 6. undo, redo, attach with the same access

test('undo and redo have their own words for the status line', () => {
  assert.equal(UNDO_WORDS, 'Undid the last change.'); assert.equal(REDO_WORDS, 'Redid it.');
});

test('attaching a tool with the access it already has is refused in words, not told as done', () => {
  const o = attachToolOutcome('a', 't', 'read-only', ACCESS_WORDS, 'Planner', 'Search', 'read-only');
  assert.equal(o.kind, 'refused');
  if (o.kind === 'refused') assert.equal(o.message, 'It already has this tool with that access.');
  assert.equal(attachToolOutcome('a', 't', 'read-write', ACCESS_WORDS, 'Planner', 'Search', 'read-only').kind, 'action');
  assert.equal(attachToolOutcome('a', 't', 'read-only', ACCESS_WORDS, 'Planner', 'Search', null).kind, 'action');
  assert.equal(attachToolOutcome('a', 't', 'read-only', ACCESS_WORDS, 'Planner', 'Search').kind, 'action', 'old callers still compile and work');
});

// ---- 7. the canvas hears the outcome

test('a wire from a skill to a skill is refused, a wire from a skill to an agent is done, and a tool opens the chooser', () => {
  const w = makeWorld(), c = ctxOf(w);
  assert.equal(connectResult(connectOutcome(c, 's1', 's2')), 'refused');
  assert.equal(connectResult(connectOutcome(c, 's2', 'a1')), 'done');
  assert.equal(connectResult(connectOutcome(c, 't1', 'a1')), undefined, 'nothing is wired until the access class is picked');
});

// ---- 8. the graph that cannot be drawn

test('a graph that cannot start tells the screen, and a graph that starts does not', async () => {
  const failures: unknown[] = [];
  await startGraph({ start: () => Promise.reject(new Error('no force-graph')) }, [], e => failures.push(e));
  await startGraph({ start: () => { throw new Error('constructor threw'); } }, [], e => failures.push(e));
  await startGraph({ start: () => Promise.resolve() }, [], e => failures.push(e));
  assert.equal(failures.length, 2);
  assert.match(GRAPH_FAILED_WORDS, /^The graph could not be drawn\. The list of pages still works\.$/);
});

// ---- 9. a render error does not blank the window

test('the error boundary shows a plain message, the error text and a Reload button', () => {
  const error = new Error('boom in a screen');
  const state = ErrorBoundary.getDerivedStateFromError(error);
  assert.equal(state.error, error);
  const boundary = new ErrorBoundary({ children: createElement('p', null, 'fine') });
  assert.match(text(renderToStaticMarkup(boundary.render() as never)), /fine/);
  boundary.state = state;
  const t = text(renderToStaticMarkup(boundary.render() as never));
  assert.match(t, new RegExp(CRASH_TITLE.replace('.', '\\.')));
  assert.equal(CRASH_TITLE, 'Something went wrong. Nothing was saved.');
  assert.match(t, /boom in a screen/); assert.match(t, /Reload/);
  assert.doesNotMatch(t, /fine/);
});

// ---- 10. setup says what it keeps, and settled means settled

test('bring in says how many items are in the ticked places and that every found item is kept', () => {
  const places = buildScan(world), ids = places.map(p => p.id).slice(0, 1);
  const review = buildReview(world, ids);
  const words = bringInWords(review, world), found = world.items.filter(i => i.foundAt.length > 0).length;
  assert.match(words.count, new RegExp(`^${review.itemCount} of ${found} items are in the places you ticked\\.$`));
  assert.equal(words.keeps, 'The prototype keeps every item it found.');
  assert.ok(review.itemCount < found, 'a partial tick is a partial count');
});

test('unrelated unsaved edits stop bring in; its own conflict choices do not', () => {
  assert.equal(unrelatedEdits(undefined, 'x', true), false, 'no baseline, nothing known');
  assert.equal(unrelatedEdits({ snapshot: 'a', foreign: false }, 'a', true), false, 'only the flow\'s own edits');
  assert.equal(unrelatedEdits({ snapshot: 'a', foreign: false }, 'b', true), true, 'something else changed the draft');
  assert.equal(unrelatedEdits({ snapshot: 'a', foreign: true }, 'a', true), true, 'it was dirty before the flow began');
  assert.equal(unrelatedEdits({ snapshot: 'a', foreign: true }, 'b', false), false, 'a clean draft has nothing to apply');
});

test('the bring in step shows the stop message and no way to apply when blocked', () => {
  const places = buildScan(world), ids = places.map(p => p.id), review = buildReview(world, ids);
  const draw = (blocked: boolean): string => renderToStaticMarkup(createElement(ProtoProvider, { store: createStore(world) }, createElement(function P() {
    return createElement(BringIn, { flow: { ...initialSetup(), step: 'bring-in', harnessRoot: '/a', knowledgeRoot: '/b', ticked: ids }, send: () => undefined, review, places: ids.length, world, session: useProtoStore(), blocked });
  })));
  assert.equal(BRING_BLOCKED_WORDS, 'You have unsaved changes on the Harness screen. Apply or discard them first.');
  const open = draw(false), shut = draw(true);
  assert.doesNotMatch(text(open), /unsaved changes/);
  assert.match(text(shut), /You have unsaved changes on the Harness screen\. Apply or discard them first\./);
  assert.match(shut, /<button[^>]*disabled=""[^>]*>Bring these in<\/button>/);
  assert.doesNotMatch(open, /<button[^>]*disabled=""[^>]*>Bring these in<\/button>/);
  assert.match(text(open), /items are in the places you ticked\./); assert.match(text(open), /The prototype keeps every item it found\./);
  assert.doesNotMatch(text(open), /Brings in \d+ skills/);
});

test('a conflict that came back is no longer listed as settled', () => {
  const resolved = { a: 'A: kept the Codex version.', b: 'B: kept both.' };
  const conflicts = [{ itemId: 'a' }] as never;
  assert.deepEqual(settledList(resolved, conflicts), [['b', 'B: kept both.']]);
  assert.deepEqual(settledList(resolved, [] as never), [['a', 'A: kept the Codex version.'], ['b', 'B: kept both.']]);
});

// ---- 11. edits are not files

test('one new skill is one edit, even when it writes many files', () => {
  const store = createStore(world), g = world.items.find(i => i.kind === 'skill' && i.library === null && i.scopeId === 'global')!;
  store.dispatch({ type: 'installItem', itemId: g.id, targetScopeId: 'global' });
  const s = store.getState();
  assert.equal(isDirty(s), true);
  const plan = planProjection(s.committed, s.draft);
  assert.ok(plan.changes.length >= 2, 'a skill writes a file for each interface');
  assert.equal(editCount(s.committed, s.draft), 1);
  assert.equal(plan.edits, 1);
  assert.equal(changeBarText(true, plan.changes.length, 1), `1 edit waiting. ${plan.changes.length} files would change.`);
});

test('the change bar words: none, one of each, many, and no file', () => {
  assert.equal(changeBarText(false, 0, 0), 'No changes waiting'); assert.equal(changeBarText(false, 7, 3), 'No changes waiting');
  assert.equal(changeBarText(true, 1, 1), '1 edit waiting. 1 file would change.');
  assert.equal(changeBarText(true, 12, 4), '4 edits waiting. 12 files would change.');
  assert.equal(changeBarText(true, 0, 2), '2 edits waiting. No file would change.');
  assert.equal(waitingSentence(true, 3, 1), '1 edit waiting. 3 files would change. Apply on the Harness screen.');
  assert.equal(waitingView(true, { changes: [], edits: 2 }).headline, '2 edits waiting. No file would change.');
});

// ---- 12. the cheap ones

test('adding a library: a new one is an action; one that is there, or whose item ids are taken, is refused as already added', () => {
  const w = { ...makeWorld(), libraries: [] };
  const fresh = addLibraryOutcome(w, 'lantern-works');
  assert.equal(fresh.kind, 'action');
  assert.equal(addLibraryOutcome(w, 'not-a-library').kind, 'refused');
  const store = createStore(w);
  if (fresh.kind === 'action') store.dispatch(fresh.action);
  const there = addLibraryOutcome(store.getState().draft, 'lantern-works');
  assert.deepEqual(there, { kind: 'refused', message: 'Already added.' });
  const taken = { ...w, items: [...w.items, { ...skill(catalogItemId('lantern-works', LIBRARY_CATALOG.find(l => l.id === 'lantern-works')!.skills[0]!.key), 'Squatter') }] };
  assert.deepEqual(addLibraryOutcome(taken, 'lantern-works'), { kind: 'refused', message: 'Already added.' }, 'the store would refuse it, so the screen must not say added');
});

test('only the missing-session error is swallowed by the optional session hook', () => {
  assert.equal(isMissingSession(new Error(MISSING_SESSION_MESSAGE)), true);
  assert.equal(isMissingSession(new Error('something else broke')), false);
  assert.equal(isMissingSession('text'), false);
});

test('the root of the graph says "Nothing to show with this filter." when a filter hides everything, and "Nothing here yet" only for an empty harness', () => {
  const root = (w: World, view: Parameters<typeof buildHarnessMap>[1]): string => buildHarnessMap(w, view).nodes.find(n => n.kind === 'scope')!.detail;
  const w = makeWorld(), empty: World = { ...w, items: [] };
  assert.equal(root(empty, { scopeId: 'global', showInherited: true, expandedGroups: [] }), 'Nothing here yet');
  assert.equal(root(empty, { scopeId: 'global', showInherited: true, expandedGroups: [], interfaceFilter: 'codex' }), 'Nothing to show with this filter.');
  assert.equal(root(w, { scopeId: 'global', showInherited: true, expandedGroups: [], interfaceFilter: 'opencode' }), 'Nothing to show with this filter.', 'no item here was found in OpenCode');
  const inheritOnly: World = { ...w, items: w.items.filter(i => i.scopeId === 'global') };
  assert.equal(root(inheritOnly, { scopeId: 'proj', showInherited: false, expandedGroups: [] }), 'Nothing to show with this filter.');
  assert.match(root(w, { scopeId: 'global', showInherited: true, expandedGroups: [] }), /skill/);
});
