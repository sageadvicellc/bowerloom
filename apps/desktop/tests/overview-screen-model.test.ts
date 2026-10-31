// The decisions of the Overview screen apart from the screen (Task 2 lane H): the view, the open places, what a place offers, the bright set of a selection, the window that
// follows a key, and the words the screen builds. Pure data, no DOM.
import test from 'node:test';
import assert from 'node:assert/strict';
import { OVERVIEW_LIMITS, overviewOf } from '../shared/harness/overview.js';
import type { FolderInfo } from '../shared/engine/types.js';
import { createSampleOverviewState } from '../shared/harness/sample.js';
import type { HarnessState, Part, PartKind, ScanSource } from '../shared/harness/types.js';
import { LIMITS, bannedHere, countWords } from '../shared/harness/words.js';
import { OVERVIEW, chooseFolderName, kindWords, nodeName, placesWords, toggleName, usesLineWords } from '../renderer/harness/words-overview.js';
import {
  allOverrides, brightOf, canExpandAll, chosenMatches, copiesOf, expandedOf, indexOverview, isHomeLabel, litPlaces, neighbourPlace, placeAction, placeStatus, placesOf, revealView,
  toggledOverrides, usesCounts, viewFor,
} from '../renderer/harness/screens/OverviewModel.js';

const part = (id: string, kind: PartKind, name: string, extra: Partial<Part> = {}): Part =>
  ({ id, kind, name, summary: `${name}.`, description: '', path: '', source: '', origin: '', fileText: '', cannotUse: [], inLibrary: true, ...extra });
const folder = (id: string, label: string, hasDefinition: boolean): FolderInfo =>
  ({ id, label, name: label.split('/').at(-1) ?? label, hasDefinition, engines: [], previewEngines: false, installedEngines: [], problem: null, projected: false, unfinished: { projection: false, adoption: false } });
const sample = (folders: readonly FolderInfo[] = []) => overviewOf(createSampleOverviewState(), folders);

// ---- the view

test('the List is the default view in a window under the small-screen width, and a choice always wins', () => {
  assert.equal(viewFor(null, OVERVIEW_LIMITS.smallScreen - 1), 'list');
  assert.equal(viewFor(null, OVERVIEW_LIMITS.smallScreen), 'graph');
  assert.equal(viewFor(null, 390), 'list');
  assert.equal(viewFor(null, 1440), 'graph');
  assert.equal(viewFor('graph', 390), 'graph');
  assert.equal(viewFor('list', 1440), 'list');
});

// ---- the open places

test('a place follows the default rule until the person presses it; a press flips what it shows now', () => {
  const o = sample();
  const none = new Map<string, boolean>();
  const rule = expandedOf(o, none);
  assert.ok(rule.has(o.groups[0]!.id), 'the home is open');
  const last = o.groups.at(-1)!.id;
  const flipped = toggledOverrides(none, last, rule.has(last));
  assert.equal(expandedOf(o, flipped).has(last), !rule.has(last));
  assert.equal(none.size, 0, 'the old map is not changed');
  assert.ok(o.groups.every(g => expandedOf(o, allOverrides(o, true)).has(g.id)));
  assert.equal(expandedOf(o, allOverrides(o, false)).size, 0);
  // A choice for a place that is not there is ignored.
  assert.deepEqual([...expandedOf(o, new Map([['nope', true]]))].sort(), [...rule].sort());
});

test('"Expand all" is allowed up to the limit of parts in all, and off above it', () => {
  const small = indexOverview(sample());
  assert.equal(canExpandAll(small), true);
  const parts: Part[] = [], ids: string[] = [];
  for (let i = 0; i <= OVERVIEW_LIMITS.expandAllMax; i += 1) { parts.push(part(`p${i}`, 'skill', `s${i}`)); ids.push(`p${i}`); }
  const source: ScanSource = { id: 's', name: 'Home', interfaceName: 'Claude Code', harnessName: 'h', partIds: ids, scope: 'home', label: '~' };
  const state = { ...createSampleOverviewState(), parts, sources: [source] } as HarnessState;
  const big = indexOverview(overviewOf(state, []));
  assert.equal(big.nodes, OVERVIEW_LIMITS.expandAllMax + 1);
  assert.equal(canExpandAll(big), false);
});

// ---- what a place offers

test('a place outside home never says it is in Bowerloom, even when main knows a folder with the same last name', () => {
  const source: ScanSource = { id: 'out', name: 'app', interfaceName: 'Claude Code', harnessName: 'h', partIds: [], scope: 'project', label: '/Volumes/B/app' };
  const state = { ...createSampleOverviewState(), sources: [source] } as HarnessState;
  // Main labels the folder with its full path, which is also what the window would compare with.
  for (const label of ['/Volumes/A/app', '/Volumes/B/app', '…/app', 'app']) {
    const g = overviewOf(state, [folder('folder-1', label, true)]).groups[0]!;
    assert.equal(g.label, '…/app');
    // The model does not match a full path to the cut label; the screen does not rely on it even when a label would (a label that main never gives).
    if (label !== '…/app') assert.equal(g.inBowerloom, false, label);
    assert.equal(placeStatus(g), 'unknown', label);
    assert.equal(placeAction(g), 'choose', label);
  }
});

test('a place under home says In Bowerloom with a harness and Open in builder; without one it says not yet and offers Choose this folder', () => {
  const known = sample([folder('folder-7', '~/Projects/alpha', true)]);
  const alpha = known.groups.find(g => g.label === '~/Projects/alpha')!, beta = known.groups.find(g => g.label === '~/Projects/beta')!;
  assert.equal(placeStatus(alpha), 'in'); assert.equal(placeAction(alpha), 'open'); assert.equal(alpha.folderId, 'folder-7');
  assert.equal(placeStatus(beta), 'not-in'); assert.equal(placeAction(beta), 'choose');
  // A folder main knows that holds no harness is not "In Bowerloom".
  const bare = sample([folder('folder-8', '~/Projects/alpha', false)]).groups.find(g => g.label === '~/Projects/alpha')!;
  assert.equal(placeStatus(bare), 'not-in'); assert.equal(placeAction(bare), 'choose');
  assert.equal(isHomeLabel('~'), true); assert.equal(isHomeLabel('~/Projects'), true); assert.equal(isHomeLabel('~x'), false); assert.equal(isHomeLabel('…/app'), false); assert.equal(isHomeLabel('Your Claude Code folder'), false);
});

test('the folder the person chose must be the folder shown: the exact label under home, the same last name outside it', () => {
  const o = sample();
  const alpha = o.groups.find(g => g.label === '~/Projects/alpha')!;
  assert.equal(chosenMatches(alpha, '~/Projects/alpha'), true);
  assert.equal(chosenMatches(alpha, '~/Projects/beta'), false);
  assert.equal(chosenMatches(alpha, '~/Other/alpha'), false);
  assert.equal(chosenMatches(alpha, '/Volumes/X/alpha'), false);
  const outside = { ...alpha, label: '…/app' };
  assert.equal(chosenMatches(outside, '/Volumes/B/app'), true);
  assert.equal(chosenMatches(outside, 'C:\\Work\\app'), true);
  assert.equal(chosenMatches(outside, '/Volumes/B/other'), false);
  assert.equal(chosenMatches(outside, '~/app'), true, 'the last name is all the window can compare');
  assert.equal(chosenMatches({ ...alpha, label: '…' }, '…'), false, 'a label with no name matches nothing');
  const home = o.groups[0]!;
  assert.equal(home.label, '~'); assert.equal(chosenMatches(home, '~'), true); assert.equal(chosenMatches(home, '~/x'), false);
});

// ---- selection

test('selecting a shared skill lights every copy and the places that hold one; a part that is not shared lights itself and what it is joined to', () => {
  const o = sample(), index = indexOverview(o);
  const copies = [...o.sharedKeys.values()][0]!;
  assert.equal(copies.length, 3, 'Check facts is in the home, alpha and beta');
  const first = index.node(copies[0]!)!;
  assert.deepEqual([...copiesOf(o, first.node)], [...copies]);
  const bright = brightOf(o, index, copies[0]!)!;
  for (const id of copies) assert.ok(bright.has(id), id);
  // The agent that uses the copy in alpha is bright when that copy is selected, and the agent of beta is not.
  const alphaCopy = copies.find(id => id.startsWith('src-alpha/'))!, betaCopy = copies.find(id => id.startsWith('src-beta/'))!;
  const reviewer = index.usedBy(alphaCopy)[0]!, docWriter = index.usedBy(betaCopy)[0]!;
  assert.ok(reviewer.includes('reviewer'));
  assert.ok(brightOf(o, index, alphaCopy)!.has(reviewer));
  assert.equal(brightOf(o, index, alphaCopy)!.has(docWriter), false);
  assert.deepEqual([...litPlaces(o, index, copies[0]!)].sort(), copies.map(id => index.node(id)!.group.id).sort());
  // A part that is not shared.
  const glossary = [...o.groups.find(g => g.id === 'src-beta')!.nodes].find(n => n.name === 'Beta glossary')!;
  assert.equal(litPlaces(o, index, glossary.id).size, 0);
  const b = brightOf(o, index, glossary.id)!;
  assert.ok(b.has(glossary.id) && b.has(index.usedBy(glossary.id)[0]!)); assert.equal(b.size, 2);
  assert.equal(brightOf(o, index, null), null); assert.equal(brightOf(o, index, 'no/such'), null);
});

test('the places of a part: its own first, then each place that holds a copy', () => {
  const o = sample(), index = indexOverview(o);
  const copies = [...o.sharedKeys.values()][0]!;
  const places = placesOf(index, copies[1]!);
  assert.equal(places[0]!.id, index.node(copies[1]!)!.group.id);
  assert.equal(places.length, 3);
  assert.deepEqual(new Set(places.map(g => g.id)), new Set(copies.map(id => index.node(id)!.group.id)));
  assert.deepEqual(placesOf(index, 'no/such'), []);
  const plain = [...o.groups.find(g => g.id === 'src-gamma')!.nodes][0]!;
  assert.equal(placesOf(index, plain.id).length, 1);
});

test('what an agent uses is counted by kind from the edges the files name', () => {
  const o = sample(), index = indexOverview(o);
  const reviewer = o.groups.find(g => g.id === 'src-alpha')!.nodes.find(n => n.name === 'Reviewer')!;
  assert.deepEqual(usesCounts(index, reviewer.id), { skill: 1, tool: 2 });
  assert.deepEqual(usesCounts(index, 'no/such'), {});
  assert.equal(usesLineWords(usesCounts(index, reviewer.id)), 'uses 1 skill, 2 tools');
});

// ---- the window

test('a card is brought into the window by the smallest move, and a card already in view leaves the view as it is', () => {
  const view = { x: 0, y: 0, k: 1 };
  const inside = { x: 100, y: 100, w: 200, h: 60 };
  assert.equal(revealView(view, inside, 800, 600), view);
  assert.deepEqual(revealView(view, { x: 900, y: 100, w: 200, h: 60 }, 800, 600, 24), { k: 1, x: -(1100 - 800 + 24), y: 0 });
  assert.deepEqual(revealView(view, { x: -300, y: 100, w: 200, h: 60 }, 800, 600, 24), { k: 1, x: 324, y: 0 });
  assert.deepEqual(revealView(view, { x: 100, y: 700, w: 200, h: 60 }, 800, 600, 24), { k: 1, x: 0, y: -(760 - 600 + 24) });
  assert.deepEqual(revealView({ x: 50, y: 50, k: 0.5 }, { x: 4000, y: 4000, w: 100, h: 100 }, 800, 600, 10), { k: 0.5, x: -1260, y: -1460 });
  // A card wider than the window keeps its left edge in view.
  const wide = revealView(view, { x: 900, y: 0, w: 2000, h: 60 }, 800, 600, 24);
  assert.equal(wide.x + 900, 24);
});

test('the arrow keys on a header step through the places and stop at the ends', () => {
  const ids = ['a', 'b', 'c', 'd', 'e'];
  assert.equal(neighbourPlace(ids, 'a', 'ArrowRight', 3), 'b');
  assert.equal(neighbourPlace(ids, 'b', 'ArrowLeft', 3), 'a');
  assert.equal(neighbourPlace(ids, 'a', 'ArrowDown', 3), 'd');
  assert.equal(neighbourPlace(ids, 'e', 'ArrowUp', 3), 'b');
  assert.equal(neighbourPlace(ids, 'a', 'ArrowLeft', 3), null);
  assert.equal(neighbourPlace(ids, 'e', 'ArrowRight', 3), null);
  assert.equal(neighbourPlace(ids, 'c', 'ArrowDown', 3), null);
  assert.equal(neighbourPlace(ids, 'x', 'ArrowRight', 3), null);
  assert.equal(neighbourPlace(ids, 'a', 'ArrowDown', 0), 'b', 'a grid of no columns still moves one');
});

// ---- the words

test('the words the screen builds obey the rules of the preview', () => {
  const built = [placesWords(1), placesWords(4), kindWords('agent'), kindWords('skill'), kindWords('tool'), kindWords('context'), kindWords('tool', 'mcp'), kindWords('tool', 'prompt'), kindWords('tool', 'hook'),
    chooseFolderName('alpha (Claude Code)'), toggleName('alpha', true), toggleName('alpha', false), usesLineWords({ skill: 2, tool: 1, context: 1 }) ?? ''];
  for (const text of built) { assert.equal(bannedHere(text), null, text); assert.ok(countWords(text) <= LIMITS.hint, text); assert.equal(text, text.trim()); }
  assert.equal(placesWords(1), '1 place'); assert.equal(placesWords(4), '4 places');
  assert.equal(usesLineWords({}), null); assert.equal(usesLineWords({ skill: 0 }), null);
  assert.equal(usesLineWords({ skill: 1 }), 'uses 1 skill');
  assert.equal(usesLineWords({ skill: 2, tool: 1, context: 3 }), 'uses 2 skills, 1 tool, 3 sets of notes');
  assert.equal(kindWords('tool', 'hook'), OVERVIEW.label.kindHook);
  assert.equal(chooseFolderName('alpha'), 'Choose the folder for alpha');
  assert.equal(toggleName('alpha', true), 'Collapse alpha'); assert.equal(toggleName('alpha', false), 'Expand alpha');
});

test('a node name that has a line of uses says it once, in place of the single-kind form, and the old form still works', () => {
  assert.equal(nodeName({ name: 'Reviewer', kind: 'agent', group: 'alpha', uses: 0, usesLine: 'uses 1 skill, 2 tools', sharedWith: 0 }), 'Reviewer, agent, alpha, uses 1 skill, 2 tools');
  assert.equal(nodeName({ name: 'Tidy', kind: 'agent', group: 'alpha', uses: 2, usesKind: 'skill', sharedWith: 0 }), 'Tidy, agent, alpha, uses 2 skills');
  assert.equal(nodeName({ name: 'Format', kind: 'tool', toolKind: 'hook', group: 'alpha', uses: 0, runsCode: true, sharedWith: 2 }), 'Format, hook, alpha, runs code, shared with 2 places');
});
