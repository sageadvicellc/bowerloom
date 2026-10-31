// Wave F, Find: the first scan is one list of AGENTS (no per-app tiles, no per-app counts), each with flat tags for the apps it works with; after the first scan,
// Find more is a panel in the right column and never the full page again. The model, the machine and the words are pure and are checked here; the markup of the list and the
// panel is checked below, and the window is checked in e2e/home-find2.spec.ts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { generateWorld } from '../shared/proto/sample.js';
import type { World } from '../shared/proto/types.js';
import { agentCard, ownedAgents } from '../shared/home/cards.js';
import { withSampleCopies } from '../shared/home/sample-copies.js';
import { appLabel, findAgents, findPlaces, lockedAgents } from '../shared/home/find-model.js';
import { findReduce, startFind } from '../shared/home/find-flow.js';
import type { FindAction, FindState } from '../shared/home/find-flow.js';
import { screenAfter } from '../shared/home/flow-screens.js';
import type { FlowEvent, Screen } from '../shared/home/flow-screens.js';
import { createStore, reduceStore } from '../shared/proto/store.js';
import { FIND_WORDS, foundTitle, readProgress, readSummary, readingNow, unsavedAgent } from '../renderer/home/first-run/find-words.js';
import { FindScreen } from '../renderer/home/first-run/FindScreen.js';
import { FindPanel } from '../renderer/home/first-run/FindPanel.js';
import { ProtoProvider } from '../renderer/proto/session.js';
import { assertTextBudget, bannedIn, countWords } from '../shared/home/textbudget.js';
import { removeAction } from '../renderer/home/store-actions.js';
import { shelvesOf } from '../shared/home/cards.js';

const world = (): World => withSampleCopies(generateWorld(1));
const none = (): void => undefined;
const run = (state: FindState, ...actions: FindAction[]): FindState => actions.reduce(findReduce, state);

// ---- The model: one row for each agent.
test('the list has one row for each agent the person owns, in name order, with the same name and job as the map', () => {
  const w = world();
  const list = findAgents(w);
  const owned = ownedAgents(w);
  assert.equal(list.length, owned.length); assert.equal(list.length, 10);
  assert.deepEqual(list.map(a => a.name), [...list.map(a => a.name)].sort((a, b) => a.localeCompare(b)));
  for (const row of list) { const agent = owned.find(a => a.id === row.id)!; assert.deepEqual([row.name, row.hint], [agentCard(agent).name, agentCard(agent).hint]); }
  assert.equal(new Set(list.map(a => a.id)).size, 10, 'an agent is in the list once');
});

test('each agent carries a flat tag for every app it works with, by the app\'s own name, once each', () => {
  const w = world();
  const list = findAgents(w);
  for (const row of list) {
    assert.ok(row.apps.length >= 1, `${row.name} works in at least one app`);
    assert.equal(new Set(row.apps).size, row.apps.length, 'no tag twice');
    for (const app of row.apps) assert.ok(['Claude Code', 'Codex', 'OpenCode'].includes(app), app);
  }
  // The tags are the apps of the agent's own files, as the old tiles counted them: the totals agree with the tile counts (9, 4 and 4).
  const count = (name: string): number => list.filter(a => a.apps.includes(name)).length;
  assert.deepEqual([count('Claude Code'), count('Codex'), count('OpenCode')], [9, 4, 4]);
  assert.ok(list.some(a => a.apps.length > 1), 'some agent works in more than one app, and says so with more than one tag');
  // Apps come in the order Claude Code, Codex, OpenCode.
  for (const row of list) assert.deepEqual(row.apps, ['Claude Code', 'Codex', 'OpenCode'].filter(n => row.apps.includes(n)));
});

test('an app the world does not know by name is shown by its own id as words, so a Hermes agent is tagged "Hermes"', () => {
  assert.equal(appLabel('claude-code'), 'Claude Code'); assert.equal(appLabel('codex'), 'Codex'); assert.equal(appLabel('opencode'), 'OpenCode');
  assert.equal(appLabel('hermes'), 'Hermes'); assert.equal(appLabel('my-own-app'), 'My Own App');
});

test('an agent with changes that wait is locked: it stays in the list and cannot be skipped, and the others are free', () => {
  const store = createStore(world());
  const before = store.getState();
  const agent = ownedAgents(before.draft).find(a => shelvesOf(before.draft, a).skills.length > 0)!;
  const changed = reduceStore(before, removeAction(agent.id, 'skill', shelvesOf(before.draft, agent).skills[0]!.id));
  const list = findAgents(changed.draft, changed.committed);
  assert.deepEqual(list.filter(a => a.unsaved).map(a => a.id), [agent.id]);
  assert.deepEqual(lockedAgents(list), [agent.id]);
  assert.deepEqual(lockedAgents(findAgents(before.draft, before.committed)), [], 'a world with no changes locks nothing');
});

test('the places stay in the model for "Show details": the home folder first, with the folders of each place', () => {
  const places = findPlaces(world());
  assert.equal(places[0]!.name, 'Your home folder'); assert.ok(places.every(p => p.paths.length > 0));
});

// ---- The machine: ticks are agents.
const ids = ['a', 'b', 'c', 'd'];
const atList = (): FindState => run(startFind(3, ids), { type: 'lightAll' });

test('"Select all" ticks every agent and "Clear" unticks them all, only on the list step', () => {
  let s = run(atList(), { type: 'toggle', id: 'b' }, { type: 'toggle', id: 'c' });
  assert.deepEqual(s.ticked, ['a', 'd']);
  s = run(s, { type: 'selectAll' }); assert.deepEqual(s.ticked, ids, 'in the order of the list');
  s = run(s, { type: 'clear', keep: [] }); assert.deepEqual(s.ticked, []);
  const early = startFind(3, ids);
  assert.equal(findReduce(early, { type: 'selectAll' }), early); assert.equal(findReduce(early, { type: 'clear', keep: [] }), early);
  const confirm = run(atList(), { type: 'looksRight' });
  assert.equal(findReduce(confirm, { type: 'clear', keep: [] }), confirm, 'not after the question is asked');
});

test('"Clear" leaves the locked agents ticked, and ignores a locked id that is not in the list', () => {
  const s = run(atList(), { type: 'clear', keep: ['b', 'zzz'] });
  assert.deepEqual(s.ticked, ['b']);
  assert.equal(Object.isFrozen(s), true);
  // Nothing ticked means "Looks right" does nothing; a locked agent keeps it possible.
  assert.equal(findReduce(run(atList(), { type: 'clear', keep: [] }), { type: 'looksRight' }).step, 'places');
  assert.equal(run(atList(), { type: 'clear', keep: ['b'] }, { type: 'looksRight' }).step, 'confirm');
});

test('a second pass over the same list gives the same state: Select all and Clear are the same action twice', () => {
  const s = run(atList(), { type: 'selectAll' });
  assert.equal(findReduce(s, { type: 'selectAll' }).ticked.join(), s.ticked.join());
  const c = run(atList(), { type: 'clear', keep: [] });
  assert.equal(findReduce(c, { type: 'clear', keep: [] }).ticked.join(), '');
});

// ---- Which screen: the full page is the first scan only.
test('the full-page Find opens from Welcome and from nowhere else: a second Find never mounts it', () => {
  const screens: Screen[] = ['welcome', 'find', 'map'];
  const events: FlowEvent[] = ['find', 'leave', 'done', 'findMore'];
  assert.equal(screenAfter('welcome', 'find'), 'find');
  for (const screen of screens) for (const event of events) {
    const next = screenAfter(screen, event);
    if (next === 'find' && screen !== 'find') assert.deepEqual([screen, event], ['welcome', 'find'], 'the only way to the full page is Find from Welcome');
  }
  assert.equal(screenAfter('map', 'findMore'), 'map', 'Find more on the map stays on the map');
  assert.equal(screenAfter('map', 'find'), 'map', 'even the first-scan event does nothing once the map is shown');
  assert.equal(screenAfter('find', 'done'), 'map'); assert.equal(screenAfter('find', 'leave'), 'welcome');
  assert.equal(screenAfter('welcome', 'done'), 'welcome'); assert.equal(screenAfter('welcome', 'findMore'), 'welcome');
  // Once the map has been shown, no chain of events leads back to the full page.
  let screen: Screen = 'map';
  for (const event of [...events, ...events, ...events]) { screen = screenAfter(screen, event); assert.equal(screen, 'map'); }
});

// ---- The words.
test('the new Find words follow the budget: labels at most 5 words, hints at most 12, no banned word, no path', () => {
  for (const [key, text] of Object.entries(FIND_WORDS.label)) { assert.ok(countWords(text) <= 5, key); assert.equal(bannedIn(text), null, `${key}: ${text}`); }
  for (const [key, text] of Object.entries(FIND_WORDS.hint)) { assert.ok(countWords(text) <= 12, key); assert.equal(bannedIn(text), null, `${key}: ${text}`); }
  assert.deepEqual([FIND_WORDS.label.selectAll, FIND_WORDS.label.clearAll, FIND_WORDS.label.findMore, FIND_WORDS.label.agentsFound, FIND_WORDS.label.worksWith], ['Select all', 'Clear', 'Find more', 'Agents found', 'Works with']);
  assert.equal(foundTitle(10), 'Found 10 agents'); assert.equal(foundTitle(1), 'Found 1 agent');
  assert.equal(readSummary(10), '10 agents'); assert.equal(readSummary(1), '1 agent');
  assert.equal(readingNow('Meeting assistant'), 'Reading Meeting assistant'); assert.equal(readProgress(3, 10), '3 of 10');
  assert.equal(unsavedAgent(), 'This agent has changes you have not saved.');
  assert.deepEqual(assertTextBudget(`<p>${unsavedAgent()}</p><p>${FIND_WORDS.hint.pickAgents}</p><p>${FIND_WORDS.hint.pickOne}</p>`), []);
  assert.equal('appsNote' in FIND_WORDS.hint, false, 'the note about the apps is gone'); assert.equal(FIND_WORDS.hint.pickAgents, 'Untick an agent to skip it.');
});

// ---- The markup.
const draw = (element: ReturnType<typeof createElement>): string => renderToStaticMarkup(createElement(ProtoProvider, { store: createStore(world()) }, element));

test('the first scan page starts looking with a progress bar and no tiles; no per-app tile, count or note is anywhere on it', () => {
  const m = draw(createElement(FindScreen, { world: world(), onLeave: none, onDone: none }));
  assert.match(m, /data-screen="find"/); assert.match(m, /data-step="looking"/); assert.match(m, /Looking for your agents/);
  assert.match(m, /role="progressbar"/); assert.doesNotMatch(m, /fr-tile|Not found|work in more than one app|These are the apps/);
  assert.doesNotMatch(m, /\/Users|\.claude|\.codex|\.opencode/);
  assert.deepEqual(assertTextBudget(m), []);
});

test('the panel draws as a column of the shell: a Find more heading, a Close icon button with a name, and the same scan inside it, not a full page', () => {
  const m = draw(createElement(FindPanel, { world: world(), skipped: [], onClose: none, onDone: none }));
  assert.match(m, /<aside class="hm-panel"[^>]*id="hm-panel"[^>]*data-find=""/); assert.match(m, /<h2 class="kit-heading" id="fr-panel-title"[^>]*>Find more<\/h2>/);
  assert.match(m, /<button[^>]*aria-label="Close"[^>]*data-find-close=""|<button[^>]*data-find-close=""[^>]*aria-label="Close"/);
  assert.match(m, /data-variant="panel"/); assert.doesNotMatch(m, /data-screen="find"|<main|<h1/);
  assert.deepEqual(assertTextBudget(m), []);
});
