// Fixes to the prototype screens that are about behaviour: the focus words, the undo guard, the one rule for "unsaved" on the Knowledge screen,
// where the nodes are kept, what Start again says, and how items are counted once. Screens that need a real window are checked in e2e/proto-*.spec.ts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { KnowledgeFlow } from '../renderer/proto/KnowledgeScreen.js';
import { keyedLines } from '../renderer/proto/knowledge-panels.js';
import { Inspector, ResultPanel } from '../renderer/proto/harness-parts.js';
import { keepPositions, positionsFor } from '../renderer/proto/harness-positions.js';
import { ProtoProvider, useProtoStore } from '../renderer/proto/session.js';
import { BROUGHT_IN_LABEL, START_AGAIN_DONE_WORDS, START_AGAIN_WORDS, SetupFlow, broughtInVersion } from '../renderer/proto/SetupScreen.js';
import { describeSelection } from '../shared/proto/editor-describe.js';
import { NO_OWN_GROUPS, buildHarnessMap } from '../shared/proto/harnessmodel.js';
import { initialKnowledge, isDirty as sliceDirty, reduceKnowledge, sameRule, sameSeeds } from '../shared/proto/knowledge-state.js';
import { generateWorld } from '../shared/proto/sample.js';
import { buildScan } from '../shared/proto/scan-places.js';
import { initialSetup } from '../shared/proto/setup-flow.js';
import type { SetupState } from '../shared/proto/setup-flow.js';
import { createStore } from '../shared/proto/store.js';
import type { StoreState } from '../shared/proto/store.js';
import { DESKTOP } from './support.js';

const world = generateWorld(1);
const textOf = (markup: string): string => markup.replace(/<[^>]*>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const ref = { current: null };
const noop = (): void => undefined;

// ------------------------------------------------------------------------------------------------------- undo and redo stop at a version

// What the Harness screen reads: the plain stacks of the store. The store clears them on apply and restore.
const canUndoDraft = (s: StoreState): boolean => s.undoStack.length > 0;
const canRedoDraft = (s: StoreState): boolean => s.redoStack.length > 0;
const edit = (store: ReturnType<typeof createStore>, n = 0): void => { store.dispatch({ type: 'attachSkill', agentId: 'agent-01', skillId: n === 0 ? 'skill-030' : 'skill-031' }); };

test('Undo is off with nothing to undo, on after an edit, and off right after Apply (the real store)', () => {
  const store = createStore(world);
  assert.equal(canUndoDraft(store.getState()), false, 'an empty undo list');
  edit(store);
  assert.equal(canUndoDraft(store.getState()), true, 'an edit can be undone');
  store.dispatch({ type: 'apply', label: 'One' });
  assert.equal(store.getState().undoStack.length, 0, 'the store clears the old steps on apply');
  assert.equal(canUndoDraft(store.getState()), false, 'but Undo does not walk back past the version');
  edit(store, 1);
  assert.equal(canUndoDraft(store.getState()), true, 'an edit after the apply can be undone');
  store.dispatch({ type: 'undo' });
  assert.equal(canUndoDraft(store.getState()), false, 'and stops at the version again');
  assert.equal(canRedoDraft(store.getState()), true, 'the undone edit can be redone');
});

test('Undo is off right after a restore, and Redo does not cross a version', () => {
  const store = createStore(world);
  edit(store); store.dispatch({ type: 'apply', label: 'One' });
  edit(store, 1); store.dispatch({ type: 'apply', label: 'Two' });
  const first = store.getState().committed.versions[0]!;
  edit(store, 0);
  store.dispatch({ type: 'restore', versionId: first.id });
  assert.equal(canUndoDraft(store.getState()), false, 'after a restore');
  assert.equal(canRedoDraft(store.getState()), false);
  edit(store, 1);
  assert.equal(canUndoDraft(store.getState()), true, 'an edit after the restore');
  // Redo made before an apply cannot be used after it.
  const other = createStore(world);
  edit(other); other.dispatch({ type: 'undo' });
  assert.equal(canRedoDraft(other.getState()), true);
  edit(other, 1); other.dispatch({ type: 'undo' }); other.dispatch({ type: 'redo' }); other.dispatch({ type: 'apply', label: 'x' });
  assert.equal(canRedoDraft(other.getState()), false, 'after an apply');
  edit(other); other.dispatch({ type: 'undo' });
  assert.equal(canRedoDraft(other.getState()), true);
  other.dispatch({ type: 'restore', versionId: other.getState().committed.versions[0]!.id });
  assert.equal(canRedoDraft(other.getState()), false, 'after a restore');
  assert.equal(canUndoDraft(other.getState()), false);
});

// Decision: Discard does NOT clear the stacks (Apply and Restore do). The Discard message says "Undo brings them back", so the discarded draft must be a step on the undo list.
test('after Discard, Undo is on even though nothing waits, because Discard says Undo brings the changes back', () => {
  const store = createStore(world);
  edit(store);
  store.dispatch({ type: 'discard' });
  assert.equal(canUndoDraft(store.getState()), true);
  assert.equal(canRedoDraft(store.getState()), false, 'a discard leaves nothing to redo');
  store.dispatch({ type: 'undo' });
  assert.equal(store.getState().draft.items.some(i => i.kind === 'agent' && i.id === 'agent-01' && i.definition.skillIds.includes('skill-030')), true, 'the changes are back');
});

// ------------------------------------------------------------------------------------------------------- one rule for unsaved

test('the same pages in another order are the same pages: remove a seed and add it back, and nothing is unsaved', () => {
  const saved = world.slices.find(s => s.seeds.length >= 2)!;
  const pages = world.wikiPages;
  let s = initialKnowledge([saved]);
  assert.equal(sliceDirty(s, saved), false);
  const [first, ...rest] = saved.seeds;
  s = reduceKnowledge(s, { type: 'removeSeed', id: first! }, { pages });
  assert.equal(sliceDirty(s, saved), true, 'a seed is missing');
  // Put it back at the end, as picking it again does.
  s = { ...s, seeds: [...rest, first!] };
  assert.notDeepEqual(s.seeds, saved.seeds, 'the order is different');
  assert.equal(sliceDirty(s, saved), false, 'the set is the same');
  assert.equal(sameSeeds(['b', 'a'], ['a', 'b']), true);
  assert.equal(sameSeeds(['a'], ['a', 'b']), false);
});

test('rules compare as sets as well, and a new slice is unsaved only when it holds something', () => {
  const rule = { folders: ['a', 'b'], pageTypesAndTags: { types: ['x', 'y'], tags: ['t', 'u'] }, linksFromSeeds: null } as const;
  assert.equal(sameRule(rule, { folders: ['b', 'a'], pageTypesAndTags: { types: ['y', 'x'], tags: ['u', 't'] }, linksFromSeeds: null }), true);
  assert.equal(sameRule(rule, { ...rule, linksFromSeeds: { hops: 1 } }), false);
  assert.equal(sameRule(rule, { ...rule, folders: ['a'] }), false);
  const fresh = initialKnowledge([]);
  assert.equal(sliceDirty(fresh, null), false);
  assert.equal(sliceDirty({ ...fresh, name: 'Notes' }, null), true);
});

test('the Knowledge screen decides "unsaved" in one place: the shared isDirty, and no second comparison file', () => {
  const code = readFileSync(join(DESKTOP, 'renderer', 'proto', 'KnowledgeScreen.tsx'), 'utf8');
  assert.match(code, /import \{[^}]*\bisDirty\b[^}]*\} from '\.\.\/\.\.\/shared\/proto\/knowledge-state\.js'/, 'the screen imports the shared rule');
  assert.equal([...code.matchAll(/\bisDirty\(/g)].length, 2, 'the screen and the reload check use the same function');
  assert.equal(existsSync(join(DESKTOP, 'renderer', 'proto', 'knowledge-dirty.ts')), false, 'the duplicate is gone');
});

// ------------------------------------------------------------------------------------------------------- where the nodes are kept

test('positions are kept for each scope for the life of the session, and a different session starts with none', () => {
  const session = {}, other = {};
  assert.deepEqual(positionsFor(session, 'global'), {});
  const none = positionsFor(session, 'global');
  assert.equal(positionsFor(session, 'scope-a'), none, 'the same empty object comes back, so the canvas does not lay out again');
  const places = { 'skill-1': { x: 16, y: 32 } };
  keepPositions(session, 'global', places);
  assert.equal(positionsFor(session, 'global'), places);
  assert.deepEqual(positionsFor(session, 'scope-a'), {}, 'another scope has its own');
  assert.deepEqual(positionsFor(other, 'global'), {}, 'another session has its own');
});

// ------------------------------------------------------------------------------------------------------- the inspector

const model = (scopeId: string) => buildHarnessMap(world, { scopeId, showInherited: true, expandedGroups: [], groupLimits: NO_OWN_GROUPS });
const inheritedAgent = (): string => { const m = model('scope-copperfen'); return m.nodes.find(n => n.kind === 'agent' && n.inherited)!.id; };
const inspect = (id: string, copyHere: (() => void) | null): string => {
  const v = describeSelection(world, model('scope-copperfen'), id)!;
  return renderToStaticMarkup(createElement(Inspector, { view: v, onAction: noop, onClose: noop, headingRef: ref, replace: null, copyHere }));
};

test('an inherited agent gets a visible Copy to this harness button, and the note names the button and the drop', () => {
  const id = inheritedAgent();
  const withButton = inspect(id, noop), without = inspect(id, null);
  assert.match(withButton, /<button[^>]*>Copy to this harness<\/button>/);
  assert.doesNotMatch(without, /Copy to this harness<\/button>/);
  const v = describeSelection(world, model('scope-copperfen'), id)!;
  for (const markup of [withButton, without]) {
    assert.match(textOf(markup), /Or make a copy you can change here: press Copy to this harness, or drop it on this harness\./, 'the note gives the keyboard path and the drop');
  }
  assert.match(v.readOnlyNote!, /press Copy to this harness/);
  assert.match(v.readOnlyNote!, /drop it on this harness/);
  assert.doesNotMatch(v.readOnlyNote!, /\u2014|\u2013/, 'no dashes');
});

test('the empty inspector names the button as well as the drop', () => {
  const markup = renderToStaticMarkup(createElement(Inspector, { view: null, onAction: noop, onClose: noop, headingRef: ref, replace: null }));
  assert.match(textOf(markup), /select it and press Copy to this harness, or drop it on the harness/);
});

test('the result panel carries its state in an icon and words, not in colour or a thick one-sided border', () => {
  const plan = { changes: [{ interface: 'codex' as const, path: 'a/b.md', action: 'add' as const, preview: 'x' }] };
  const markup = renderToStaticMarkup(createElement(ResultPanel, { plan, counter: 1, label: 'x', onClose: noop, headingRef: ref }));
  assert.match(markup, /<h2[^>]*id="harness-result-title"[^>]*><svg[^>]*aria-hidden="true"/);
  const css = readFileSync(join(DESKTOP, 'renderer', 'proto', 'harness.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(css, /border-left-width:\s*6px/);
  assert.match(/\.harness-result \{[^}]*border: 1px solid var\(--good-fg\)/.exec(css)?.[0] ?? '', /border: 1px solid var\(--good-fg\)/);
  const setupCss = readFileSync(join(DESKTOP, 'renderer', 'proto', 'setup-screen.css'), 'utf8');
  assert.doesNotMatch(setupCss, /border-left:\s*[4-9]px/);
});

// ------------------------------------------------------------------------------------------------------- setup

function Probe({ initial }: { initial: SetupState }) { return createElement(SetupFlow, { session: useProtoStore(), initial }); }
const draw = (initial: SetupState, store = createStore(generateWorld(1))): string => renderToStaticMarkup(createElement(ProtoProvider, { store }, createElement(Probe, { initial })));
const roots = { harnessRoot: '/Users/sample/Studio', knowledgeRoot: '/Users/sample/Studio/knowledge', pickersOpen: true } as const;
const places = buildScan(world);

test('an item found in two ticked places is counted once in "items in them"', () => {
  const seen = new Map<string, number>();
  for (const p of places) for (const id of p.itemIds) seen.set(id, (seen.get(id) ?? 0) + 1);
  assert.ok([...seen.values()].some(n => n > 1), 'the sample has an item in two places');
  const all = places.map(p => p.id);
  const text = textOf(draw({ ...initialSetup(), ...roots, step: 'contents', scanned: true, ticked: all }));
  assert.match(text, new RegExp(`${all.length} of ${all.length} places ticked, ${seen.size} items in them`));
  assert.ok(places.reduce((n, p) => n + p.itemIds.length, 0) > seen.size, 'the old sum would have been bigger');
});

test('Start again says in one sentence what it does and does not undo, on the steps and on the last screen', () => {
  const mid = textOf(draw({ ...initialSetup(), ...roots, step: 'places', scanned: true }));
  assert.ok(mid.includes(START_AGAIN_WORDS));
  assert.match(START_AGAIN_WORDS, /does not undo changes already made to the harness/);
  assert.match(START_AGAIN_WORDS, /Discard on the Harness screen/);
  assert.equal(START_AGAIN_WORDS.split('. ').length, 1, 'one sentence');
  const done = draw({ ...initialSetup(), ...roots, step: 'done', scanned: true, ticked: places.map(p => p.id), broughtIn: true });
  assert.ok(textOf(done).includes(START_AGAIN_DONE_WORDS));
  assert.equal(START_AGAIN_DONE_WORDS.split('. ').length, 1);
  for (const words of [START_AGAIN_WORDS, START_AGAIN_DONE_WORDS]) assert.doesNotMatch(words, /\u2014|--|\bnpm\b|\bgit\b/);
  assert.match(done, /aria-describedby="sx-restart-note"/);
});

test('Done names only a version made during this run', () => {
  const store = createStore(world);
  edit(store); store.dispatch({ type: 'apply', label: BROUGHT_IN_LABEL });
  const firstRun = store.getState().committed.versions;
  assert.equal(broughtInVersion(firstRun, 0)?.counter, 1, 'the first run made version 1');
  assert.equal(broughtInVersion(firstRun, firstRun.length), undefined, 'a second run that made nothing names nothing');
  edit(store, 1); store.dispatch({ type: 'apply', label: BROUGHT_IN_LABEL });
  const both = store.getState().committed.versions;
  assert.equal(broughtInVersion(both, firstRun.length)?.counter, 2, 'a second run that made a version names its own');
});

// ------------------------------------------------------------------------------------------------------- the reasons list

test('folders with the same last name in different domains read differently, and lines that do read the same still get their own keys', () => {
  const pages = world.wikiPages, byFolder = new Map<string, string[]>();
  for (const p of pages) byFolder.set(p.folder, [...(byFolder.get(p.folder) ?? []), p.id]);
  const leaf = (folder: string): string => folder.split('/').pop()!;
  let pair: [string, string] | undefined;
  for (const [a, ida] of byFolder) for (const [b, idb] of byFolder) if (a < b && leaf(a) === leaf(b) && ida.length === idb.length) pair = [a, b];
  assert.ok(pair, 'the sample has two folders with the same last name and the same number of pages');
  const ids = [...byFolder.get(pair![0])!, ...byFolder.get(pair![1])!];
  const s = reduceKnowledge(initialKnowledge([]), { type: 'lassoResult', ids, mode: 'replace' }, { pages });
  const markup = renderToStaticMarkup(createElement(ProtoProvider, { store: createStore(generateWorld(1)) }, createElement(KnowledgeProbe, { initial: s })));
  const lines = [...markup.matchAll(/<li>(You picked \d+ of the [^<]*)<\/li>/g)].map(m => m[1]!);
  assert.ok(lines.length >= 2, 'both folders have a line');
  assert.equal(new Set(lines).size, lines.length, 'the lines name the full folder, so no two are word for word the same');
  const same = ['You picked 2 pages.', 'You picked 2 pages.'];
  const keys = keyedLines(same).map(l => l.key);
  assert.equal(new Set(keys).size, keys.length, 'lines that are word for word the same still have their own keys');
  assert.match(readFileSync(join(DESKTOP, 'renderer', 'proto', 'knowledge-panels.tsx'), 'utf8'), /keyedLines\(explainInference\(inferred\)\)/, 'the list uses them');
});

function KnowledgeProbe({ initial }: { initial: ReturnType<typeof initialKnowledge> }) { return createElement(KnowledgeFlow, { session: useProtoStore(), initial }); }
